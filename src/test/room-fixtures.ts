import type { Opening, PlacedItem, WimyRoomV1 } from "../room/document";

export const makeOpening = (overrides: Partial<Opening> = {}): Opening => ({
  id: "door_west_1",
  kind: "door",
  wall: "west",
  centerOffset: 2,
  width: 0.9,
  bottom: 0,
  height: 2.1,
  ...overrides,
});

export const makePlacedItem = (
  overrides: Partial<PlacedItem> = {},
): PlacedItem => ({
  id: "item_chair_1",
  pose: { x: 1, y: 1, rotationDeg: 0 },
  snapshot: {
    name: "Test Chair",
    category: "chair",
    dimensions: { width: 0.6, depth: 0.6, height: 0.8 },
    appearance: { color: "#C9B79C" },
    styleTags: ["warm-modern"],
  },
  ...overrides,
});

export const makeRoom = (
  overrides: Partial<WimyRoomV1> = {},
): WimyRoomV1 => ({
  name: "Test Room",
  dimensions: { width: 4, depth: 3, height: 2.7 },
  openings: [],
  items: [],
  ...overrides,
});
