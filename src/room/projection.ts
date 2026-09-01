import type {
  EntityId,
  FurnitureSnapshot,
  Opening,
  WimyRoomV1,
} from "./document";
import { orientedFootprint } from "./placement";

type DeepReadonly<T> = T extends readonly (infer Item)[]
  ? readonly DeepReadonly<Item>[]
  : T extends object
    ? { readonly [Key in keyof T]: DeepReadonly<T[Key]> }
    : T;

export type PlanPoint = { x: number; y: number };
export type PlanRect = PlanPoint & { width: number; height: number };

export type PlanViewport = {
  width: number;
  height: number;
  padding: number;
};

export type PlanOpeningMark = {
  id: EntityId;
  start: PlanPoint;
  end: PlanPoint;
};

export type PlanItem = {
  id: EntityId;
  center: PlanPoint;
  rect: PlanRect;
  labelAnchor: PlanPoint;
};

export type PlanProjection = {
  viewport: PlanViewport;
  scale: number;
  origin: PlanPoint;
  roomRect: PlanRect;
  dimensions: {
    width: { value: number; x: number; y: number };
    depth: { value: number; x: number; y: number };
  };
  openings: PlanOpeningMark[];
  items: PlanItem[];
};

export type SceneVector3 = [number, number, number];

export type SceneFloor = {
  position: SceneVector3;
  size: [number, number];
};

export type SceneWall = {
  wall: Opening["wall"];
  position: SceneVector3;
  size: SceneVector3;
};

export type SceneOpeningHint = {
  id: EntityId;
  kind: Opening["kind"];
  wall: Opening["wall"];
  position: SceneVector3;
  size: SceneVector3;
};

export type SceneItem = {
  id: EntityId;
  name: string;
  catalogRef?: {
    catalogId: string;
    productId: string;
  };
  catalogProductId?: string;
  category: FurnitureSnapshot["category"];
  color: string;
  position: SceneVector3;
  rotationDeg: number;
  rotationY: number;
  size: SceneVector3;
  styleTags: string[];
};

export type SceneProjection = {
  dimensions: SceneVector3;
  floor: SceneFloor;
  walls: SceneWall[];
  openings: SceneOpeningHint[];
  items: SceneItem[];
};

const NEUTRAL_SCENE_COLOR = "#8a8a8a";
const SAFE_HEX_COLOR = /^#[0-9a-f]{6}$/iu;
const WALL_THICKNESS = 0.08;
const OPENING_HINT_THICKNESS = 0.02;
const OPENING_HINT_WALL_GAP = 0.005;
const OPENING_HINT_INSET =
  WALL_THICKNESS / 2 + OPENING_HINT_THICKNESS / 2 + OPENING_HINT_WALL_GAP;

const sceneColor = (color: string) =>
  SAFE_HEX_COLOR.test(color) ? color : NEUTRAL_SCENE_COLOR;

const openingSceneSize = (opening: DeepReadonly<Opening>): SceneVector3 =>
  opening.wall === "north" || opening.wall === "south"
    ? [opening.width, opening.height, OPENING_HINT_THICKNESS]
    : [OPENING_HINT_THICKNESS, opening.height, opening.width];

const openingScenePosition = (
  opening: DeepReadonly<Opening>,
  room: DeepReadonly<WimyRoomV1>,
): SceneVector3 => {
  const height = opening.bottom + opening.height / 2;

  switch (opening.wall) {
    case "north":
      return [opening.centerOffset, height, OPENING_HINT_INSET];
    case "east":
      return [
        room.dimensions.width - OPENING_HINT_INSET,
        height,
        opening.centerOffset,
      ];
    case "south":
      return [
        opening.centerOffset,
        height,
        room.dimensions.depth - OPENING_HINT_INSET,
      ];
    case "west":
      return [OPENING_HINT_INSET, height, opening.centerOffset];
  }
};

export const projectRoomToScene = (
  room: DeepReadonly<WimyRoomV1>,
): SceneProjection => {
  const { width, depth, height } = room.dimensions;

  return {
    dimensions: [width, height, depth],
    floor: {
      position: [width / 2, 0, depth / 2],
      size: [width, depth],
    },
    walls: [
      {
        wall: "north",
        position: [width / 2, height / 2, 0],
        size: [width, height, WALL_THICKNESS],
      },
      {
        wall: "east",
        position: [width, height / 2, depth / 2],
        size: [WALL_THICKNESS, height, depth],
      },
      {
        wall: "south",
        position: [width / 2, height / 2, depth],
        size: [width, height, WALL_THICKNESS],
      },
      {
        wall: "west",
        position: [0, height / 2, depth / 2],
        size: [WALL_THICKNESS, height, depth],
      },
    ],
    openings: room.openings.map((opening) => ({
      id: opening.id,
      kind: opening.kind,
      wall: opening.wall,
      position: openingScenePosition(opening, room),
      size: openingSceneSize(opening),
    })),
    items: room.items.map((item) => ({
      id: item.id,
      name: item.snapshot.name,
      ...(item.catalogRef
        ? { catalogRef: { ...item.catalogRef } }
        : {}),
      ...(item.catalogRef?.productId
        ? { catalogProductId: item.catalogRef.productId }
        : {}),
      category: item.snapshot.category,
      color: sceneColor(item.snapshot.appearance.color),
      position: [
        item.pose.x,
        item.snapshot.dimensions.height / 2,
        item.pose.y,
      ],
      rotationDeg: item.pose.rotationDeg,
      rotationY:
        item.pose.rotationDeg === 0
          ? 0
          : (-item.pose.rotationDeg * Math.PI) / 180,
      size: [
        item.snapshot.dimensions.width,
        item.snapshot.dimensions.height,
        item.snapshot.dimensions.depth,
      ],
      styleTags: [...item.snapshot.styleTags],
    })),
  };
};

const projectOpening = (
  opening: DeepReadonly<Opening>,
  origin: PlanPoint,
  roomRect: PlanRect,
  scale: number,
): PlanOpeningMark => {
  const startOffset = opening.centerOffset - opening.width / 2;
  const endOffset = opening.centerOffset + opening.width / 2;
  const horizontal = opening.wall === "north" || opening.wall === "south";
  const wallCoordinate =
    opening.wall === "north"
      ? origin.y
      : opening.wall === "south"
        ? origin.y + roomRect.height
        : opening.wall === "west"
          ? origin.x
          : origin.x + roomRect.width;

  return {
    id: opening.id,
    start: horizontal
      ? { x: origin.x + startOffset * scale, y: wallCoordinate }
      : { x: wallCoordinate, y: origin.y + startOffset * scale },
    end: horizontal
      ? { x: origin.x + endOffset * scale, y: wallCoordinate }
      : { x: wallCoordinate, y: origin.y + endOffset * scale },
  };
};

export const projectRoomToPlan = (
  room: DeepReadonly<WimyRoomV1>,
  viewport: PlanViewport,
): PlanProjection => {
  const drawableWidth = viewport.width - viewport.padding * 2;
  const drawableHeight = viewport.height - viewport.padding * 2;
  const scale = Math.min(
    drawableWidth / room.dimensions.width,
    drawableHeight / room.dimensions.depth,
  );
  const roomWidth = room.dimensions.width * scale;
  const roomHeight = room.dimensions.depth * scale;
  const origin = {
    x: (viewport.width - roomWidth) / 2,
    y: (viewport.height - roomHeight) / 2,
  };
  const roomRect = {
    ...origin,
    width: roomWidth,
    height: roomHeight,
  };
  const items = room.items.map((item): PlanItem => {
    const footprint = orientedFootprint(
      item.snapshot.dimensions,
      item.pose.rotationDeg,
    );
    const center = {
      x: origin.x + item.pose.x * scale,
      y: origin.y + item.pose.y * scale,
    };

    return {
      id: item.id,
      center,
      rect: {
        x: center.x - (footprint.width * scale) / 2,
        y: center.y - (footprint.depth * scale) / 2,
        width: footprint.width * scale,
        height: footprint.depth * scale,
      },
      labelAnchor: { ...center },
    };
  });

  return {
    viewport: { ...viewport },
    scale,
    origin,
    roomRect,
    dimensions: {
      width: {
        value: room.dimensions.width,
        x: origin.x + roomWidth / 2,
        y: origin.y + roomHeight + viewport.padding / 2,
      },
      depth: {
        value: room.dimensions.depth,
        x: origin.x - viewport.padding / 2,
        y: origin.y + roomHeight / 2,
      },
    },
    openings: room.openings.map((opening) =>
      projectOpening(opening, origin, roomRect, scale),
    ),
    items,
  };
};

export const clientPointToSvg = (
  svg: SVGSVGElement,
  clientPoint: PlanPoint,
): PlanPoint | null => {
  const matrix = svg.getScreenCTM?.();
  if (!matrix) return null;

  try {
    const point = new DOMPoint(clientPoint.x, clientPoint.y).matrixTransform(
      matrix.inverse(),
    );
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return null;
    return { x: point.x, y: point.y };
  } catch {
    return null;
  }
};

export const planPointToRoom = (
  projection: PlanProjection,
  planPoint: PlanPoint,
): PlanPoint => ({
  x: (planPoint.x - projection.origin.x) / projection.scale,
  y: (planPoint.y - projection.origin.y) / projection.scale,
});

export const screenPointToRoom = (
  svg: SVGSVGElement,
  clientPoint: PlanPoint,
  projection: PlanProjection,
): PlanPoint | null => {
  const planPoint = clientPointToSvg(svg, clientPoint);
  return planPoint ? planPointToRoom(projection, planPoint) : null;
};
