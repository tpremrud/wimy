import { useState, type FormEvent, type RefObject } from "react";
import type { Opening, WimyRoomV1 } from "../room/document";
import type { RoomStore } from "../room/store";
import { findFirstAvailableOpening } from "../room/geometry";

type RoomGeometryPanelProps = Readonly<{
  initialRevision: number;
  onClose: () => void;
  openerRef: RefObject<HTMLButtonElement | null>;
  room: RoomStore["getState"] extends () => infer State
    ? State extends { room: infer Room }
      ? Room
      : never
    : never;
  store: RoomStore;
}>;

const nextOpeningId = (room: Readonly<WimyRoomV1>) => {
  const used = new Set([
    ...room.openings.map(({ id }) => id),
    ...room.items.map(({ id }) => id),
  ]);
  let sequence = 1;
  while (used.has(`opening_added_${sequence}`)) sequence += 1;
  return `opening_added_${sequence}`;
};

const displayNumber = (value: number) => Number.isNaN(value) ? "" : value;

export function RoomGeometryPanel({ initialRevision, onClose, openerRef, room, store }: RoomGeometryPanelProps) {
  const [draft, setDraft] = useState<WimyRoomV1>(
    () => structuredClone(room) as WimyRoomV1,
  );
  const [status, setStatus] = useState<string | null>(null);
  const [baseRevision, setBaseRevision] = useState(initialRevision);

  const updateOpening = (index: number, change: Partial<Opening>) => {
    setDraft((current) => {
      const openings = current.openings.map((opening, candidateIndex) =>
        candidateIndex === index ? { ...opening, ...change } : opening,
      );
      return { ...current, openings };
    });
  };

  const addOpening = (kind: Opening["kind"]) => {
    const opening = findFirstAvailableOpening(
      draft,
      kind,
      nextOpeningId(draft),
    );
    if (!opening) {
      setStatus(`No clear wall span is available for another ${kind}.`);
      return;
    }
    setStatus(null);
    setDraft({ ...draft, openings: [...draft.openings, opening] });
  };

  const applySetup = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const result = store.getState().transact({
      expectedRevision: baseRevision,
      origin: "human",
      change: { type: "replace", room: draft },
    });
    if (result.ok) setBaseRevision(result.revision);
    setStatus(result.ok ? `Room setup applied at revision ${result.revision}.` : result.message);
  };

  const lShapeGeometry = draft.geometry?.shape === "l-shape"
    ? draft.geometry
    : null;

  return (
    <section
      aria-labelledby="room-geometry-heading"
      aria-modal="false"
      className="app-drawer room-geometry-drawer"
      data-floating-surface="geometry"
      role="dialog"
    >
      <div className="drawer-heading">
        <div>
          <p className="drawer-kicker">One room</p>
          <h2 id="room-geometry-heading">Room setup</h2>
        </div>
        <button
          autoFocus
          aria-label="Close room setup"
          onClick={() => {
            onClose();
            openerRef.current?.focus();
          }}
          type="button"
        >
          Close
        </button>
      </div>
      <form className="room-geometry-form" onSubmit={applySetup}>
        <fieldset>
          <legend>Dimensions</legend>
          <div className="room-geometry-grid">
            {(["width", "depth", "height"] as const).map((dimension) => (
              <label key={dimension}>
                {`Room ${dimension}`}
                <input
                  aria-label={`Room ${dimension}`}
                  max={dimension === "height" ? 10 : 30}
                  min={dimension === "height" ? 2 : 1}
                  onChange={(event) => {
                    const value = event.currentTarget.valueAsNumber;
                    setDraft((current) => ({
                      ...current,
                      dimensions: { ...current.dimensions, [dimension]: value },
                    }));
                  }}
                  step="0.1"
                  type="number"
                  value={displayNumber(draft.dimensions[dimension])}
                />
              </label>
            ))}
          </div>
          <label>
            Room shape
            <select
              aria-label="Room shape"
              onChange={(event) => {
                const shape = event.currentTarget.value;
                setDraft((current) => ({
                  ...current,
                  geometry: shape === "l-shape"
                    ? { shape: "l-shape", notch: { corner: "south-east", width: 1, depth: 1 } }
                    : { shape: "rectangle" },
                }));
              }}
              value={draft.geometry?.shape ?? "rectangle"}
            >
              <option value="rectangle">Rectangle</option>
              <option value="l-shape">L shape — southeast notch</option>
            </select>
          </label>
          {lShapeGeometry ? (
            <div className="room-geometry-grid">
              {(["width", "depth"] as const).map((dimension) => (
                <label key={dimension}>
                  {`Notch ${dimension}`}
                  <input
                    aria-label={`Notch ${dimension}`}
                    min="0.1"
                    onChange={(event) => {
                      const value = event.currentTarget.valueAsNumber;
                      setDraft((current) => current.geometry?.shape === "l-shape"
                        ? {
                            ...current,
                            geometry: {
                              ...current.geometry,
                              notch: { ...current.geometry.notch, [dimension]: value },
                            },
                          }
                        : current);
                    }}
                    step="0.1"
                    type="number"
                    value={displayNumber(lShapeGeometry.notch[dimension])}
                  />
                </label>
              ))}
            </div>
          ) : null}
        </fieldset>
        <fieldset>
          <legend>Doors and windows</legend>
          <div className="opening-add-actions">
            <button onClick={() => addOpening("door")} type="button">Add door</button>
            <button onClick={() => addOpening("window")} type="button">Add window</button>
          </div>
          <div className="opening-editor-list">
            {draft.openings.length === 0 ? <p>No openings yet.</p> : null}
            {draft.openings.map((opening, index) => (
              <fieldset className="opening-editor" key={opening.id}>
                <legend>{`${opening.kind} ${index + 1}`}</legend>
                <div className="room-geometry-grid">
                  <label>
                    Type
                    <select
                      aria-label={`Opening ${index + 1} type`}
                      onChange={(event) => {
                        const kind = event.currentTarget.value as Opening["kind"];
                        updateOpening(index, {
                          kind,
                          ...(kind === "door" ? { bottom: 0 } : {}),
                        });
                      }}
                      value={opening.kind}
                    >
                      <option value="door">Door</option>
                      <option value="window">Window</option>
                    </select>
                  </label>
                  <label>
                    Wall
                    <select
                      aria-label={`Opening ${index + 1} wall`}
                      onChange={(event) => updateOpening(index, {
                        wall: event.currentTarget.value as Opening["wall"],
                      })}
                      value={opening.wall}
                    >
                      <option value="north">North</option>
                      <option value="east">East</option>
                      <option value="south">South</option>
                      <option value="west">West</option>
                    </select>
                  </label>
                  {(["centerOffset", "width", "bottom", "height"] as const).map((field) => (
                    <label key={field}>
                      {field === "centerOffset" ? "Position from wall start" : field}
                      <input
                        aria-label={`Opening ${index + 1} ${field}`}
                        disabled={field === "bottom" && opening.kind === "door"}
                        min={field === "bottom" ? 0 : 0.1}
                        onChange={(event) => updateOpening(index, {
                          [field]: event.currentTarget.valueAsNumber,
                        })}
                        step="0.1"
                        type="number"
                        value={displayNumber(opening[field])}
                      />
                    </label>
                  ))}
                </div>
                <button
                  aria-label={`Remove opening ${index + 1}`}
                  onClick={() => setDraft((current) => ({
                    ...current,
                    openings: current.openings.filter((_, candidateIndex) => candidateIndex !== index),
                  }))}
                  type="button"
                >
                  Remove
                </button>
              </fieldset>
            ))}
          </div>
        </fieldset>
        <button className="room-geometry-apply" type="submit">Apply room setup</button>
        {status ? <p aria-live="polite" role="status">{status}</p> : null}
      </form>
    </section>
  );
}
