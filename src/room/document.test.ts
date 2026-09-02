import { describe, expect, it } from "vitest";
import {
  makeOpening,
  makePlacedItem,
  makeRoom,
} from "../test/room-fixtures";
import {
  DimensionsSchema,
  FurnitureSnapshotSchema,
  OpeningSchema,
  PlacedItemSchema,
  PoseSchema,
  WimyFileV1Schema,
  WimyRoomV1Schema,
} from "./document";

describe("WimyRoomV1Schema", () => {
  it("rejects duplicate identities across openings and items", () => {
    const candidate = {
      name: "Test Room",
      dimensions: { width: 4, depth: 3, height: 2.7 },
      openings: [
        {
          id: "same_id",
          kind: "door",
          wall: "west",
          centerOffset: 2,
          width: 0.9,
          bottom: 0,
          height: 2.1,
        },
      ],
      items: [
        {
          id: "same_id",
          pose: { x: 1, y: 1, rotationDeg: 0 },
          snapshot: {
            name: "Test Chair",
            category: "chair",
            dimensions: { width: 0.6, depth: 0.6, height: 0.8 },
            appearance: { color: "#C9B79C" },
            styleTags: ["warm-modern"],
          },
        },
      ],
    };

    const result = WimyRoomV1Schema.safeParse(candidate);

    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toContain("Duplicate");
  });

  it("accepts a valid room document", () => {
    expect(WimyRoomV1Schema.safeParse(makeRoom()).success).toBe(true);
  });

  it("rejects an opening that extends beyond its wall", () => {
    const result = WimyRoomV1Schema.safeParse(
      makeRoom({
        openings: [
          makeOpening({ wall: "north", centerOffset: 3.8, width: 0.6 }),
        ],
      }),
    );

    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toContain("wall");
  });

  it("accepts a millimeter-aligned opening exactly on a wall boundary", () => {
    expect(
      WimyRoomV1Schema.safeParse(
        makeRoom({
          dimensions: { width: 1.001, depth: 3, height: 2.7 },
          openings: [
            makeOpening({
              wall: "north",
              centerOffset: 0.937,
              width: 0.128,
            }),
          ],
        }),
      ).success,
    ).toBe(true);
  });

  it("rejects a quarter-turned item whose footprint leaves the room", () => {
    const item = makePlacedItem();
    const result = WimyRoomV1Schema.safeParse(
      makeRoom({
        items: [
          makePlacedItem({
            pose: { x: 3.6, y: 1, rotationDeg: 90 },
            snapshot: {
              ...item.snapshot,
              dimensions: { width: 0.6, depth: 1.2, height: 0.8 },
            },
          }),
        ],
      }),
    );

    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toContain("room");
  });

  it("rejects control characters in user-visible text", () => {
    expect(
      WimyRoomV1Schema.safeParse(makeRoom({ name: "Unsafe\u0000Room" }))
        .success,
    ).toBe(false);
  });

  it("rejects edge control characters before trimming text", () => {
    expect(
      WimyRoomV1Schema.safeParse(makeRoom({ name: "Unsafe Room\n" }))
        .success,
    ).toBe(false);
  });

  it("rejects Unicode C1 control characters", () => {
    expect(
      WimyRoomV1Schema.safeParse(makeRoom({ name: "Unsafe\u0085Room" }))
        .success,
    ).toBe(false);
  });

  it("rejects non-finite geometry numbers", () => {
    expect(
      WimyRoomV1Schema.safeParse(
        makeRoom({ dimensions: { width: Number.NaN, depth: 3, height: 2.7 } }),
      ).success,
    ).toBe(false);
  });

  it("rejects more than 100 placed items", () => {
    const items = Array.from({ length: 101 }, (_, index) =>
      makePlacedItem({ id: `item_${index}` }),
    );

    expect(WimyRoomV1Schema.safeParse(makeRoom({ items })).success).toBe(
      false,
    );
  });

  it("enforces the v1 room dimension ranges", () => {
    const invalidDimensions = [
      { width: 0.999, depth: 3, height: 2.7 },
      { width: 30.001, depth: 3, height: 2.7 },
      { width: 4, depth: 0.999, height: 2.7 },
      { width: 4, depth: 30.001, height: 2.7 },
      { width: 4, depth: 3, height: 1.999 },
      { width: 4, depth: 3, height: 10.001 },
    ];

    expect(
      invalidDimensions.every(
        (dimensions) =>
          !WimyRoomV1Schema.safeParse(makeRoom({ dimensions })).success,
      ),
    ).toBe(true);
  });

  it("rejects more than 20 openings", () => {
    const openings = Array.from({ length: 21 }, (_, index) =>
      makeOpening({ id: `door_${index}` }),
    );

    expect(
      WimyRoomV1Schema.safeParse(makeRoom({ openings })).success,
    ).toBe(false);
  });

  it("enforces the portable entity ID grammar", () => {
    const invalidIds = ["1starts_with_digit", `a${"b".repeat(64)}`];

    expect(
      invalidIds.every(
        (id) =>
          !WimyRoomV1Schema.safeParse(
            makeRoom({ items: [makePlacedItem({ id })] }),
          ).success,
      ),
    ).toBe(true);
  });

  it("rejects geometry more precise than one millimeter", () => {
    expect(
      WimyRoomV1Schema.safeParse(
        makeRoom({
          items: [
            makePlacedItem({
              pose: { x: 1.0001, y: 1, rotationDeg: 0 },
            }),
          ],
        }),
      ).success,
    ).toBe(false);
  });

  it("canonicalizes accepted floating-point noise to millimeter precision", () => {
    const room = WimyRoomV1Schema.parse(
      makeRoom({
        items: [
          makePlacedItem({
            pose: { x: 0.30000000000000004, y: 1, rotationDeg: 0 },
          }),
        ],
      }),
    );

    expect(room.items[0]?.pose.x).toBe(0.3);
  });

  it("canonicalizes negative zero to portable zero", () => {
    const room = WimyRoomV1Schema.parse(
      makeRoom({ openings: [makeOpening({ bottom: -0 })] }),
    );

    expect(room.openings[0]?.bottom).toBe(0);
  });

  it("rejects prices more precise than one cent", () => {
    const item = makePlacedItem();
    expect(
      WimyRoomV1Schema.safeParse(
        makeRoom({
          items: [
            makePlacedItem({
              snapshot: {
                ...item.snapshot,
                commerce: {
                  price: { amount: 12.345, currency: "USD" },
                },
              },
            }),
          ],
        }),
      ).success,
    ).toBe(false);
  });

  it("requires doors to start at floor level", () => {
    expect(
      WimyRoomV1Schema.safeParse(
        makeRoom({ openings: [makeOpening({ bottom: 0.1 })] }),
      ).success,
    ).toBe(false);
  });

  it("rejects an opening that exceeds the room height", () => {
    expect(
      WimyRoomV1Schema.safeParse(
        makeRoom({
          openings: [
            makeOpening({ kind: "window", bottom: 2, height: 1 }),
          ],
        }),
      ).success,
    ).toBe(false);
  });

  it("rejects a placed item taller than the room", () => {
    const item = makePlacedItem();
    expect(
      WimyRoomV1Schema.safeParse(
        makeRoom({
          items: [
            makePlacedItem({
              snapshot: {
                ...item.snapshot,
                dimensions: { width: 0.6, depth: 0.6, height: 3 },
              },
            }),
          ],
        }),
      ).success,
    ).toBe(false);
  });

  it("rejects non-positive physical dimensions", () => {
    const item = makePlacedItem();
    const candidates = [
      makeRoom({
        items: [
          makePlacedItem({
            snapshot: {
              ...item.snapshot,
              dimensions: { width: 0, depth: 0.6, height: 0.8 },
            },
          }),
        ],
      }),
      makeRoom({ openings: [makeOpening({ width: 0 })] }),
      makeRoom({ openings: [makeOpening({ height: 0 })] }),
    ];

    expect(
      candidates.every(
        (candidate) => !WimyRoomV1Schema.safeParse(candidate).success,
      ),
    ).toBe(true);
  });

  it("trims bounded user-visible text and rejects nested controls", () => {
    const item = makePlacedItem();
    const parsed = WimyRoomV1Schema.safeParse(
      makeRoom({
        name: "  Test Room  ",
        items: [
          makePlacedItem({
            snapshot: {
              ...item.snapshot,
              name: "  Test Chair  ",
              styleTags: ["  warm-modern  "],
            },
          }),
        ],
      }),
    );

    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.name).toBe("Test Room");
      expect(parsed.data.items[0]?.snapshot.name).toBe("Test Chair");
      expect(parsed.data.items[0]?.snapshot.styleTags).toEqual([
        "warm-modern",
      ]);
    }

    expect(
      WimyRoomV1Schema.safeParse(
        makeRoom({
          items: [
            makePlacedItem({
              snapshot: { ...item.snapshot, name: "Unsafe\u0000Chair" },
            }),
          ],
        }),
      ).success,
    ).toBe(false);
  });

  it("accepts only HTTPS product URLs", () => {
    const item = makePlacedItem();
    expect(
      WimyRoomV1Schema.safeParse(
        makeRoom({
          items: [
            makePlacedItem({
              snapshot: {
                ...item.snapshot,
                commerce: {
                  price: { amount: 100, currency: "USD" },
                  productUrl: "http://example.com/chair",
                },
              },
            }),
          ],
        }),
      ).success,
    ).toBe(false);
  });

  it("requires snapshot colors to use the portable hash-prefixed form", () => {
    const item = makePlacedItem();
    expect(
      WimyRoomV1Schema.safeParse(
        makeRoom({
          items: [
            makePlacedItem({
              snapshot: {
                ...item.snapshot,
                appearance: { color: "C9B79C" },
              },
            }),
          ],
        }),
      ).success,
    ).toBe(false);
  });
});

describe("WimyFileV1Schema", () => {
  it("rejects a non-v1 envelope", () => {
    expect(
      WimyFileV1Schema.safeParse({
        format: "wimy-room",
        schemaVersion: 2,
        room: makeRoom(),
      }).success,
    ).toBe(false);
  });
});

describe("strict object contract", () => {
  it("rejects unknown properties at every portable object boundary", () => {
    const item = makePlacedItem();
    const candidates = [
      DimensionsSchema.safeParse({
        width: 1,
        depth: 1,
        height: 1,
        unexpected: true,
      }),
      PoseSchema.safeParse({
        x: 1,
        y: 1,
        rotationDeg: 0,
        unexpected: true,
      }),
      OpeningSchema.safeParse({ ...makeOpening(), unexpected: true }),
      FurnitureSnapshotSchema.safeParse({
        ...item.snapshot,
        unexpected: true,
      }),
      FurnitureSnapshotSchema.safeParse({
        ...item.snapshot,
        appearance: { color: "#C9B79C", unexpected: true },
      }),
      FurnitureSnapshotSchema.safeParse({
        ...item.snapshot,
        commerce: {
          price: { amount: 100, currency: "USD", unexpected: true },
          unexpected: true,
        },
      }),
      PlacedItemSchema.safeParse({ ...item, unexpected: true }),
      PlacedItemSchema.safeParse({
        ...item,
        catalogRef: {
          catalogId: "wimy-demo-v1",
          productId: "chair-1",
          unexpected: true,
        },
      }),
      WimyRoomV1Schema.safeParse({ ...makeRoom(), unexpected: true }),
      WimyFileV1Schema.safeParse({
        format: "wimy-room",
        schemaVersion: 1,
        room: makeRoom(),
        unexpected: true,
      }),
    ];

    expect(candidates.every((candidate) => !candidate.success)).toBe(true);
  });
});
