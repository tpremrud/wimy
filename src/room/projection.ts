import type { EntityId, Opening, WimyRoomV1 } from "./document";
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
