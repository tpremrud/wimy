import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Children, useState, type ReactNode } from "react";
import { useStore } from "zustand";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SceneItem } from "../room/projection";
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
      part.kind === "sphere" ? part.radius : part.size[1] / 2;
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
        ? [part.radius, part.radius, part.radius]
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
});

describe("RoomPreview3D", () => {
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
