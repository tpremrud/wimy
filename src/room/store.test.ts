import { describe, expect, it } from "vitest";
import { makePlacedItem, makeRoom } from "../test/room-fixtures";
import { getTemplate } from "./templates";
import { createRoomStore, roomStore, type RoomStore } from "./store";
import {
  TEST_TRANSACTION_DEPENDENCIES,
  type RoomTransactionResult,
} from "./transaction";

describe("createRoomStore", () => {
  it("offers transact as the only room writer from revision one", () => {
    const initialRoom = getTemplate("living-room");
    const store = createRoomStore(
      initialRoom,
      TEST_TRANSACTION_DEPENDENCIES,
    );
    const state = store.getState();

    expect(state.room).toEqual(initialRoom);
    expect(state.revision).toBe(1);
    expect(typeof state.transact).toBe("function");
    expect(typeof state.createUndoRequest).toBe("function");
    expect(typeof state.getLayoutWarnings).toBe("function");
    expect(state).not.toHaveProperty("setRoom");
    expect(state).not.toHaveProperty("moveItem");
    expect(state).not.toHaveProperty("undo");
    expect(store).not.toHaveProperty("setState");
  });

  it.each([
    {
      name: "known custom reference",
      resolvedCatalogId: "custom-catalog",
      expectedWarnings: 0,
    },
    {
      name: "catalog id mismatch",
      resolvedCatalogId: "different-catalog",
      expectedWarnings: 1,
    },
    {
      name: "unknown custom reference",
      resolvedCatalogId: undefined,
      expectedWarnings: 1,
    },
  ])(
    "derives current layout warnings from injected dependencies for $name",
    ({ resolvedCatalogId, expectedWarnings }) => {
      const item = makePlacedItem({
        catalogRef: {
          catalogId: "custom-catalog",
          productId: "custom-chair",
        },
      });
      const store = createRoomStore(makeRoom({ items: [item] }), {
        resolveProduct: (productId) =>
          resolvedCatalogId === undefined
            ? undefined
            : {
                catalogRef: {
                  catalogId: resolvedCatalogId,
                  productId,
                },
                snapshot: item.snapshot,
              },
        createItemId: () => "item_generated_1",
      });

      const warnings = store.getState().getLayoutWarnings();

      expect(warnings).toHaveLength(expectedWarnings);
      if (expectedWarnings > 0) {
        expect(warnings[0]).toMatchObject({
          code: "CATALOG_UNAVAILABLE",
          itemIds: [item.id],
        });
      }
      expect(store.getState()).not.toHaveProperty("setLayoutWarnings");
    },
  );

  it("protects committed state from out-of-band mutation", () => {
    const initialRoom = getTemplate("living-room");
    const store = createRoomStore(
      initialRoom,
      TEST_TRANSACTION_DEPENDENCIES,
    );
    const exposed = store.getState();

    expect(Object.isFrozen(exposed)).toBe(true);
    expect(Object.isFrozen(exposed.room)).toBe(true);
    expect(Object.isFrozen(exposed.room.items)).toBe(true);
    expect(() => {
      Object.assign(exposed.room, {
        name: "Tampered without a transaction",
      });
    }).toThrow(TypeError);
    expect(store.getState().room.name).toBe(initialRoom.name);
    expect(store.getState().revision).toBe(1);
  });

  it("commits an accepted transaction and stores its receipt", () => {
    const initialRoom = getTemplate("living-room");
    const store = createRoomStore(
      initialRoom,
      TEST_TRANSACTION_DEPENDENCIES,
    );

    const result = store.getState().transact({
      expectedRevision: 1,
      origin: "human",
      change: {
        type: "edit",
        operations: [
          {
            type: "transform",
            itemId: "item_living_sofa",
            pose: { x: 2 },
          },
        ],
      },
    });

    expect(result).toMatchObject({
      ok: true,
      revision: 2,
      applied: 1,
      receipt: {
        changeType: "edit",
        removedItemIds: [],
      },
    });
    const state = store.getState();
    expect(state.revision).toBe(2);
    expect(
      state.room.items.find(({ id }) => id === "item_living_sofa")?.pose.x,
    ).toBe(2);
    expect(state.receipts).toEqual([result.receipt]);
    expect(state.previousRoom).toEqual(initialRoom);
  });

  it("returns an accepted result and notifies later subscribers when one throws", () => {
    const reportedErrors: unknown[] = [];
    const store = createRoomStore(
      getTemplate("living-room"),
      TEST_TRANSACTION_DEPENDENCIES,
      {
        reportSubscriberError: (error) => {
          reportedErrors.push(error);
          throw new Error("reporter exploded");
        },
      },
    );
    store.subscribe(() => {
      throw new Error("subscriber exploded");
    });
    const observedRevisions: number[] = [];
    store.subscribe((state) => {
      observedRevisions.push(state.revision);
    });
    let result: RoomTransactionResult | undefined;

    expect(() => {
      result = store.getState().transact({
        expectedRevision: 1,
        origin: "human",
        change: {
          type: "edit",
          operations: [
            {
              type: "transform",
              itemId: "item_living_sofa",
              pose: { x: 2 },
            },
          ],
        },
      });
    }).not.toThrow();

    expect(result).toMatchObject({
      ok: true,
      revision: 2,
      receipt: { status: "accepted", revision: 2 },
    });
    expect(store.getState().revision).toBe(2);
    expect(
      store.getState().room.items.find(
        ({ id }) => id === "item_living_sofa",
      )?.pose.x,
    ).toBe(2);
    expect(store.getState().receipts).toMatchObject([
      { origin: "human", status: "accepted", revision: 2 },
    ]);
    expect(observedRevisions).toEqual([2]);
    expect(reportedErrors).toHaveLength(1);
    expect(reportedErrors[0]).toMatchObject({
      message: "subscriber exploded",
    });
  });

  it("preserves listener identity across duplicate subscriptions", () => {
    const store = createRoomStore(
      getTemplate("living-room"),
      TEST_TRANSACTION_DEPENDENCIES,
    );
    let listenerCalls = 0;
    const listener = () => {
      listenerCalls += 1;
    };
    const unsubscribeFirst = store.subscribe(listener);
    const unsubscribeSecond = store.subscribe(listener);

    store.getState().transact({
      expectedRevision: 1,
      origin: "human",
      change: {
        type: "edit",
        operations: [
          {
            type: "transform",
            itemId: "item_living_sofa",
            pose: { x: 2 },
          },
        ],
      },
    });

    expect(listenerCalls).toBe(1);

    unsubscribeFirst();
    store.getState().transact({
      expectedRevision: 2,
      origin: "human",
      change: {
        type: "edit",
        operations: [
          { type: "remove", itemId: "item_living_rug" },
        ],
      },
    });

    expect(listenerCalls).toBe(1);
    unsubscribeSecond();
  });

  it.each(["resolveProduct", "createItemId"] as const)(
    "rejects %s reentrant transact without losing outer state or receipts",
    (reentryPoint) => {
      const existingItem = makePlacedItem();
      const initialRoom = makeRoom({ items: [existingItem] });
      const storeRef: { current?: RoomStore } = {};
      let reentrantResult: RoomTransactionResult | undefined;
      let hasReentered = false;
      const reenter = () => {
        if (hasReentered) return;

        hasReentered = true;
        if (!storeRef.current) throw new Error("expected initialized store");
        reentrantResult = storeRef.current.getState().transact({
          expectedRevision: 1,
          origin: "webmcp",
          change: {
            type: "edit",
            operations: [
              { type: "remove", itemId: existingItem.id },
            ],
          },
        });
      };
      const dependencies = {
        resolveProduct: (productId: string) => {
          if (reentryPoint === "resolveProduct") reenter();
          return {
            catalogRef: { catalogId: "wimy-demo-v1", productId },
            snapshot: existingItem.snapshot,
          };
        },
        createItemId: () => {
          if (reentryPoint === "createItemId") reenter();
          return "item_generated_1";
        },
      };
      const store = createRoomStore(initialRoom, dependencies);
      storeRef.current = store;

      const outerResult = store.getState().transact({
        expectedRevision: 1,
        origin: "human",
        change: {
          type: "edit",
          operations: [
            {
              type: "add",
              productId: "chair-2",
              pose: { x: 3, y: 2, rotationDeg: 0 },
            },
          ],
        },
      });

      expect(reentrantResult).toMatchObject({
        ok: false,
        code: "REVISION_CONFLICT",
        revision: 1,
        message: expect.stringMatching(/transaction.*progress.*retry/iu),
        receipt: {
          origin: "webmcp",
          status: "rejected",
          code: "REVISION_CONFLICT",
          changeType: "edit",
          removedItemIds: [],
        },
      });
      expect(outerResult).toMatchObject({ ok: true, revision: 2 });
      expect(store.getState().revision).toBe(2);
      expect(store.getState().room.items.map(({ id }) => id)).toEqual([
        existingItem.id,
        "item_generated_1",
      ]);
      expect(store.getState().receipts).toMatchObject([
        { origin: "human", status: "accepted", revision: 2 },
        {
          origin: "webmcp",
          status: "rejected",
          revision: 1,
          code: "REVISION_CONFLICT",
        },
      ]);

      const nextResult = store.getState().transact({
        expectedRevision: 2,
        origin: "human",
        change: {
          type: "edit",
          operations: [
            { type: "remove", itemId: "item_generated_1" },
          ],
        },
      });
      expect(nextResult).toMatchObject({ ok: true, revision: 3 });
    },
  );

  it("treats a subscriber transaction after publication as a new commit", () => {
    const store = createRoomStore(
      getTemplate("living-room"),
      TEST_TRANSACTION_DEPENDENCIES,
    );
    let subscriberResult: RoomTransactionResult | undefined;
    let hasSubmitted = false;
    const unsubscribe = store.subscribe((state) => {
      if (hasSubmitted || state.revision !== 2) return;

      hasSubmitted = true;
      subscriberResult = state.transact({
        expectedRevision: 2,
        origin: "webmcp",
        change: {
          type: "edit",
          operations: [
            { type: "remove", itemId: "item_living_rug" },
          ],
        },
      });
    });

    const outerResult = store.getState().transact({
      expectedRevision: 1,
      origin: "human",
      change: {
        type: "edit",
        operations: [
          {
            type: "transform",
            itemId: "item_living_sofa",
            pose: { x: 2 },
          },
        ],
      },
    });
    unsubscribe();

    expect(outerResult).toMatchObject({ ok: true, revision: 2 });
    expect(subscriberResult).toMatchObject({ ok: true, revision: 3 });
    expect(store.getState().revision).toBe(3);
    expect(
      store.getState().room.items.some(({ id }) => id === "item_living_rug"),
    ).toBe(false);
    expect(store.getState().receipts).toMatchObject([
      { origin: "webmcp", status: "accepted", revision: 3 },
      { origin: "human", status: "accepted", revision: 2 },
    ]);
  });

  it("retains a reentrant rejection receipt when a dependency throws", () => {
    const existingItem = makePlacedItem();
    const initialRoom = makeRoom({ items: [existingItem] });
    const storeRef: { current?: RoomStore } = {};
    let reentrantResult: RoomTransactionResult | undefined;
    const reportedErrors: unknown[] = [];
    const dependencies = {
      resolveProduct: () => {
        if (!storeRef.current) throw new Error("expected initialized store");
        reentrantResult = storeRef.current.getState().transact({
          expectedRevision: 1,
          origin: "webmcp",
          change: {
            type: "edit",
            operations: [
              { type: "remove", itemId: existingItem.id },
            ],
          },
        });
        throw new Error("resolver failed after reentry");
      },
      createItemId: () => "item_generated_1",
    };
    const store = createRoomStore(initialRoom, dependencies, {
      reportSubscriberError: (error) => reportedErrors.push(error),
    });
    storeRef.current = store;
    store.subscribe(() => {
      throw new Error("subscriber exploded during receipt flush");
    });
    let laterSubscriberCalls = 0;
    store.subscribe(() => {
      laterSubscriberCalls += 1;
    });

    expect(() =>
      store.getState().transact({
        expectedRevision: 1,
        origin: "human",
        change: {
          type: "edit",
          operations: [
            {
              type: "add",
              productId: "chair-2",
              pose: { x: 3, y: 2, rotationDeg: 0 },
            },
          ],
        },
      }),
    ).toThrow("resolver failed after reentry");

    expect(reentrantResult).toMatchObject({
      ok: false,
      code: "REVISION_CONFLICT",
      revision: 1,
    });
    expect(store.getState().revision).toBe(1);
    expect(store.getState().room).toEqual(initialRoom);
    expect(store.getState().receipts).toMatchObject([
      {
        origin: "webmcp",
        status: "rejected",
        revision: 1,
        code: "REVISION_CONFLICT",
      },
    ]);
    expect(laterSubscriberCalls).toBe(1);
    expect(reportedErrors).toHaveLength(1);
    expect(reportedErrors[0]).toMatchObject({
      message: "subscriber exploded during receipt flush",
    });
  });

  it("isolates returned transaction results from stored receipt history", () => {
    const store = createRoomStore(
      getTemplate("living-room"),
      TEST_TRANSACTION_DEPENDENCIES,
    );
    const accepted = store.getState().transact({
      expectedRevision: 1,
      origin: "human",
      change: {
        type: "edit",
        operations: [
          {
            type: "transform",
            itemId: "item_living_sofa",
            pose: { x: 2 },
          },
        ],
      },
    });
    const rejected = store.getState().transact({
      expectedRevision: 1,
      origin: "webmcp",
      change: {
        type: "edit",
        operations: [
          { type: "remove", itemId: "item_living_sofa" },
        ],
      },
    });
    const [storedRejected, storedAccepted] = store.getState().receipts;

    expect(storedAccepted).not.toBe(accepted.receipt);
    expect(storedRejected).not.toBe(rejected.receipt);
    expect(Object.isFrozen(accepted)).toBe(false);
    expect(Object.isFrozen(rejected)).toBe(false);
    if (!accepted.ok) throw new Error("expected an accepted result");
    expect(accepted.affectedItemIds).not.toBe(
      accepted.receipt.affectedItemIds,
    );

    accepted.receipt.summary = "Caller-owned accepted result";
    rejected.receipt.summary = "Caller-owned rejected result";
    accepted.affectedItemIds.push("item_caller_owned");
    expect(accepted.receipt.affectedItemIds).not.toContain(
      "item_caller_owned",
    );
    expect(storedAccepted?.summary).toBe("Applied 1 room operations");
    expect(storedRejected?.summary).toBe(
      "Expected revision 1, but the room is at revision 2",
    );
  });

  it("appends only a failure receipt for a rejected transaction", () => {
    const store = createRoomStore(
      getTemplate("living-room"),
      TEST_TRANSACTION_DEPENDENCIES,
    );
    const before = store.getState();

    const result = before.transact({
      expectedRevision: 0,
      origin: "webmcp",
      change: {
        type: "edit",
        operations: [
          {
            type: "remove",
            itemId: "item_living_sofa",
          },
        ],
      },
    });

    expect(result).toMatchObject({
      ok: false,
      code: "REVISION_CONFLICT",
      revision: 1,
    });
    const after = store.getState();
    expect(after.room).toBe(before.room);
    expect(after.revision).toBe(before.revision);
    expect(after.previousRoom).toBe(before.previousRoom);
    expect(after.selectedItemId).toBe(before.selectedItemId);
    expect(after.receipts).toEqual([result.receipt]);
  });

  it("keeps only the newest twenty receipts", () => {
    const store = createRoomStore(
      getTemplate("living-room"),
      TEST_TRANSACTION_DEPENDENCIES,
    );

    for (let index = 0; index < 21; index += 1) {
      store.getState().transact({
        expectedRevision: 0,
        origin: index === 20 ? "undo" : "human",
        change: {
          type: "edit",
          operations: [
            { type: "remove", itemId: "item_living_sofa" },
          ],
        },
      });
    }

    expect(store.getState().receipts).toHaveLength(20);
    expect(store.getState().receipts[0]?.origin).toBe("undo");
  });

  it("expresses one-level undo as a replacement request", () => {
    const initialRoom = getTemplate("living-room");
    const store = createRoomStore(
      initialRoom,
      TEST_TRANSACTION_DEPENDENCIES,
    );
    store.getState().transact({
      expectedRevision: 1,
      origin: "human",
      change: {
        type: "edit",
        operations: [
          {
            type: "transform",
            itemId: "item_living_sofa",
            pose: { x: 2 },
          },
        ],
      },
    });

    expect(store.getState().createUndoRequest()).toEqual({
      expectedRevision: 2,
      origin: "undo",
      change: { type: "replace", room: initialRoom },
    });
  });

  it("submits undo through transact, increments revision, and consumes it", () => {
    const initialRoom = getTemplate("living-room");
    const store = createRoomStore(
      initialRoom,
      TEST_TRANSACTION_DEPENDENCIES,
    );
    store.getState().transact({
      expectedRevision: 1,
      origin: "human",
      change: {
        type: "edit",
        operations: [
          {
            type: "transform",
            itemId: "item_living_sofa",
            pose: { x: 2 },
          },
        ],
      },
    });
    const undoRequest = store.getState().createUndoRequest();
    if (!undoRequest) throw new Error("expected an undo request");

    const result = store.getState().transact(undoRequest);

    expect(result).toMatchObject({
      ok: true,
      revision: 3,
      receipt: { origin: "undo", status: "accepted", revision: 3 },
    });
    expect(store.getState().room).toEqual(initialRoom);
    expect(store.getState().previousRoom).toBeNull();
    expect(store.getState().createUndoRequest()).toBeNull();
    expect(store.getState().receipts.map(({ origin }) => origin)).toEqual([
      "undo",
      "human",
    ]);
  });

  it("clears selection after a successful replacement", () => {
    const store = createRoomStore(
      getTemplate("living-room"),
      TEST_TRANSACTION_DEPENDENCIES,
    );
    store.getState().selectItem("item_living_sofa");
    expect(store.getState().selectedItemId).toBe("item_living_sofa");

    const result = store.getState().transact({
      expectedRevision: 1,
      origin: "template",
      change: { type: "replace", room: getTemplate("blank-room") },
    });

    expect(result).toMatchObject({
      ok: true,
      revision: 2,
      receipt: {
        origin: "template",
        status: "accepted",
        changeType: "replace",
        removedItemIds: [
          "item_living_sofa",
          "item_living_rug",
          "item_living_table",
          "item_living_chair",
          "item_living_plant",
        ],
      },
    });
    expect(store.getState().selectedItemId).toBeNull();
  });

  it("clears selection when a successful edit removes the selected item", () => {
    const store = createRoomStore(
      getTemplate("living-room"),
      TEST_TRANSACTION_DEPENDENCIES,
    );
    store.getState().selectItem("item_living_sofa");

    const result = store.getState().transact({
      expectedRevision: 1,
      origin: "webmcp",
      change: {
        type: "edit",
        operations: [
          { type: "remove", itemId: "item_living_sofa" },
        ],
      },
    });

    expect(result).toMatchObject({
      ok: true,
      revision: 2,
      receipt: {
        changeType: "edit",
        removedItemIds: ["item_living_sofa"],
      },
    });
    expect(store.getState().selectedItemId).toBeNull();
  });
});

describe("roomStore production dependencies", () => {
  it("resolves a demo catalog add while retaining app-owned identity generation", () => {
    const before = roomStore.getState();

    const result = before.transact({
      expectedRevision: before.revision,
      origin: "human",
      change: {
        type: "edit",
        operations: [
          {
            type: "add",
            productId: "ember-nest-chair",
            pose: { x: 0.3, y: 0.3, rotationDeg: 0 },
          },
        ],
      },
    });

    expect(result).toMatchObject({
      ok: true,
      revision: before.revision + 1,
      applied: 1,
      receipt: { summary: "Added Ember Nest Chair" },
    });
    if (!result.ok) throw new Error("expected the catalog add to succeed");
    const addedItem = roomStore
      .getState()
      .room.items.find(({ id }) => result.affectedItemIds.includes(id));
    expect(addedItem).toMatchObject({
      id: expect.stringMatching(/^item_[A-Fa-f0-9-]+$/u),
      catalogRef: {
        catalogId: "wimy-demo-v1",
        productId: "ember-nest-chair",
      },
      snapshot: { name: "Ember Nest Chair" },
    });
  });
});
