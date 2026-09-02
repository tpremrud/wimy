import { describe, expect, it } from "vitest";
import { makeOpening, makePlacedItem, makeRoom } from "../test/room-fixtures";
import { WimyRoomV1Schema } from "./document";
import {
  findFirstAvailableOpening,
  isRectangleWithinRoom,
  openingsOverlap,
  roomFloorPolygon,
  roomUsableWallLength,
} from "./geometry";

const makeLRoom = () => makeRoom({
  geometry: {
    shape: "l-shape",
    notch: { corner: "south-east", width: 1.25, depth: 1 },
  },
});

describe("single-room geometry", () => {
  it("projects a southeast-notched L-shaped floor", () => {
    expect(roomFloorPolygon(makeLRoom())).toEqual([
      { x: 0, y: 0 },
      { x: 4, y: 0 },
      { x: 4, y: 2 },
      { x: 2.75, y: 2 },
      { x: 2.75, y: 3 },
      { x: 0, y: 3 },
    ]);
  });

  it("excludes the notch from valid furniture floor area", () => {
    const room = makeLRoom();
    expect(isRectangleWithinRoom(room, {
      left: 3,
      right: 3.5,
      top: 2.25,
      bottom: 2.75,
    })).toBe(false);
    expect(isRectangleWithinRoom(room, {
      left: 2,
      right: 2.5,
      top: 2.25,
      bottom: 2.75,
    })).toBe(true);
  });

  it("shortens the east and south exterior walls around the notch", () => {
    const room = makeLRoom();
    expect(roomUsableWallLength(room, "east")).toBe(2);
    expect(roomUsableWallLength(room, "south")).toBe(2.75);
  });

  it("rejects openings and items that occupy the removed corner", () => {
    expect(WimyRoomV1Schema.safeParse(makeRoom({
      ...makeLRoom(),
      openings: [makeOpening({
        id: "door_east_1",
        wall: "east",
        centerOffset: 2.5,
      })],
    })).success).toBe(false);
    expect(WimyRoomV1Schema.safeParse(makeRoom({
      ...makeLRoom(),
      items: [makePlacedItem({ pose: { x: 3.25, y: 2.5, rotationDeg: 0 } })],
    })).success).toBe(false);
  });

  it("finds a deterministic free wall span and detects 2D opening overlap", () => {
    const room = makeRoom({
      openings: [makeOpening({
        id: "window_north_1",
        kind: "window",
        wall: "north",
        centerOffset: 2,
        width: 1.4,
        bottom: 0.9,
        height: 1.2,
      })],
    });
    const candidate = findFirstAvailableOpening(room, "window", "window_added_1");

    expect(candidate).toEqual(expect.objectContaining({
      wall: "north",
      centerOffset: 0.6,
    }));
    expect(candidate && openingsOverlap(candidate, room.openings[0]!)).toBe(false);
  });

  it("rejects window-window and door-window overlap on the same wall", () => {
    const window = makeOpening({
      id: "window_north_1",
      kind: "window",
      wall: "north",
      centerOffset: 2,
      width: 1.4,
      bottom: 0.9,
      height: 1.2,
    });
    expect(WimyRoomV1Schema.safeParse(makeRoom({
      openings: [window, { ...window, id: "window_north_2", centerOffset: 2.5 }],
    })).success).toBe(false);
    expect(WimyRoomV1Schema.safeParse(makeRoom({
      openings: [window, makeOpening({
        id: "door_north_1",
        wall: "north",
        centerOffset: 2,
      })],
    })).success).toBe(false);
  });
});
