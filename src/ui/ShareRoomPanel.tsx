import type { RefObject } from "react";
import { FileAndTemplateControls } from "./FileAndTemplateControls";
import type { RoomStore } from "../room/store";

type ShareRoomPanelProps = {
  open: boolean;
  onClose: () => void;
  onOpen: () => void;
  openerRef: RefObject<HTMLButtonElement | null>;
  store: RoomStore;
};

export function ShareRoomPanel({
  open,
  onClose,
  onOpen,
  openerRef,
  store,
}: ShareRoomPanelProps) {

  return (
    <div className="share-region">
      <button
        ref={openerRef}
        type="button"
        className="share-trigger"
        aria-expanded={open}
        aria-controls="share-room-panel"
        onClick={onOpen}
      >
        Share room
      </button>
      {open ? (
        <section
          id="share-room-panel"
          className="share-panel is-open"
          role="dialog"
          aria-modal="false"
          aria-labelledby="share-room-heading"
        >
          <div className="share-panel-heading">
            <div>
              <p className="drawer-kicker">Portable room file</p>
              <h2 id="share-room-heading">Share room</h2>
              <p>No account or network is required. Wimy Files stay on your device until you share them yourself.</p>
            </div>
            <button type="button" aria-label="Close share room" onClick={onClose} autoFocus>
              Close
            </button>
          </div>
          <FileAndTemplateControls store={store} />
        </section>
      ) : null}
    </div>
  );
}
