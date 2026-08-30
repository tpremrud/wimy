import { useEffect, useState } from "react";
import { useStore } from "zustand";
import type { EntityId } from "../room/document";
import { roomStore, type RoomStore } from "../room/store";
import { ReceiptPanel } from "../ui/ReceiptPanel";
import {
  registerRoomTools,
  type WebMcpRegistrationStatus,
} from "../webmcp/room-tools";

type AppProps = {
  store?: RoomStore;
};

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

export function App({ store = roomStore }: AppProps) {
  const { room, revision, receipts } = useStore(store);
  const [humanActionResult, setHumanActionResult] = useState<{
    attempt: number;
    owner: RoomStore;
    text: string;
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

  useEffect(() => {
    const controller = new AbortController();

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

    return () => controller.abort();
  }, [store]);

  const nudgeItemRight = (itemId: EntityId) => {
    const current = store.getState();
    const item = current.room.items.find(({ id }) => id === itemId);
    if (!item) return;

    const result = current.transact({
      expectedRevision: current.revision,
      origin: "human",
      change: {
        type: "edit",
        operations: [
          {
            type: "transform",
            itemId,
            pose: { x: Math.round((item.pose.x + 0.1) * 1_000) / 1_000 },
          },
        ],
      },
    });
    const status = result.ok ? "accepted" : "rejected";
    const summary = result.ok ? result.receipt.summary : result.message;
    setHumanActionResult((previous) => {
      const attempt = previous?.owner === store ? previous.attempt + 1 : 1;
      return {
        attempt,
        owner: store,
        text: `Human edit attempt ${attempt} ${status}. ${summary}. Revision ${result.revision}.`,
      };
    });
  };

  return (
    <main>
      <header>
        <h1>Wimy</h1>
        <p>Fit, find, and place furniture with your browser agent.</p>
        <p role="status" aria-live="polite">
          {registrationStatusText(visibleRegistration)}
        </p>
      </header>
      <section aria-labelledby="current-room-heading">
        <h2 id="current-room-heading">{room.name}</h2>
        <p>Revision {revision}</p>
        <p
          aria-label="Human edit result"
          aria-live="polite"
          aria-atomic="true"
        >
          {humanActionResult?.owner === store ? humanActionResult.text : ""}
        </p>
        <h3>Placed items</h3>
        <ul aria-label="Placed items">
          {room.items.map((item) => (
            <li key={item.id}>
              <strong>{item.snapshot.name}</strong>
              <span>{item.id}</span>
              <span>
                x {item.pose.x} m, y {item.pose.y} m, rotation{" "}
                {item.pose.rotationDeg}°
              </span>
              <button
                type="button"
                aria-label={`Nudge ${item.id} right 0.1 meters`}
                onClick={() => nudgeItemRight(item.id)}
              >
                Nudge right 0.1 m
              </button>
            </li>
          ))}
        </ul>
      </section>
      <ReceiptPanel receipts={receipts} />
    </main>
  );
}
