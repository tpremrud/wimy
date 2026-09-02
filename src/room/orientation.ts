import type {
  Dimensions,
  FurnitureSnapshot,
  RotationDeg,
} from "./document";

export type PlanDirection = "north" | "east" | "south" | "west";
export type OrientationCue = "facing" | "head" | "use-side" | "none";

export type FurnitureOrientation = {
  cue: OrientationCue;
  direction: PlanDirection | null;
  directionVector: readonly [number, number];
  label: string;
  rotationDeg: RotationDeg;
};

// The top of the plan is Plan North. A furniture item's local negative-depth
// edge is its front/use edge at zero rotation; the bed head is the opposite
// local edge. Room rotation remains the only persisted orientation source.
const LOCAL_FRONT_VECTOR = [0, -1] as const;
const LOCAL_HEAD_VECTOR = [0, 1] as const;

const rotatePlanVector = (
  vector: readonly [number, number],
  rotationDeg: RotationDeg,
): readonly [number, number] => {
  const [x, y] = vector;
  const normalizeZero = (value: number) => (Object.is(value, -0) ? 0 : value);
  switch (rotationDeg) {
    case 0:
      return [x, y];
    case 90:
      return [normalizeZero(-y), normalizeZero(x)];
    case 180:
      return [normalizeZero(-x), normalizeZero(-y)];
    case 270:
      return [normalizeZero(y), normalizeZero(-x)];
  }
};

const directionForVector = (
  vector: readonly [number, number],
): PlanDirection => {
  const [x, y] = vector;
  if (x > 0) return "east";
  if (x < 0) return "west";
  return y < 0 ? "north" : "south";
};

const cueForCategory = (
  category: FurnitureSnapshot["category"],
  dimensions?: Pick<Dimensions, "width" | "depth">,
): { cue: OrientationCue; localVector: readonly [number, number] } => {
  if (category === "bed") {
    return { cue: "head", localVector: LOCAL_HEAD_VECTOR };
  }

  if (category === "sofa" || category === "chair") {
    return { cue: "facing", localVector: LOCAL_FRONT_VECTOR };
  }

  if (
    category === "desk" ||
    category === "dresser" ||
    (category === "table" &&
      (dimensions === undefined || dimensions.width !== dimensions.depth))
  ) {
    return { cue: "use-side", localVector: LOCAL_FRONT_VECTOR };
  }

  return { cue: "none", localVector: [0, 0] };
};

export const projectFurnitureOrientation = (
  category: FurnitureSnapshot["category"],
  rotationDeg: RotationDeg,
  dimensions?: Pick<Dimensions, "width" | "depth">,
): FurnitureOrientation => {
  const { cue, localVector } = cueForCategory(category, dimensions);
  if (cue === "none") {
    return {
      cue,
      direction: null,
      directionVector: [0, 0],
      label: "No fixed direction",
      rotationDeg,
    };
  }

  const directionVector = rotatePlanVector(localVector, rotationDeg);
  const direction = directionForVector(directionVector);
  const cueLabel = cue === "facing" ? "Facing" : cue === "head" ? "Head" : "Use side";

  return {
    cue,
    direction,
    directionVector,
    label: `${cueLabel} ${direction}`,
    rotationDeg,
  };
};
