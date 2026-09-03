import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Children, useState, type ReactNode } from "react";
import { useStore } from "zustand";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { projectRoomToScene, type SceneItem } from "../room/projection";
import { getCatalogPresentation } from "../room/catalog-presentation";
import { projectFurnitureOrientation } from "../room/orientation";
import { createRoomStore, type RoomStore } from "../room/store";
import { createLightingPreviewStore } from "../room/lighting-preview";
import { TEST_TRANSACTION_DEPENDENCIES } from "../room/transaction";
import { makeOpening, makePlacedItem, makeRoom } from "../test/room-fixtures";
import { MAX_FURNITURE_PRIMITIVE_PARTS } from "./catalog-procedural-layout";
import {
  projectFurniturePrimitiveLayout,
  probeWebGL2PreviewSupport,
  RoomPreview3D,
} from "./RoomPreview3D";
import type { SunBeam } from "../room/sunlight";
import {
  MAX_SHADOW_CASTING_WINDOW_LIGHTS,
  selectShadowCastingWindowLightIds,
} from "./window-lighting";

const canvasHarness = vi.hoisted(() => ({
  cameras: [] as unknown[],
  frameloops: [] as unknown[],
  shadows: [] as unknown[],
  gl: { domElement: { setAttribute: () => {} } },
  camera: {
    far: 100,
    lookAt: () => {},
    near: 0.1,
    position: {
      values: [0, 0, 0],
      set(...values: number[]) {
        this.values = values;
      },
      toArray() {
        return this.values;
      },
    },
    updateProjectionMatrix: () => {},
  },
  invalidate: vi.fn(),
  mounts: 0,
  throws: false,
}));

vi.mock("@react-three/fiber", () => ({
  Canvas: ({
    camera,
    children,
    frameloop,
    shadows,
  }: {
    camera: unknown;
    children: ReactNode;
    frameloop: unknown;
    shadows: unknown;
  }) => {
    if (canvasHarness.throws) {
      throw new Error("WebGL unavailable for test");
    }
    canvasHarness.mounts += 1;
    canvasHarness.cameras.push(camera);
    canvasHarness.frameloops.push(frameloop);
    canvasHarness.shadows.push(shadows);
    // Keep R3F host primitives inside its custom renderer, not React DOM/jsdom.
    const [cameraFramer] = Children.toArray(children);
    return <div data-testid="three-canvas-host">{cameraFramer}</div>;
  },
  useThree: () => ({
    camera: canvasHarness.camera,
    gl: canvasHarness.gl,
    invalidate: canvasHarness.invalidate,
    size: { height: 500, width: 500 },
  }),
  useFrame: () => {},
}));

vi.mock("@react-three/drei", () => ({
  Grid: () => null,
  OrbitControls: () => null,
}));

afterEach(() => {
  cleanup();
  canvasHarness.cameras = [];
  canvasHarness.frameloops = [];
  canvasHarness.shadows = [];
  canvasHarness.invalidate.mockReset();
  canvasHarness.mounts = 0;
  canvasHarness.camera.position.values = [0, 0, 0];
  canvasHarness.throws = false;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const makeSceneItem = (category: SceneItem["category"]): SceneItem => ({
  id: `item_${category}`,
  name: `${category} item`,
  category,
  color: "#123456",
  position: [1, 0.4, 1],
  rotationDeg: 0,
  rotationY: 0,
  size: [1.2, 0.8, 0.9],
  styleTags: [],
  orientation: projectFurnitureOrientation(category, 0, {
    width: 1.2,
    depth: 0.9,
  }),
});

const StorePreview = ({ store }: { store: RoomStore }) => {
  const room = useStore(store, (state) => state.room);
  return <RoomPreview3D room={room} />;
};

const PreviewToggle = () => {
  const [view, setView] = useState<"2d" | "3d">("2d");
  return (
    <>
      <button onClick={() => setView("2d")} type="button">Edit in 2D</button>
      <button onClick={() => setView("3d")} type="button">Preview in 3D</button>
      {view === "3d" ? (
        <RoomPreview3D room={makeRoom()} webglSupportOverride={false} />
      ) : null}
    </>
  );
};

const openLightingSettings = () => {
  fireEvent.click(screen.getByRole("button", { name: "Open lighting settings" }));
};

const webglContextHarness = vi.hoisted(() => ({
  loseContext: vi.fn(),
}));

beforeEach(() => {
  webglContextHarness.loseContext.mockReset();
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
    getExtension: () => ({ loseContext: webglContextHarness.loseContext }),
  } as unknown as RenderingContext);
});

const verticalBounds = (
  item: SceneItem,
  parts: ReturnType<typeof projectFurniturePrimitiveLayout>,
) => {
  const itemCenterY = item.size[1] / 2;
  const bounds = parts.map((part) => {
    const halfHeight =
      part.kind === "sphere"
        ? part.radius * (part.scale?.[1] ?? 1)
        : part.size[1] / 2;
    return {
      bottom: itemCenterY + part.position[1] - halfHeight,
      top: itemCenterY + part.position[1] + halfHeight,
    };
  });

  return {
    bottom: Math.min(...bounds.map((part) => part.bottom)),
    top: Math.max(...bounds.map((part) => part.top)),
  };
};

const partEnvelope = (
  item: SceneItem,
  parts: ReturnType<typeof projectFurniturePrimitiveLayout>,
) => {
  const itemCenterY = item.size[1] / 2;
  const bounds = parts.map((part) => {
    const halfSize: SceneItem["size"] =
      part.kind === "sphere"
        ? part.scale
          ? [
              part.radius * part.scale[0],
              part.radius * part.scale[1],
              part.radius * part.scale[2],
            ]
          : [part.radius, part.radius, part.radius]
        : part.kind === "cylinder"
          ? [
              Math.max(part.radiusBottom, part.radiusTop),
              part.size[1] / 2,
              Math.max(part.radiusBottom, part.radiusTop),
            ]
          : [part.size[0] / 2, part.size[1] / 2, part.size[2] / 2];
    const center: SceneItem["position"] = [
      part.position[0],
      itemCenterY + part.position[1],
      part.position[2],
    ];
    return {
      min: center.map((value, index) => value - halfSize[index]),
      max: center.map((value, index) => value + halfSize[index]),
    };
  });

  return {
    min: bounds.map(({ min }) => min).reduce(
      (envelope, bounds) =>
        envelope.map((value, index) => Math.min(value, bounds[index])),
    ),
    max: bounds.map(({ max }) => max).reduce(
      (envelope, bounds) =>
        envelope.map((value, index) => Math.max(value, bounds[index])),
    ),
  };
};

const primitiveSignature = (
  parts: ReturnType<typeof projectFurniturePrimitiveLayout>,
) => {
  const roundedVector = (vector: SceneItem["size"]) =>
    vector.map((value) => Number(value.toFixed(4)));

  return parts.map((part) => {
    if (part.kind === "sphere") {
      return {
        kind: part.kind,
        color: part.color,
        position: roundedVector(part.position),
        radius: Number(part.radius.toFixed(4)),
        ...(part.scale ? { scale: roundedVector(part.scale) } : {}),
      };
    }
    if (part.kind === "cylinder") {
      return {
        kind: part.kind,
        color: part.color,
        position: roundedVector(part.position),
        radiusBottom: Number(part.radiusBottom.toFixed(4)),
        radiusTop: Number(part.radiusTop.toFixed(4)),
        size: roundedVector(part.size),
      };
    }
    return {
      kind: part.kind,
      color: part.color,
      position: roundedVector(part.position),
      size: roundedVector(part.size),
    };
  });
};

const newlyAuthoredLayoutCases = [
  {
    catalogProductId: "harbor-slat-bed",
    category: "bed",
    kinds: ["box", "box", "box", "box", "box", "box"],
    size: [1.5, 0.5, 2.05],
  },
  {
    catalogProductId: "juniper-rise-plant",
    category: "plant",
    kinds: ["cylinder", "cylinder", "sphere", "sphere", "sphere", "sphere"],
    size: [0.42, 1.25, 0.42],
  },
  {
    catalogProductId: "saffron-loom-rug",
    category: "rug",
    kinds: ["box", "box", "box", "box", "box"],
    size: [2.2, 0.02, 1.6],
  },
  {
    catalogProductId: "lumen-fold-desk",
    category: "desk",
    kinds: ["box", "box", "box", "box", "box"],
    size: [1, 0.75, 0.5],
  },
] as const;

describe("projectFurniturePrimitiveLayout", () => {
  it("keeps the Cove Shell Chair back at local positive Z and seat/front open toward local negative Z", () => {
    const item = {
      ...makeSceneItem("chair"),
      catalogProductId: "cove-shell-chair",
      size: [0.78, 0.8, 0.8] as SceneItem["size"],
    };

    const [shell, seat] = projectFurniturePrimitiveLayout(item);

    expect(shell?.kind).toBe("sphere");
    expect(seat?.kind).toBe("sphere");
    if (shell?.kind !== "sphere" || seat?.kind !== "sphere") {
      throw new Error("Expected Cove Shell Chair shell and seat primitives");
    }

    expect(shell.position[2]).toBeGreaterThan(0);
    expect(seat.position[2]).toBeLessThan(0);
    expect(shell.position[2]).toBeGreaterThan(seat.position[2]);
  });

  it("uses generic category geometry when an external catalog reuses a demo product ID", () => {
    const item = {
      ...makeSceneItem("chair"),
      catalogProductId: "cove-shell-chair",
      catalogRef: {
        catalogId: "external-catalog",
        productId: "cove-shell-chair",
      },
    };

    expect(primitiveSignature(projectFurniturePrimitiveLayout(item))).toEqual(
      primitiveSignature(projectFurniturePrimitiveLayout(makeSceneItem("chair"))),
    );
  });

  it.each([
    ["bed", { bottom: 0, top: 0.8 }],
    ["desk", { bottom: 0, top: 0.8 }],
    ["chair", { bottom: 0, top: 0.8 }],
    ["sofa", { bottom: 0, top: 0.8 }],
    ["dresser", { bottom: 0, top: 0.8 }],
    ["rug", { bottom: 0, top: 0.04 }],
    ["table", { bottom: 0, top: 0.8 }],
    ["plant", { bottom: 0, top: 0.8 }],
    ["generic", { bottom: 0, top: 0.8 }],
  ] as const)(
    "keeps the %s primitive inside its floor-to-height bounds",
    (category, expected) => {
      const item = makeSceneItem(category);

      const bounds = verticalBounds(
        item,
        projectFurniturePrimitiveLayout(item),
      );
      expect(bounds.bottom).toBeGreaterThanOrEqual(-1e-9);
      expect(bounds.bottom).toBeCloseTo(expected.bottom, 9);
      expect(bounds.top).toBeCloseTo(expected.top, 9);
    },
  );

  it.each([
    "bed",
    "desk",
    "chair",
    "sofa",
    "dresser",
    "rug",
    "table",
    "plant",
    "generic",
  ] as const)("contains tiny valid %s primitives within the declared envelope", (category) => {
    const item = {
      ...makeSceneItem(category),
      size: [0.02, 0.02, 0.02] as SceneItem["size"],
    };

    const envelope = partEnvelope(item, projectFurniturePrimitiveLayout(item));
    expect(envelope.min[0]).toBeGreaterThanOrEqual(-0.01);
    expect(envelope.min[1]).toBeGreaterThanOrEqual(-1e-9);
    expect(envelope.min[2]).toBeGreaterThanOrEqual(-0.01);
    expect(envelope.max[0]).toBeLessThanOrEqual(0.01);
    expect(envelope.max[1]).toBeLessThanOrEqual(0.02);
    expect(envelope.max[2]).toBeLessThanOrEqual(0.01);
  });

  it("joins a table's floor-standing legs to the underside of its top", () => {
    const item = {
      ...makeSceneItem("table"),
      size: [1, 0.4, 0.55] as SceneItem["size"],
    };

    const [top, ...legs] = projectFurniturePrimitiveLayout(item);
    expect(top?.kind).toBe("box");
    expect(legs).toHaveLength(4);
    if (top?.kind !== "box") throw new Error("expected a table top");

    const itemCenterY = item.size[1] / 2;
    const topUnderside = itemCenterY + top.position[1] - top.size[1] / 2;
    for (const leg of legs) {
      expect(leg.kind).toBe("box");
      if (leg.kind !== "box") throw new Error("expected a table leg");
      const legBottom = itemCenterY + leg.position[1] - leg.size[1] / 2;
      const legTop = itemCenterY + leg.position[1] + leg.size[1] / 2;
      expect(legBottom).toBeCloseTo(0, 9);
      expect(legTop).toBeCloseTo(topUnderside, 9);
    }
  });

  it("builds a connected pot, stem, and layered canopy for a tall plant", () => {
    const item = {
      ...makeSceneItem("plant"),
      size: [0.45, 1.3, 0.45] as SceneItem["size"],
    };

    const [pot, stem, ...canopy] = projectFurniturePrimitiveLayout(item);
    expect(pot?.kind).toBe("cylinder");
    expect(stem?.kind).toBe("cylinder");
    expect(canopy).toHaveLength(3);
    expect(canopy.every((part) => part.kind === "sphere")).toBe(true);
    if (pot?.kind !== "cylinder" || stem?.kind !== "cylinder") {
      throw new Error("expected a plant pot and stem");
    }

    const itemCenterY = item.size[1] / 2;
    const potTop = itemCenterY + pot.position[1] + pot.size[1] / 2;
    const stemBottom = itemCenterY + stem.position[1] - stem.size[1] / 2;
    const stemTop = itemCenterY + stem.position[1] + stem.size[1] / 2;
    const canopyBottom = Math.min(
      ...canopy.map((part) => {
        if (part.kind !== "sphere") throw new Error("expected foliage");
        return itemCenterY + part.position[1] - part.radius;
      }),
    );

    expect(stemBottom).toBeLessThanOrEqual(potTop);
    expect(stemTop).toBeGreaterThanOrEqual(canopyBottom);
    expect(verticalBounds(item, [pot, stem, ...canopy])).toEqual({
      bottom: 0,
      top: 1.3,
    });
  });

  it("uses the molded-shell lounge manifest variant for an original silhouette", () => {
    const item: SceneItem = {
      ...makeSceneItem("chair"),
      catalogProductId: "dune-shell-lounger",
      name: "Original test lounger",
      color: "#c87852",
      size: [0.84, 0.82, 0.88],
      styleTags: ["organic", "molded-shell", "lounge"],
    };

    const parts = projectFurniturePrimitiveLayout(item);

    expect(primitiveSignature(parts)).toEqual([
      {
        kind: "sphere",
        color: "#c87852",
        position: [-0.0504, 0.0984, 0.1408],
        radius: 0.5,
        scale: [0.6552, 0.4756, 0.2464],
      },
      {
        kind: "sphere",
        color: "#c87852",
        position: [0.2016, 0, -0.0352],
        radius: 0.5,
        scale: [0.2352, 0.3116, 0.2816],
      },
      {
        kind: "box",
        color: "#f1d5bd",
        position: [0, -0.0574, -0.0528],
        size: [0.5712, 0.082, 0.484],
      },
      ...[-0.2016, 0.2016].flatMap((x) =>
        [-0.1848, 0.0792].map((z) => ({
          kind: "cylinder",
          color: "#c87852",
          position: [x, -0.2542, z],
          radiusBottom: 0.063,
          radiusTop: 0.042,
          size: [0.126, 0.3116, 0.126],
        })),
      ),
    ]);
    const shells = parts.slice(0, 2);
    const seat = parts[2];
    const legs = parts.slice(3);
    const itemCenterY = item.size[1] / 2;
    expect(seat?.kind).toBe("box");
    if (seat?.kind !== "box") throw new Error("expected a lounge seat");
    expect(
      shells.some((shell) => {
        if (shell.kind !== "sphere") return false;
        const shellHalfSize = shell.scale
          ? shell.scale.map((axisScale) => shell.radius * axisScale)
          : [shell.radius, shell.radius, shell.radius];
        return seat.position.every(
          (value, index) =>
            Math.abs(value - shell.position[index]) <=
            (shellHalfSize[index] ?? 0) + (seat.size[index] ?? 0) / 2,
        );
      }),
    ).toBe(true);
    const seatBottom = itemCenterY + seat.position[1] - seat.size[1] / 2;
    for (const leg of legs) {
      expect(leg.kind).toBe("cylinder");
      if (leg.kind !== "cylinder") throw new Error("expected a lounge leg");
      const legTop = itemCenterY + leg.position[1] + leg.size[1] / 2;
      expect(legTop).toBeCloseTo(seatBottom, 9);
      expect(Math.abs(leg.position[0] - seat.position[0]) + leg.radiusTop)
        .toBeLessThan(seat.size[0] / 2);
      expect(Math.abs(leg.position[2] - seat.position[2]) + leg.radiusTop)
        .toBeLessThan(seat.size[2] / 2);
    }
    const envelope = partEnvelope(item, parts);
    expect(envelope.min[0]).toBeGreaterThanOrEqual(-0.42);
    expect(envelope.min[1]).toBeGreaterThanOrEqual(-1e-9);
    expect(envelope.min[2]).toBeGreaterThanOrEqual(-0.44);
    expect(envelope.max[0]).toBeLessThanOrEqual(0.42);
    expect(envelope.max[1]).toBeLessThanOrEqual(0.82);
    expect(envelope.max[2]).toBeLessThanOrEqual(0.44);
  });

  it("keeps the molded-shell back behind the seat while the front opens toward local negative Z", () => {
    const item: SceneItem = {
      ...makeSceneItem("chair"),
      catalogRef: {
        catalogId: "wimy-demo-v1",
        productId: "dune-shell-lounger",
      },
      color: "#c87852",
      size: [0.84, 0.82, 0.88],
      styleTags: ["organic", "molded-shell", "lounge"],
    };

    const parts = projectFurniturePrimitiveLayout(item);
    const back = parts[0];
    const seat = parts[2];
    expect(back?.kind).toBe("sphere");
    expect(seat?.kind).toBe("box");
    expect(back?.position[2]).toBeGreaterThan(0);
    expect(seat?.position[2]).toBeLessThan(0);
    expect(back?.position[2]).toBeGreaterThan(seat?.position[2] ?? 0);
  });

  it("uses the modular sofa manifest variant for a sectional silhouette", () => {
    const item: SceneItem = {
      ...makeSceneItem("sofa"),
      catalogProductId: "tidal-modular-sofa",
      name: "Original test sectional",
      color: "#6e7f8d",
      size: [2.1, 0.72, 0.95],
      styleTags: ["soft", "modular", "low-profile"],
    };

    const parts = projectFurniturePrimitiveLayout(item);

    expect(primitiveSignature(parts)).toEqual([
      {
        kind: "box",
        color: "#6e7f8d",
        position: [0, -0.3024, 0],
        size: [2.1, 0.1152, 0.874],
      },
      {
        kind: "box",
        color: "#93a3ad",
        position: [-0.6825, -0.1224, 0.076],
        size: [0.609, 0.2448, 0.5225],
      },
      {
        kind: "box",
        color: "#93a3ad",
        position: [0, -0.1224, 0.076],
        size: [0.609, 0.2448, 0.5225],
      },
      {
        kind: "box",
        color: "#93a3ad",
        position: [0.6825, -0.1224, -0.038],
        size: [0.609, 0.2448, 0.817],
      },
      ...[-0.6825, 0, 0.6825].map((x) => ({
        kind: "box",
        color: "#6e7f8d",
        position: [x, 0.18, 0.361],
        size: [0.609, 0.36, 0.152],
      })),
    ]);
    const [platform, ...modules] = parts;
    const seats = modules.slice(0, 3);
    const backs = modules.slice(3);
    expect(platform?.kind).toBe("box");
    if (platform?.kind !== "box") throw new Error("expected a sofa platform");
    const itemCenterY = item.size[1] / 2;
    const platformTop =
      itemCenterY + platform.position[1] + platform.size[1] / 2;
    seats.forEach((seat, index) => {
      const back = backs[index];
      expect(seat?.kind).toBe("box");
      expect(back?.kind).toBe("box");
      if (seat?.kind !== "box" || back?.kind !== "box") {
        throw new Error("expected matching sofa seat and back modules");
      }
      const seatBottom = itemCenterY + seat.position[1] - seat.size[1] / 2;
      const seatTop = itemCenterY + seat.position[1] + seat.size[1] / 2;
      const backBottom = itemCenterY + back.position[1] - back.size[1] / 2;
      expect(seatBottom).toBeCloseTo(platformTop, 9);
      expect(backBottom).toBeCloseTo(seatTop, 9);
      expect(Math.abs(seat.position[0] - back.position[0])).toBeLessThan(
        (seat.size[0] + back.size[0]) / 2,
      );
      expect(Math.abs(seat.position[2] - back.position[2])).toBeLessThan(
        (seat.size[2] + back.size[2]) / 2,
      );
    });
    const envelope = partEnvelope(item, parts);
    expect(envelope.min[0]).toBeGreaterThanOrEqual(-1.05);
    expect(envelope.min[1]).toBeGreaterThanOrEqual(-1e-9);
    expect(envelope.min[2]).toBeGreaterThanOrEqual(-0.475);
    expect(envelope.max[0]).toBeLessThanOrEqual(1.05);
    expect(envelope.max[1]).toBeLessThanOrEqual(0.72);
    expect(envelope.max[2]).toBeLessThanOrEqual(0.475);
  });

  it("uses the manifest key and safely falls back for imported snapshots", () => {
    const chair = makeSceneItem("chair");
    const sofa = makeSceneItem("sofa");

    expect(
      primitiveSignature(
        projectFurniturePrimitiveLayout({
          ...chair,
          catalogProductId: "dune-shell-lounger",
          styleTags: ["lounge", "organic", "molded-shell"],
        }),
      ),
    ).toEqual(
      primitiveSignature(
        projectFurniturePrimitiveLayout({
          ...chair,
          catalogProductId: "dune-shell-lounger",
          styleTags: ["molded-shell", "lounge"],
        }),
      ),
    );
    expect(
      primitiveSignature(
        projectFurniturePrimitiveLayout({
          ...chair,
          styleTags: ["molded-shell"],
        }),
      ),
    ).toEqual(primitiveSignature(projectFurniturePrimitiveLayout(chair)));
    expect(
      primitiveSignature(
        projectFurniturePrimitiveLayout({
          ...sofa,
          styleTags: ["modular", "unknown-style"],
        }),
      ),
    ).toEqual(primitiveSignature(projectFurniturePrimitiveLayout(sofa)));

    expect(
      primitiveSignature(
        projectFurniturePrimitiveLayout({
          ...chair,
          catalogProductId: "cove-shell-chair",
          styleTags: [],
        }),
      ),
    ).not.toEqual(primitiveSignature(projectFurniturePrimitiveLayout(chair)));
  });

  it.each([
    [
      "cove-shell-chair",
      "chair",
      ["sphere", "sphere", "cylinder", "cylinder", "cylinder", "cylinder"],
    ],
    ["tideline-corner-sofa", "sofa", ["box", "box", "box", "box", "box"]],
    ["arclet-dining-table", "table", ["sphere", "cylinder", "cylinder"]],
    [
      "reed-dining-chair",
      "chair",
      ["box", "box", "cylinder", "cylinder", "cylinder", "cylinder"],
    ],
    [
      "harbor-console",
      "dresser",
      ["box", "box", "box", "box", "box", "box", "box"],
    ],
  ] as const)(
    "selects the %s procedural variant through the manifest",
    (catalogProductId, category, kinds) => {
      const parts = projectFurniturePrimitiveLayout({
        ...makeSceneItem(category),
        catalogProductId,
      });

      expect(parts.map((part) => part.kind)).toEqual(kinds);
    },
  );

  it.each([
    ["cove-shell-chair", "chair", [0.78, 0.8, 0.8]],
    ["tideline-corner-sofa", "sofa", [2.3, 0.74, 1.55]],
    ["arclet-dining-table", "table", [1.6, 0.76, 0.9]],
    ["reed-dining-chair", "chair", [0.52, 0.84, 0.56]],
    ["harbor-console", "dresser", [1.4, 0.78, 0.42]],
  ] as const)(
    "keeps the %s variant inside its certified footprint",
    (catalogProductId, category, size) => {
      const item = {
        ...makeSceneItem(category),
        catalogProductId,
        size: [...size] as SceneItem["size"],
      };
      const envelope = partEnvelope(item, projectFurniturePrimitiveLayout(item));

      expect(envelope.min[0]).toBeGreaterThanOrEqual(-size[0] / 2 - 1e-9);
      expect(envelope.min[1]).toBeGreaterThanOrEqual(-1e-9);
      expect(envelope.min[2]).toBeGreaterThanOrEqual(-size[2] / 2 - 1e-9);
      expect(envelope.max[0]).toBeLessThanOrEqual(size[0] / 2 + 1e-9);
      expect(envelope.max[1]).toBeLessThanOrEqual(size[1] + 1e-9);
      expect(envelope.max[2]).toBeLessThanOrEqual(size[2] / 2 + 1e-9);
    },
  );

  it.each(
    newlyAuthoredLayoutCases.map(({ catalogProductId, category, kinds }) => [
      catalogProductId,
      category,
      kinds,
    ] as const),
  )(
    "selects the %s authored layout through the manifest",
    (catalogProductId, category, kinds) => {
      const parts = projectFurniturePrimitiveLayout({
        ...makeSceneItem(category),
        catalogProductId,
      });

      expect(parts.map((part) => part.kind)).toEqual(kinds);
      expect(parts.length).toBeGreaterThan(1);
      expect(parts.length).toBeLessThanOrEqual(
        getCatalogPresentation(catalogProductId)?.maxPrimitiveParts ?? 0,
      );
      expect(parts.length).toBeLessThanOrEqual(MAX_FURNITURE_PRIMITIVE_PARTS);
    },
  );

  it("keeps every newly authored category layout inside its certified footprint", () => {
    for (const { catalogProductId, category, size } of newlyAuthoredLayoutCases) {
      const item = {
        ...makeSceneItem(category),
        catalogProductId,
        size: [...size] as SceneItem["size"],
      };
      const envelope = partEnvelope(item, projectFurniturePrimitiveLayout(item));

      expect(envelope.min[0]).toBeGreaterThanOrEqual(-size[0] / 2 - 1e-9);
      expect(envelope.min[1]).toBeGreaterThanOrEqual(-1e-9);
      expect(envelope.min[2]).toBeGreaterThanOrEqual(-size[2] / 2 - 1e-9);
      expect(envelope.max[0]).toBeLessThanOrEqual(size[0] / 2 + 1e-9);
      expect(envelope.max[1]).toBeLessThanOrEqual(size[1] + 1e-9);
      expect(envelope.max[2]).toBeLessThanOrEqual(size[2] / 2 + 1e-9);
    }
  });

  it("keeps the Arclet Dining Table base, support, and oval top in contact", () => {
    const item = {
      ...makeSceneItem("table"),
      catalogProductId: "arclet-dining-table",
      size: [1.6, 0.76, 0.9] as SceneItem["size"],
    };
    const [top, support, base] = projectFurniturePrimitiveLayout(item);
    expect(top?.kind).toBe("sphere");
    expect(support?.kind).toBe("cylinder");
    expect(base?.kind).toBe("cylinder");
    if (
      top?.kind !== "sphere" ||
      support?.kind !== "cylinder" ||
      base?.kind !== "cylinder"
    ) {
      throw new Error("Expected Arclet top, support, and base primitives");
    }

    const itemCenterY = item.size[1] / 2;
    const topUnderside =
      itemCenterY + top.position[1] - top.radius * (top.scale?.[1] ?? 1);
    const supportBottom =
      itemCenterY + support.position[1] - support.size[1] / 2;
    const supportTop =
      itemCenterY + support.position[1] + support.size[1] / 2;
    const baseTop = itemCenterY + base.position[1] + base.size[1] / 2;

    expect(itemCenterY + base.position[1] - base.size[1] / 2).toBeCloseTo(0, 9);
    expect(supportBottom).toBeCloseTo(baseTop, 9);
    expect(supportTop).toBeCloseTo(topUnderside, 9);
    expect(top.scale?.[0]).toBeCloseTo(item.size[0], 9);
    expect(top.scale?.[2]).toBeCloseTo(item.size[2], 9);
  });
});

describe("RoomPreview3D", () => {
  it("bounds shadow maps when many windows receive direct light", () => {
    const beams: SunBeam[] = Array.from({ length: 20 }, (_, index) => ({
      openingId: `window_${index}`,
      position: [0, 1, 1],
      direction: [1, -0.5, 0],
      aperture: [1, 1],
      length: 2,
      strength: 0.8,
    }));

    expect(selectShadowCastingWindowLightIds(beams, true)).toHaveLength(
      MAX_SHADOW_CASTING_WINDOW_LIGHTS,
    );
    expect(selectShadowCastingWindowLightIds(beams, false)).toEqual([]);
  });

  it("spends the shadow budget on the strongest window apertures", () => {
    const makeBeam = (openingId: string, strength: number, aperture: [number, number] = [1, 1]): SunBeam => ({
      openingId,
      position: [0, 1, 1],
      direction: [1, -0.5, 0],
      aperture,
      length: 2,
      strength,
    });
    const beams = [
      makeBeam("dim", 0.1),
      makeBeam("wide", 0.9, [2, 2]),
      makeBeam("medium-a", 0.5),
      makeBeam("medium-b", 0.4),
      makeBeam("medium-c", 0.3),
    ];

    expect(selectShadowCastingWindowLightIds(beams, true)).toEqual([
      "wide",
      "medium-a",
      "medium-b",
      "medium-c",
    ]);
  });

  it("keeps the room dominant while lighting settings collapse into a drawer", () => {
    render(
      <RoomPreview3D
        room={makeRoom({ openings: [makeOpening({ kind: "window" })] })}
        webglSupportOverride={false}
      />,
    );

    expect(screen.getByRole("slider", { name: "Local time of day" })).toBeVisible();
    const openSettings = screen.getByRole("button", { name: "Open lighting settings" });
    expect(openSettings).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("group", { name: "Sun study controls" })).not.toBeInTheDocument();

    fireEvent.click(openSettings);
    expect(screen.getByRole("group", { name: "Sun study controls" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Close lighting settings" })).toBeVisible();

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("group", { name: "Sun study controls" })).not.toBeInTheDocument();
  });

  it("keeps the approximate lighting place visible without opening settings", () => {
    const lightingPreviewStore = createLightingPreviewStore({
      latitude: "22.32",
      longitude: "114.17",
      date: "2026-09-03",
      localTime: "18:00",
      timeZone: "Asia/Hong_Kong",
      planNorthAzimuthDeg: "0",
    });

    render(
      <RoomPreview3D
        lightingPreviewStore={lightingPreviewStore}
        room={makeRoom()}
        webglSupportOverride={false}
      />,
    );

    expect(screen.getByLabelText("Approximate lighting location"))
      .toHaveTextContent("Hong Kong");
    expect(screen.queryByRole("group", { name: "Sun study controls" }))
      .not.toBeInTheDocument();
  });

  it("dismisses lighting settings when the user points outside the drawer", () => {
    render(<RoomPreview3D room={makeRoom()} webglSupportOverride={false} />);
    openLightingSettings();

    fireEvent.pointerDown(screen.getByRole("heading", { name: "3D room preview" }));

    expect(screen.queryByRole("complementary", { name: "Lighting settings" }))
      .not.toBeInTheDocument();
  });

  it("shows bounded sunlight controls and honest assumptions", () => {
    render(
      <RoomPreview3D
        room={makeRoom({ openings: [makeOpening({ kind: "window" })] })}
        webglSupportOverride={false}
      />,
    );

    openLightingSettings();

    expect(screen.getByRole("group", { name: "Sun study controls" })).toBeVisible();
    expect(screen.getByLabelText("Latitude" )).toHaveValue(40.71);
    expect(screen.getByLabelText("Longitude" )).toHaveValue(-74.01);
    expect(screen.getByLabelText("Plan North true bearing" )).toHaveValue(0);
    expect(screen.getByRole("slider", { name: "Local time of day" })).toHaveValue("720");
    expect(screen.getByText("Approximate directional sun and moon geometry")).toBeVisible();
    expect(screen.getByText(/does not estimate daylight or moonlight intensity, lux, or energy performance/i)).toBeVisible();
    expect(screen.getByRole("status", { name: "Sun study status" })).toHaveTextContent(
      "Shadows are unavailable",
    );
  });

  it("recomputes from local controls without changing canonical room state", () => {
    const room = makeRoom({ openings: [makeOpening({ kind: "window" })] });
    const before = structuredClone(room);
    render(<RoomPreview3D room={room} webglSupportOverride={false} />);
    openLightingSettings();

    const status = screen.getByRole("status", { name: "Sun study status" });
    expect(status).toHaveTextContent("Apparent solar azimuth");
    const initialStatus = status.textContent;
    fireEvent.change(screen.getByLabelText("Plan North true bearing"), {
      target: { value: "90" },
    });
    expect(status.textContent).not.toBe(initialStatus);
    expect(status).toHaveTextContent("Plan North 90°");
    expect(room).toEqual(before);
  });

  it("scrubs the sun study through the day with one time slider", () => {
    const room = makeRoom({ openings: [makeOpening({ kind: "window" })] });
    render(<RoomPreview3D room={room} webglSupportOverride={false} />);

    const slider = screen.getByRole("slider", { name: "Local time of day" });
    fireEvent.change(slider, { target: { value: "480" } });

    expect(slider).toHaveValue("480");
    expect(screen.getByText("08:00")).toBeVisible();
  });

  it("preserves the user's orbit while the day timeline advances", () => {
    vi.useFakeTimers();
    render(
      <RoomPreview3D
        room={makeRoom({ openings: [makeOpening({ kind: "window" })] })}
      />,
    );
    const userOrbit = [14, 8, 9];
    canvasHarness.camera.position.set(...userOrbit);

    fireEvent.click(screen.getByRole("button", { name: "Play day" }));
    act(() => vi.advanceTimersByTime(360));

    expect(screen.getByRole("slider", { name: "Local time of day" })).not.toHaveValue("720");
    expect(canvasHarness.camera.position.values).toEqual(userOrbit);
    vi.useRealTimers();
  });

  it("does not offer automatic day playback when reduced motion is preferred", () => {
    vi.stubGlobal("matchMedia", vi.fn(() => ({
      matches: true,
      media: "(prefers-reduced-motion: reduce)",
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }) as unknown as MediaQueryList));

    render(<RoomPreview3D room={makeRoom()} webglSupportOverride={false} />);

    expect(screen.getByRole("button", {
      name: "Day animation disabled because reduced motion is preferred",
    })).toBeDisabled();
  });

  it("derives the moon phase and horizon position from the same local study controls", () => {
    render(
      <RoomPreview3D
        room={makeRoom({ openings: [makeOpening({ kind: "window", wall: "east" })] })}
        webglSupportOverride={false}
      />,
    );

    openLightingSettings();

    fireEvent.change(screen.getByLabelText("Local date"), {
      target: { value: "2026-09-26" },
    });
    fireEvent.change(screen.getByRole("slider", { name: "Local time of day" }), {
      target: { value: "1200" },
    });

    expect(screen.getByRole("status", { name: "Moon study status" })).toHaveTextContent(
      "Full Moon",
    );
    expect(screen.getByRole("status", { name: "Moon study status" })).toHaveTextContent(
      "Moon is above the modeled horizon",
    );
  });

  it("keeps the rendered moonlight strength at zero for a new moon", () => {
    render(
      <RoomPreview3D
        room={makeRoom({ openings: [makeOpening({ kind: "window" })] })}
        webglSupportOverride
      />,
    );
    openLightingSettings();

    fireEvent.change(screen.getByLabelText("Local date"), {
      target: { value: "2026-09-11" },
    });

    expect(document.querySelector(".room-preview-canvas"))
      .toHaveAttribute("data-wimy-moon-strength", "0");
  });

  it("enables bounded shadows by default when the renderer supports them", () => {
    render(
      <RoomPreview3D
        room={makeRoom({ openings: [makeOpening({ kind: "window" })] })}
        shadowSupportOverride
        webglSupportOverride
      />,
    );

    openLightingSettings();

    expect(screen.getByLabelText("Enable bounded shadows")).toBeChecked();
    expect(canvasHarness.shadows).not.toHaveLength(0);
    expect(canvasHarness.shadows).toEqual(
      expect.arrayContaining(["percentage"]),
    );
    expect(canvasHarness.shadows.every((filter) => filter === "percentage"))
      .toBe(true);
    expect(document.querySelector(".room-preview-canvas"))
      .toHaveAttribute("data-wimy-shadow-filter", "percentage-closer");
  });

  it("limits every direct shadow-casting light source to room windows", () => {
    const { rerender } = render(
      <RoomPreview3D room={makeRoom()} shadowSupportOverride webglSupportOverride />,
    );
    const canvas = document.querySelector(".room-preview-canvas");
    expect(canvas).toHaveAttribute("data-wimy-direct-light-source", "windows-only");
    expect(canvas).toHaveAttribute("data-wimy-direct-light-count", "0");

    rerender(
      <RoomPreview3D
        room={makeRoom({ openings: [makeOpening({ kind: "window", wall: "south" })] })}
        shadowSupportOverride
        webglSupportOverride
      />,
    );
    expect(document.querySelector(".room-preview-canvas"))
      .toHaveAttribute("data-wimy-direct-light-source", "windows-only");
  });

  it("fails closed for invalid location input and does not invent a sun", () => {
    render(<RoomPreview3D room={makeRoom()} webglSupportOverride={false} />);
    openLightingSettings();

    fireEvent.change(screen.getByLabelText("Latitude"), {
      target: { value: "91" },
    });

    expect(screen.getByRole("status", { name: "Sun study status" })).toHaveTextContent(
      "Sun study unavailable",
    );
    expect(screen.getByText(/No fixed fallback sun is shown/i)).toBeVisible();
  });

  it("keeps the shadows control disabled when shadow support is unavailable", () => {
    render(
      <RoomPreview3D
        room={makeRoom()}
        shadowSupportOverride={false}
        webglSupportOverride={true}
      />,
    );

    openLightingSettings();

    expect(screen.getByLabelText("Enable bounded shadows")).toBeDisabled();
    expect(screen.getByRole("status", { name: "Sun study status" })).toHaveTextContent(
      "Shadows are unavailable",
    );
  });

  it("uses the same semantic heading and clockwise turn as the 2D projection", () => {
    const room = makeRoom({
      items: [
        makePlacedItem({
          id: "item_sofa",
          pose: { x: 1, y: 1, rotationDeg: 180 },
          snapshot: { ...makePlacedItem().snapshot, category: "sofa" },
        }),
        makePlacedItem({
          id: "item_bed",
          pose: { x: 3, y: 1, rotationDeg: 90 },
          snapshot: { ...makePlacedItem().snapshot, category: "bed" },
        }),
      ],
    });
    const scene = projectRoomToScene(room);

    expect(scene.items.map(({ orientation, rotationY }) => ({ orientation, rotationY }))).toEqual([
      {
        orientation: expect.objectContaining({ cue: "facing", direction: "south" }),
        rotationY: -Math.PI,
      },
      {
        orientation: expect.objectContaining({ cue: "head", direction: "west" }),
        rotationY: -Math.PI / 2,
      },
    ]);
  });

  it("releases its detached WebGL preflight context", () => {
    expect(probeWebGL2PreviewSupport()).toBe(true);
    expect(webglContextHarness.loseContext).toHaveBeenCalledTimes(1);
  });

  it("rejects a plausible WebGL1 context because the renderer requires WebGL2", () => {
    const webgl1 = {
      getExtension: () => ({ loseContext: webglContextHarness.loseContext }),
    } as unknown as RenderingContext;
    const getContext = vi
      .spyOn(HTMLCanvasElement.prototype, "getContext")
      .mockImplementation((contextId) =>
        contextId === "webgl2" ? null : webgl1,
      );

    expect(probeWebGL2PreviewSupport()).toBe(false);
    expect(getContext).toHaveBeenCalledTimes(1);
    expect(getContext).toHaveBeenCalledWith("webgl2", {
      alpha: true,
      antialias: true,
      powerPreference: "high-performance",
    });
    expect(webglContextHarness.loseContext).not.toHaveBeenCalled();
  });

  it("does not mount Canvas across repeated unsupported view toggles", () => {
    render(<PreviewToggle />);

    for (let retry = 0; retry < 3; retry += 1) {
      fireEvent.click(screen.getByRole("button", { name: "Preview in 3D" }));
      expect(screen.getByText(/The interactive 3D canvas is unavailable/)).toHaveTextContent(
        "The interactive 3D canvas is unavailable",
      );
      expect(
        screen.getByText("Test Room: 4 m by 3 m room with 0 placed items."),
      ).toBeVisible();
      expect(
        screen.getByRole("list", { name: "Placed items in Test Room" }),
      ).toBeVisible();
      fireEvent.click(screen.getByRole("button", { name: "Edit in 2D" }));
    }

    expect(canvasHarness.mounts).toBe(0);
  });

  it("keeps a DOM room summary and item list when Canvas fails", () => {
    canvasHarness.throws = true;
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    render(
      <RoomPreview3D
        room={makeRoom({
          name: "Fallback Room",
          items: [makePlacedItem({ id: "item_fallback" })],
        })}
      />,
    );

    expect(screen.getByText(/The interactive 3D canvas is unavailable/)).toHaveTextContent(
      "The interactive 3D canvas is unavailable",
    );
    expect(
      screen.getByRole("region", { name: "3D preview of Fallback Room" }),
    ).toHaveTextContent("Fallback Room: 4 m by 3 m room with 1 placed item.");
    expect(screen.getByRole("list", { name: "Placed items in Fallback Room" })).toHaveTextContent(
      "Test Chair — x 1 m, y 1 m, rotation 0°",
    );
    expect(consoleError).toHaveBeenCalled();
  });

  it("reframes Canvas from the current room dimensions", () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const { rerender } = render(<RoomPreview3D room={makeRoom()} />);

    rerender(
      <RoomPreview3D
        room={makeRoom({
          dimensions: { width: 10, depth: 4, height: 4 },
        })}
      />,
    );

    expect(canvasHarness.cameras).toHaveLength(2);
    expect(canvasHarness.cameras[1]).not.toEqual(canvasHarness.cameras[0]);
    expect(canvasHarness.frameloops).toEqual(["demand", "demand"]);
    expect(canvasHarness.invalidate).toHaveBeenCalledTimes(2);
    expect(consoleError).not.toHaveBeenCalled();
  });

  it("remounts Canvas when the room framing dimensions change", () => {
    const { rerender } = render(<RoomPreview3D room={makeRoom()} />);
    const firstCanvas = screen.getByTestId("three-canvas-host");

    rerender(
      <RoomPreview3D
        room={makeRoom({
          dimensions: { width: 10, depth: 4, height: 4 },
        })}
      />,
    );

    expect(screen.getByTestId("three-canvas-host")).not.toBe(firstCanvas);
  });

  it("preserves a user orbit for an item-only store edit and reframes dimensions", () => {
    const store = createRoomStore(
      makeRoom({
      items: [makePlacedItem({ id: "item_orbit" })],
      }),
      TEST_TRANSACTION_DEPENDENCIES,
    );
    const { rerender } = render(<StorePreview store={store} />);
    const userOrbit = [17, 13, 11];
    canvasHarness.camera.position.set(...userOrbit);

    const itemEdit = store.getState().transact({
      expectedRevision: 1,
      origin: "human",
      change: {
        type: "edit",
        operations: [
          {
            type: "transform",
            itemId: "item_orbit",
            pose: { rotationDeg: 90 },
          },
        ],
      },
    });

    expect(itemEdit).toMatchObject({ ok: true, revision: 2 });
    expect(canvasHarness.camera.position.values).toEqual(userOrbit);

    rerender(
      <RoomPreview3D
        room={makeRoom({
          dimensions: { width: 10, depth: 4, height: 4 },
          items: [makePlacedItem({ id: "item_orbit", pose: { x: 2, y: 1, rotationDeg: 90 } })],
        })}
      />,
    );

    expect(canvasHarness.camera.position.values).not.toEqual(userOrbit);
  });
});
