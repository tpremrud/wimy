import { useLayoutEffect, useRef, useState, type ChangeEvent } from "react";
import { useStore } from "zustand";
import {
  MAX_WIMY_FILE_BYTES,
  type WimyRoomV1,
} from "../room/document";
import type { RoomStore } from "../room/store";
import {
  getTemplate,
  TEMPLATE_IDS,
  type TemplateId,
} from "../room/templates";
import { parseWimyFile, serializeWimyRoom } from "../room/wimy-file";

type FileAndTemplateControlsProps = {
  store: RoomStore;
};

type Feedback = {
  kind: "error" | "status";
  message: string;
  owner: RoomStore;
};

type StoreGeneration = {
  active: boolean;
  owner: RoomStore;
};

const MAX_VISIBLE_WARNINGS = 50;

const warningAnnouncement = (owner: RoomStore) => {
  const count = owner.getState().getLayoutWarnings().length;
  const countText = count.toLocaleString("en-US");
  return count === 0
    ? "Current room has 0 room warnings."
    : `Current room has ${countText} room warning${count === 1 ? "" : "s"}. Review the Room warnings region.`;
};

const exportFilename = (roomName: string) => {
  const withoutSuffix = roomName.replace(/(?:\.wimy)+$/giu, "");
  const base = withoutSuffix
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 64)
    .replace(/-+$/gu, "");
  return `${base || "wimy-room"}.wimy`;
};

export function FileAndTemplateControls({
  store,
}: FileAndTemplateControlsProps) {
  useStore(store, (state) => state.room);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [feedbackOwner, setFeedbackOwner] = useState(store);
  const importAttemptRef = useRef(0);
  const importRequestRef = useRef(0);
  const templateAttemptRef = useRef(0);
  const exportAttemptRef = useRef(0);
  const undoAttemptRef = useRef(0);
  const templateSelectRef = useRef<HTMLSelectElement>(null);
  const undoButtonRef = useRef<HTMLButtonElement>(null);
  const storeGenerationRef = useRef<StoreGeneration>({
    active: false,
    owner: store,
  });
  useLayoutEffect(() => {
    const generation: StoreGeneration = { active: true, owner: store };
    storeGenerationRef.current = generation;
    return () => {
      generation.active = false;
    };
  }, [store]);
  if (feedbackOwner !== store) {
    setFeedbackOwner(store);
    setFeedback(null);
  }
  const visibleFeedback =
    feedbackOwner === store && feedback?.owner === store ? feedback : null;
  const canUndo = store.getState().createUndoRequest() !== null;

  const importFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget;
    const file = input.files?.[0];
    if (!file) return;

    const owner = store;
    const expectedRevision = owner.getState().revision;
    const storeGeneration = storeGenerationRef.current;
    const attempt = importAttemptRef.current + 1;
    importAttemptRef.current = attempt;
    const requestId = importRequestRef.current + 1;
    importRequestRef.current = requestId;
    try {
      if (file.size > MAX_WIMY_FILE_BYTES) {
        setFeedback({
          kind: "error",
          message: `Import attempt ${attempt} rejected. FILE_TOO_LARGE: Wimy files must be at most ${MAX_WIMY_FILE_BYTES} bytes. Revision ${expectedRevision}.`,
          owner,
        });
        return;
      }

      const parsed = await parseWimyFile(file);
      if (
        !storeGeneration.active ||
        storeGeneration.owner !== owner ||
        storeGenerationRef.current !== storeGeneration ||
        importRequestRef.current !== requestId
      ) {
        return;
      }
      if (!parsed.ok) {
        setFeedback({
          kind: "error",
          message: `Import attempt ${attempt} rejected. ${parsed.code}${parsed.path ? ` at ${parsed.path}` : ""}: ${parsed.message}. Revision ${owner.getState().revision}.`,
          owner,
        });
        return;
      }

      const result = owner.getState().transact({
        expectedRevision,
        origin: "import",
        change: { type: "replace", room: parsed.room },
      });
      setFeedback({
        kind: result.ok ? "status" : "error",
        message: result.ok
          ? `Import attempt ${attempt} accepted. ${result.receipt.summary}. Revision ${result.revision}. ${warningAnnouncement(owner)}`
          : `Import attempt ${attempt} rejected. ${result.message}. Revision ${result.revision}.`,
        owner,
      });
    } finally {
      input.value = "";
    }
  };

  const loadTemplate = (event: ChangeEvent<HTMLSelectElement>) => {
    const templateId = event.currentTarget.value as TemplateId | "";
    if (templateId === "") return;

    const owner = store;
    const current = owner.getState();
    const attempt = templateAttemptRef.current + 1;
    templateAttemptRef.current = attempt;
    const result = current.transact({
      expectedRevision: current.revision,
      origin: "template",
      change: { type: "replace", room: getTemplate(templateId) },
    });
    setFeedback({
      kind: result.ok ? "status" : "error",
      message: result.ok
        ? `Template attempt ${attempt} accepted. ${result.receipt.summary}. Revision ${result.revision}. ${warningAnnouncement(owner)}`
        : `Template attempt ${attempt} rejected. ${result.message}. Revision ${result.revision}.`,
      owner,
    });
  };

  const exportRoom = () => {
    const owner = store;
    const current = owner.getState();
    const attempt = exportAttemptRef.current + 1;
    exportAttemptRef.current = attempt;
    const anchor = document.createElement("a");
    let objectUrl: string | undefined;
    try {
      const text = serializeWimyRoom(current.room as WimyRoomV1);
      const blob = new Blob([text], { type: "application/json" });
      objectUrl = URL.createObjectURL(blob);
      anchor.href = objectUrl;
      anchor.download = exportFilename(current.room.name);
      document.body.append(anchor);
      anchor.click();
      setFeedback({
        kind: "status",
        message: `Export attempt ${attempt} accepted. Downloaded ${anchor.download}. Revision ${current.revision}.`,
        owner,
      });
    } catch (error) {
      setFeedback({
        kind: "error",
        message: `Export attempt ${attempt} rejected. ${error instanceof Error ? error.message : "The room could not be exported"}. Revision ${current.revision}.`,
        owner,
      });
    } finally {
      anchor.remove();
      if (objectUrl !== undefined) {
        URL.revokeObjectURL(objectUrl);
      }
    }
  };

  const undoLastChange = () => {
    const owner = store;
    const current = owner.getState();
    const attempt = undoAttemptRef.current + 1;
    undoAttemptRef.current = attempt;
    const request = current.createUndoRequest();
    if (!request) {
      setFeedback({
        kind: "error",
        message: `Undo attempt ${attempt} rejected. No room change is available to undo. Revision ${current.revision}.`,
        owner,
      });
      return;
    }

    const restoreFocus = document.activeElement === undoButtonRef.current;
    const result = current.transact(request);
    if (result.ok && restoreFocus) {
      templateSelectRef.current?.focus();
    }
    setFeedback({
      kind: result.ok ? "status" : "error",
      message: result.ok
        ? `Undo attempt ${attempt} accepted. ${result.receipt.summary}. Revision ${result.revision}. ${warningAnnouncement(owner)}`
        : `Undo attempt ${attempt} rejected. ${result.message}. Revision ${result.revision}.`,
      owner,
    });
  };

  return (
    <section
      className="portable-controls"
      aria-labelledby="file-template-controls-heading"
    >
      <h2 id="file-template-controls-heading">Room files and templates</h2>
      <label>
        Load room template
        <select ref={templateSelectRef} value="" onChange={loadTemplate}>
          <option value="">Load template…</option>
          {TEMPLATE_IDS.map((templateId) => (
            <option key={templateId} value={templateId}>
              {getTemplate(templateId).name}
            </option>
          ))}
        </select>
      </label>
        <label>
          <span>Import Wimy File</span>
          <input
            aria-label="Import .wimy file"
            type="file"
            onChange={(event) => void importFile(event)}
          />
        </label>
      <button aria-label="Export .wimy" type="button" onClick={exportRoom}>
        Download Wimy File
      </button>
      <button
        ref={undoButtonRef}
        type="button"
        disabled={!canUndo}
        onClick={undoLastChange}
      >
        Undo last room change
      </button>
      <p
        role="status"
        aria-label="Portable room action status"
        aria-live="polite"
        aria-atomic="true"
      >
        {visibleFeedback?.kind === "status" ? visibleFeedback.message : ""}
      </p>
      <p
        role="alert"
        aria-label="Room file alert"
        aria-live="assertive"
        aria-atomic="true"
      >
        {visibleFeedback?.kind === "error" ? visibleFeedback.message : ""}
      </p>
    </section>
  );
}

export function RoomWarnings({ store }: FileAndTemplateControlsProps) {
  useStore(store, (state) => state.room);
  const warnings = store.getState().getLayoutWarnings();
  const visibleWarnings = warnings.slice(0, MAX_VISIBLE_WARNINGS);

  return (
    <section aria-labelledby="room-warnings-heading">
      <h2 id="room-warnings-heading">Room warnings</h2>
      {warnings.length === 0 ? (
        <p>No current room warnings.</p>
      ) : (
        <>
          <p>
            {warnings.length.toLocaleString("en-US")} current room warning
            {warnings.length === 1 ? "" : "s"}.
          </p>
          <ul>
            {visibleWarnings.map((warning, index) => (
              <li
                key={`${index}-${warning.code}-${warning.itemIds.join("-")}-${warning.message}`}
              >
                {warning.code === "CATALOG_UNAVAILABLE"
                  ? "Catalog unavailable; using embedded snapshot."
                  : warning.message}
              </li>
            ))}
          </ul>
          {warnings.length > MAX_VISIBLE_WARNINGS ? (
            <p>
              Showing the first {MAX_VISIBLE_WARNINGS} of{" "}
              {warnings.length.toLocaleString("en-US")} room warnings.
            </p>
          ) : null}
        </>
      )}
    </section>
  );
}
