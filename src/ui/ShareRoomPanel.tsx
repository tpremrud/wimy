import { useEffect, useRef, useState } from "react";
import { FileAndTemplateControls } from "./FileAndTemplateControls";
import type { RoomStore } from "../room/store";

export function ShareRoomPanel({ store }: { store: RoomStore }) {
  const [open, setOpen] = useState(false);
  const shareButtonRef = useRef<HTMLButtonElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (open) closeButtonRef.current?.focus();
  }, [open]);

  const close = () => {
    setOpen(false);
    shareButtonRef.current?.focus();
  };

  return (
    <div className="share-region">
      <section
        id="share-room-panel"
        className={`share-panel${open ? " is-open" : ""}`}
        role={open ? "dialog" : "region"}
        aria-modal={open ? "false" : undefined}
        aria-labelledby="share-room-heading"
      >
        <div className="share-panel-heading">
          <div>
            <h2 id="share-room-heading">Share room</h2>
            <p>No account or network is required. Wimy Files stay on your device until you share them yourself.</p>
          </div>
          {open ? (
            <button ref={closeButtonRef} type="button" aria-label="Close share room" onClick={close}>
              Close
            </button>
          ) : null}
        </div>
        <FileAndTemplateControls store={store} />
      </section>
      <button
        ref={shareButtonRef}
        type="button"
        className="share-trigger"
        aria-expanded={open}
        aria-controls="share-room-panel"
        onClick={() => setOpen(true)}
      >
        Share room
      </button>
    </div>
  );
}
