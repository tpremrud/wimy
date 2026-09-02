import type { Opening, WimyRoomV1 } from "./document";

type DeepReadonly<T> = T extends readonly (infer Item)[]
  ? readonly DeepReadonly<Item>[]
  : T extends object
    ? { readonly [Key in keyof T]: DeepReadonly<T[Key]> }
    : T;

export type RoomRectangle = {
  left: number;
  right: number;
  top: number;
  bottom: number;
};

export type RoomPoint = { x: number; y: number };

const EPSILON_METERS = 1e-9;

export const roomUsableWallLength = (
  room: DeepReadonly<WimyRoomV1>,
  wall: Opening["wall"],
) => {
  const notch = room.geometry?.shape === "l-shape"
    ? room.geometry.notch
    : undefined;
  if (wall === "north") return room.dimensions.width;
  if (wall === "west") return room.dimensions.depth;
  if (wall === "east") return room.dimensions.depth - (notch?.depth ?? 0);
  return room.dimensions.width - (notch?.width ?? 0);
};

export const roomFloorPolygon = (
  room: DeepReadonly<WimyRoomV1>,
): RoomPoint[] => {
  const { width, depth } = room.dimensions;
  if (room.geometry?.shape !== "l-shape") {
    return [
      { x: 0, y: 0 },
      { x: width, y: 0 },
      { x: width, y: depth },
      { x: 0, y: depth },
    ];
  }
  const notchLeft = width - room.geometry.notch.width;
  const notchTop = depth - room.geometry.notch.depth;
  return [
    { x: 0, y: 0 },
    { x: width, y: 0 },
    { x: width, y: notchTop },
    { x: notchLeft, y: notchTop },
    { x: notchLeft, y: depth },
    { x: 0, y: depth },
  ];
};

export const isRectangleWithinRoom = (
  room: DeepReadonly<WimyRoomV1>,
  rectangle: RoomRectangle,
) => {
  if (
    rectangle.left < -EPSILON_METERS ||
    rectangle.right > room.dimensions.width + EPSILON_METERS ||
    rectangle.top < -EPSILON_METERS ||
    rectangle.bottom > room.dimensions.depth + EPSILON_METERS
  ) return false;
  if (room.geometry?.shape !== "l-shape") return true;
  const notchLeft = room.dimensions.width - room.geometry.notch.width;
  const notchTop = room.dimensions.depth - room.geometry.notch.depth;
  return !(
    rectangle.right > notchLeft + EPSILON_METERS &&
    rectangle.bottom > notchTop + EPSILON_METERS
  );
};

export const roomFloorRectangles = (
  room: DeepReadonly<WimyRoomV1>,
): RoomRectangle[] => {
  const { width, depth } = room.dimensions;
  if (room.geometry?.shape !== "l-shape") {
    return [{ left: 0, right: width, top: 0, bottom: depth }];
  }
  const notchLeft = width - room.geometry.notch.width;
  const notchTop = depth - room.geometry.notch.depth;
  return [
    { left: 0, right: width, top: 0, bottom: notchTop },
    { left: 0, right: notchLeft, top: notchTop, bottom: depth },
  ];
};

export const openingsOverlap = (
  first: DeepReadonly<Opening>,
  second: DeepReadonly<Opening>,
) => {
  if (first.wall !== second.wall || first.id === second.id) return false;
  const firstStart = first.centerOffset - first.width / 2;
  const firstEnd = first.centerOffset + first.width / 2;
  const secondStart = second.centerOffset - second.width / 2;
  const secondEnd = second.centerOffset + second.width / 2;
  const horizontalOverlap =
    firstStart < secondEnd - EPSILON_METERS &&
    firstEnd > secondStart + EPSILON_METERS;
  const verticalOverlap =
    first.bottom < second.bottom + second.height - EPSILON_METERS &&
    first.bottom + first.height > second.bottom + EPSILON_METERS;
  return horizontalOverlap && verticalOverlap;
};

export const findFirstAvailableOpening = (
  room: DeepReadonly<WimyRoomV1>,
  kind: Opening["kind"],
  id: string,
): Opening | null => {
  const width = kind === "door" ? 0.9 : 1.2;
  const bottom = kind === "door" ? 0 : 0.9;
  const height = kind === "door" ? 2.1 : 1.2;
  for (const wall of ["north", "east", "south", "west"] as const) {
    const wallLength = roomUsableWallLength(room, wall);
    const halfWidth = width / 2;
    for (let center = halfWidth; center <= wallLength - halfWidth + EPSILON_METERS; center += 0.1) {
      const candidate: Opening = {
        id,
        kind,
        wall,
        centerOffset: Math.round(center * 1000) / 1000,
        width,
        bottom,
        height,
      };
      if (!room.openings.some((opening) => openingsOverlap(candidate, opening))) {
        return candidate;
      }
    }
  }
  return null;
};
