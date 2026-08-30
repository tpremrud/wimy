import { useEffect, useState } from "react";
import { useStore } from "zustand";
import { roomStore, type RoomStore } from "../room/store";
import { ReceiptPanel } from "../ui/ReceiptPanel";
import { RoomEditor2D } from "../ui/RoomEditor2D";
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
        <RoomEditor2D store={store} />
      </section>
      <ReceiptPanel receipts={receipts} />
    </main>
  );
}
