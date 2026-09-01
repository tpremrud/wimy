import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Children, useState, type ReactNode } from "react";
import { useStore } from "zustand";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { projectRoomToScene, type SceneItem } from "../room/projection";
import { projectFurnitureOrientation } from "../room/orientation";
import { createRoomStore, type RoomStore } from "../room/store";
import { TEST_TRANSACTION_DEPENDENCIES } from "../room/transaction";
import { makePlacedItem, makeRoom } from "../test/room-fixtures";
import {
  projectFurniturePrimitiveLayout,
  probeWebGL2PreviewSupport,
  RoomPreview3D,
} from "./RoomPreview3D";

const canvasHarness = vi.hoisted(() => ({
  cameras: [] as unknown[],
  frameloops: [] as unknown[],
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
  }: {
    camera: unknown;
    children: ReactNode;
    frameloop: unknown;
  }) => {
    if (canvasHarness.throws) {
      throw new Error("WebGL unavailable for test");
    }
    canvasHarness.mounts += 1;
    canvasHarness.cameras.push(camera);
    canvasHarness.frameloops.push(frameloop);
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
  canvasHarness.invalidate.mockReset();
  canvasHarness.mounts = 0;
  canvasHarness.camera.position.values = [0, 0, 0];
  canvasHarness.throws = false;
  vi.restoreAllMocks();
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

describe("projectFurniturePrimitiveLayout", () => {
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

  it("uses molded-shell lounge tags for an original bucket lounger silhouette", () => {
    const item: SceneItem = {
      ...makeSceneItem("chair"),
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

  it("uses modular low-profile tags for a sectional sofa silhouette", () => {
    const item: SceneItem = {
      ...makeSceneItem("sofa"),
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

  it("ignores tag order and safely falls back for partial or unknown combinations", () => {
    const chair = makeSceneItem("chair");
    const sofa = makeSceneItem("sofa");

    expect(
      primitiveSignature(
        projectFurniturePrimitiveLayout({
          ...chair,
          styleTags: ["lounge", "organic", "molded-shell"],
        }),
      ),
    ).toEqual(
      primitiveSignature(
        projectFurniturePrimitiveLayout({
          ...chair,
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
  });
});

describe("RoomPreview3D", () => {
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
      expect(screen.getByRole("status")).toHaveTextContent(
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

    expect(screen.getByRole("status")).toHaveTextContent(
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
