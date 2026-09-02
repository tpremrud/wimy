import type {
  ProceduralAppearanceKey,
} from "../room/catalog-presentation";
import type { SceneItem, SceneVector3 } from "../room/projection";

export const FURNITURE_CYLINDER_SEGMENTS = 12;
export const FURNITURE_SPHERE_WIDTH_SEGMENTS = 12;
export const FURNITURE_SPHERE_HEIGHT_SEGMENTS = 8;
export const MAX_FURNITURE_PRIMITIVE_PARTS = 16;

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

const projectCatalogProceduralLayoutUnchecked = (
  item: SceneItem,
  appearanceKey: ProceduralAppearanceKey,
  { box, cylinder, ellipsoid, localY }: CatalogLayoutHelpers,
): FurniturePrimitivePart[] | undefined => {
  const [width, height, depth] = item.size;

  if (item.category === "chair" && appearanceKey === "molded-shell-lounge") {
    const seatHeight = height * 0.1;
    const seatWorldY = height * 0.43;
    const seatZ = -depth * 0.06;
    const legHeight = height * 0.38;
    const legRadiusBottom = Math.min(width, depth) * 0.075;
    const legRadiusTop = Math.min(width, depth) * 0.05;

    return [
      ellipsoid(
        item.color,
        [-width * 0.06, localY(height * 0.62), depth * 0.16],
        [width * 0.78, height * 0.58, depth * 0.28],
      ),
      ellipsoid(
        item.color,
        [width * 0.24, localY(height * 0.5), -depth * 0.04],
        [width * 0.28, height * 0.38, depth * 0.32],
      ),
      box(
        "#f1d5bd",
        [0, localY(seatWorldY), seatZ],
        [width * 0.68, seatHeight, depth * 0.55],
      ),
      ...[-width * 0.24, width * 0.24].flatMap((x) =>
        [seatZ - depth * 0.15, seatZ + depth * 0.15].map((z) =>
          cylinder(
            item.color,
            [x, localY(legHeight / 2), z],
            legRadiusBottom,
            legRadiusTop,
            legHeight,
          ),
        ),
      ),
    ];
  }

  if (item.category === "sofa" && appearanceKey === "modular-sofa") {
    const platformHeight = height * 0.16;
    const seatHeight = height * 0.34;
    const moduleWidth = width * 0.29;
    const moduleOffsets = [-width * 0.325, 0, width * 0.325];
    const backHeight = height * 0.5;
    const backDepth = depth * 0.16;

    return [
      box(
        item.color,
        [0, localY(platformHeight / 2), 0],
        [width, platformHeight, depth * 0.92],
      ),
      ...moduleOffsets.map((x, index) =>
        box(
          "#93a3ad",
          [
            x,
            localY(platformHeight + seatHeight / 2),
            index === 2 ? -depth * 0.04 : depth * 0.08,
          ],
          [
            moduleWidth,
            seatHeight,
            index === 2 ? depth * 0.86 : depth * 0.55,
          ],
        ),
      ),
      ...moduleOffsets.map((x) =>
        box(
          item.color,
          [x, localY(height - backHeight / 2), depth * 0.38],
          [moduleWidth, backHeight, backDepth],
        ),
      ),
    ];
  }

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

  if (item.category === "bed" && appearanceKey === "slatted-bed") {
    const frameHeight = Math.max(height * 0.18, 0.02);
    const mattressHeight = Math.max(height * 0.34, 0.02);
    const headboardHeight = Math.max(height * 0.5, 0.02);

    return [
      box(
        item.color,
        [0, localY(frameHeight / 2), 0],
        [width * 0.96, frameHeight, depth * 0.96],
      ),
      box(
        "#f2eee5",
        [0, localY(frameHeight + mattressHeight / 2), -depth * 0.06],
        [width * 0.9, mattressHeight, depth * 0.78],
      ),
      box(
        item.color,
        [0, localY(height * 0.5), depth * 0.42],
        [width * 0.96, headboardHeight, depth * 0.08],
      ),
      ...[-width * 0.3, 0, width * 0.3].map((x) =>
        box(
          "#d8c7aa",
          [x, localY(frameHeight + mattressHeight + 0.015), -depth * 0.06],
          [width * 0.16, Math.min(height * 0.05, 0.025), depth * 0.68],
        ),
      ),
    ];
  }

  if (item.category === "plant" && appearanceKey === "layered-plant") {
    const potHeight = Math.max(height * 0.22, 0.02);
    const leafSize: SceneVector3 = [width * 0.56, height * 0.28, depth * 0.56];
    const stemHeight = Math.max(height * 0.5, 0.02);

    return [
      cylinder(
        "#b87852",
        [0, localY(potHeight / 2), 0],
        Math.min(width, depth) * 0.3,
        Math.min(width, depth) * 0.24,
        potHeight,
      ),
      cylinder(
        "#6b4f35",
        [0, localY(potHeight + stemHeight / 2), 0],
        Math.min(width, depth) * 0.04,
        Math.min(width, depth) * 0.04,
        stemHeight,
      ),
      ellipsoid("#426b45", [0, localY(height * 0.9), 0], leafSize),
      ellipsoid(
        "#5b8957",
        [-width * 0.16, localY(height * 0.75), depth * 0.06],
        [leafSize[0] * 0.82, leafSize[1] * 0.82, leafSize[2] * 0.82],
      ),
      ellipsoid(
        "#365f3b",
        [width * 0.16, localY(height * 0.75), -depth * 0.06],
        [leafSize[0] * 0.82, leafSize[1] * 0.82, leafSize[2] * 0.82],
      ),
      ellipsoid(
        "#6b995e",
        [0, localY(height * 0.64), depth * 0.12],
        [leafSize[0] * 0.66, leafSize[1] * 0.66, leafSize[2] * 0.66],
      ),
    ];
  }

  if (item.category === "rug" && appearanceKey === "woven-rug") {
    const baseHeight = Math.min(Math.max(height * 0.5, 0.002), height);
    const stripeHeight = Math.min(Math.max(height * 0.2, 0.001), height);

    return [
      box("#d2a85d", [0, localY(baseHeight / 2), 0], [width * 0.98, baseHeight, depth * 0.96]),
      ...[-width * 0.3, -width * 0.1, width * 0.1, width * 0.3].map((x) =>
        box(
          "#8f6a43",
          [x, localY(baseHeight), 0],
          [width * 0.08, stripeHeight, depth * 0.82],
        ),
      ),
    ];
  }

  if (item.category === "desk" && appearanceKey === "folding-desk") {
    const topHeight = Math.min(Math.max(height * 0.1, 0.025), height);
    const legHeight = Math.max(height - topHeight, 0);
    const legWidth = Math.max(width * 0.08, 0.04);

    return [
      box(
        item.color,
        [0, localY(height - topHeight / 2), 0],
        [width * 0.96, topHeight, depth * 0.92],
      ),
      box(
        item.color,
        [-width * 0.38, localY(legHeight / 2), 0],
        [legWidth, legHeight, depth * 0.78],
      ),
      box(
        item.color,
        [width * 0.38, localY(legHeight / 2), 0],
        [legWidth, legHeight, depth * 0.78],
      ),
      box(
        "#c8a77a",
        [0, localY(height * 0.62), depth * 0.26],
        [width * 0.75, Math.min(height * 0.06, 0.04), 0.05],
      ),
      box(
        item.color,
        [0, localY(height * 0.85), depth * 0.32],
        [width * 0.82, Math.min(height * 0.08, 0.06), 0.06],
      ),
    ];
  }

  return undefined;
};

export const projectCatalogProceduralLayout = (
  item: SceneItem,
  appearanceKey: ProceduralAppearanceKey,
  helpers: CatalogLayoutHelpers,
): FurniturePrimitivePart[] | undefined => {
  const layout = projectCatalogProceduralLayoutUnchecked(
    item,
    appearanceKey,
    helpers,
  );
  return layout && layout.length <= MAX_FURNITURE_PRIMITIVE_PARTS
    ? layout
    : undefined;
};
