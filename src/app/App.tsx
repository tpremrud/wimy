import { useStore } from "zustand";
import { roomStore, type RoomStore } from "../room/store";
import { ReceiptPanel } from "../ui/ReceiptPanel";

type AppProps = {
  store?: RoomStore;
};

export function App({ store = roomStore }: AppProps) {
  const { room, revision, receipts } = useStore(store);

  return (
    <main>
      <header>
        <h1>Wimy</h1>
        <p>Fit, find, and place furniture with your browser agent.</p>
      </header>
      <section aria-labelledby="current-room-heading">
        <h2 id="current-room-heading">{room.name}</h2>
        <p>Revision {revision}</p>
      </section>
      <ReceiptPanel receipts={receipts} />
    </main>
  );
}
