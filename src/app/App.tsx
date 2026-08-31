import {
  Component,
  lazy,
  Suspense,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ComponentType,
  type ReactNode,
} from "react";
import { useStore } from "zustand";
import { roomStore, type RoomStore } from "../room/store";
import { CatalogPanel } from "../ui/CatalogPanel";
import {
  FileAndTemplateControls,
  RoomWarnings,
} from "../ui/FileAndTemplateControls";
import { ReceiptPanel } from "../ui/ReceiptPanel";
import { RoomEditor2D } from "../ui/RoomEditor2D";
import {
  registerRoomTools,
  type WebMcpRegistrationStatus,
} from "../webmcp/room-tools";

type ViewMode = "2d" | "3d";

type PreviewProps = {
  room: ReturnType<RoomStore["getState"]>["room"];
};

type PreviewLoader = () => Promise<{ default: ComponentType<PreviewProps> }>;

const loadRoomPreview3D: PreviewLoader = async () => {
  const module = await import("../ui/RoomPreview3D");
  return { default: module.RoomPreview3D };
};

const RoomPreview3D = lazy(loadRoomPreview3D);
const RejectedRoomPreview3D = lazy(async () =>
  Promise.reject(new Error("3D preview chunk unavailable")),
);

type AppProps = {
  previewLoadFailure?: boolean;
  store?: RoomStore;
};

type PreviewLoadBoundaryProps = {
  children: ReactNode;
  fallback: ReactNode;
};

type PreviewLoadBoundaryState = {
  failed: boolean;
};

class PreviewLoadBoundary extends Component<
  PreviewLoadBoundaryProps,
  PreviewLoadBoundaryState
> {
  state: PreviewLoadBoundaryState = { failed: false };

  static getDerivedStateFromError(): PreviewLoadBoundaryState {
    return { failed: true };
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

const PreviewLoadFailure = ({
  onReturnTo2D,
  room,
}: PreviewProps & { onReturnTo2D: () => void }) => (
  <section aria-label={`3D preview of ${room.name}`} className="room-preview">
    <div className="room-preview-heading-row">
      <h3>3D room preview</h3>
      <p>Read-only procedural preview</p>
    </div>
    <p className="room-preview-summary">
      {room.name}: {room.dimensions.width} m by {room.dimensions.depth} m
      {" "}room with {room.items.length} placed item
      {room.items.length === 1 ? "" : "s"}.
    </p>
    <p className="room-preview-fallback" role="status">
      The interactive 3D preview could not load. The 2D editor, room summary, and placed item list remain available.
    </p>
    <button onClick={onReturnTo2D} type="button">
      Return to 2D editor
    </button>
    <ul
      aria-label={`Placed items in ${room.name}`}
      className="room-preview-items"
    >
      {room.items.map((item) => (
        <li key={item.id}>{item.snapshot.name}</li>
      ))}
    </ul>
  </section>
);

type RegistrationViewState =
  | {
      generation: AbortController | null;
      owner: RoomStore;
      phase: "pending";
    }
  | {
      generation: AbortController;
      owner: RoomStore;
      phase: "resolved";
      status: WebMcpRegistrationStatus;
    };

const registrationStatusText = (state: RegistrationViewState) => {
  if (state.phase === "pending") {
    return "WebMCP registration pending";
  }

  if (!state.status.available) {
    return "WebMCP unavailable — human room access remains available";
  }

  if (state.status.errors.length > 0) {
    const attempted =
      state.status.registered.length + state.status.errors.length;
    return `WebMCP degraded — ${state.status.registered.length} of ${attempted} tools registered. ${state.status.errors.join("; ")}`;
  }

  return `WebMCP ready — ${state.status.registered.length} tools registered`;
};

export function App({
  previewLoadFailure = false,
  store = roomStore,
}: AppProps) {
  const { room, revision, receipts } = useStore(store);
  const [viewMode, setViewMode] = useState<ViewMode>("2d");
  const Preview3D = previewLoadFailure
    ? RejectedRoomPreview3D
    : RoomPreview3D;
  const registrationGenerationRef = useRef<{
    controller: AbortController;
    owner: RoomStore;
  } | null>(null);
  const [registration, setRegistration] = useState<RegistrationViewState>({
    generation: null,
    owner: store,
    phase: "pending",
  });
  const visibleRegistration: RegistrationViewState =
    registration.owner === store &&
    !registration.generation?.signal.aborted
      ? registration
      : {
          generation: null,
          owner: store,
          phase: "pending",
        };

  useLayoutEffect(() => {
    const generation = {
      controller: new AbortController(),
      owner: store,
    };
    registrationGenerationRef.current = generation;

    return () => {
      generation.controller.abort();
      if (registrationGenerationRef.current === generation) {
        registrationGenerationRef.current = null;
      }
    };
  }, [store]);

  useEffect(() => {
    const generation = registrationGenerationRef.current;
    if (
      !generation ||
      generation.owner !== store ||
      generation.controller.signal.aborted
    ) {
      return;
    }
    const { controller } = generation;

    void registerRoomTools(document.modelContext, store, controller).then(
      (status) => {
        if (!controller.signal.aborted) {
          setRegistration({
            generation: controller,
            owner: store,
            phase: "resolved",
            status,
          });
        }
      },
    );
  }, [store]);

  return (
    <main>
      <header>
        <h1>Wimy</h1>
        <p>Fit, find, and place furniture with your browser agent.</p>
        <p role="status" aria-label="WebMCP status" aria-live="polite">
          {registrationStatusText(visibleRegistration)}
        </p>
        <section
          aria-labelledby="webmcp-workflow-heading"
          className="agent-workflow"
        >
          <h2 id="webmcp-workflow-heading">Work with a browser agent</h2>
          <p>
            WebMCP lets your agent inspect the room, find a catalog fit, and
            apply one exact edit while you review each change.
          </p>
          <ol>
            <li>Inspect the room dimensions and placed items.</li>
            <li>Find a catalog item that fits the room.</li>
            <li>Apply one exact placement at the current revision.</li>
          </ol>
        </section>
        <FileAndTemplateControls store={store} />
      </header>
      <div className="workspace-grid">
        <aside
          className="workspace-catalog"
          aria-labelledby="catalog-heading"
        >
          <CatalogPanel store={store} />
        </aside>
        <section
          className="workspace-room"
          aria-labelledby="current-room-heading"
        >
          <div className="workspace-room-header">
            <div className="workspace-room-heading">
              <h2 id="current-room-heading">{room.name}</h2>
              <p>Revision {revision}</p>
            </div>
            <div
              aria-label="Room view"
              className="room-view-controls"
              role="group"
            >
              <button
                aria-pressed={viewMode === "2d"}
                onClick={() => setViewMode("2d")}
                type="button"
              >
                Edit in 2D
              </button>
              <button
                aria-pressed={viewMode === "3d"}
                onClick={() => setViewMode("3d")}
                type="button"
              >
                Preview in 3D
              </button>
            </div>
          </div>
          {viewMode === "2d" ? (
            <RoomEditor2D store={store} />
          ) : (
            <PreviewLoadBoundary
              fallback={
                <PreviewLoadFailure
                  onReturnTo2D={() => setViewMode("2d")}
                  room={room}
                />
              }
            >
              <Suspense fallback={<p role="status">Loading 3D preview…</p>}>
                <Preview3D room={room} />
              </Suspense>
            </PreviewLoadBoundary>
          )}
        </section>
        <aside
          className="workspace-activity"
          aria-labelledby="activity-receipts-heading"
        >
          <RoomWarnings store={store} />
          <ReceiptPanel receipts={receipts} />
        </aside>
      </div>
    </main>
  );
}
