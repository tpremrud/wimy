import { describe, expect, it, vi } from "vitest";
import {
  makeOpening,
  makePlacedItem,
  makeRoom,
} from "../test/room-fixtures";
import { FurnitureSnapshotSchema } from "./document";
import { getTemplate } from "./templates";
import {
  findFurniture,
  resolveCatalogProduct,
  type CatalogItem,
} from "./catalog";
import {
  CATALOG_ID,
  DEMO_CATALOG,
  DEMO_CATALOG_PROVENANCE,
} from "./catalog-data";
import { preparePlacementContext, validatePlacement } from "./placement";

vi.mock("./placement", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./placement")>();
  return {
    ...actual,
    preparePlacementContext: vi.fn(actual.preparePlacementContext),
    validatePlacement: vi.fn(actual.validatePlacement),
  };
});

const preparePlacementContextMock = vi.mocked(preparePlacementContext);
const validatePlacementMock = vi.mocked(validatePlacement);

const makeCatalogItem = ({
  productId = "test-chair",
  category = "chair",
  styleTags = ["warm-modern"],
  price = 499,
  dimensions = { width: 0.6, depth: 0.6, height: 0.8 },
}: {
  productId?: string;
  category?: CatalogItem["snapshot"]["category"];
  styleTags?: string[];
  price?: number;
  dimensions?: CatalogItem["snapshot"]["dimensions"];
} = {}): CatalogItem => ({
  catalogRef: { catalogId: "wimy-demo-v1", productId },
  snapshot: {
    name: `Test ${productId}`,
    category,
    dimensions,
    appearance: { color: "#C9B79C" },
    styleTags,
    commerce: { price: { amount: price, currency: "USD" } },
  },
});

describe("findFurniture", () => {
  it("returns the first matching product at the first valid grid pose", () => {
    const query = {
      category: "chair" as const,
      styleTags: ["warm-modern"],
      maxPrice: 600,
    };
    const room = makeRoom({
      dimensions: { width: 2, depth: 2, height: 2.7 },
    });
    const compactChair: CatalogItem = {
      catalogRef: {
        catalogId: "wimy-demo-v1",
        productId: "compact-chair",
      },
      snapshot: {
        name: "Compact Chair",
        category: "chair",
        dimensions: { width: 0.6, depth: 0.6, height: 0.8 },
        appearance: { color: "#C9B79C" },
        styleTags: ["warm-modern"],
        commerce: { price: { amount: 499, currency: "USD" } },
      },
    };

    expect(findFurniture(room, query, [compactChair])).toEqual([
      {
        ...compactChair,
        suggestedPose: { x: 0.3, y: 0.3, rotationDeg: 0 },
      },
    ]);
  });

  it("requires every requested style tag", () => {
    const room = makeRoom();
    const warmOnly = makeCatalogItem({
      productId: "warm-only",
      styleTags: ["warm-modern"],
    });
    const warmCompact = makeCatalogItem({
      productId: "warm-compact",
      styleTags: ["warm-modern", "compact"],
    });

    expect(
      findFurniture(
        room,
        { styleTags: ["warm-modern", "compact"] },
        [warmOnly, warmCompact],
      ).map(({ catalogRef }) => catalogRef.productId),
    ).toEqual(["warm-compact"]);
  });

  it("applies inclusive price and canonical width/depth ceilings", () => {
    const room = makeRoom();
    const boundary = makeCatalogItem({
      productId: "boundary",
      price: 600,
      dimensions: { width: 0.8, depth: 0.7, height: 0.8 },
    });
    const overPrice = makeCatalogItem({
      productId: "over-price",
      price: 600.01,
      dimensions: { width: 0.8, depth: 0.7, height: 0.8 },
    });
    const overWidth = makeCatalogItem({
      productId: "over-width",
      price: 500,
      dimensions: { width: 0.801, depth: 0.7, height: 0.8 },
    });
    const overDepth = makeCatalogItem({
      productId: "over-depth",
      price: 500,
      dimensions: { width: 0.8, depth: 0.701, height: 0.8 },
    });

    expect(
      findFurniture(
        room,
        { maxPrice: 600, maxWidth: 0.8, maxDepth: 0.7 },
        [boundary, overPrice, overWidth, overDepth],
      ).map(({ catalogRef }) => catalogRef.productId),
    ).toEqual(["boundary"]);
  });

  it("defaults to five stable results and restricts explicit limits to integers 1–5", () => {
    const room = makeRoom();
    const catalog = Array.from({ length: 7 }, (_, index) =>
      makeCatalogItem({ productId: `chair-${index + 1}` }),
    );

    expect(
      findFurniture(room, {}, catalog).map(
        ({ catalogRef }) => catalogRef.productId,
      ),
    ).toEqual(["chair-1", "chair-2", "chair-3", "chair-4", "chair-5"]);
    expect(
      findFurniture(room, { limit: 2 }, catalog).map(
        ({ catalogRef }) => catalogRef.productId,
      ),
    ).toEqual(["chair-1", "chair-2"]);
    expect(() => findFurniture(room, { limit: 0 }, catalog)).toThrow(
      RangeError,
    );
    expect(() => findFurniture(room, { limit: 6 }, catalog)).toThrow(
      RangeError,
    );
    expect(() => findFurniture(room, { limit: 1.5 }, catalog)).toThrow(
      RangeError,
    );
  });

  it("tries quarter turns in order and scans north-to-south then west-to-east", () => {
    const turningRoom = makeRoom({
      dimensions: { width: 1, depth: 1.4, height: 2.7 },
    });
    const turningChair = makeCatalogItem({
      productId: "turning-chair",
      dimensions: { width: 1.2, depth: 0.4, height: 0.8 },
    });

    expect(findFurniture(turningRoom, {}, [turningChair])).toEqual([
      {
        ...turningChair,
        suggestedPose: { x: 0.2, y: 0.6, rotationDeg: 90 },
      },
    ]);

    const blocker = makeCatalogItem({
      productId: "blocker",
      dimensions: { width: 0.4, depth: 0.4, height: 0.8 },
    });
    const scanRoom = makeRoom({
      dimensions: { width: 2, depth: 2, height: 2.7 },
      items: [
        {
          id: "item_blocker",
          snapshot: blocker.snapshot,
          pose: { x: 0.2, y: 0.2, rotationDeg: 0 },
        },
      ],
    });
    const scanningChair = makeCatalogItem({
      productId: "scanning-chair",
      dimensions: { width: 0.4, depth: 0.4, height: 0.8 },
    });

    expect(findFurniture(scanRoom, {}, [scanningChair])[0]?.suggestedPose)
      .toEqual({ x: 0.6, y: 0.2, rotationDeg: 0 });
  });

  it("uses collision-proof candidate identities while probing", () => {
    const item = makeCatalogItem({ productId: "candidate-chair" });
    const room = makeRoom({
      dimensions: { width: 2, depth: 2, height: 2.7 },
      items: [
        {
          id: "catalog_fit_candidate_0",
          snapshot: makeCatalogItem({ productId: "existing-chair" }).snapshot,
          pose: { x: 0.3, y: 0.3, rotationDeg: 0 },
        },
      ],
    });

    expect(findFurniture(room, {}, [item])[0]?.suggestedPose).toEqual({
      x: 0.9,
      y: 0.3,
      rotationDeg: 0,
    });
  });

  it("filters by exact category in stable catalog order and returns [] for no match", () => {
    const room = makeRoom();
    const catalog = [
      makeCatalogItem({ productId: "sofa-first", category: "sofa" }),
      makeCatalogItem({ productId: "chair-second" }),
      makeCatalogItem({ productId: "chair-third" }),
    ];

    expect(
      findFurniture(room, { category: "chair" }, catalog).map(
        ({ catalogRef }) => catalogRef.productId,
      ),
    ).toEqual(["chair-second", "chair-third"]);
    expect(findFurniture(room, { category: "bed" }, catalog)).toEqual([]);
    expect(findFurniture(room, {}, [])).toEqual([]);
  });

  it("uses canonical dimensions for filters before a suggested rotation", () => {
    const room = makeRoom({
      dimensions: { width: 1, depth: 1.4, height: 2.7 },
    });
    const rotatable = makeCatalogItem({
      productId: "rotatable",
      dimensions: { width: 1.2, depth: 0.4, height: 0.8 },
    });

    expect(
      findFurniture(room, { maxWidth: 0.5, maxDepth: 1.2 }, [rotatable]),
    ).toEqual([]);
  });

  it("accepts exact room boundaries and blocking-furniture edge touch", () => {
    const exactRoom = makeRoom({
      dimensions: { width: 1, depth: 1, height: 2.7 },
    });
    const exactItem = makeCatalogItem({
      productId: "exact-boundary",
      dimensions: { width: 1, depth: 1, height: 0.8 },
    });

    expect(findFurniture(exactRoom, {}, [exactItem])[0]?.suggestedPose)
      .toEqual({ x: 0.5, y: 0.5, rotationDeg: 0 });

    const edgeRoom = makeRoom({
      dimensions: { width: 1, depth: 1, height: 2.7 },
      items: [
        makePlacedItem({
          id: "item_west_half",
          pose: { x: 0.2, y: 0.5, rotationDeg: 0 },
          snapshot: makeCatalogItem({
            productId: "west-half",
            dimensions: { width: 0.4, depth: 1, height: 0.8 },
          }).snapshot,
        }),
      ],
    });
    const eastHalf = makeCatalogItem({
      productId: "east-half",
      dimensions: { width: 0.6, depth: 1, height: 0.8 },
    });

    expect(findFurniture(edgeRoom, {}, [eastHalf])[0]?.suggestedPose).toEqual({
      x: 0.7,
      y: 0.5,
      rotationDeg: 0,
    });
  });

  it("allows a rug overlap while rejecting blocking furniture overlap", () => {
    const candidate = makeCatalogItem({ productId: "candidate" });
    const fullRug = makePlacedItem({
      id: "item_full_rug",
      pose: { x: 1, y: 1, rotationDeg: 0 },
      snapshot: makeCatalogItem({
        productId: "full-rug",
        category: "rug",
        dimensions: { width: 2, depth: 2, height: 0.02 },
      }).snapshot,
    });
    const rugRoom = makeRoom({
      dimensions: { width: 2, depth: 2, height: 2.7 },
      items: [fullRug],
    });

    expect(findFurniture(rugRoom, {}, [candidate])[0]?.suggestedPose).toEqual({
      x: 0.3,
      y: 0.3,
      rotationDeg: 0,
    });

    const blockingRoom = makeRoom({
      dimensions: { width: 1, depth: 1, height: 2.7 },
      items: [
        makePlacedItem({
          id: "item_full_blocker",
          pose: { x: 0.5, y: 0.5, rotationDeg: 0 },
          snapshot: makeCatalogItem({
            productId: "full-blocker",
            dimensions: { width: 1, depth: 1, height: 0.8 },
          }).snapshot,
        }),
      ],
    });

    expect(findFurniture(blockingRoom, {}, [candidate])).toEqual([]);
  });

  it("rejects protected door clearance while windows do not block", () => {
    const item = makeCatalogItem({ productId: "opening-chair" });
    const doorRoom = makeRoom({
      dimensions: { width: 2, depth: 2, height: 2.7 },
      openings: [
        makeOpening({
          id: "door_north_full",
          wall: "north",
          centerOffset: 1,
          width: 2,
        }),
      ],
    });
    const windowRoom = makeRoom({
      dimensions: { width: 2, depth: 2, height: 2.7 },
      openings: [
        makeOpening({
          id: "window_north_full",
          kind: "window",
          wall: "north",
          centerOffset: 1,
          width: 2,
          bottom: 0.8,
        }),
      ],
    });

    expect(findFurniture(doorRoom, {}, [item])[0]?.suggestedPose).toEqual({
      x: 0.3,
      y: 1.3,
      rotationDeg: 0,
    });
    expect(findFurniture(windowRoom, {}, [item])[0]?.suggestedPose).toEqual({
      x: 0.3,
      y: 0.3,
      rotationDeg: 0,
    });
  });

  it("rejects over-height products without treating unrelated existing warnings as fatal", () => {
    const shortRoom = makeRoom({
      dimensions: { width: 2, depth: 2, height: 0.7 },
    });
    const tallItem = makeCatalogItem({
      productId: "too-tall",
      dimensions: { width: 0.4, depth: 0.4, height: 0.8 },
    });
    expect(findFurniture(shortRoom, {}, [tallItem])).toEqual([]);

    const warningRoom = makeRoom({
      dimensions: { width: 3, depth: 3, height: 2.7 },
      items: [
        makePlacedItem({
          id: "item_warning_one",
          pose: { x: 2.5, y: 2.5, rotationDeg: 0 },
        }),
        makePlacedItem({
          id: "item_warning_two",
          pose: { x: 2.5, y: 2.5, rotationDeg: 0 },
        }),
      ],
    });
    const compact = makeCatalogItem({
      productId: "warning-independent",
      dimensions: { width: 0.4, depth: 0.4, height: 0.8 },
    });

    expect(findFurniture(warningRoom, {}, [compact])[0]?.suggestedPose)
      .toEqual({ x: 0.2, y: 0.2, rotationDeg: 0 });
  });

  it("is deterministic, does not mutate inputs, and isolates returned matches", () => {
    const room = makeRoom();
    const query = { category: "chair" as const, styleTags: ["warm-modern"] };
    const catalog = [makeCatalogItem({ productId: "isolated-chair" })];
    const roomBefore = structuredClone(room);
    const queryBefore = structuredClone(query);
    const catalogBefore = structuredClone(catalog);

    const first = findFurniture(room, query, catalog);
    const second = findFurniture(room, query, catalog);

    expect(first).toEqual(second);
    expect(room).toEqual(roomBefore);
    expect(query).toEqual(queryBefore);
    expect(catalog).toEqual(catalogBefore);

    const firstMatch = first[0];
    if (!firstMatch) throw new Error("expected a catalog match");
    firstMatch.snapshot.name = "Changed result";
    firstMatch.suggestedPose.x = 9;

    expect(catalog).toEqual(catalogBefore);
    expect(findFurniture(room, query, catalog)).toEqual(second);
  });

  it("allocates one collision-free probe per product rather than per grid cell", () => {
    const room = makeRoom({
      dimensions: { width: 30, depth: 30, height: 2.7 },
    });
    const item = makeCatalogItem({ productId: "bounded-probe" });
    const addSpy = vi.spyOn(Set.prototype, "add");
    const cloneSpy = vi.spyOn(globalThis, "structuredClone");
    let matchCount: number;
    let addCalls: number;
    let cloneCalls: number;

    try {
      validatePlacementMock.mockClear();
      matchCount = findFurniture(room, {}, [item]).length;
      addCalls = addSpy.mock.calls.length;
      cloneCalls = cloneSpy.mock.calls.length;
    } finally {
      addSpy.mockRestore();
      cloneSpy.mockRestore();
    }

    expect(matchCount).toBe(1);
    expect(addCalls).toBeLessThanOrEqual(3);
    expect(cloneCalls).toBeLessThanOrEqual(4);

    const candidateReferences = validatePlacementMock.mock.calls.map(
      ([, candidate]) => candidate,
    );
    const firstCandidate = candidateReferences[0];
    if (!firstCandidate) throw new Error("expected placement probes");

    expect(candidateReferences.length).toBeGreaterThan(1);
    expect(
      candidateReferences.every((candidate) => candidate === firstCandidate),
    ).toBe(true);
    expect(new Set(candidateReferences.map(({ id }) => id)).size).toBe(1);
    expect(
      new Set(
        validatePlacementMock.mock.calls.map(([, , pose]) =>
          JSON.stringify(pose),
        ),
      ).size,
    ).toBeGreaterThan(1);
  });

  it("prepares room geometry once and reuses it for every grid probe", () => {
    const baseItem = makePlacedItem();
    const sourceRoom = makeRoom({
      dimensions: { width: 2, depth: 2, height: 2.7 },
      openings: [
        makeOpening({
          id: "door_north",
          wall: "north",
          centerOffset: 1,
          width: 0.4,
        }),
        makeOpening({
          id: "window_south",
          kind: "window",
          wall: "south",
          centerOffset: 1,
          width: 0.4,
          bottom: 0.8,
        }),
      ],
      items: [
        makePlacedItem({
          id: "item_blocker",
          pose: { x: 1, y: 1, rotationDeg: 0 },
        }),
        makePlacedItem({
          id: "item_rug",
          snapshot: { ...baseItem.snapshot, category: "rug" },
          pose: { x: 1.7, y: 1.7, rotationDeg: 0 },
        }),
      ],
    });
    let itemReads = 0;
    let openingReads = 0;
    const room = { ...sourceRoom };
    Object.defineProperties(room, {
      items: {
        configurable: true,
        enumerable: true,
        get() {
          itemReads += 1;
          return sourceRoom.items;
        },
      },
      openings: {
        configurable: true,
        enumerable: true,
        get() {
          openingReads += 1;
          return sourceRoom.openings;
        },
      },
    });
    const item = makeCatalogItem({
      productId: "prepared-context-chair",
      dimensions: { width: 0.4, depth: 0.4, height: 0.8 },
    });

    preparePlacementContextMock.mockClear();
    validatePlacementMock.mockClear();
    const cloneSpy = vi.spyOn(globalThis, "structuredClone");
    let matchCount: number;
    let geometrySourceReads: { items: number; openings: number };
    let preparedRoomCloneCalls: number;
    let preparedContext:
      | ReturnType<typeof preparePlacementContext>
      | undefined;

    try {
      matchCount = findFurniture(room, {}, [item]).length;
      geometrySourceReads = { items: itemReads, openings: openingReads };
      preparedContext = preparePlacementContextMock.mock.results[0]?.value;
      if (!preparedContext) throw new Error("expected a prepared room context");
      preparedRoomCloneCalls = cloneSpy.mock.calls.filter(
        ([value]) => value === room || value === preparedContext?.room,
      ).length;
    } finally {
      cloneSpy.mockRestore();
    }

    expect(matchCount).toBe(1);
    expect(geometrySourceReads).toEqual({ items: 1, openings: 1 });
    expect(preparedRoomCloneCalls).toBe(1);
    expect(preparePlacementContextMock).toHaveBeenCalledTimes(1);
    expect(preparePlacementContextMock).toHaveBeenCalledWith(room);

    if (!preparedContext) throw new Error("expected a prepared room context");

    expect(validatePlacementMock.mock.calls.length).toBeGreaterThan(1);
    expect(
      validatePlacementMock.mock.calls.every(
        ([validatedRoom, , , context]) =>
          validatedRoom === preparedContext.room &&
          context === preparedContext,
      ),
    ).toBe(true);
  });
});

describe("demo catalog integrity", () => {
  it("exports 8–12 deeply frozen, schema-valid fictional USD records", () => {
    expect(CATALOG_ID).toBe("wimy-demo-v1");
    expect(DEMO_CATALOG_PROVENANCE).toBe("fictional");
    expect(DEMO_CATALOG).toHaveLength(10);
    expect(Object.isFrozen(DEMO_CATALOG)).toBe(true);

    const productIds = DEMO_CATALOG.map(
      ({ catalogRef }) => catalogRef.productId,
    );
    expect(new Set(productIds).size).toBe(productIds.length);

    for (const item of DEMO_CATALOG) {
      expect(item.catalogRef.catalogId).toBe(CATALOG_ID);
      expect(item.catalogRef.productId).toMatch(/^[a-z][a-z0-9-]+$/u);
      expect(FurnitureSnapshotSchema.safeParse(item.snapshot).success).toBe(
        true,
      );
      expect(item.snapshot.appearance.color).toMatch(/^#[0-9A-F]{6}$/iu);
      expect(item.snapshot.styleTags.length).toBeGreaterThan(0);
      expect(item.snapshot.commerce.price).toMatchObject({ currency: "USD" });
      expect(item.snapshot.commerce.productUrl).toBeUndefined();
      expect(item.snapshot.commerce.observedAt).toBeUndefined();
      expect(Object.isFrozen(item)).toBe(true);
      expect(Object.isFrozen(item.catalogRef)).toBe(true);
      expect(Object.isFrozen(item.snapshot)).toBe(true);
      expect(Object.isFrozen(item.snapshot.dimensions)).toBe(true);
      expect(Object.isFrozen(item.snapshot.appearance)).toBe(true);
      expect(Object.isFrozen(item.snapshot.styleTags)).toBe(true);
      expect(Object.isFrozen(item.snapshot.commerce)).toBe(true);
      expect(Object.isFrozen(item.snapshot.commerce.price)).toBe(true);
    }

    expect(JSON.stringify(DEMO_CATALOG)).not.toMatch(/https?:\/\/|www\./iu);
  });

  it("contains the deterministic warm-modern Living Room worked example", () => {
    const matches = findFurniture(
      getTemplate("living-room"),
      { category: "chair", styleTags: ["warm-modern"], maxPrice: 600 },
      DEMO_CATALOG,
    );

    expect(matches[0]).toMatchObject({
      catalogRef: {
        catalogId: "wimy-demo-v1",
        productId: "ember-nest-chair",
      },
      snapshot: {
        name: "Ember Nest Chair",
        commerce: { price: { amount: 499, currency: "USD" } },
      },
      suggestedPose: { x: 0.3, y: 0.3, rotationDeg: 0 },
    });
  });

  it("resolves authoritative cloned facts without exposing catalog storage", () => {
    const first = resolveCatalogProduct("ember-nest-chair");
    const second = resolveCatalogProduct("ember-nest-chair");
    if (!first || !second) throw new Error("expected the demo product");

    expect(first).toEqual(second);
    expect(first).not.toBe(second);
    expect(first.catalogRef).not.toBe(second.catalogRef);
    expect(first.snapshot).not.toBe(second.snapshot);
    expect(Object.keys(first).sort()).toEqual(["catalogRef", "snapshot"]);

    first.catalogRef.productId = "changed";
    first.snapshot.name = "Changed result";
    first.snapshot.styleTags.push("changed");

    expect(resolveCatalogProduct("ember-nest-chair")).toEqual(second);
    expect(resolveCatalogProduct("missing-product")).toBeUndefined();
  });
});
