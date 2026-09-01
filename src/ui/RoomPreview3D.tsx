import { Grid, OrbitControls } from "@react-three/drei";
import { Canvas, useThree } from "@react-three/fiber";
import {
  Component,
  useCallback,
  useEffect,
  useMemo,
  type ReactNode,
} from "react";
import {
  projectRoomToScene,
  type SceneItem,
  type SceneProjection,
  type SceneVector3,
} from "../room/projection";
import {
  deriveRoomPreviewCamera,
  ROOM_PREVIEW_CAMERA_FOV,
} from "./room-preview-camera";

type RoomPreview3DProps = {
  room: Parameters<typeof projectRoomToScene>[0];
  webglSupportOverride?: boolean;
};

let cachedWebGLPreviewSupport: boolean | undefined;

const WEBGL_PREVIEW_CONTEXT_ATTRIBUTES: WebGLContextAttributes = {
  alpha: true,
  antialias: true,
  powerPreference: "high-performance",
};

// eslint-disable-next-line react-refresh/only-export-components -- pure preflight seam used by renderer and regression tests
export const probeWebGL2PreviewSupport = (
  createCanvas = () => document.createElement("canvas"),
) => {
  const canvas = createCanvas();
  try {
    const context = canvas.getContext(
      "webgl2",
      WEBGL_PREVIEW_CONTEXT_ATTRIBUTES,
    );
    if (!context) return false;

    context.getExtension("WEBGL_lose_context")?.loseContext();
    return true;
  } catch {
    return false;
  } finally {
    canvas.width = 1;
    canvas.height = 1;
    canvas.remove();
  }
};

// eslint-disable-next-line react-refresh/only-export-components -- cached browser-session preflight seam used by renderer tests
export const supportsWebGLPreview = () => {
  if (cachedWebGLPreviewSupport === undefined) {
    cachedWebGLPreviewSupport = probeWebGL2PreviewSupport();
  }
  return cachedWebGLPreviewSupport;
};

type PreviewErrorBoundaryProps = {
  children: ReactNode;
  fallback: ReactNode;
};

type PreviewErrorBoundaryState = {
  failed: boolean;
};

class PreviewErrorBoundary extends Component<
  PreviewErrorBoundaryProps,
  PreviewErrorBoundaryState
> {
  state: PreviewErrorBoundaryState = { failed: false };

  static getDerivedStateFromError(): PreviewErrorBoundaryState {
    return { failed: true };
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

type BoxPartProps = {
  color: string;
  position: SceneVector3;
  size: SceneVector3;
};

const BoxPart = ({ color, position, size }: BoxPartProps) => (
  <mesh position={position}>
    <boxGeometry args={size} />
    <meshStandardMaterial color={color} />
  </mesh>
);

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
};

export type FurniturePrimitivePart =
  | FurnitureBoxPart
  | FurnitureCylinderPart
  | FurnitureSpherePart;

// eslint-disable-next-line react-refresh/only-export-components -- pure layout seam used by renderer and regression tests
export const projectFurniturePrimitiveLayout = (
  item: SceneItem,
): FurniturePrimitivePart[] => {
  const [width, height, depth] = item.size;
  const clamp = (value: number, minimum: number, maximum: number) =>
    Math.min(Math.max(value, minimum), maximum);
  const localY = (worldY: number) => worldY - height / 2;
  const containedPosition = (
    position: SceneVector3,
    size: SceneVector3,
  ): SceneVector3 => [
    clamp(position[0], -width / 2 + size[0] / 2, width / 2 - size[0] / 2),
    clamp(position[1], -height / 2 + size[1] / 2, height / 2 - size[1] / 2),
    clamp(position[2], -depth / 2 + size[2] / 2, depth / 2 - size[2] / 2),
  ];
  const box = (
    color: string,
    position: SceneVector3,
    size: SceneVector3,
  ): FurnitureBoxPart => {
    const boundedSize: SceneVector3 = [
      Math.min(size[0], width),
      Math.min(size[1], height),
      Math.min(size[2], depth),
    ];
    return {
      kind: "box",
      color,
      position: containedPosition(position, boundedSize),
      size: boundedSize,
    };
  };
  const cylinder = (
    color: string,
    position: SceneVector3,
    radiusBottom: number,
    radiusTop: number,
    cylinderHeight: number,
  ): FurnitureCylinderPart => {
    const maximumRadius = Math.min(width / 2, depth / 2);
    const boundedRadiusBottom = Math.min(radiusBottom, maximumRadius);
    const boundedRadiusTop = Math.min(radiusTop, maximumRadius);
    const envelopeRadius = Math.max(boundedRadiusBottom, boundedRadiusTop);
    const boundedSize: SceneVector3 = [
      envelopeRadius * 2,
      Math.min(cylinderHeight, height),
      envelopeRadius * 2,
    ];
    return {
      kind: "cylinder",
      color,
      position: containedPosition(position, boundedSize),
      radiusBottom: boundedRadiusBottom,
      radiusTop: boundedRadiusTop,
      size: boundedSize,
    };
  };
  const sphere = (
    color: string,
    position: SceneVector3,
    requestedRadius: number,
  ): FurnitureSpherePart => {
    const radius = Math.min(requestedRadius, width / 2, height / 2, depth / 2);
    const size: SceneVector3 = [radius * 2, radius * 2, radius * 2];
    return {
      kind: "sphere",
      color,
      position: containedPosition(position, size),
      radius,
    };
  };
  const baseHeight = Math.min(height * 0.55, 0.5);
  const topHeight = Math.min(Math.max(height * 0.12, 0.05), height);
  const legOffsetX = Math.max(width / 2 - 0.08, 0);
  const legOffsetZ = Math.max(depth / 2 - 0.08, 0);

  switch (item.category) {
    case "rug":
      return [box(item.color, [0, localY(0.02), 0], [width, 0.04, depth])];
    case "plant": {
      const potHeight = height * 0.3;
      const canopyRadius = Math.min(
        width * 0.28,
        depth * 0.28,
        height * 0.18,
      );
      const lowerCanopyY = height - canopyRadius * 2.55;
      const stemHeight = lowerCanopyY - potHeight;
      return [
        cylinder(
          item.color,
          [0, localY(potHeight / 2), 0],
          Math.min(width, depth) * 0.25,
          Math.min(width, depth) * 0.32,
          potHeight,
        ),
        cylinder(
          "#6b4f35",
          [0, localY(potHeight + stemHeight / 2), 0],
          Math.min(width, depth) * 0.045,
          Math.min(width, depth) * 0.045,
          stemHeight,
        ),
        sphere(
          "#426b45",
          [0, localY(height - canopyRadius), 0],
          canopyRadius,
        ),
        sphere(
          "#4f7d50",
          [
            -width * 0.18,
            localY(lowerCanopyY),
            depth * 0.07,
          ],
          canopyRadius,
        ),
        sphere(
          "#365f3b",
          [
            width * 0.18,
            localY(lowerCanopyY),
            -depth * 0.07,
          ],
          canopyRadius,
        ),
      ];
    }
    case "chair":
      return [
        box(
          item.color,
          [0, localY(baseHeight / 2), 0],
          [width, baseHeight, depth],
        ),
        box(
          item.color,
          [0, localY(height - (height * 0.48) / 2), depth * 0.36],
          [width, height * 0.48, Math.max(depth * 0.16, 0.05)],
        ),
      ];
    case "sofa":
      return [
        box(
          item.color,
          [0, localY((height * 0.62) / 2), 0],
          [width, height * 0.62, depth],
        ),
        box(
          item.color,
          [0, localY(height - (height * 0.48) / 2), depth * 0.36],
          [width, height * 0.48, Math.max(depth * 0.2, 0.05)],
        ),
        box(
          item.color,
          [-width * 0.43, localY(height * 0.55), 0],
          [Math.max(width * 0.14, 0.05), height * 0.5, depth],
        ),
        box(
          item.color,
          [width * 0.43, localY(height * 0.55), 0],
          [Math.max(width * 0.14, 0.05), height * 0.5, depth],
        ),
      ];
    case "table": {
      const legHeight = height - topHeight;
      return [
        box(
          item.color,
          [0, localY(height - topHeight / 2), 0],
          [width, topHeight, depth],
        ),
        ...[
          [-legOffsetX, legHeight / 2, -legOffsetZ],
          [-legOffsetX, legHeight / 2, legOffsetZ],
          [legOffsetX, legHeight / 2, -legOffsetZ],
          [legOffsetX, legHeight / 2, legOffsetZ],
        ].map(
          ([x, worldY, z]) =>
            box(
              item.color,
              [x, localY(worldY), z],
              [0.08, legHeight, 0.08],
            ),
        ),
      ];
    }
    case "bed":
      return [
        box(
          item.color,
          [0, localY((height * 0.64) / 2), 0],
          [width, height * 0.64, depth],
        ),
        box(
          "#f2eee5",
          [0, localY(height * 0.7), -depth * 0.18],
          [width * 0.82, height * 0.16, depth * 0.45],
        ),
        box(
          item.color,
          [0, 0, depth * 0.45],
          [width, height, Math.max(depth * 0.08, 0.05)],
        ),
      ];
    case "desk":
    case "dresser":
      return [
        box(item.color, [0, 0, 0], [width, height, depth]),
        box(
          "#f2eee5",
          [0, localY(height * 0.52), -depth * 0.51],
          [width * 0.72, height * 0.05, 0.02],
        ),
      ];
    case "generic":
      return [box(item.color, [0, 0, 0], item.size)];
  }
};

const FurniturePrimitive = ({ item }: { item: SceneItem }) => {
  return projectFurniturePrimitiveLayout(item).map((part, index) => {
    if (part.kind === "box") {
      return <BoxPart key={index} {...part} />;
    }
    if (part.kind === "cylinder") {
      return (
        <mesh key={index} position={part.position}>
          <cylinderGeometry
            args={[part.radiusTop, part.radiusBottom, part.size[1], 16]}
          />
          <meshStandardMaterial color={part.color} />
        </mesh>
      );
    }
    return (
      <mesh key={index} position={part.position}>
        <sphereGeometry args={[part.radius, 16, 12]} />
        <meshStandardMaterial color={part.color} />
      </mesh>
    );
  });
};

const CameraFramer = ({
  depth,
  height,
  width,
}: {
  depth: number;
  height: number;
  width: number;
}) => {
  const { camera, gl, invalidate, size } = useThree();
  const aspect = size.width / Math.max(size.height, 1);
  const target = useMemo(
    () => [width / 2, height / 2, depth / 2] as SceneVector3,
    [depth, height, width],
  );
  const writeCameraDiagnostics = useCallback(() => {
    gl.domElement.setAttribute(
      "data-wimy-camera-position",
      camera.position.toArray().join(","),
    );
    gl.domElement.setAttribute("data-wimy-camera-far", String(camera.far));
  }, [camera, gl]);

  useEffect(() => {
    const frame = deriveRoomPreviewCamera([width, height, depth], aspect);
    Object.assign(camera, { far: frame.far, near: frame.near });
    camera.position.set(...frame.position);
    camera.lookAt(...frame.target);
    camera.updateProjectionMatrix();
    writeCameraDiagnostics();
    invalidate();
  }, [aspect, camera, depth, height, invalidate, width, writeCameraDiagnostics]);

  return (
    <OrbitControls
      enablePan={false}
      onChange={writeCameraDiagnostics}
      target={target}
    />
  );
};

const PreviewScene = ({ scene }: { scene: SceneProjection }) => {
  const [width, height, depth] = scene.dimensions;
  const span = Math.max(width, depth);
  const initialFrame = useMemo(
    () => deriveRoomPreviewCamera([width, height, depth], 1),
    [depth, height, width],
  );
  return (
    <Canvas
      key={scene.dimensions.join(":")}
      camera={{
        fov: ROOM_PREVIEW_CAMERA_FOV,
        near: initialFrame.near,
        far: initialFrame.far,
        position: initialFrame.position,
      }}
      dpr={[1, 1.5]}
      frameloop="demand"
    >
      <CameraFramer depth={depth} height={height} width={width} />
      <ambientLight intensity={0.7} />
      <directionalLight intensity={1.1} position={[span, span * 1.6, span]} />
      <Grid
        args={[width, depth]}
        cellColor="#c6cfd6"
        cellSize={0.5}
        infiniteGrid={false}
        position={[width / 2, 0.005, depth / 2]}
        sectionColor="#8fa0ad"
        sectionSize={1}
      />
      <mesh position={scene.floor.position} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={scene.floor.size} />
        <meshStandardMaterial color="#edf0f2" />
      </mesh>
      {scene.walls.map((wall) => (
        <mesh key={wall.wall} position={wall.position}>
          <boxGeometry args={wall.size} />
          <meshStandardMaterial color="#d9e0e3" opacity={0.38} transparent />
        </mesh>
      ))}
      {scene.openings.map((opening) => (
        <mesh key={opening.id} position={opening.position}>
          <boxGeometry args={opening.size} />
          <meshStandardMaterial
            color={opening.kind === "door" ? "#b45309" : "#0369a1"}
            opacity={0.82}
            transparent
          />
        </mesh>
      ))}
      {scene.items.map((item) => (
        <group
          key={item.id}
          name={item.name}
          position={item.position}
          rotation={[0, item.rotationY, 0]}
        >
          <FurniturePrimitive item={item} />
        </group>
      ))}
    </Canvas>
  );
};

export function RoomPreview3D({
  room,
  webglSupportOverride,
}: RoomPreview3DProps) {
  const scene = useMemo(() => projectRoomToScene(room), [room]);
  const webglSupported = useMemo(
    () => webglSupportOverride ?? supportsWebGLPreview(),
    [webglSupportOverride],
  );
  const summary = `${room.name}: ${room.dimensions.width} m by ${room.dimensions.depth} m room with ${room.items.length} placed item${room.items.length === 1 ? "" : "s"}.`;

  return (
    <section className="room-preview" aria-label={`3D preview of ${room.name}`}>
      <div className="room-preview-heading-row">
        <h3>3D room preview</h3>
        <p>Read-only procedural preview</p>
      </div>
      <p className="room-preview-summary">{summary}</p>
      {!webglSupported ? (
        <p className="room-preview-fallback" role="status">
          The interactive 3D canvas is unavailable. The room summary and placed
          {" "}item list remain available.
        </p>
      ) : (
        <PreviewErrorBoundary
          fallback={
            <p className="room-preview-fallback" role="status">
              The interactive 3D canvas is unavailable. The room summary and
              {" "}placed item list remain available.
            </p>
          }
        >
          <div className="room-preview-canvas">
            <PreviewScene scene={scene} />
          </div>
        </PreviewErrorBoundary>
      )}
      <ul
        aria-label={`Placed items in ${room.name}`}
        className="room-preview-items"
      >
        {scene.items.map((item) => (
          <li key={item.id}>
            {item.name} — x {item.position[0]} m, y {item.position[2]} m,
            {" "}rotation {item.rotationDeg}°
          </li>
        ))}
      </ul>
    </section>
  );
}
