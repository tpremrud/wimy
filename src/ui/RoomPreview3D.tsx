import { Grid, OrbitControls } from "@react-three/drei";
import { Canvas, useThree } from "@react-three/fiber";
import {
  Component,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useLayoutEffect,
  type ReactNode,
  type RefObject,
} from "react";
import {
  AdditiveBlending,
  Color,
  DoubleSide,
  Object3D,
  Quaternion,
  Vector3,
  type DirectionalLight,
} from "three";
import {
  projectRoomToScene,
  type SceneItem,
  type SceneProjection,
  type SceneVector3,
} from "../room/projection";
import {
  resolveCatalogPresentation,
  resolveCatalogPresentationKey,
} from "../room/catalog-presentation";
import {
  FURNITURE_CYLINDER_SEGMENTS,
  FURNITURE_SPHERE_HEIGHT_SEGMENTS,
  FURNITURE_SPHERE_WIDTH_SEGMENTS,
  projectCatalogProceduralLayout,
  type FurniturePrimitivePart,
} from "./catalog-procedural-layout";
import {
  deriveRoomPreviewCamera,
  ROOM_PREVIEW_CAMERA_FOV,
} from "./room-preview-camera";
import {
  calculateSolarPositionAtUtc,
  deriveSunBeams,
  deriveSunDirection,
  validateSunStudyScenario,
  type CelestialDirection,
  type SolarPosition,
  type SunBeam,
  type SunStudyScenario,
} from "../room/sunlight";
import {
  calculateIllustrativeMoonlightStrength,
  calculateLunarIlluminationAtUtc,
  calculateLunarPositionAtUtc,
  deriveMoonDirection,
  type LunarIllumination,
  type LunarPosition,
} from "../room/moonlight";

type RoomPreview3DProps = {
  room: Parameters<typeof projectRoomToScene>[0];
  webglSupportOverride?: boolean;
  shadowSupportOverride?: boolean;
};

type SunStudyInputState = {
  latitude: string;
  longitude: string;
  date: string;
  localTime: string;
  timeZone: string;
  planNorthAzimuthDeg: string;
};

type SunStudyRenderState = {
  position: SolarPosition;
  direction: CelestialDirection;
  shadowsEnabled: boolean;
};

type MoonStudyRenderState = {
  position: LunarPosition;
  direction: CelestialDirection;
  illumination: LunarIllumination;
  shadowsEnabled: boolean;
};

const DEFAULT_SUN_STUDY_INPUT: SunStudyInputState = {
  latitude: "40.71",
  longitude: "-74.01",
  date: "2026-09-01",
  localTime: "12:00",
  timeZone: "America/New_York",
  planNorthAzimuthDeg: "0",
};

const parseNumberInput = (value: string) =>
  value.trim() === "" ? Number.NaN : Number(value);

const toSunStudyScenario = (
  input: SunStudyInputState,
): SunStudyScenario => ({
  latitude: parseNumberInput(input.latitude),
  longitude: parseNumberInput(input.longitude),
  date: input.date,
  localTime: input.localTime,
  timeZone: input.timeZone,
  planNorthAzimuthDeg: parseNumberInput(input.planNorthAzimuthDeg),
});

const fixed = (value: number, digits = 1) => value.toFixed(digits);

const minutesFromLocalTime = (localTime: string) => {
  const [hour = "0", minute = "0"] = localTime.split(":");
  return Number(hour) * 60 + Number(minute);
};

const localTimeFromMinutes = (minutes: number) => {
  const normalized = ((Math.round(minutes) % 1440) + 1440) % 1440;
  return `${String(Math.floor(normalized / 60)).padStart(2, "0")}:${String(normalized % 60).padStart(2, "0")}`;
};

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

const usePrefersReducedMotion = () => {
  const [preferred, setPreferred] = useState(
    () => window.matchMedia?.(REDUCED_MOTION_QUERY).matches ?? false,
  );

  useEffect(() => {
    const media = window.matchMedia?.(REDUCED_MOTION_QUERY);
    if (!media) return undefined;
    const update = () => setPreferred(media.matches);
    media.addEventListener?.("change", update);
    return () => media.removeEventListener?.("change", update);
  }, []);

  return preferred;
};

const SunStudyControls = ({
  input,
  onChange,
  shadowsEnabled,
  shadowsSupported,
  onShadowsChange,
}: {
  input: SunStudyInputState;
  onChange: (field: keyof SunStudyInputState, value: string) => void;
  shadowsEnabled: boolean;
  shadowsSupported: boolean;
  onShadowsChange: (enabled: boolean) => void;
}) => (
  <fieldset className="sun-study-controls" aria-label="Sun study controls">
    <legend>Sun study (experimental)</legend>
    <p className="sun-study-intro">
      Manual coarse inputs stay in this session and are never added to the room
      file.
    </p>
    <div className="sun-study-input-grid">
      <label>
        Latitude
        <input
          inputMode="decimal"
          max={90}
          min={-90}
          onChange={(event) => onChange("latitude", event.target.value)}
          step={0.01}
          type="number"
          value={input.latitude}
        />
      </label>
      <label>
        Longitude
        <input
          inputMode="decimal"
          max={180}
          min={-180}
          onChange={(event) => onChange("longitude", event.target.value)}
          step={0.01}
          type="number"
          value={input.longitude}
        />
      </label>
      <label>
        Local date
        <input
          onChange={(event) => onChange("date", event.target.value)}
          type="date"
          value={input.date}
        />
      </label>
      <label>
        IANA timezone
        <input
          list="sun-study-timezones"
          onChange={(event) => onChange("timeZone", event.target.value)}
          type="text"
          value={input.timeZone}
        />
        <datalist id="sun-study-timezones">
          <option value="America/New_York" />
          <option value="UTC" />
          <option value="Europe/London" />
        </datalist>
      </label>
      <label>
        Plan North true bearing
        <input
          inputMode="decimal"
          max={359.999}
          min={0}
          onChange={(event) =>
            onChange("planNorthAzimuthDeg", event.target.value)
          }
          step={0.001}
          type="number"
          value={input.planNorthAzimuthDeg}
        />
      </label>
    </div>
    <label className="sun-study-shadow-toggle">
      <input
        checked={shadowsEnabled && shadowsSupported}
        disabled={!shadowsSupported}
        onChange={(event) => onShadowsChange(event.target.checked)}
        type="checkbox"
      />
      Enable bounded shadows
    </label>
  </fieldset>
);

const SkyTimelineDock = ({
  animationDisabled,
  dayAnimating,
  input,
  moonIllumination,
  onChange,
  onDayAnimationChange,
  onOpenSettings,
  settingsButtonRef,
  settingsOpen,
}: {
  animationDisabled: boolean;
  dayAnimating: boolean;
  input: SunStudyInputState;
  moonIllumination: LunarIllumination | null;
  onChange: (field: keyof SunStudyInputState, value: string) => void;
  onDayAnimationChange: (playing: boolean) => void;
  onOpenSettings: () => void;
  settingsButtonRef: RefObject<HTMLButtonElement | null>;
  settingsOpen: boolean;
}) => (
  <div className="sky-timeline-dock" aria-label="Sky timeline">
    <div className="sky-timeline-readout">
      <output htmlFor="sun-study-time-slider">{input.localTime}</output>
      {moonIllumination ? (
        <span className="moon-phase-indicator">
          {moonIllumination.phaseName} · {Math.round(moonIllumination.fraction * 100)}%
        </span>
      ) : null}
    </div>
    <div className="sun-study-timeline">
      <input
        aria-label="Local time of day"
        id="sun-study-time-slider"
        max={1435}
        min={0}
        onChange={(event) =>
          onChange("localTime", localTimeFromMinutes(Number(event.target.value)))
        }
        step={5}
        type="range"
        value={minutesFromLocalTime(input.localTime)}
      />
      <div aria-hidden="true" className="sun-study-timeline-ticks">
        <span>00</span>
        <span>06</span>
        <span>12</span>
        <span>18</span>
        <span>24</span>
      </div>
    </div>
    <button
      aria-label={animationDisabled
        ? "Day animation disabled because reduced motion is preferred"
        : dayAnimating ? "Pause" : "Play day"}
      aria-pressed={dayAnimating}
      disabled={animationDisabled}
      onClick={() => onDayAnimationChange(!dayAnimating)}
      type="button"
    >
      {dayAnimating ? "Pause" : "Play day"}
    </button>
    <button
      ref={settingsButtonRef}
      aria-controls="lighting-settings-drawer"
      aria-expanded={settingsOpen}
      aria-label="Open lighting settings"
      onClick={onOpenSettings}
      type="button"
    >
      Settings
    </button>
  </div>
);

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
  <mesh castShadow receiveShadow position={position}>
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
  scale?: SceneVector3;
};

export type { FurniturePrimitivePart } from "./catalog-procedural-layout";

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
  const ellipsoid = (
    color: string,
    position: SceneVector3,
    requestedSize: SceneVector3,
  ): FurnitureSpherePart => {
    const boundedSize: SceneVector3 = [
      Math.min(requestedSize[0], width),
      Math.min(requestedSize[1], height),
      Math.min(requestedSize[2], depth),
    ];
    return {
      kind: "sphere",
      color,
      position: containedPosition(position, boundedSize),
      radius: 0.5,
      scale: boundedSize,
    };
  };
  const baseHeight = Math.min(height * 0.55, 0.5);
  const topHeight = Math.min(Math.max(height * 0.12, 0.05), height);
  const legOffsetX = Math.max(width / 2 - 0.08, 0);
  const legOffsetZ = Math.max(depth / 2 - 0.08, 0);
  const appearanceKey = resolveCatalogPresentationKey(
    item.catalogRef ?? item.catalogProductId,
  );

  const catalogVariant = projectCatalogProceduralLayout(item, appearanceKey, {
    box,
    cylinder,
    ellipsoid,
    localY,
  });
  if (
    catalogVariant &&
    catalogVariant.length <=
      (resolveCatalogPresentation(item.catalogRef ?? item.catalogProductId)
        ?.maxPrimitiveParts ?? 0)
  ) {
    return catalogVariant;
  }

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
            args={[
              part.radiusTop,
              part.radiusBottom,
              part.size[1],
              FURNITURE_CYLINDER_SEGMENTS,
            ]}
          />
          <meshStandardMaterial color={part.color} />
        </mesh>
      );
    }
    return (
      <mesh key={index} position={part.position} scale={part.scale}>
        <sphereGeometry
          args={[
            part.radius,
            FURNITURE_SPHERE_WIDTH_SEGMENTS,
            FURNITURE_SPHERE_HEIGHT_SEGMENTS,
          ]}
        />
        <meshStandardMaterial color={part.color} />
      </mesh>
    );
  });
};

const CameraFramer = ({
  depth,
  height,
  renderKey,
  width,
}: {
  depth: number;
  height: number;
  renderKey: string;
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
  }, [aspect, camera, depth, height, invalidate, renderKey, width, writeCameraDiagnostics]);

  return (
    <OrbitControls
      enablePan={false}
      onChange={writeCameraDiagnostics}
      target={target}
    />
  );
};

const WindowLightBeamVolume = ({
  beam,
  color = "#ffb65c",
  opacityScale = 1,
}: {
  beam: SunBeam;
  color?: string;
  opacityScale?: number;
}) => {
  const quaternion = useMemo(
    () => new Quaternion().setFromUnitVectors(
      new Vector3(0, 0, 1),
      new Vector3(...beam.direction).normalize(),
    ),
    [beam.direction],
  );

  return (
    <mesh
      position={beam.position}
      quaternion={quaternion}
      renderOrder={2}
    >
      <boxGeometry args={[beam.aperture[0] * 0.94, beam.aperture[1] * 0.94, beam.length]} />
      <meshBasicMaterial
        blending={AdditiveBlending}
        color={color}
        depthWrite={false}
        opacity={(0.1 + beam.strength * 0.2) * opacityScale}
        side={DoubleSide}
        toneMapped={false}
        transparent
      />
    </mesh>
  );
};

const PreviewScene = ({
  scene,
  moonBeams,
  moonlightStrength,
  moonStudy,
  sunBeams,
  sunStudy,
}: {
  scene: SceneProjection;
  moonBeams: readonly SunBeam[];
  moonlightStrength: number;
  moonStudy: MoonStudyRenderState | null;
  sunBeams: readonly SunBeam[];
  sunStudy: SunStudyRenderState | null;
}) => {
  const [width, height, depth] = scene.dimensions;
  const span = Math.max(width, depth);
  const sunTarget = useMemo(() => new Object3D(), []);
  const moonTarget = useMemo(() => new Object3D(), []);
  const sunLight = useRef<DirectionalLight>(null);
  const moonLight = useRef<DirectionalLight>(null);
  const renderKey = [
    sunStudy?.position.utcDate ?? "no-sun-study",
    sunStudy?.position.azimuthDeg ?? 0,
    sunStudy?.position.apparentAltitudeDeg ?? 0,
    moonStudy?.position.azimuthDeg ?? 0,
    moonStudy?.position.apparentAltitudeDeg ?? 0,
    sunStudy?.shadowsEnabled ?? false,
  ].join(":");
  const initialFrame = useMemo(
    () => deriveRoomPreviewCamera([width, height, depth], 1),
    [depth, height, width],
  );
  useLayoutEffect(() => {
    sunTarget.position.set(width / 2, 0, depth / 2);
    sunTarget.updateMatrixWorld();
    if (sunLight.current) sunLight.current.target = sunTarget;
    moonTarget.position.set(width / 2, 0, depth / 2);
    moonTarget.updateMatrixWorld();
    if (moonLight.current) moonLight.current.target = moonTarget;
  }, [depth, moonTarget, sunTarget, width]);
  const showSun = sunStudy?.direction.isAboveHorizon === true;
  const showMoon =
    moonStudy?.direction.isAboveHorizon === true &&
    moonlightStrength > 0 &&
    !showSun;
  const daylight = showSun && sunStudy
    ? Math.min(Math.max(Math.sin(sunStudy.position.apparentAltitudeDeg * Math.PI / 180), 0.08), 1)
    : 0;
  const skyColor = useMemo(
    () => new Color("#243544").lerp(new Color("#edf2f1"), daylight).getStyle(),
    [daylight],
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
      shadows={sunStudy?.shadowsEnabled ?? false}
    >
      <CameraFramer
        depth={depth}
        height={height}
        renderKey={renderKey}
        width={width}
      />
      <color args={[skyColor]} attach="background" />
      <ambientLight intensity={0.12 + daylight * 0.22} />
      <hemisphereLight args={["#fff7e8", "#51606a", 0.18 + daylight * 0.28]} />
      {showSun ? (
        <>
          <primitive object={sunTarget} />
          <directionalLight
            castShadow={sunStudy.shadowsEnabled}
            color="#ffe2a8"
            intensity={0.65 + daylight * 1.75}
            position={[
              width / 2 + sunStudy.direction.lightPosition[0],
              height + sunStudy.direction.lightPosition[1],
              depth / 2 + sunStudy.direction.lightPosition[2],
            ]}
            ref={sunLight}
            shadow-bias={-0.00015}
            shadow-camera-bottom={-span}
            shadow-camera-far={span * 4}
            shadow-camera-left={-span}
            shadow-camera-right={span}
            shadow-camera-top={span}
            shadow-mapSize={[2048, 2048]}
            shadow-normalBias={0.02}
            target={sunTarget}
          />
          {sunBeams.map((beam) => (
            <WindowLightBeamVolume beam={beam} key={beam.openingId} />
          ))}
        </>
      ) : null}
      {showMoon && moonStudy ? (
        <>
          <primitive object={moonTarget} />
          <directionalLight
            castShadow={moonStudy.shadowsEnabled}
            color="#9fc5ff"
            intensity={0.12 + moonlightStrength * 0.55}
            position={[
              width / 2 + moonStudy.direction.lightPosition[0],
              height + moonStudy.direction.lightPosition[1],
              depth / 2 + moonStudy.direction.lightPosition[2],
            ]}
            ref={moonLight}
            shadow-bias={-0.00015}
            shadow-camera-bottom={-span}
            shadow-camera-far={span * 4}
            shadow-camera-left={-span}
            shadow-camera-right={span}
            shadow-camera-top={span}
            shadow-mapSize={[2048, 2048]}
            shadow-normalBias={0.02}
            target={moonTarget}
          />
          {moonBeams.map((beam) => (
            <WindowLightBeamVolume
              beam={beam}
              color="#8cbcff"
              key={beam.openingId}
              opacityScale={0.28 + moonlightStrength * 0.5}
            />
          ))}
        </>
      ) : null}
      <Grid
        args={[width, depth]}
        cellColor="#c6cfd6"
        cellSize={0.5}
        infiniteGrid={false}
        position={[width / 2, 0.005, depth / 2]}
        sectionColor="#8fa0ad"
        sectionSize={1}
      />
      {scene.floorSections.map((floor) => (
        <mesh
          key={`${floor.position[0]}-${floor.position[2]}-${floor.size.join("-")}`}
          receiveShadow
          position={floor.position}
          rotation={[-Math.PI / 2, 0, 0]}
        >
          <planeGeometry args={floor.size} />
          <meshStandardMaterial color="#edf0f2" />
        </mesh>
      ))}
      {scene.walls.map((wall) => (
        <mesh castShadow key={`${wall.wall}-${wall.position.join("-")}`} position={wall.position} receiveShadow>
          <boxGeometry args={wall.size} />
          <meshStandardMaterial
            color="#e1e6e4"
            depthWrite={wall.wall === "north" || wall.wall === "west"}
            opacity={wall.wall === "north" || wall.wall === "west" ? 0.96 : 0.13}
            roughness={0.92}
            transparent
          />
        </mesh>
      ))}
      {scene.openings.map((opening) => (
        <group key={opening.id} name={opening.label}>
          <mesh position={opening.position}>
            <boxGeometry args={opening.size} />
            <meshStandardMaterial
              color={opening.kind === "door" ? "#9b5528" : "#9bc8d8"}
              opacity={opening.kind === "door" ? 0.82 : 0.2}
              transparent
            />
          </mesh>
        </group>
      ))}
      {scene.items.map((item) => (
        <group
          castShadow
          key={item.id}
          name={item.name}
          position={item.position}
          receiveShadow
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
  shadowSupportOverride,
  webglSupportOverride,
}: RoomPreview3DProps) {
  const scene = useMemo(() => projectRoomToScene(room), [room]);
  const webglSupported = useMemo(
    () => webglSupportOverride ?? supportsWebGLPreview(),
    [webglSupportOverride],
  );
  const shadowSupport = shadowSupportOverride ?? webglSupported;
  const [sunStudyInput, setSunStudyInput] = useState(DEFAULT_SUN_STUDY_INPUT);
  const [shadowsEnabled, setShadowsEnabled] = useState(true);
  const [dayAnimating, setDayAnimating] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const prefersReducedMotion = usePrefersReducedMotion();
  const settingsButtonRef = useRef<HTMLButtonElement>(null);
  const settingsDrawerRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!dayAnimating || prefersReducedMotion) return undefined;
    const timer = window.setInterval(() => {
      setSunStudyInput((current) => ({
        ...current,
        localTime: localTimeFromMinutes(minutesFromLocalTime(current.localTime) + 10),
      }));
    }, 120);
    return () => window.clearInterval(timer);
  }, [dayAnimating, prefersReducedMotion]);
  useEffect(() => {
    if (!settingsOpen) return undefined;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setSettingsOpen(false);
      settingsButtonRef.current?.focus();
    };
    const closeOnOutsidePointer = (event: PointerEvent) => {
      const target = event.target as Node;
      if (settingsDrawerRef.current?.contains(target)) return;
      if (settingsButtonRef.current?.contains(target)) return;
      setSettingsOpen(false);
    };
    document.addEventListener("keydown", closeOnEscape);
    document.addEventListener("pointerdown", closeOnOutsidePointer);
    return () => {
      document.removeEventListener("keydown", closeOnEscape);
      document.removeEventListener("pointerdown", closeOnOutsidePointer);
    };
  }, [settingsOpen]);
  const sunStudyValidation = useMemo(
    () => validateSunStudyScenario(toSunStudyScenario(sunStudyInput)),
    [sunStudyInput],
  );
  const sunStudy = useMemo<SunStudyRenderState | null>(() => {
    if (!sunStudyValidation.valid) return null;
    const position = calculateSolarPositionAtUtc(
      new Date(sunStudyValidation.value.utcDate),
      sunStudyValidation.value.latitude,
      sunStudyValidation.value.longitude,
    );
    return {
      direction: deriveSunDirection(
        position,
        sunStudyValidation.value.planNorthAzimuthDeg,
      ),
      position,
      shadowsEnabled: shadowsEnabled && shadowSupport,
    };
  }, [shadowSupport, shadowsEnabled, sunStudyValidation]);
  const moonStudy = useMemo<MoonStudyRenderState | null>(() => {
    if (!sunStudyValidation.valid) return null;
    const instant = new Date(sunStudyValidation.value.utcDate);
    const position = calculateLunarPositionAtUtc(
      instant,
      sunStudyValidation.value.latitude,
      sunStudyValidation.value.longitude,
    );
    return {
      direction: deriveMoonDirection(
        position,
        sunStudyValidation.value.planNorthAzimuthDeg,
      ),
      illumination: calculateLunarIlluminationAtUtc(instant),
      position,
      shadowsEnabled: shadowsEnabled && shadowSupport,
    };
  }, [shadowSupport, shadowsEnabled, sunStudyValidation]);
  const summary = `${room.name}: ${room.dimensions.width} m by ${room.dimensions.depth} m room with ${room.items.length} placed item${room.items.length === 1 ? "" : "s"}.`;
  const updateSunStudyInput = (
    field: keyof SunStudyInputState,
    value: string,
  ) => {
    setSunStudyInput((current) => ({ ...current, [field]: value }));
  };
  const statusText = !sunStudyValidation.valid || !sunStudy
    ? "Sun study unavailable. No fixed fallback sun is shown."
    : [
        `Apparent solar azimuth ${fixed(sunStudy.position.azimuthDeg)}°`,
        `apparent solar altitude ${fixed(sunStudy.position.apparentAltitudeDeg)}°`,
        `Plan North ${fixed(sunStudyValidation.value.planNorthAzimuthDeg, 0)}°`,
        sunStudy.direction.isAboveHorizon
          ? "Direct sun is above the modeled horizon"
          : "Direct sun is at or below the modeled horizon",
        shadowsEnabled && shadowSupport && sunStudy.direction.isAboveHorizon
          ? "Shadows are on"
          : shadowSupport
            ? "Shadows are off"
            : "Shadows are unavailable",
      ].join(" — ");
  const sunBeams = useMemo(
    () => sunStudy
      ? deriveSunBeams(scene.dimensions, scene.openings, sunStudy.direction)
      : [],
    [scene, sunStudy],
  );
  const moonlightStrength = moonStudy
    ? calculateIllustrativeMoonlightStrength(moonStudy.illumination.fraction)
    : 0;
  const moonBeams = useMemo(
    () => moonStudy && moonlightStrength > 0 && !sunStudy?.direction.isAboveHorizon
      ? deriveSunBeams(scene.dimensions, scene.openings, moonStudy.direction)
      : [],
    [moonStudy, moonlightStrength, scene, sunStudy],
  );
  const moonStatusText = !sunStudyValidation.valid || !moonStudy
    ? "Moon study unavailable. No fixed fallback moonlight is shown."
    : [
        `${moonStudy.illumination.phaseName}`,
        `${Math.round(moonStudy.illumination.fraction * 100)}% illuminated`,
        `apparent lunar azimuth ${fixed(moonStudy.position.azimuthDeg)}°`,
        `apparent lunar altitude ${fixed(moonStudy.position.apparentAltitudeDeg)}°`,
        moonStudy.direction.isAboveHorizon
          ? "Moon is above the modeled horizon"
          : "Moon is at or below the modeled horizon",
        sunStudy?.direction.isAboveHorizon
          ? "Direct sun takes lighting precedence"
          : moonlightStrength === 0
            ? "Phase is too dim for illustrative moonlight"
          : moonBeams.length > 0
            ? "Illustrative moonlight reaches a window"
            : "No window-facing moonlight beam",
      ].join(" — ");

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
          <div
            className="room-preview-canvas"
            data-wimy-shadows={sunStudy?.shadowsEnabled ? "on" : "off"}
            data-wimy-moonbeams={moonBeams.length}
            data-wimy-moonlight={moonStudy?.direction.isAboveHorizon && moonlightStrength > 0 && !sunStudy?.direction.isAboveHorizon ? "on" : "off"}
            data-wimy-moon-phase={moonStudy?.illumination.phaseName ?? "unavailable"}
            data-wimy-moon-strength={moonlightStrength}
            data-wimy-sunbeams={sunBeams.length}
            data-wimy-sun-study={sunStudy ? "available" : "unavailable"}
          >
          <PreviewScene
            moonBeams={moonBeams}
            moonlightStrength={moonlightStrength}
            moonStudy={moonStudy}
            scene={scene}
            sunBeams={sunBeams}
            sunStudy={sunStudy}
          />
          </div>
        </PreviewErrorBoundary>
      )}
      <SkyTimelineDock
        animationDisabled={prefersReducedMotion}
        dayAnimating={dayAnimating && !prefersReducedMotion}
        input={sunStudyInput}
        moonIllumination={moonStudy?.illumination ?? null}
        onDayAnimationChange={setDayAnimating}
        onChange={updateSunStudyInput}
        onOpenSettings={() => setSettingsOpen(true)}
        settingsButtonRef={settingsButtonRef}
        settingsOpen={settingsOpen}
      />
      <ul
        aria-label={`Placed items in ${room.name}`}
        className="room-preview-accessible-inventory"
      >
        {scene.items.map((item) => (
          <li key={item.id}>
            {item.name} — x {item.position[0]} m, y {item.position[2]} m,
            {" "}rotation {item.rotationDeg}° — {item.orientation.label}
          </li>
        ))}
      </ul>
      {settingsOpen ? (
        <aside
          aria-label="Lighting settings"
          className="lighting-settings-drawer"
          id="lighting-settings-drawer"
          ref={settingsDrawerRef}
        >
          <div className="lighting-settings-heading">
            <div>
              <span>Sun + Moon</span>
              <h4>Lighting settings</h4>
            </div>
            <button
              aria-label="Close lighting settings"
              onClick={() => {
                setSettingsOpen(false);
                settingsButtonRef.current?.focus();
              }}
              type="button"
            >
              Close
            </button>
          </div>
          <SunStudyControls
            input={sunStudyInput}
            onChange={updateSunStudyInput}
            onShadowsChange={setShadowsEnabled}
            shadowsEnabled={shadowsEnabled}
            shadowsSupported={shadowSupport && webglSupported && sunStudyValidation.valid}
          />
          <p
            aria-label="Sun study status"
            className="sun-study-status"
            role="status"
          >
            {statusText}
          </p>
          <p
            aria-label="Moon study status"
            className="moon-study-status"
            role="status"
          >
            {moonStatusText}
          </p>
          {sunStudyValidation.valid && sunStudy ? (
            <p className="sun-study-time">
              Local {sunStudyValidation.value.date} {sunStudyValidation.value.localTime}{" "}
              ({sunStudyValidation.value.timeZone}); UTC {sunStudy.position.utcDate}.
            </p>
          ) : null}
          <aside className="sun-study-assumptions" aria-label="Sun study assumptions">
            <strong>Approximate directional sun and moon geometry</strong>
            <p>
              Plan North is the room-local top edge; the true bearing is used only
              to orient the sky. This does not estimate daylight or moonlight
              intensity, lux, or energy performance.
            </p>
            <p>
              Clear sky, no weather, glazing, blinds, terrain, or exterior
              obstructions are modeled. Window openings are geometric apertures;
              furniture and walls use a bounded shadow map when enabled. Moonlight
              is intentionally amplified and labeled illustrative so its direction
              and phase can be understood in the preview.
            </p>
          </aside>
          <details className="lighting-scene-details">
            <summary>Scene details</summary>
            <ul
              aria-label={`Placed item details in ${room.name}`}
              className="room-preview-items"
            >
              {scene.items.map((item) => (
                <li key={item.id}>
                  {item.name} — x {item.position[0]} m, y {item.position[2]} m,
                  {" "}rotation {item.rotationDeg}° — {item.orientation.label}
                </li>
              ))}
            </ul>
            {scene.openings.length > 0 ? (
              <ul
                aria-label={`Openings in ${room.name}`}
                className="room-preview-openings"
              >
                {scene.openings.map((opening) => (
                  <li key={opening.id}>{opening.label}</li>
                ))}
              </ul>
            ) : null}
          </details>
        </aside>
      ) : null}
    </section>
  );
}
