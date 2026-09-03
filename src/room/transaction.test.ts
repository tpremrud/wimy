import { describe, expect, it } from "vitest";
import { makePlacedItem, makeRoom } from "../test/room-fixtures";
import type { WimyRoomV1 } from "./document";
import { LIVING_ROOM_TEMPLATE } from "./templates";
import {
  applyRoomTransaction,
  TEST_TRANSACTION_DEPENDENCIES,
  type RoomChange,
  type RuntimeRoomState,
  type TransactionOrigin,
} from "./transaction";

const makeRuntimeState = (
  room: WimyRoomV1 = LIVING_ROOM_TEMPLATE.room,
  revision = 1,
): RuntimeRoomState => ({
  room: structuredClone(room),
  revision,
});

const MAX_REVISION_CHANGES: Array<{
  label: string;
  origin: TransactionOrigin;
  change: RoomChange;
}> = [
  {
    label: "edit",
    origin: "human",
    change: {
      type: "edit",
      operations: [{ type: "remove", itemId: "item_living_rug" }],
    },
  },
  {
    label: "replace",
    origin: "template",
    change: {
      type: "replace",
      room: makeRoom({ name: "Replacement at revision limit" }),
    },
  },
  {
    label: "undo replacement",
    origin: "undo",
    change: {
      type: "replace",
      room: makeRoom({ name: "Undo at revision limit" }),
    },
  },
];

describe("applyRoomTransaction", () => {
  it.each([0, Number.MAX_SAFE_INTEGER + 1, Number.POSITIVE_INFINITY])(
    "fails closed before touching an invalid runtime revision %s",
    (revision) => {
      const before = makeRuntimeState(LIVING_ROOM_TEMPLATE.room, revision);

      expect(() =>
        applyRoomTransaction(
          before,
          {
            expectedRevision: revision,
            origin: "human",
            change: {
              type: "edit",
              operations: [
                { type: "remove", itemId: "item_living_rug" },
              ],
            },
          },
          TEST_TRANSACTION_DEPENDENCIES,
        ),
      ).toThrow("Runtime room revision must be a positive safe integer");
      expect(before).toEqual({
        room: LIVING_ROOM_TEMPLATE.room,
        revision,
      });
    },
  );

  it("commits an edit atomically and increments once", () => {
    const state = makeRuntimeState(LIVING_ROOM_TEMPLATE.room, 4);
    const outcome = applyRoomTransaction(
      state,
      {
        expectedRevision: 4,
        origin: "human",
        change: {
          type: "edit",
          operations: [
            {
              type: "transform",
              itemId: "item_living_sofa",
              pose: { x: 2 },
            },
            { type: "remove", itemId: "item_living_rug" },
          ],
        },
      },
      TEST_TRANSACTION_DEPENDENCIES,
    );

    expect(outcome.result.ok).toBe(true);
    expect(outcome.state.revision).toBe(5);
    if (!outcome.result.ok) throw new Error("expected accepted transaction");
    expect(outcome.result.applied).toBe(2);
    expect(outcome.result.affectedItemIds).toEqual([
      "item_living_sofa",
      "item_living_rug",
    ]);
    expect(outcome.result.receipt).toMatchObject({
      status: "accepted",
      changeType: "edit",
      removedItemIds: ["item_living_rug"],
    });
  });

  it("rolls every operation back when one fails", () => {
    const before = makeRuntimeState(LIVING_ROOM_TEMPLATE.room, 4);
    const outcome = applyRoomTransaction(
      before,
      {
        expectedRevision: 4,
        origin: "human",
        change: {
          type: "edit",
          operations: [
            {
              type: "transform",
              itemId: "item_living_sofa",
              pose: { x: 2 },
            },
            { type: "remove", itemId: "missing_item" },
          ],
        },
      },
      TEST_TRANSACTION_DEPENDENCIES,
    );

    expect(outcome.result).toMatchObject({
      ok: false,
      code: "UNKNOWN_ITEM",
      revision: 4,
      receipt: {
        status: "rejected",
        changeType: "edit",
        removedItemIds: [],
      },
    });
    expect(outcome.state).toBe(before);
    expect(outcome.state).toEqual(before);
  });

  it("rejects a stale expected revision without mutating state", () => {
    const before = makeRuntimeState(LIVING_ROOM_TEMPLATE.room, 4);
    const outcome = applyRoomTransaction(
      before,
      {
        expectedRevision: 3,
        origin: "webmcp",
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
      },
      TEST_TRANSACTION_DEPENDENCIES,
    );

    expect(outcome.result).toMatchObject({
      ok: false,
      code: "REVISION_CONFLICT",
      revision: 4,
    });
    expect(outcome.state).toBe(before);
  });

  it.each(MAX_REVISION_CHANGES)(
    "rejects a $label that would exceed the safe revision limit",
    ({ origin, change }) => {
      const before = makeRuntimeState(
        LIVING_ROOM_TEMPLATE.room,
        Number.MAX_SAFE_INTEGER,
      );
      const outcome = applyRoomTransaction(
        before,
        {
          expectedRevision: Number.MAX_SAFE_INTEGER,
          origin,
          change,
        },
        TEST_TRANSACTION_DEPENDENCIES,
      );

      expect(outcome.state).toBe(before);
      expect(outcome.result).toMatchObject({
        ok: false,
        revision: Number.MAX_SAFE_INTEGER,
        code: "INVALID_DOCUMENT",
        message: `Room revision cannot advance beyond ${Number.MAX_SAFE_INTEGER}`,
        receipt: {
          origin,
          status: "rejected",
          revision: Number.MAX_SAFE_INTEGER,
          code: "INVALID_DOCUMENT",
          affectedItemIds: [],
          removedItemIds: [],
        },
      });
      expect(Number.isSafeInteger(outcome.result.revision)).toBe(true);
      expect(Number.isSafeInteger(outcome.result.receipt.revision)).toBe(
        true,
      );
    },
  );

  it("rejects an edit with more than eight operations", () => {
    const before = makeRuntimeState();
    const outcome = applyRoomTransaction(
      before,
      {
        expectedRevision: 1,
        origin: "human",
        change: {
          type: "edit",
          operations: Array.from({ length: 9 }, () => ({
            type: "transform" as const,
            itemId: "item_living_sofa",
            pose: { x: 2 },
          })),
        },
      },
      TEST_TRANSACTION_DEPENDENCIES,
    );

    expect(outcome.result).toMatchObject({
      ok: false,
      code: "TOO_MANY_OPERATIONS",
      revision: 1,
    });
    expect(outcome.state).toBe(before);
  });

  it("rejects an edit with no operations", () => {
    const before = makeRuntimeState();
    const outcome = applyRoomTransaction(
      before,
      {
        expectedRevision: 1,
        origin: "human",
        change: { type: "edit", operations: [] },
      },
      TEST_TRANSACTION_DEPENDENCIES,
    );

    expect(outcome.result).toMatchObject({
      ok: false,
      code: "TOO_MANY_OPERATIONS",
      revision: 1,
    });
    expect(outcome.state).toBe(before);
  });

  it("uses the product resolver and an app-generated identity for add", () => {
    const snapshot = makePlacedItem().snapshot;
    const state = makeRuntimeState(makeRoom(), 2);
    const outcome = applyRoomTransaction(
      state,
      {
        expectedRevision: 2,
        origin: "webmcp",
        change: {
          type: "edit",
          operations: [
            {
              type: "add",
              productId: "chair-1",
              pose: { x: 2, y: 1.5, rotationDeg: 0 },
            },
          ],
        },
      },
      {
        resolveProduct: (productId) =>
          productId === "chair-1"
            ? {
                catalogRef: {
                  catalogId: "wimy-demo-v1",
                  productId,
                },
                snapshot,
              }
            : undefined,
        createItemId: () => "item_generated_1",
      },
    );

    expect(outcome.result).toMatchObject({
      ok: true,
      revision: 3,
      applied: 1,
      affectedItemIds: ["item_generated_1"],
      receipt: {
        summary: "Added Test Chair",
      },
    });
    expect(outcome.state.room.items).toEqual([
      {
        id: "item_generated_1",
        catalogRef: {
          catalogId: "wimy-demo-v1",
          productId: "chair-1",
        },
        pose: { x: 2, y: 1.5, rotationDeg: 0 },
        snapshot,
      },
    ]);
  });

  it("rejects an add when the product resolver cannot resolve it", () => {
    const before = makeRuntimeState(makeRoom());
    const outcome = applyRoomTransaction(
      before,
      {
        expectedRevision: 1,
        origin: "human",
        change: {
          type: "edit",
          operations: [
            {
              type: "add",
              productId: "missing-product",
              pose: { x: 2, y: 1.5, rotationDeg: 0 },
            },
          ],
        },
      },
      TEST_TRANSACTION_DEPENDENCIES,
    );

    expect(outcome.result).toMatchObject({
      ok: false,
      code: "UNKNOWN_PRODUCT",
      revision: 1,
    });
    expect(outcome.state).toBe(before);
  });

  it("rejects an app-generated identity that already exists", () => {
    const existingItem = makePlacedItem({ id: "item_generated_1" });
    const before = makeRuntimeState(makeRoom({ items: [existingItem] }));
    const outcome = applyRoomTransaction(
      before,
      {
        expectedRevision: 1,
        origin: "human",
        change: {
          type: "edit",
          operations: [
            {
              type: "add",
              productId: "chair-1",
              pose: { x: 2, y: 1.5, rotationDeg: 0 },
            },
          ],
        },
      },
      {
        resolveProduct: () => ({
          catalogRef: {
            catalogId: "wimy-demo-v1",
            productId: "chair-1",
          },
          snapshot: existingItem.snapshot,
        }),
        createItemId: () => "item_generated_1",
      },
    );

    expect(outcome.result).toMatchObject({
      ok: false,
      code: "INVALID_DOCUMENT",
      revision: 1,
    });
    expect(outcome.state).toBe(before);
  });

  it("rejects an added item outside the room", () => {
    const item = makePlacedItem();
    const before = makeRuntimeState(makeRoom());
    const outcome = applyRoomTransaction(
      before,
      {
        expectedRevision: 1,
        origin: "human",
        change: {
          type: "edit",
          operations: [
            {
              type: "add",
              productId: "chair-1",
              pose: { x: 0.1, y: 0.1, rotationDeg: 0 },
            },
          ],
        },
      },
      {
        resolveProduct: () => ({
          catalogRef: {
            catalogId: "wimy-demo-v1",
            productId: "chair-1",
          },
          snapshot: item.snapshot,
        }),
        createItemId: () => "item_generated_1",
      },
    );

    expect(outcome.result).toMatchObject({
      ok: false,
      code: "OUT_OF_BOUNDS",
      revision: 1,
    });
    expect(outcome.state).toBe(before);
  });

  it("reports OUT_OF_BOUNDS when an added product is taller than the room", () => {
    const room = makeRoom();
    const baseItem = makePlacedItem();
    const before = makeRuntimeState(room);
    const outcome = applyRoomTransaction(
      before,
      {
        expectedRevision: 1,
        origin: "webmcp",
        change: {
          type: "edit",
          operations: [
            {
              type: "add",
              productId: "tall-chair",
              pose: { x: 2, y: 1.5, rotationDeg: 0 },
            },
          ],
        },
      },
      {
        resolveProduct: () => ({
          catalogRef: {
            catalogId: "wimy-demo-v1",
            productId: "tall-chair",
          },
          snapshot: {
            ...baseItem.snapshot,
            dimensions: {
              ...baseItem.snapshot.dimensions,
              height: room.dimensions.height + 0.1,
            },
          },
        }),
        createItemId: () => "item_tall_chair",
      },
    );

    expect(outcome.result).toMatchObject({
      ok: false,
      code: "OUT_OF_BOUNDS",
      revision: 1,
      message: expect.stringMatching(/height.*room/iu),
    });
    expect(outcome.state).toBe(before);
  });

  it("reports OUT_OF_BOUNDS when transforming an over-height item", () => {
    const room = makeRoom();
    const baseItem = makePlacedItem();
    const tallItem = makePlacedItem({
      snapshot: {
        ...baseItem.snapshot,
        dimensions: {
          ...baseItem.snapshot.dimensions,
          height: room.dimensions.height + 0.1,
        },
      },
    });
    const before = makeRuntimeState(makeRoom({ items: [tallItem] }));
    const outcome = applyRoomTransaction(
      before,
      {
        expectedRevision: 1,
        origin: "human",
        change: {
          type: "edit",
          operations: [
            {
              type: "transform",
              itemId: tallItem.id,
              pose: { x: 1.2 },
            },
          ],
        },
      },
      TEST_TRANSACTION_DEPENDENCIES,
    );

    expect(outcome.result).toMatchObject({
      ok: false,
      code: "OUT_OF_BOUNDS",
      revision: 1,
      message: expect.stringMatching(/height.*room/iu),
    });
    expect(outcome.state).toBe(before);
  });

  it("rejects a transformed item that collides with blocking furniture", () => {
    const before = makeRuntimeState();
    const outcome = applyRoomTransaction(
      before,
      {
        expectedRevision: 1,
        origin: "human",
        change: {
          type: "edit",
          operations: [
            {
              type: "transform",
              itemId: "item_living_sofa",
              pose: { x: 2.4, y: 2.2 },
            },
          ],
        },
      },
      TEST_TRANSACTION_DEPENDENCIES,
    );

    expect(outcome.result).toMatchObject({
      ok: false,
      code: "COLLISION",
      revision: 1,
    });
    expect(outcome.state).toBe(before);
  });

  it("rejects an invalid app-generated identity through document validation", () => {
    const item = makePlacedItem();
    const before = makeRuntimeState(makeRoom());
    const outcome = applyRoomTransaction(
      before,
      {
        expectedRevision: 1,
        origin: "human",
        change: {
          type: "edit",
          operations: [
            {
              type: "add",
              productId: "chair-1",
              pose: { x: 2, y: 1.5, rotationDeg: 0 },
            },
          ],
        },
      },
      {
        resolveProduct: () => ({
          catalogRef: {
            catalogId: "wimy-demo-v1",
            productId: "chair-1",
          },
          snapshot: item.snapshot,
        }),
        createItemId: () => "not valid!",
      },
    );

    expect(outcome.result).toMatchObject({
      ok: false,
      code: "INVALID_DOCUMENT",
      revision: 1,
    });
    expect(outcome.state).toBe(before);
  });

  it("replaces a valid room once and reports existing layout warnings", () => {
    const replacement = makeRoom({
      name: "Imported Room",
      items: [
        makePlacedItem(),
        makePlacedItem({ id: "item_chair_2" }),
      ],
    });
    const outcome = applyRoomTransaction(
      makeRuntimeState(undefined, 5),
      {
        expectedRevision: 5,
        origin: "import",
        change: { type: "replace", room: replacement },
      },
      TEST_TRANSACTION_DEPENDENCIES,
    );

    expect(outcome.result).toMatchObject({
      ok: true,
      revision: 6,
      applied: 1,
      affectedItemIds: ["item_chair_1", "item_chair_2"],
      receipt: {
        origin: "import",
        status: "accepted",
        revision: 6,
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
    expect(outcome.state).toEqual({ room: replacement, revision: 6 });
    if (!outcome.result.ok) throw new Error("expected accepted replacement");
    expect(outcome.result.warnings).toContainEqual({
      code: "OVERLAP",
      message: "item_chair_1 overlaps item_chair_2",
      itemIds: ["item_chair_1", "item_chair_2"],
    });
  });

  it("rejects an invalid replacement without changing state", () => {
    const before = makeRuntimeState(undefined, 5);
    const outcome = applyRoomTransaction(
      before,
      {
        expectedRevision: 5,
        origin: "import",
        change: {
          type: "replace",
          room: makeRoom({
            dimensions: { width: 0, depth: 3, height: 2.7 },
          }),
        },
      },
      TEST_TRANSACTION_DEPENDENCIES,
    );

    expect(outcome.result).toMatchObject({
      ok: false,
      code: "INVALID_DOCUMENT",
      revision: 5,
      receipt: {
        origin: "import",
        status: "rejected",
        revision: 5,
        changeType: "replace",
        removedItemIds: [],
      },
    });
    expect(outcome.state).toBe(before);
  });

  it("allows an unrelated edit when imported warnings already exist", () => {
    const room = makeRoom({
      items: [
        makePlacedItem(),
        makePlacedItem({ id: "item_chair_2" }),
        makePlacedItem({
          id: "item_chair_3",
          pose: { x: 3, y: 2, rotationDeg: 0 },
        }),
      ],
    });
    const outcome = applyRoomTransaction(
      makeRuntimeState(room),
      {
        expectedRevision: 1,
        origin: "human",
        change: {
          type: "edit",
          operations: [
            {
              type: "transform",
              itemId: "item_chair_3",
              pose: { x: 3.2 },
            },
          ],
        },
      },
      TEST_TRANSACTION_DEPENDENCIES,
    );

    expect(outcome.result).toMatchObject({ ok: true, revision: 2 });
    if (!outcome.result.ok) throw new Error("expected accepted transaction");
    expect(outcome.result.warnings).toContainEqual({
      code: "OVERLAP",
      message: "item_chair_1 overlaps item_chair_2",
      itemIds: ["item_chair_1", "item_chair_2"],
    });
  });

  it("commits one atomic structure change while preserving placed-item identity and snapshots", () => {
    const item = makePlacedItem({
      id: "item_preserved",
      pose: { x: 1, y: 1, rotationDeg: 90 },
    });
    const before = makeRuntimeState(
      makeRoom({ items: [item] }),
      7,
    );

    const outcome = applyRoomTransaction(
      before,
      {
        expectedRevision: 7,
        origin: "webmcp",
        change: {
          type: "structure",
          dimensions: { width: 5 },
          geometry: {
            shape: "l-shape",
            notch: { corner: "south-east", width: 1, depth: 1 },
          },
          openingOperations: [
            {
              type: "add",
              opening: {
                id: "window_added",
                kind: "window",
                wall: "north",
                centerOffset: 2.5,
                width: 1.2,
                bottom: 0.9,
                height: 1.2,
              },
            },
          ],
        },
      },
      TEST_TRANSACTION_DEPENDENCIES,
    );

    expect(outcome.result).toMatchObject({
      ok: true,
      revision: 8,
      applied: 1,
      affectedItemIds: [],
      receipt: {
        origin: "webmcp",
        status: "accepted",
        revision: 8,
        changeType: "structure",
        affectedItemIds: [],
        removedItemIds: [],
        affectedOpeningIds: ["window_added"],
        removedOpeningIds: [],
      },
    });
    expect(outcome.state.room).toMatchObject({
      dimensions: { width: 5, depth: 3, height: 2.7 },
      geometry: {
        shape: "l-shape",
        notch: { corner: "south-east", width: 1, depth: 1 },
      },
      openings: [
        expect.objectContaining({ id: "window_added", kind: "window" }),
      ],
    });
    expect(outcome.state.room.items).toEqual([item]);
    expect(outcome.state.revision).toBe(8);
  });

  it("supports every opening operation without changing the room more than once", () => {
    const before = makeRuntimeState(
      makeRoom({
        openings: [
          {
            id: "door_existing",
            kind: "door",
            wall: "west",
            centerOffset: 2,
            width: 0.8,
            bottom: 0,
            height: 2.1,
          },
          {
            id: "window_existing",
            kind: "window",
            wall: "north",
            centerOffset: 2,
            width: 1.2,
            bottom: 1,
            height: 1.2,
          },
        ],
      }),
      3,
    );

    const outcome = applyRoomTransaction(
      before,
      {
        expectedRevision: 3,
        origin: "webmcp",
        change: {
          type: "structure",
          openingOperations: [
            {
              type: "move",
              openingId: "door_existing",
              patch: { wall: "east", centerOffset: 1 },
            },
            {
              type: "resize",
              openingId: "window_existing",
              patch: { width: 1 },
            },
            {
              type: "update",
              openingId: "window_existing",
              patch: { bottom: 0.8, height: 1.3 },
            },
            {
              type: "add",
              opening: {
                id: "window_added",
                kind: "window",
                wall: "south",
                centerOffset: 2,
                width: 1,
                bottom: 0.9,
                height: 1.2,
              },
            },
            { type: "remove", openingId: "window_added" },
          ],
        },
      },
      TEST_TRANSACTION_DEPENDENCIES,
    );

    expect(outcome.result).toMatchObject({
      ok: true,
      revision: 4,
      applied: 1,
      receipt: {
        affectedOpeningIds: [
          "door_existing",
          "window_existing",
          "window_existing",
          "window_added",
          "window_added",
        ],
        removedOpeningIds: ["window_added"],
      },
    });
    expect(outcome.state.room.openings).toEqual([
      {
        id: "door_existing",
        kind: "door",
        wall: "east",
        centerOffset: 1,
        width: 0.8,
        bottom: 0,
        height: 2.1,
      },
      {
        id: "window_existing",
        kind: "window",
        wall: "north",
        centerOffset: 2,
        width: 1,
        bottom: 0.8,
        height: 1.3,
      },
    ]);
  });

  it.each([
    {
      label: "shrinking around furniture",
      room: makeRoom({
        items: [makePlacedItem({ pose: { x: 3.7, y: 1, rotationDeg: 0 } })],
      }),
      change: { dimensions: { width: 3 } },
      code: "INVALID_DOCUMENT",
    },
    {
      label: "cutting through furniture with the L notch",
      room: makeRoom({
        items: [makePlacedItem({ pose: { x: 3.5, y: 2.5, rotationDeg: 0 } })],
      }),
      change: {
        geometry: {
          shape: "l-shape" as const,
          notch: { corner: "south-east" as const, width: 1, depth: 1 },
        },
      },
      code: "INVALID_DOCUMENT",
    },
  ])("rejects a structure change that invalidates $label", ({ room, change, code }) => {
    const before = makeRuntimeState(room);
    const outcome = applyRoomTransaction(
      before,
      {
        expectedRevision: 1,
        origin: "webmcp",
        change: { type: "structure", openingOperations: [], ...change },
      },
      TEST_TRANSACTION_DEPENDENCIES,
    );

    expect(outcome.result).toMatchObject({ ok: false, code, revision: 1 });
    expect(outcome.state).toBe(before);
  });

  it("rejects overlapping openings and rolls back earlier opening operations", () => {
    const before = makeRuntimeState(makeRoom());
    const outcome = applyRoomTransaction(
      before,
      {
        expectedRevision: 1,
        origin: "webmcp",
        change: {
          type: "structure",
          openingOperations: [
            {
              type: "add",
              opening: {
                id: "window_first",
                kind: "window",
                wall: "north",
                centerOffset: 1.5,
                width: 1,
                bottom: 1,
                height: 1,
              },
            },
            {
              type: "add",
              opening: {
                id: "window_overlap",
                kind: "window",
                wall: "north",
                centerOffset: 1.8,
                width: 1,
                bottom: 1,
                height: 1,
              },
            },
          ],
        },
      },
      TEST_TRANSACTION_DEPENDENCIES,
    );

    expect(outcome.result).toMatchObject({
      ok: false,
      code: "INVALID_DOCUMENT",
      message: expect.stringMatching(/overlap/iu),
    });
    expect(outcome.state).toBe(before);
    expect(outcome.state.room.openings).toEqual([]);
  });

  it("rejects adding a door whose protected clearance would invalidate existing furniture", () => {
    const before = makeRuntimeState(
      makeRoom({
        items: [makePlacedItem({ pose: { x: 2, y: 0.5, rotationDeg: 0 } })],
      }),
    );
    const outcome = applyRoomTransaction(
      before,
      {
        expectedRevision: 1,
        origin: "webmcp",
        change: {
          type: "structure",
          openingOperations: [
            {
              type: "add",
              opening: {
                id: "door_added_north",
                kind: "door",
                wall: "north",
                centerOffset: 2,
                width: 1,
                bottom: 0,
                height: 2.1,
              },
            },
          ],
        },
      },
      TEST_TRANSACTION_DEPENDENCIES,
    );

    expect(outcome.result).toMatchObject({
      ok: false,
      code: "DOOR_CLEARANCE",
      message: "The placed item blocks door clearance at door_added_north",
    });
    expect(outcome.state).toBe(before);
  });
});
