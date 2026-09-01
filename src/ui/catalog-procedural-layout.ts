import type {
  ProceduralAppearanceKey,
} from "../room/catalog-presentation";
import type { SceneItem, SceneVector3 } from "../room/projection";

type FurnitureBoxPart = {
  kind: "box";
  color: string;
  position: SceneVector3;
  size: SceneVector3;
};

type FurnitureCylinderPart = {
  kind: "cylinder";
  color: string;
  position: SceneVector3;
  radiusBottom: number;
  radiusTop: number;
  size: SceneVector3;
};

type FurnitureSpherePart = {
  kind: "sphere";
  color: string;
  position: SceneVector3;
  radius: number;
  scale?: SceneVector3;
};

export type FurniturePrimitivePart =
  | FurnitureBoxPart
  | FurnitureCylinderPart
  | FurnitureSpherePart;

type CatalogLayoutHelpers = {
  localY: (worldY: number) => number;
  box: (
    color: string,
    position: SceneVector3,
    size: SceneVector3,
  ) => FurnitureBoxPart;
  cylinder: (
    color: string,
    position: SceneVector3,
    radiusBottom: number,
    radiusTop: number,
    cylinderHeight: number,
  ) => FurnitureCylinderPart;
  ellipsoid: (
    color: string,
    position: SceneVector3,
    requestedSize: SceneVector3,
  ) => FurnitureSpherePart;
};

export const projectCatalogProceduralLayout = (
  item: SceneItem,
  appearanceKey: ProceduralAppearanceKey,
  { box, cylinder, ellipsoid, localY }: CatalogLayoutHelpers,
): FurniturePrimitivePart[] | undefined => {
  const [width, height, depth] = item.size;

  if (item.category === "chair" && appearanceKey === "cove-shell-chair") {
    const seatHeight = Math.max(height * 0.1, 0.02);
    const seatWorldY = height * 0.4;
    const legHeight = Math.max(height * 0.3, 0.02);
    const legRadius = Math.min(width, depth) * 0.065;

    return [
      ellipsoid(
        item.color,
        [0, localY(height * 0.58), depth * 0.14],
        [width * 0.84, height * 0.52, depth * 0.34],
      ),
      ellipsoid(
        "#d8c7aa",
        [0, localY(seatWorldY), -depth * 0.08],
        [width * 0.66, seatHeight, depth * 0.5],
      ),
      ...[-width * 0.25, width * 0.25].flatMap((x) =>
        [-depth * 0.12, depth * 0.2].map((z) =>
          cylinder(
            item.color,
            [x, localY(legHeight / 2), z],
            legRadius,
            legRadius * 0.72,
            legHeight,
          ),
        ),
      ),
    ];
  }

  if (item.category === "sofa" && appearanceKey === "corner-sofa") {
    const platformHeight = height * 0.16;
    const seatHeight = height * 0.34;
    const backHeight = height * 0.42;
    const moduleDepth = depth * 0.48;

    return [
      box(
        item.color,
        [0, localY(platformHeight / 2), 0],
        [width, platformHeight, depth * 0.9],
      ),
      box(
        "#8da0a8",
        [-width * 0.18, localY(platformHeight + seatHeight / 2), -depth * 0.08],
        [width * 0.58, seatHeight, moduleDepth],
      ),
      box(
        "#8da0a8",
        [width * 0.22, localY(platformHeight + seatHeight / 2), depth * 0.16],
        [width * 0.42, seatHeight, depth * 0.76],
      ),
      box(
        item.color,
        [-width * 0.18, localY(height - backHeight / 2), depth * 0.36],
        [width * 0.58, backHeight, depth * 0.14],
      ),
      box(
        item.color,
        [width * 0.4, localY(height - backHeight / 2), depth * 0.16],
        [width * 0.14, backHeight, depth * 0.76],
      ),
    ];
  }

  if (item.category === "table" && appearanceKey === "pedestal-dining-table") {
    const topHeight = Math.min(Math.max(height * 0.12, 0.05), height);
    const supportHeight = Math.max(height - topHeight, 0);
    const baseHeight = Math.min(
      Math.max(supportHeight * 0.08, 0.02),
      supportHeight,
    );
    const columnHeight = Math.max(supportHeight - baseHeight, 0);

    return [
      ellipsoid(
        item.color,
        [0, localY(height - topHeight / 2), 0],
        [width, topHeight, depth],
      ),
      cylinder(
        item.color,
        [0, localY(baseHeight + columnHeight / 2), 0],
        Math.min(width, depth) * 0.13,
        Math.min(width, depth) * 0.1,
        columnHeight,
      ),
      cylinder(
        item.color,
        [0, localY(baseHeight / 2), 0],
        Math.min(width, depth) * 0.34,
        Math.min(width, depth) * 0.34,
        baseHeight,
      ),
    ];
  }

  if (item.category === "chair" && appearanceKey === "reed-dining-chair") {
    const seatHeight = Math.max(height * 0.1, 0.02);
    const seatWorldY = height * 0.43;
    const legHeight = Math.max(height * 0.38, 0.02);
    const legRadius = Math.min(width, depth) * 0.045;

    return [
      box(
        "#cbb28e",
        [0, localY(seatWorldY), depth * 0.02],
        [width * 0.84, seatHeight, depth * 0.8],
      ),
      box(
        item.color,
        [0, localY(height - (height * 0.46) / 2), depth * 0.35],
        [width * 0.84, height * 0.46, depth * 0.1],
      ),
      ...[-width * 0.27, width * 0.27].flatMap((x) =>
        [-depth * 0.2, depth * 0.2].map((z) =>
          cylinder(
            item.color,
            [x, localY(legHeight / 2), z],
            legRadius,
            legRadius * 0.78,
            legHeight,
          ),
        ),
      ),
    ];
  }

  if (item.category === "dresser" && appearanceKey === "console-storage") {
    const bodyHeight = height * 0.7;
    const topHeight = Math.min(Math.max(height * 0.1, 0.04), height);
    const legHeight = Math.max(height - bodyHeight - topHeight, 0);

    return [
      box(
        item.color,
        [0, localY(legHeight + bodyHeight / 2), 0],
        [width * 0.94, bodyHeight, depth * 0.86],
      ),
      box(
        "#c8a77a",
        [0, localY(height - topHeight / 2), 0],
        [width, topHeight, depth * 0.92],
      ),
      ...[-width * 0.27, 0, width * 0.27].map((x) =>
        box(
          "#d8c7aa",
          [x, localY(legHeight + bodyHeight * 0.52), -depth * 0.44],
          [width * 0.18, bodyHeight * 0.18, 0.03],
        ),
      ),
      ...[-width * 0.38, width * 0.38].map((x) =>
        box(
          item.color,
          [x, localY(legHeight / 2), 0],
          [0.07, legHeight, depth * 0.72],
        ),
      ),
    ];
  }

  return undefined;
};
