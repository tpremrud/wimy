import { WimyRoomV1Schema, type EntityId, type WimyRoomV1 } from "./document";
import { roomUsableWallLength } from "./geometry";

type DeepReadonly<T> = T extends readonly (infer Item)[]
  ? readonly DeepReadonly<Item>[]
  : T extends object
    ? { readonly [Key in keyof T]: DeepReadonly<T[Key]> }
    : T;

const MILLIMETERS_PER_METER = 1_000;
const MIN_ROOM_SPAN_METERS = 1;
const MAX_ROOM_SPAN_METERS = 30;

const roundMillimeters = (value: number) => {
  const rounded = Math.round(value * MILLIMETERS_PER_METER) / MILLIMETERS_PER_METER;
  return Object.is(rounded, -0) ? 0 : rounded;
};

const clamp = (value: number, minimum: number, maximum: number) =>
  Math.min(Math.max(value, minimum), maximum);

const parsedCandidate = (room: WimyRoomV1) => {
  const parsed = WimyRoomV1Schema.safeParse(room);
  return parsed.success ? parsed.data : null;
};

const cloneRoom = (room: DeepReadonly<WimyRoomV1>) =>
  structuredClone(room) as WimyRoomV1;

export const moveOpeningAlongWall = (
  room: DeepReadonly<WimyRoomV1>,
  openingId: EntityId,
  desiredCenterOffset: number,
): WimyRoomV1 | null => {
  if (!Number.isFinite(desiredCenterOffset)) return null;
  const openingIndex = room.openings.findIndex(({ id }) => id === openingId);
  const opening = room.openings[openingIndex];
  if (!opening) return null;

  const halfWidth = opening.width / 2;
  const wallLength = roomUsableWallLength(room, opening.wall);
  const minimum = halfWidth;
  const maximum = wallLength - halfWidth;
  if (maximum < minimum) return null;

  const desired = roundMillimeters(clamp(desiredCenterOffset, minimum, maximum));
  const candidateOffsets = new Set<number>([minimum, desired, maximum].map(roundMillimeters));
  for (const other of room.openings) {
    if (other.id === opening.id || other.wall !== opening.wall) continue;
    const verticalOverlap =
      opening.bottom < other.bottom + other.height &&
      opening.bottom + opening.height > other.bottom;
    if (!verticalOverlap) continue;
    candidateOffsets.add(roundMillimeters(other.centerOffset - other.width / 2 - halfWidth));
    candidateOffsets.add(roundMillimeters(other.centerOffset + other.width / 2 + halfWidth));
  }

  const orderedOffsets = [...candidateOffsets]
    .filter((offset) => offset >= minimum && offset <= maximum)
    .sort((left, right) => Math.abs(left - desired) - Math.abs(right - desired) || left - right);

  for (const centerOffset of orderedOffsets) {
    const candidate = cloneRoom(room);
    candidate.openings[openingIndex] = { ...opening, centerOffset };
    const parsed = parsedCandidate(candidate);
    if (parsed) return parsed;
  }

  return null;
};

const roomWithDimension = (
  room: DeepReadonly<WimyRoomV1>,
  dimension: "width" | "depth",
  value: number,
): WimyRoomV1 => {
  const candidate = cloneRoom(room);
  candidate.dimensions[dimension] = roundMillimeters(value);
  return candidate;
};

export const resizeAnchoredRoom = (
  room: DeepReadonly<WimyRoomV1>,
  dimension: "width" | "depth",
  desiredValue: number,
): WimyRoomV1 | null => {
  if (!Number.isFinite(desiredValue)) return null;
  const desired = roundMillimeters(clamp(
    desiredValue,
    MIN_ROOM_SPAN_METERS,
    MAX_ROOM_SPAN_METERS,
  ));
  const direct = parsedCandidate(roomWithDimension(room, dimension, desired));
  if (direct) return direct;

  const currentValue = room.dimensions[dimension];
  if (desired >= currentValue) return null;

  let invalid = desired;
  let valid = currentValue;
  for (let iteration = 0; iteration < 24; iteration += 1) {
    const candidateValue = (invalid + valid) / 2;
    if (parsedCandidate(roomWithDimension(room, dimension, candidateValue))) {
      valid = candidateValue;
    } else {
      invalid = candidateValue;
    }
  }

  let nearestValid = Math.ceil(valid * MILLIMETERS_PER_METER) / MILLIMETERS_PER_METER;
  while (nearestValid <= currentValue) {
    const candidate = parsedCandidate(roomWithDimension(room, dimension, nearestValid));
    if (candidate) return candidate;
    nearestValid = roundMillimeters(nearestValid + 1 / MILLIMETERS_PER_METER);
  }
  return parsedCandidate(roomWithDimension(room, dimension, currentValue));
};
