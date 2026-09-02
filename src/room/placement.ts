import type {
  Dimensions,
  EntityId,
  Opening,
  PlacedItem,
  Pose,
  RotationDeg,
  WimyRoomV1,
} from "./document";
import { isRectangleWithinRoom } from "./geometry";

const PLACEMENT_EPSILON_METERS = 1e-9;

type DeepReadonly<T> = T extends (...args: never[]) => unknown
  ? T
  : T extends readonly (infer Item)[]
    ? readonly DeepReadonly<Item>[]
    : T extends object
      ? { readonly [Key in keyof T]: DeepReadonly<T[Key]> }
      : T;

export type PreparedPlacementRoom = DeepReadonly<WimyRoomV1>;

export type Footprint = Pick<Dimensions, "width" | "depth">;

type Rectangle = {
  left: number;
  right: number;
  top: number;
  bottom: number;
};

const preparedPlacementContextBrand = Symbol("prepared-placement-context");

export type PreparedPlacementContext = {
  readonly [preparedPlacementContextBrand]: true;
  readonly room: PreparedPlacementRoom;
};

type PreparedPlacementContextValue = PreparedPlacementContext & {
  readonly blockingRectangles: readonly {
    readonly id: EntityId;
    readonly rectangle: Rectangle;
  }[];
  readonly doorClearanceRectangles: readonly {
    readonly id: EntityId;
    readonly rectangle: Rectangle;
  }[];
};

const deepFreeze = <T>(value: T): DeepReadonly<T> => {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.values(value).forEach((child) => deepFreeze(child));
    Object.freeze(value);
  }

  return value as DeepReadonly<T>;
};

export type PlacementFailureCode =
  | "OUT_OF_BOUNDS"
  | "COLLISION"
  | "DOOR_CLEARANCE";

export type PlacementValidation =
  | { ok: true }
  | {
      ok: false;
      code: PlacementFailureCode;
      message: string;
    };

export type RoomWarning =
  | { code: "OVERLAP"; message: string; itemIds: [EntityId, EntityId] }
  | { code: "DOOR_CLEARANCE"; message: string; itemIds: [EntityId] }
  | { code: "CATALOG_UNAVAILABLE"; message: string; itemIds: [EntityId] };

type CatalogRef = NonNullable<PlacedItem["catalogRef"]>;
export type CatalogAvailability = (catalogRef: CatalogRef) => boolean;

export const orientedFootprint = (
  dimensions: Readonly<Dimensions>,
  rotationDeg: RotationDeg,
): Footprint =>
  rotationDeg === 90 || rotationDeg === 270
    ? { width: dimensions.depth, depth: dimensions.width }
    : { width: dimensions.width, depth: dimensions.depth };

const rectangleFor = (
  item: DeepReadonly<PlacedItem>,
  pose: Readonly<Pose>,
): Rectangle => {
  const footprint = orientedFootprint(item.snapshot.dimensions, pose.rotationDeg);
  return {
    left: pose.x - footprint.width / 2,
    right: pose.x + footprint.width / 2,
    top: pose.y - footprint.depth / 2,
    bottom: pose.y + footprint.depth / 2,
  };
};

const rectanglesOverlap = (first: Rectangle, second: Rectangle) =>
  first.left < second.right - PLACEMENT_EPSILON_METERS &&
  first.right > second.left + PLACEMENT_EPSILON_METERS &&
  first.top < second.bottom - PLACEMENT_EPSILON_METERS &&
  first.bottom > second.top + PLACEMENT_EPSILON_METERS;

const doorClearanceRectangle = (
  opening: DeepReadonly<Opening>,
  room: PreparedPlacementRoom,
): Rectangle | undefined => {
  if (opening.kind !== "door") {
    return undefined;
  }

  const halfWidth = opening.width / 2;
  if (opening.wall === "north") {
    return {
      left: opening.centerOffset - halfWidth,
      right: opening.centerOffset + halfWidth,
      top: 0,
      bottom: Math.min(1, room.dimensions.depth),
    };
  }
  if (opening.wall === "south") {
    return {
      left: opening.centerOffset - halfWidth,
      right: opening.centerOffset + halfWidth,
      top: Math.max(0, room.dimensions.depth - 1),
      bottom: room.dimensions.depth,
    };
  }
  if (opening.wall === "west") {
    return {
      left: 0,
      right: Math.min(1, room.dimensions.width),
      top: opening.centerOffset - halfWidth,
      bottom: opening.centerOffset + halfWidth,
    };
  }
  if (opening.wall === "east") {
    return {
      left: Math.max(0, room.dimensions.width - 1),
      right: room.dimensions.width,
      top: opening.centerOffset - halfWidth,
      bottom: opening.centerOffset + halfWidth,
    };
  }

  return undefined;
};

const createPreparedPlacementContext = (
  room: PreparedPlacementRoom,
): PreparedPlacementContextValue => {
  const preparedRoom = deepFreeze(structuredClone(room));
  const blockingRectangles = preparedRoom.items
    .filter(({ snapshot }) => snapshot.category !== "rug")
    .map((item) => ({
      id: item.id,
      rectangle: rectangleFor(item, item.pose),
    }));
  const doorClearanceRectangles = preparedRoom.openings.flatMap((opening) => {
    const rectangle = doorClearanceRectangle(opening, preparedRoom);
    return rectangle === undefined
      ? []
      : [
          {
            id: opening.id,
            rectangle,
          },
        ];
  });

  const context: PreparedPlacementContextValue = {
    [preparedPlacementContextBrand]: true,
    room: preparedRoom,
    blockingRectangles,
    doorClearanceRectangles,
  };

  return context;
};

export const preparePlacementContext = (
  room: PreparedPlacementRoom,
): PreparedPlacementContext => createPreparedPlacementContext(room);

const preparedContextForRoom = (
  room: PreparedPlacementRoom,
  context: PreparedPlacementContext,
): PreparedPlacementContextValue => {
  const prepared = context as PreparedPlacementContextValue;
  if (prepared.room !== room) {
    throw new TypeError(
      "Prepared placement context must belong to the validated room",
    );
  }

  return prepared;
};

export const validatePlacement = (
  room: PreparedPlacementRoom,
  item: DeepReadonly<PlacedItem>,
  pose: Readonly<Pose>,
  preparedContext?: PreparedPlacementContext,
): PlacementValidation => {
  const suppliedContext =
    preparedContext === undefined
      ? undefined
      : preparedContextForRoom(room, preparedContext);

  if (
    item.snapshot.dimensions.height >
    room.dimensions.height + PLACEMENT_EPSILON_METERS
  ) {
    return {
      ok: false,
      code: "OUT_OF_BOUNDS",
      message: "The placed item height must fit inside the room",
    };
  }

  const footprint = orientedFootprint(item.snapshot.dimensions, pose.rotationDeg);

  if (!isRectangleWithinRoom(room, {
    left: pose.x - footprint.width / 2,
    right: pose.x + footprint.width / 2,
    top: pose.y - footprint.depth / 2,
    bottom: pose.y + footprint.depth / 2,
  })) {
    return {
      ok: false,
      code: "OUT_OF_BOUNDS",
      message: "The placed item must fit inside the room",
    };
  }

  const candidateRectangle = rectangleFor(item, pose);
  const context =
    suppliedContext ?? createPreparedPlacementContext(room);
  let blockingItemId: EntityId | undefined;
  if (item.snapshot.category !== "rug") {
    for (const blockingItem of context.blockingRectangles) {
      if (
        blockingItem.id !== item.id &&
        rectanglesOverlap(candidateRectangle, blockingItem.rectangle)
      ) {
        blockingItemId = blockingItem.id;
        break;
      }
    }
  }
  if (blockingItemId) {
    return {
      ok: false,
      code: "COLLISION",
      message: `The placed item overlaps ${blockingItemId}`,
    };
  }

  let blockedDoorId: EntityId | undefined;
  for (const doorClearance of context.doorClearanceRectangles) {
    if (rectanglesOverlap(candidateRectangle, doorClearance.rectangle)) {
      blockedDoorId = doorClearance.id;
      break;
    }
  }
  if (blockedDoorId) {
    return {
      ok: false,
      code: "DOOR_CLEARANCE",
      message: `The placed item blocks door clearance at ${blockedDoorId}`,
    };
  }

  return { ok: true };
};

const canonicalPosition = (value: number) => {
  const rounded = Math.round(value * 1_000) / 1_000;
  return Object.is(rounded, -0) ? 0 : rounded;
};

const portableFloor = (value: number) => Math.floor(value * 1_000 + 1e-9) / 1_000;
const portableCeil = (value: number) => Math.ceil(value * 1_000 - 1e-9) / 1_000;

const squaredDistance = (first: Readonly<Pose>, second: Readonly<Pose>) =>
  (first.x - second.x) ** 2 + (first.y - second.y) ** 2;

/**
 * Finds the nearest deterministic Pose for a human quarter-turn. The search
 * keeps blocking furniture and door clearance authoritative; only rugs retain
 * their existing overlap exception.
 */
export const findNearestLegalRotationPose = (
  room: PreparedPlacementRoom,
  item: PreparedPlacementRoom["items"][number],
  rotationDeg: RotationDeg,
): Pose | undefined => {
  const footprint = orientedFootprint(item.snapshot.dimensions, rotationDeg);
  const minX = portableCeil(footprint.width / 2);
  const maxX = portableFloor(room.dimensions.width - footprint.width / 2);
  const minY = portableCeil(footprint.depth / 2);
  const maxY = portableFloor(room.dimensions.depth - footprint.depth / 2);
  if (minX > maxX || minY > maxY) return undefined;

  const clamp = (value: number, minimum: number, maximum: number) =>
    canonicalPosition(Math.min(maximum, Math.max(minimum, value)));
  const clampedPose: Pose = {
    x: clamp(item.pose.x, minX, maxX),
    y: clamp(item.pose.y, minY, maxY),
    rotationDeg,
  };
  const context = preparePlacementContext(room);
  const prepared = context as PreparedPlacementContextValue;
  const placementItem = prepared.room.items.find(({ id }) => id === item.id);
  if (!placementItem) return undefined;

  const xCoordinates = new Set<number>([minX, maxX, clampedPose.x]);
  const yCoordinates = new Set<number>([minY, maxY, clampedPose.y]);
  const addCoordinate = (
    coordinates: Set<number>,
    value: number,
    minimum: number,
    maximum: number,
  ) => {
    for (const canonical of [portableFloor(value), portableCeil(value)]) {
      if (
        canonical >= minimum - PLACEMENT_EPSILON_METERS &&
        canonical <= maximum + PLACEMENT_EPSILON_METERS
      ) {
        coordinates.add(canonical);
      }
    }
  };
  const blockingRectangles = [
    ...prepared.blockingRectangles.filter(({ id }) => id !== item.id),
    ...prepared.doorClearanceRectangles,
  ];
  for (const { rectangle } of blockingRectangles) {
    addCoordinate(xCoordinates, rectangle.left - footprint.width / 2, minX, maxX);
    addCoordinate(xCoordinates, rectangle.right + footprint.width / 2, minX, maxX);
    addCoordinate(yCoordinates, rectangle.top - footprint.depth / 2, minY, maxY);
    addCoordinate(yCoordinates, rectangle.bottom + footprint.depth / 2, minY, maxY);
  }

  const sortAxis = (coordinates: Set<number>, current: number) =>
    [...coordinates].sort(
      (first, second) =>
        Math.abs(first - current) - Math.abs(second - current) || first - second,
    );
  const xs = sortAxis(xCoordinates, item.pose.x);
  const ys = sortAxis(yCoordinates, item.pose.y);
  type CandidateIndex = { xIndex: number; yIndex: number; pose: Pose };
  const compareCandidates = (first: CandidateIndex, second: CandidateIndex) =>
    squaredDistance(first.pose, item.pose) - squaredDistance(second.pose, item.pose) ||
    Math.abs(first.pose.y - item.pose.y) - Math.abs(second.pose.y - item.pose.y) ||
    Math.abs(first.pose.x - item.pose.x) - Math.abs(second.pose.x - item.pose.x) ||
    first.pose.y - second.pose.y ||
    first.pose.x - second.pose.x;
  const heap: CandidateIndex[] = [];
  const push = (candidate: CandidateIndex) => {
    heap.push(candidate);
    let index = heap.length - 1;
    while (index > 0) {
      const parent = Math.floor((index - 1) / 2);
      if (compareCandidates(heap[parent]!, candidate) <= 0) break;
      heap[index] = heap[parent]!;
      index = parent;
    }
    heap[index] = candidate;
  };
  const pop = () => {
    const first = heap[0];
    const last = heap.pop();
    if (!first || !last || heap.length === 0) return first;
    let index = 0;
    while (true) {
      const left = index * 2 + 1;
      const right = left + 1;
      if (left >= heap.length) break;
      const child =
        right < heap.length && compareCandidates(heap[right]!, heap[left]!) < 0
          ? right
          : left;
      if (compareCandidates(last, heap[child]!) <= 0) break;
      heap[index] = heap[child]!;
      index = child;
    }
    heap[index] = last;
    return first;
  };

  for (let xIndex = 0; xIndex < xs.length; xIndex += 1) {
    push({
      xIndex,
      yIndex: 0,
      pose: { x: xs[xIndex]!, y: ys[0]!, rotationDeg },
    });
  }
  while (heap.length > 0) {
    const candidate = pop()!;
    if (
      validatePlacement(prepared.room, placementItem, candidate.pose, context).ok
    ) {
      return candidate.pose;
    }
    const nextYIndex = candidate.yIndex + 1;
    if (nextYIndex < ys.length) {
      push({
        xIndex: candidate.xIndex,
        yIndex: nextYIndex,
        pose: {
          x: xs[candidate.xIndex]!,
          y: ys[nextYIndex]!,
          rotationDeg,
        },
      });
    }
  }
  return undefined;
};

export const findLayoutWarnings = (
  room: WimyRoomV1,
  isCatalogProductAvailable: CatalogAvailability,
): RoomWarning[] => {
  const warnings: RoomWarning[] = [];

  for (let firstIndex = 0; firstIndex < room.items.length; firstIndex += 1) {
    const firstItem = room.items[firstIndex];
    if (!firstItem || firstItem.snapshot.category === "rug") {
      continue;
    }

    for (
      let secondIndex = firstIndex + 1;
      secondIndex < room.items.length;
      secondIndex += 1
    ) {
      const secondItem = room.items[secondIndex];
      if (!secondItem || secondItem.snapshot.category === "rug") {
        continue;
      }

      if (
        rectanglesOverlap(
          rectangleFor(firstItem, firstItem.pose),
          rectangleFor(secondItem, secondItem.pose),
        )
      ) {
        warnings.push({
          code: "OVERLAP",
          message: `${firstItem.id} overlaps ${secondItem.id}`,
          itemIds: [firstItem.id, secondItem.id],
        });
      }
    }
  }

  for (const item of room.items) {
    const itemRectangle = rectangleFor(item, item.pose);
    for (const opening of room.openings) {
      const clearance = doorClearanceRectangle(opening, room);
      if (
        clearance !== undefined &&
        rectanglesOverlap(itemRectangle, clearance)
      ) {
        warnings.push({
          code: "DOOR_CLEARANCE",
          message: `${item.id} blocks door clearance at ${opening.id}`,
          itemIds: [item.id],
        });
      }
    }
  }

  for (const item of room.items) {
    if (
      item.catalogRef !== undefined &&
      !isCatalogProductAvailable(item.catalogRef)
    ) {
      warnings.push({
        code: "CATALOG_UNAVAILABLE",
        message: `${item.id} references unavailable catalog product ${item.catalogRef.catalogId}/${item.catalogRef.productId}`,
        itemIds: [item.id],
      });
    }
  }

  return warnings;
};
