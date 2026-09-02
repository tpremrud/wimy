import { describe, expect, it } from "vitest";
import { WimyRoomV1Schema } from "./document";
import {
  moveOpeningAlongWall,
  resizeAnchoredRoom,
} from "./direct-manipulation";
import { makeOpening, makePlacedItem, makeRoom } from "../test/room-fixtures";

describe("direct room manipulation", () => {
  it("moves an opening along its current wall without mutating the source room", () => {
    const room = makeRoom({
      openings: [
        makeOpening({
          id: "window_north_1",
          kind: "window",
          wall: "north",
          centerOffset: 1.5,
          width: 1,
          bottom: 0.9,
          height: 1.2,
        }),
      ],
    });

    const moved = moveOpeningAlongWall(room, "window_north_1", 3.25);

    expect(moved?.openings[0]?.centerOffset).toBe(3.25);
    expect(room.openings[0]?.centerOffset).toBe(1.5);
    expect(WimyRoomV1Schema.safeParse(moved).success).toBe(true);
  });

  it("scoots an opening to the nearest touching edge instead of overlapping", () => {
    const room = makeRoom({
      dimensions: { width: 6, depth: 4, height: 2.7 },
      openings: [
        makeOpening({
          id: "window_moving",
          kind: "window",
          wall: "north",
          centerOffset: 1,
          width: 1,
          bottom: 0.9,
          height: 1.2,
        }),
        makeOpening({
          id: "window_fixed",
          kind: "window",
          wall: "north",
          centerOffset: 3,
          width: 1,
          bottom: 0.9,
          height: 1.2,
        }),
      ],
    });

    const moved = moveOpeningAlongWall(room, "window_moving", 2.8);

    expect(moved?.openings[0]?.centerOffset).toBe(2);
    expect(WimyRoomV1Schema.safeParse(moved).success).toBe(true);
  });

  it("moves a door along its wall without changing its identity", () => {
    const room = makeRoom({
      openings: [
        makeOpening({
          id: "door_west_1",
          kind: "door",
          wall: "west",
          centerOffset: 1,
          width: 0.9,
          bottom: 0,
          height: 2.1,
        }),
      ],
    });

    const moved = moveOpeningAlongWall(room, "door_west_1", 2.25);

    expect(moved?.openings[0]).toMatchObject({
      centerOffset: 2.25,
      id: "door_west_1",
      kind: "door",
      wall: "west",
    });
    expect(WimyRoomV1Schema.safeParse(moved).success).toBe(true);
  });

  it("resizes east and south bounds while keeping the north-west origin anchored", () => {
    const room = makeRoom();

    const wider = resizeAnchoredRoom(room, "width", 5.25);
    const deeper = resizeAnchoredRoom(wider ?? room, "depth", 4.5);

    expect(deeper?.dimensions).toEqual({ width: 5.25, depth: 4.5, height: 2.7 });
    expect(deeper?.items).toEqual(room.items);
    expect(deeper?.openings).toEqual(room.openings);
  });

  it("stops an inward wall at the nearest valid item boundary", () => {
    const room = makeRoom({
      items: [
        makePlacedItem({
          pose: { x: 3.5, y: 1, rotationDeg: 0 },
          snapshot: {
            ...makePlacedItem().snapshot,
            dimensions: { width: 0.6, depth: 0.6, height: 0.8 },
          },
        }),
      ],
    });

    const resized = resizeAnchoredRoom(room, "width", 3);

    expect(resized?.dimensions.width).toBe(3.8);
    expect(WimyRoomV1Schema.safeParse(resized).success).toBe(true);
  });
});
