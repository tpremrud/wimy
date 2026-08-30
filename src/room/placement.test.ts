import { describe, expect, it } from "vitest";
import {
  makeOpening,
  makePlacedItem,
  makeRoom,
} from "../test/room-fixtures";
import {
  findLayoutWarnings,
  orientedFootprint,
  validatePlacement,
} from "./placement";

describe("orientedFootprint", () => {
  it("swaps width and depth for a quarter turn", () => {
    expect(
      orientedFootprint({ width: 1.2, depth: 0.6, height: 0.8 }, 90),
    ).toEqual({ width: 0.6, depth: 1.2 });
  });
});

describe("validatePlacement", () => {
  it("rejects a footprint outside the room", () => {
    const room = makeRoom();
    const item = makePlacedItem();

    expect(
      validatePlacement(room, item, { x: 0.1, y: 0.1, rotationDeg: 0 }),
    ).toMatchObject({ ok: false, code: "OUT_OF_BOUNDS" });
  });

  it("rejects furniture taller than the room", () => {
    const room = makeRoom();
    const baseItem = makePlacedItem();
    const item = makePlacedItem({
      snapshot: {
        ...baseItem.snapshot,
        dimensions: {
          ...baseItem.snapshot.dimensions,
          height: room.dimensions.height + 0.1,
        },
      },
    });

    expect(validatePlacement(room, item, item.pose)).toMatchObject({
      ok: false,
      code: "OUT_OF_BOUNDS",
      message: expect.stringMatching(/height.*room/iu),
    });
  });

  it("rejects overlap with blocking furniture", () => {
    const room = makeRoom({ items: [makePlacedItem()] });
    const item = makePlacedItem({ id: "item_chair_2" });

    expect(validatePlacement(room, item, item.pose)).toMatchObject({
      ok: false,
      code: "COLLISION",
    });
  });

  it("allows a rug to overlap furniture", () => {
    const room = makeRoom({ items: [makePlacedItem()] });
    const baseItem = makePlacedItem();
    const rug = makePlacedItem({
      id: "item_rug_1",
      snapshot: { ...baseItem.snapshot, category: "rug" },
    });

    expect(validatePlacement(room, rug, rug.pose)).toEqual({ ok: true });
  });

  it("rejects placement in front of a north-wall door", () => {
    const room = makeRoom({
      openings: [makeOpening({ id: "door_north", wall: "north" })],
    });
    const item = makePlacedItem();

    expect(
      validatePlacement(room, item, { x: 2, y: 0.4, rotationDeg: 0 }),
    ).toMatchObject({ ok: false, code: "DOOR_CLEARANCE" });
  });

  it("rejects placement in front of a south-wall door", () => {
    const room = makeRoom({
      openings: [makeOpening({ id: "door_south", wall: "south" })],
    });
    const item = makePlacedItem();

    expect(
      validatePlacement(room, item, { x: 2, y: 2.6, rotationDeg: 0 }),
    ).toMatchObject({ ok: false, code: "DOOR_CLEARANCE" });
  });

  it("rejects placement in front of a west-wall door", () => {
    const room = makeRoom({
      openings: [
        makeOpening({
          id: "door_west",
          wall: "west",
          centerOffset: 1.5,
        }),
      ],
    });
    const item = makePlacedItem();

    expect(
      validatePlacement(room, item, { x: 0.4, y: 1.5, rotationDeg: 0 }),
    ).toMatchObject({ ok: false, code: "DOOR_CLEARANCE" });
  });

  it("rejects placement in front of an east-wall door", () => {
    const room = makeRoom({
      openings: [
        makeOpening({
          id: "door_east",
          wall: "east",
          centerOffset: 1.5,
        }),
      ],
    });
    const item = makePlacedItem();

    expect(
      validatePlacement(room, item, { x: 3.6, y: 1.5, rotationDeg: 0 }),
    ).toMatchObject({ ok: false, code: "DOOR_CLEARANCE" });
  });
});

describe("findLayoutWarnings", () => {
  it("reports overlap between blocking items in an existing layout", () => {
    const room = makeRoom({
      items: [
        makePlacedItem(),
        makePlacedItem({ id: "item_chair_2" }),
      ],
    });

    expect(findLayoutWarnings(room, () => true)).toContainEqual({
      code: "OVERLAP",
      message: "item_chair_1 overlaps item_chair_2",
      itemIds: ["item_chair_1", "item_chair_2"],
    });
  });

  it("reports a blocked door in an existing layout", () => {
    const room = makeRoom({
      openings: [makeOpening({ id: "door_north", wall: "north" })],
      items: [
        makePlacedItem({ pose: { x: 2, y: 0.4, rotationDeg: 0 } }),
      ],
    });

    expect(findLayoutWarnings(room, () => true)).toContainEqual({
      code: "DOOR_CLEARANCE",
      message: "item_chair_1 blocks door clearance at door_north",
      itemIds: ["item_chair_1"],
    });
  });

  it("reports an unavailable referenced catalog product", () => {
    const room = makeRoom({
      items: [
        makePlacedItem({
          catalogRef: {
            catalogId: "archived-catalog",
            productId: "chair-1",
          },
        }),
      ],
    });

    expect(findLayoutWarnings(room, () => false)).toContainEqual({
      code: "CATALOG_UNAVAILABLE",
      message:
        "item_chair_1 references unavailable catalog product archived-catalog/chair-1",
      itemIds: ["item_chair_1"],
    });
  });
});
