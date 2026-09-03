import { describe, expect, it } from "vitest";
import { DEMO_CATALOG } from "./catalog-data";
import type { CatalogItem } from "./catalog";
import { makePlacedItem, makeRoom } from "../test/room-fixtures";
import { createRoomStore } from "./store";
import { resolveCatalogProduct } from "./catalog";
import { createRoomToolDefinitions } from "../webmcp/room-tools";
import {
  applyRoomTransaction,
  type RoomOperation,
  type RuntimeRoomState,
} from "./transaction";
import { rankComparableSubstitutes } from "./substitutes";

const catalogItem = (
  productId: string,
  overrides: Partial<CatalogItem["snapshot"]> = {},
): CatalogItem => ({
  catalogRef: { catalogId: "wimy-demo-v1", productId },
  snapshot: {
    name: productId,
    category: "chair",
    dimensions: { width: 0.6, depth: 0.6, height: 0.8 },
    appearance: { color: "#C9B79C" },
    styleTags: ["warm-modern", "compact"],
    material: "oak",
    ...overrides,
  },
  metadata: {
    origin: "fictional",
    publisherId: "wimy-project-publisher",
    catalogId: "wimy-demo-v1",
    catalogVersion: "builtin-v1",
    itemId: productId,
    variantId: productId,
    provider: {
      providerId: "00000000-0000-4000-8000-000000000001",
      name: "Wimy Atelier",
      connection: "not_connected",
    },
    provenance: {
      sourceName: "Wimy fictional demo catalog",
      observedAt: "2026-09-02T00:00:00Z",
    },
    license: { name: "Wimy Project Authored License", spdxId: "MIT" },
  },
});

describe("rankComparableSubstitutes", () => {
  it("ranks same-category fits deterministically and explains identity, facts, and tradeoffs", () => {
    const source = catalogItem("source-chair", {
      dimensions: { width: 0.8, depth: 0.8, height: 0.82 },
      appearance: { color: "#C9B79C" },
      styleTags: ["warm-modern", "compact"],
      material: "oak",
    });
    const preferred = catalogItem("preferred-chair", {
      dimensions: { width: 0.82, depth: 0.78, height: 0.84 },
      appearance: { color: "#C8B69B" },
      styleTags: ["warm-modern", "compact", "soft"],
      material: "oak",
      commerce: { price: { amount: 123, currency: "USD" } },
    });
    const tradeoff = catalogItem("tradeoff-chair", {
      dimensions: { width: 0.95, depth: 0.9, height: 0.9 },
      appearance: { color: "#6F7C72" },
      styleTags: ["warm-modern"],
      material: "metal",
    });
    const tooLarge = catalogItem("too-large-chair", {
      dimensions: { width: 3, depth: 3, height: 0.8 },
    });
    const room = makeRoom({
      dimensions: { width: 4, depth: 3, height: 2.7 },
      items: [
        makePlacedItem({
          id: "source-instance",
          catalogRef: source.catalogRef,
          snapshot: source.snapshot,
          pose: { x: 1, y: 1, rotationDeg: 0 },
        }),
      ],
    });

    const forward = rankComparableSubstitutes(
      room,
      source,
      [tradeoff, tooLarge, preferred, source],
      "source-instance",
      5,
    );
    const reverse = rankComparableSubstitutes(
      room,
      source,
      [source, preferred, tradeoff, tooLarge],
      "source-instance",
      5,
    );

    expect(forward).toEqual(reverse);
    expect(forward.map(({ catalogRef }) => catalogRef.productId)).toEqual([
      "preferred-chair",
      "tradeoff-chair",
    ]);
    expect(forward[0]).toMatchObject({
      actionable: true,
      fit: { ok: true, pose: { x: 1, y: 1, rotationDeg: 0 } },
      identity: {
        source: { catalogId: "wimy-demo-v1", productId: "source-chair" },
        substitute: { catalogId: "wimy-demo-v1", productId: "preferred-chair" },
      },
      differences: {
        material: { source: "oak", substitute: "oak", same: true },
        color: { source: "#C9B79C", substitute: "#C8B69B", same: false },
      },
      rationale: expect.stringContaining("same chair category"),
      tradeoffs: expect.arrayContaining([expect.stringContaining("color")]),
      metadata: expect.objectContaining({ origin: "fictional" }),
    });
    expect(forward[1]?.tradeoffs).toEqual(
      expect.arrayContaining([
        expect.stringContaining("material"),
        expect.stringContaining("dimensions"),
      ]),
    );
    expect(forward[0]?.snapshot).not.toHaveProperty("commerce");
    expect(JSON.stringify(forward)).not.toContain("price");
  });

  it("uses the requested duplicate placed instance and its embedded snapshot", () => {
    const source = catalogItem("source-chair");
    const substitute = catalogItem("substitute-chair", {
      name: "Catalog Substitute Name",
      appearance: { color: "#AA8866" },
    });
    const room = makeRoom({
      items: [
        makePlacedItem({
          id: "first-instance",
          catalogRef: source.catalogRef,
          snapshot: source.snapshot,
          pose: { x: 0.3, y: 0.3, rotationDeg: 0 },
        }),
        makePlacedItem({
          id: "second-instance",
          catalogRef: source.catalogRef,
          snapshot: {
            ...source.snapshot,
            name: "Imported Chair Snapshot",
            material: "linen",
          },
          pose: { x: 2, y: 1, rotationDeg: 90 },
        }),
      ],
    });

    const [suggestion] = rankComparableSubstitutes(
      room,
      source,
      [source, substitute],
      "second-instance",
    );

    expect(suggestion).toMatchObject({
      fit: { pose: { x: 2, y: 1, rotationDeg: 90 } },
      rationale: expect.stringContaining("Imported Chair Snapshot"),
      differences: { material: { source: "linen", same: false } },
    });
  });
});

describe("human-confirmed substitute replacement", () => {
  const source = catalogItem("source-chair");
  const substitute = catalogItem("substitute-chair", {
    name: "Substitute Chair",
    material: "metal",
  });
  const room = makeRoom({
    items: [
      makePlacedItem({
        id: "source-instance",
        catalogRef: source.catalogRef,
        snapshot: source.snapshot,
        pose: { x: 1, y: 1, rotationDeg: 0 },
      }),
    ],
  });
  const dependencies = {
    createItemId: () => "generated-item",
    resolveProduct: (productId: string) =>
      productId === substitute.catalogRef.productId
        ? { catalogRef: substitute.catalogRef, snapshot: substitute.snapshot }
        : undefined,
  };

  it("requires a human-confirmed replace operation and rejects agent-originated swaps", () => {
    const replace = {
      type: "replace",
      itemId: "source-instance",
      productId: "substitute-chair",
      sourceCatalogRef: source.catalogRef,
      confirmedByHuman: true,
    } as const;
    const state: RuntimeRoomState = { room, revision: 1 };

    const agentResult = applyRoomTransaction(
      state,
      {
        expectedRevision: 1,
        origin: "webmcp",
        change: { type: "edit", operations: [replace as RoomOperation] },
      },
      dependencies,
    );

    expect(agentResult.result).toMatchObject({
      ok: false,
      code: "INVALID_DOCUMENT",
    });
    expect(agentResult.state).toBe(state);
  });

  it("replaces only after confirmation and rejects a stale confirmation", () => {
    const replace = {
      type: "replace",
      itemId: "source-instance",
      productId: "substitute-chair",
      sourceCatalogRef: source.catalogRef,
      confirmedByHuman: true,
    } as const;
    const accepted = applyRoomTransaction(
      { room, revision: 1 },
      {
        expectedRevision: 1,
        origin: "human",
        change: { type: "edit", operations: [replace as RoomOperation] },
      },
      dependencies,
    );

    expect(accepted.result).toMatchObject({
      ok: true,
      revision: 2,
      receipt: { summary: "Replaced source-chair with Substitute Chair after human confirmation" },
    });
    expect(accepted.state.room.items[0]).toMatchObject({
      id: "source-instance",
      catalogRef: substitute.catalogRef,
      snapshot: substitute.snapshot,
      pose: { x: 1, y: 1, rotationDeg: 0 },
    });

    const stale = applyRoomTransaction(
      accepted.state,
      {
        expectedRevision: 1,
        origin: "human",
        change: { type: "edit", operations: [replace as RoomOperation] },
      },
      dependencies,
    );
    expect(stale.result).toMatchObject({
      ok: false,
      code: "REVISION_CONFLICT",
      revision: 2,
    });
  });
});

describe("find_substitutes WebMCP tool", () => {
  it("is read-only, bounded, revision-aware, and never exposes exact prices", async () => {
    const source = DEMO_CATALOG.find(
      ({ catalogRef }) => catalogRef.productId === "ember-nest-chair",
    );
    if (!source) throw new Error("expected source catalog item");
    const store = createRoomStore(
      makeRoom({
        items: [
          makePlacedItem({
            id: "source-instance",
            catalogRef: source.catalogRef,
            snapshot: {
              ...source.snapshot,
              name: "Imported Ember Chair",
              material: "linen",
            },
            pose: { x: 1, y: 1, rotationDeg: 0 },
          }),
        ],
      }),
      { createItemId: () => "generated-item", resolveProduct: resolveCatalogProduct },
    );
    const definitions = createRoomToolDefinitions(store);
    const tool = definitions.find(({ name }) => name === "find_substitutes");
    if (!tool) throw new Error("find_substitutes was not defined");

    expect(tool.annotations).toEqual({
      readOnlyHint: true,
      untrustedContentHint: true,
    });
    const before = store.getState();
    const output = await tool.execute(
      { itemId: "source-instance", limit: 5 },
      { signal: new AbortController().signal },
    );

    expect(output).toMatchObject({
      revision: 1,
      source: { itemId: "source-instance", name: "Imported Ember Chair", material: "linen" },
      matches: expect.any(Array),
    });
    expect(output).toMatchObject({
      matches: expect.arrayContaining([
        expect.objectContaining({
          material: expect.any(String),
          rationale: expect.stringContaining("Imported Ember"),
        }),
      ]),
    });
    expect(JSON.stringify(output)).not.toContain("499");
    expect(store.getState().revision).toBe(before.revision);
    expect(store.getState().room).toEqual(before.room);
  });

  it("does not accept replacement operations through apply_room_edit", async () => {
    const store = createRoomStore(makeRoom(), {
      createItemId: () => "generated-item",
      resolveProduct: resolveCatalogProduct,
    });
    const tool = createRoomToolDefinitions(store).find(
      ({ name }) => name === "apply_room_edit",
    );
    if (!tool) throw new Error("apply_room_edit was not defined");

    const output = await tool.execute(
      {
        expectedRevision: 1,
        operations: [
          {
            type: "replace",
            itemId: "source-instance",
            productId: "cedar-arc-chair",
            sourceCatalogRef: {
              catalogId: "wimy-demo-v1",
              productId: "ember-nest-chair",
            },
            confirmedByHuman: true,
          },
        ],
      },
      { signal: new AbortController().signal },
    );

    expect(output).toMatchObject({ ok: false, code: "INVALID_DOCUMENT", revision: 1 });
    expect(store.getState().revision).toBe(1);
  });

  it("does not allow an agent to swap a placed category through remove plus add", async () => {
    const source = DEMO_CATALOG.find(
      ({ catalogRef }) => catalogRef.productId === "ember-nest-chair",
    );
    if (!source) throw new Error("expected source catalog item");
    const store = createRoomStore(
      makeRoom({
        items: [
          makePlacedItem({
            id: "source-instance",
            catalogRef: source.catalogRef,
            snapshot: source.snapshot,
            pose: { x: 1, y: 1, rotationDeg: 0 },
          }),
        ],
      }),
      { createItemId: () => "generated-item", resolveProduct: resolveCatalogProduct },
    );
    const tool = createRoomToolDefinitions(store).find(
      ({ name }) => name === "apply_room_edit",
    );
    if (!tool) throw new Error("apply_room_edit was not defined");

    const output = await tool.execute(
      {
        expectedRevision: 1,
        operations: [
          { type: "remove", itemId: "source-instance" },
          {
            type: "add",
            productId: "cedar-arc-chair",
            pose: { x: 1, y: 1, rotationDeg: 0 },
          },
        ],
      },
      { signal: new AbortController().signal },
    );

    expect(output).toMatchObject({
      ok: false,
      code: "INVALID_DOCUMENT",
      message: "Substitute replacement requires explicit human confirmation",
      revision: 1,
    });
    expect(store.getState().revision).toBe(1);
    expect(store.getState().room.items).toHaveLength(1);
  });
});
