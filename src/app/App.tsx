import {
  Component,
  lazy,
  Suspense,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ComponentType,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import { useStore } from "zustand";
import { roomStore, type RoomStore } from "../room/store";
import { CatalogPanel } from "../ui/CatalogPanel";
import { createSyntheticRetailerOfferResolver } from "../commerce/synthetic-retailer-offers";
import { RoomWarnings } from "../ui/FileAndTemplateControls";
import { ReceiptPanel } from "../ui/ReceiptPanel";
import { RoomEditor2D } from "../ui/RoomEditor2D";
import { FavoritesPanel, PlacedPanel } from "../ui/RoomRailPanels";
import { ShareRoomPanel } from "../ui/ShareRoomPanel";
import { WebMcpToolList } from "../ui/WebMcpToolList";
import { CustomerSessionPanel } from "../ui/CustomerSessionPanel";
import { CartReviewPanel } from "../ui/CartReviewPanel";
import { RoomGeometryPanel } from "../ui/RoomGeometryPanel";
import {
  createLightingPreviewStore,
  type LightingPreviewStore,
} from "../room/lighting-preview";
import {
  createCustomerSessionDemo,
  type CustomerSessionClient,
} from "../commerce/customer-session-demo";
import type { CustomerSessionView } from "../commerce/customer-session";
import {
  createRoomToolDefinitions,
  registerRoomTools,
  type WebMcpRegistrationStatus,
} from "../webmcp/room-tools";

type ViewMode = "2d" | "3d";
type RailTab = "add" | "placed" | "favorites";
type ActiveSurface = "share" | "help" | "activity" | "cart" | "geometry" | null;

type PreviewProps = {
  lightingPreviewStore: LightingPreviewStore;
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
  lightingPreviewStore?: LightingPreviewStore;
  previewLoadFailure?: boolean;
  store?: RoomStore;
  customerSession?: CustomerSessionClient;
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
}: Pick<PreviewProps, "room"> & { onReturnTo2D: () => void }) => (
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

const startsWithCompactRoomTools = () =>
  typeof window !== "undefined" &&
  typeof window.matchMedia === "function" &&
  window.matchMedia("(max-width: 42rem)").matches;

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
  lightingPreviewStore: providedLightingPreviewStore,
  previewLoadFailure = false,
  store = roomStore,
  customerSession: providedCustomerSession,
}: AppProps) {
  const { room, revision, receipts } = useStore(store);
  const lightingPreviewStore = useMemo(
    () => providedLightingPreviewStore ?? createLightingPreviewStore(),
    [providedLightingPreviewStore],
  );
  const [viewMode, setViewMode] = useState<ViewMode>("2d");
  const [railTab, setRailTab] = useState<RailTab>("add");
  const [railCollapsed, setRailCollapsed] = useState(startsWithCompactRoomTools);
  const [activeSurface, setActiveSurface] = useState<ActiveSurface>(null);
  const [customerSessionView, setCustomerSessionView] = useState<CustomerSessionView>({ authenticated: false });
  const customerSessionKey = customerSessionView.authenticated
    ? `${customerSessionView.customerId}:${customerSessionView.scopes.join(",")}`
    : "anonymous";
  const previousReceiptRef = useRef(receipts[0]);
  const shareButtonRef = useRef<HTMLButtonElement>(null);
  const helpButtonRef = useRef<HTMLButtonElement>(null);
  const activityButtonRef = useRef<HTMLButtonElement>(null);
  const cartButtonRef = useRef<HTMLButtonElement>(null);
  const geometryButtonRef = useRef<HTMLButtonElement>(null);
  const [favoriteIds, setFavoriteIds] = useState<Set<string>>(
    () => new Set(),
  );
  const Preview3D = previewLoadFailure
    ? RejectedRoomPreview3D
    : RoomPreview3D;
  const offerResolver = useMemo(
    () => createSyntheticRetailerOfferResolver(store.readCatalog),
    [store],
  );
  const customerSession = useMemo(
    () => providedCustomerSession ?? createCustomerSessionDemo({ offerResolver }),
    [offerResolver, providedCustomerSession],
  );
  const webMcpToolDefinitions = useMemo(
    () => createRoomToolDefinitions(
      store,
      offerResolver,
      {
        customerSession,
        session: customerSessionView,
      },
      lightingPreviewStore,
    ),
    // customerSessionKey is the semantic auth snapshot; expiresAt changes must
    // not churn the native registration generation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [customerSession, customerSessionKey, lightingPreviewStore, offerResolver, store],
  );
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

  const warningCount = store.getState().getLayoutWarnings().length;

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
  }, [customerSessionKey, store]);

  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const compactRoomTools = window.matchMedia("(max-width: 42rem)");
    const collapseWhenCompact = (event: MediaQueryListEvent) => {
      if (event.matches) setRailCollapsed(true);
    };
    compactRoomTools.addEventListener("change", collapseWhenCompact);
    return () => compactRoomTools.removeEventListener("change", collapseWhenCompact);
  }, []);

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

    void registerRoomTools(
      document.modelContext,
      store,
      controller,
      webMcpToolDefinitions,
    ).then(
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
  }, [store, webMcpToolDefinitions]);

  useEffect(() => {
    if (!customerSessionView.authenticated) return;
    let current = true;
    const delay = Math.max(0, customerSessionView.expiresAt - Date.now());
    const timer = window.setTimeout(() => {
      void customerSession.getSession()
        .then((nextSession) => {
          if (current) setCustomerSessionView(nextSession);
        })
        .catch(() => {
          if (current) setCustomerSessionView({ authenticated: false });
        });
    }, delay);

    return () => {
      current = false;
      window.clearTimeout(timer);
    };
  }, [customerSession, customerSessionView]);

  useEffect(() => {
    const newestReceipt = receipts[0];
    const newestReceiptChanged = newestReceipt !== previousReceiptRef.current;
    if (
      newestReceiptChanged &&
      newestReceipt?.status === "rejected" &&
      activeSurface === null
    ) {
      setActiveSurface("activity");
    }
    previousReceiptRef.current = newestReceipt;
  }, [activeSurface, receipts]);

  const toggleFavorite = (key: string) => {
    setFavoriteIds((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const tabs: readonly { id: RailTab; label: string }[] = [
    { id: "add", label: "Add" },
    { id: "placed", label: "Placed" },
    { id: "favorites", label: "Favorites" },
  ];

  const moveRailTab = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (!["ArrowRight", "ArrowLeft", "Home", "End"].includes(event.key)) {
      return;
    }
    event.preventDefault();
    const currentIndex = tabs.findIndex(
      ({ id }) => id === event.currentTarget.id.replace(/-tab$/u, ""),
    );
    const nextIndex =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? tabs.length - 1
          : (currentIndex + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) %
            tabs.length;
    const nextTab = tabs[nextIndex];
    if (!nextTab) return;
    setRailTab(nextTab.id);
    document.getElementById(`${nextTab.id}-tab`)?.focus();
  };

  const openSurface = (surface: Exclude<ActiveSurface, null>) => {
    setActiveSurface(surface);
  };

  const closeSurface = (surface: Exclude<ActiveSurface, null>) => {
    if (activeSurface !== surface) return;
    setActiveSurface(null);
    const opener = surface === "share"
      ? shareButtonRef
      : surface === "help"
        ? helpButtonRef
        : surface === "activity"
          ? activityButtonRef
          : surface === "cart"
            ? cartButtonRef
            : geometryButtonRef;
    opener.current?.focus();
  };

  useEffect(() => {
    if (!activeSurface) return;
    const opener = activeSurface === "share"
      ? shareButtonRef
      : activeSurface === "help"
        ? helpButtonRef
        : activeSurface === "activity"
          ? activityButtonRef
          : activeSurface === "cart"
            ? cartButtonRef
            : geometryButtonRef;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setActiveSurface(null);
      opener.current?.focus();
    };
    const closeOnOutsidePointer = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      const surface = document.querySelector(
        `[data-floating-surface="${activeSurface}"]`,
      );
      if (opener.current?.contains(target) || surface?.contains(target)) return;
      setActiveSurface(null);
    };
    document.addEventListener("keydown", closeOnEscape);
    document.addEventListener("pointerdown", closeOnOutsidePointer);
    return () => {
      document.removeEventListener("keydown", closeOnEscape);
      document.removeEventListener("pointerdown", closeOnOutsidePointer);
    };
  }, [activeSurface]);

  return (
    <main className="app-shell">
      <a className="skip-link" href="#room-workspace">
        Skip to room workspace
      </a>
      <header className="app-header">
        <div className="brand-lockup">
          <h1>Wimy</h1>
          <p>Fit, find, and place furniture with a human or browser agent.</p>
        </div>
        <div className="room-context" aria-label="Current room context">
          <strong>{room.name}</strong>
          <span>Revision {revision}</span>
        </div>
        <div className="header-actions">
          <div aria-label="Room view" className="room-view-controls" role="group">
            <button aria-label="Edit in 2D" aria-pressed={viewMode === "2d"} onClick={() => setViewMode("2d")} type="button">2D plan</button>
            <button aria-label="Preview in 3D" aria-pressed={viewMode === "3d"} onClick={() => setViewMode("3d")} type="button">3D preview</button>
          </div>
          <CustomerSessionPanel
            key={customerSessionKey}
            client={customerSession}
            onSessionChange={setCustomerSessionView}
            session={customerSessionView}
          />
          <ShareRoomPanel
            open={activeSurface === "share"}
            onClose={() => closeSurface("share")}
            onOpen={() => openSurface("share")}
            openerRef={shareButtonRef}
            store={store}
          />
          <CartReviewPanel
            key={`checkout-${customerSessionKey}`}
            catalog={store.readCatalog()}
            checkout={customerSession.checkout}
            client={customerSession.cart}
            onClose={() => closeSurface("cart")}
            onOpen={() => openSurface("cart")}
            openerRef={cartButtonRef}
            open={activeSurface === "cart"}
            room={room}
            roomRevision={revision}
            session={customerSessionView}
          />
          <button
            ref={helpButtonRef}
            type="button"
            className="header-action-button"
            aria-label="Help and agent guidance"
            aria-expanded={activeSurface === "help"}
            aria-controls="browser-agent-guidance"
            onClick={() => openSurface("help")}
          >
            Guide
          </button>
          <button
            ref={activityButtonRef}
            type="button"
            className="header-action-button"
            aria-label="Warnings & activity"
            aria-expanded={activeSurface === "activity"}
            aria-controls="activity-drawer"
            onClick={() => openSurface("activity")}
          >
            Activity{warningCount > 0 ? ` · ${warningCount}` : ""}
          </button>
        </div>
      </header>
      {activeSurface === "help" ? (
        <section id="browser-agent-guidance" className="app-drawer help-drawer" data-floating-surface="help" role="dialog" aria-modal="false" aria-label="Browser agent guidance" aria-labelledby="browser-agent-guidance-heading">
          <div className="drawer-heading">
            <div>
              <p className="drawer-kicker">Agent guidance</p>
              <h2 id="browser-agent-guidance-heading">Browser agent guidance</h2>
            </div>
            <button type="button" aria-label="Close browser agent guidance" onClick={() => closeSurface("help")} autoFocus>Close</button>
          </div>
          <p>WebMCP can inspect the room, find a catalog fit, and apply one exact edit while you review each change.</p>
          <ol>
            <li>Inspect the room dimensions and placed items.</li>
            <li>Find a catalog item that fits the room.</li>
            <li>Apply one exact placement at the current revision.</li>
          </ol>
        </section>
      ) : null}
      {activeSurface === "geometry" ? (
        <div id="room-geometry-drawer">
          <RoomGeometryPanel
            initialRevision={revision}
            key={activeSurface}
            onClose={() => closeSurface("geometry")}
            openerRef={geometryButtonRef}
            room={room}
            store={store}
          />
        </div>
      ) : null}
      <div className={`workspace-grid${railCollapsed ? " is-rail-collapsed" : ""}`} id="room-workspace" tabIndex={-1}>
        <aside
          className={`workspace-catalog${railCollapsed ? " is-collapsed" : ""}`}
          aria-labelledby="catalog-heading"
        >
          <button
            type="button"
            className="rail-collapse-control"
            aria-label={railCollapsed ? "Expand room tools" : "Collapse room tools"}
            aria-expanded={!railCollapsed}
            onClick={() => setRailCollapsed((collapsed) => !collapsed)}
          >
            {railCollapsed ? "Expand tools" : "Collapse"}
          </button>
          <nav className="rail-navigation" aria-label="Room tools">
            <div className="rail-title">
              <span>Room tools</span>
              <small>{room.items.length} placed</small>
            </div>
            <div className="rail-tabs" role="tablist" aria-label="Room tools">
              {tabs.map((tab) => (
                <button
                  key={tab.id}
                  id={`${tab.id}-tab`}
                  type="button"
                  role="tab"
                  aria-label={tab.label}
                  aria-selected={railTab === tab.id}
                  aria-controls={`${tab.id}-panel`}
                  tabIndex={railTab === tab.id ? 0 : -1}
                  onClick={() => setRailTab(tab.id)}
                  onKeyDown={moveRailTab}
                >
                  {tab.label}
                  {tab.id === "placed" ? <span aria-hidden="true">{room.items.length}</span> : null}
                  {tab.id === "favorites" ? <span aria-hidden="true">{favoriteIds.size}</span> : null}
                </button>
              ))}
            </div>
          </nav>
          <div className="rail-panel-host">
            <div id="add-panel" role="tabpanel" aria-labelledby="add-tab" hidden={railTab !== "add"}>
              <CatalogPanel favoriteIds={favoriteIds} onToggleFavorite={toggleFavorite} offerResolver={offerResolver} store={store} />
            </div>
            <div id="placed-panel" role="tabpanel" aria-labelledby="placed-tab" hidden={railTab !== "placed"}>
              <PlacedPanel store={store} />
            </div>
            <div id="favorites-panel" role="tabpanel" aria-labelledby="favorites-tab" hidden={railTab !== "favorites"}>
              <FavoritesPanel favoriteIds={favoriteIds} onToggleFavorite={toggleFavorite} store={store} />
            </div>
          </div>
        </aside>
        <section
          className="workspace-room"
          aria-labelledby="current-room-heading"
        >
          <div className="workspace-room-header">
            <div className="workspace-room-heading">
              <p className="room-kicker">Room surface</p>
              <h2 id="current-room-heading">{room.name}</h2>
              <p className="room-revision">Revision {revision}</p>
              <p className="room-item-count">{room.items.length} placed item{room.items.length === 1 ? "" : "s"}</p>
            </div>
            <div className="workspace-room-actions">
              <span className="room-surface-hint">Room remains visible while tools scroll independently.</span>
              <button
                aria-controls="room-geometry-drawer"
                aria-expanded={activeSurface === "geometry"}
                aria-label="Room setup"
                className="header-action-button"
                onClick={() => openSurface("geometry")}
                ref={geometryButtonRef}
                type="button"
              >
                Room setup
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
                <Preview3D lightingPreviewStore={lightingPreviewStore} room={room} />
              </Suspense>
            </PreviewLoadBoundary>
          )}
        </section>
        <aside id="activity-drawer" className={`app-drawer activity-drawer${activeSurface === "activity" ? " is-open" : ""}`} data-floating-surface="activity" role="complementary" aria-label="Activity receipts" inert={activeSurface !== "activity" ? true : undefined}>
          <div className="drawer-heading">
            <h2 id="activity-drawer-heading">Warnings & activity</h2>
            {activeSurface === "activity" ? (
              <button type="button" aria-label="Close warnings and activity" onClick={() => closeSurface("activity")} autoFocus>Close</button>
            ) : null}
          </div>
          <RoomWarnings store={store} />
          <ReceiptPanel receipts={receipts} />
        </aside>
      </div>
      <WebMcpToolList
        definitions={webMcpToolDefinitions}
        registration={
          visibleRegistration.phase === "pending"
            ? { phase: "pending" }
            : { phase: "resolved", status: visibleRegistration.status }
        }
        statusText={registrationStatusText(visibleRegistration)}
      />
    </main>
  );
}
