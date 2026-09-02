import { useStore } from "zustand";
import { useState } from "react";
import {
  catalogItemKey,
  type CatalogItem,
} from "../room/catalog";
import { rankPlacedItemSubstitutes, type SubstituteSuggestion } from "../room/substitutes";
import type { EntityId, RotationDeg, WimyRoomV1 } from "../room/document";
import { projectFurnitureOrientation } from "../room/orientation";
import { findNearestLegalRotationPose } from "../room/placement";
import type { RoomStore } from "../room/store";
import { CatalogItemPreview } from "./CatalogItemPreview";

type PlacedPanelProps = {
  store: RoomStore;
};

export function PlacedPanel({ store }: PlacedPanelProps) {
  const room = useStore(store, (state) => state.room);
  const [substituteState, setSubstituteState] = useState<{
    owner: RoomStore;
    itemId: EntityId;
    suggestions: SubstituteSuggestion[];
    message?: string;
  } | null>(null);

  const findSubstitutes = (item: (typeof room.items)[number]) => {
    const suggestions = rankPlacedItemSubstitutes(
      structuredClone(store.getState().room) as WimyRoomV1,
      store.readCatalog(),
      item.id,
    );
    setSubstituteState({ owner: store, itemId: item.id, suggestions });
  };

  const replaceWithSubstitute = (
    item: (typeof room.items)[number],
    suggestion: SubstituteSuggestion,
  ) => {
    const current = store.getState();
    const currentItem = current.room.items.find(({ id }) => id === item.id);
    if (!currentItem) return;
    const result = current.transact({
      expectedRevision: current.revision,
      origin: "human",
      change: {
        type: "edit",
        operations: [
          {
            type: "replace",
            itemId: item.id,
            productId: suggestion.catalogRef.productId,
            ...(currentItem.catalogRef
              ? { sourceCatalogRef: structuredClone(currentItem.catalogRef) }
              : {}),
            confirmedByHuman: true,
          },
        ],
      },
    });
    setSubstituteState({
      owner: store,
      itemId: item.id,
      suggestions: result.ok ? [] : [suggestion],
      message: result.ok
        ? `Accepted: ${result.receipt.summary}. Revision ${result.revision}.`
        : `Rejected: ${result.message}. Revision ${result.revision}.`,
    });
  };

  const rotate = (itemId: EntityId) => {
    const current = store.getState();
    const item = current.room.items.find(({ id }) => id === itemId);
    if (!item) return;
    const rotationDeg = ((item.pose.rotationDeg + 90) % 360) as RotationDeg;
    const pose =
      findNearestLegalRotationPose(current.room, item, rotationDeg) ?? {
        ...item.pose,
        rotationDeg,
      };
    current.transact({
      expectedRevision: current.revision,
      origin: "human",
      change: {
        type: "edit",
        operations: [{ type: "transform", itemId, pose }],
      },
    });
  };

  const remove = (itemId: EntityId) => {
    const current = store.getState();
    if (!current.room.items.some(({ id }) => id === itemId)) return;
    current.transact({
      expectedRevision: current.revision,
      origin: "human",
      change: {
        type: "edit",
        operations: [{ type: "remove", itemId }],
      },
    });
  };

  return (
    <section className="rail-panel" aria-labelledby="placed-heading">
      <div className="rail-panel-heading">
        <h2 id="placed-heading">Placed items</h2>
        <span>{room.items.length} in this room</span>
      </div>
      {room.items.length === 0 ? (
        <p className="empty-state">Nothing placed yet. Add a fit to start shaping the room.</p>
      ) : (
        <ul className="placed-list" aria-label="Placed items">
          {room.items.map((item) => (
          <li key={item.id} data-placed-item-id={item.id}>
              <div className="placed-item-copy">
                <strong>{item.snapshot.name}</strong>
                <small>
                  {item.snapshot.category} · x {item.pose.x} m · y {item.pose.y} m
                </small>
                <small>
                  {projectFurnitureOrientation(
                    item.snapshot.category,
                    item.pose.rotationDeg,
                    item.snapshot.dimensions,
                  ).label}{" "}({item.pose.rotationDeg}°)
                </small>
              </div>
              <div className="placed-item-actions">
                <button
                  type="button"
                  aria-label={`Rotate ${item.snapshot.name}`}
                  onClick={() => rotate(item.id)}
                >
                  Rotate
                </button>
                <button
                  type="button"
                  aria-label={`Remove ${item.snapshot.name}`}
                  onClick={() => remove(item.id)}
                >
                  Remove
                </button>
                <button
                  type="button"
                  aria-label={`Find substitutes for ${item.snapshot.name}`}
                  onClick={() => findSubstitutes(item)}
                >
                  Find substitutes
                </button>
              </div>
              {substituteState?.owner === store && substituteState.itemId === item.id ? (
                <section className="placed-item-substitutes" aria-label={`Substitutes for ${item.snapshot.name}`}>
                  <h3>Comparable substitutes</h3>
                  <p className="panel-note">
                    Read-only local ranking. Fit was checked at this item's current Pose; replacing it always requires this explicit human action.
                  </p>
                  {substituteState.message ? <p role="status">{substituteState.message}</p> : null}
                  {substituteState.suggestions.length === 0 && !substituteState.message ? (
                    <p role="status">No comparable catalog substitute fits this placement.</p>
                  ) : null}
                  {substituteState.suggestions.length > 0 ? (
                    <ol aria-label={`Comparable substitutes for ${item.snapshot.name}`}>
                      {substituteState.suggestions.map((suggestion) => (
                        <li className="substitute-card" key={catalogItemKey(suggestion.catalogRef)}>
                          <CatalogItemPreview snapshot={suggestion.snapshot} />
                          <div className="substitute-card-copy">
                            <strong>{suggestion.snapshot.name}</strong>
                            <small>
                              {suggestion.snapshot.dimensions.width} × {suggestion.snapshot.dimensions.depth} m · {suggestion.snapshot.material ?? "Material not recorded"}
                            </small>
                            <span className="substitute-fit">Fits at the current position</span>
                            <details>
                              <summary>Why this match</summary>
                              <p>{suggestion.rationale}</p>
                              <p>{suggestion.tradeoffs.join(" ")}</p>
                            </details>
                          </div>
                          <button
                            type="button"
                            aria-label={`Replace ${item.snapshot.name} with ${suggestion.snapshot.name}`}
                            onClick={() => replaceWithSubstitute(item, suggestion)}
                          >
                            Replace with {suggestion.snapshot.name}
                          </button>
                        </li>
                      ))}
                    </ol>
                  ) : null}
                </section>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      <p className="panel-note">The list mirrors the canonical Room Document.</p>
    </section>
  );
}

type FavoritesPanelProps = {
  favoriteIds: ReadonlySet<string>;
  onToggleFavorite: (key: string) => void;
  store: RoomStore;
};

export function FavoritesPanel({
  favoriteIds,
  onToggleFavorite,
  store,
}: FavoritesPanelProps) {
  const catalog = store.readCatalog();
  const favorites = catalog.filter((item) =>
    favoriteIds.has(catalogItemKey(item.catalogRef)),
  );

  return (
    <section className="rail-panel" aria-labelledby="favorites-heading">
      <div className="rail-panel-heading">
        <h2 id="favorites-heading">Favorites</h2>
        <span>{favorites.length} saved</span>
      </div>
      <p className="panel-note">
        Saved for this browser session only. Favorites never enter a Wimy File or Activity Receipt.
      </p>
      {favorites.length === 0 ? (
        <p className="empty-state">Save catalog items while browsing Add. They’ll stay here for this session.</p>
      ) : (
        <ul className="favorite-list" aria-label="Favorite catalog items">
          {favorites.map((item) => (
            <FavoriteItem
              key={catalogItemKey(item.catalogRef)}
              item={item}
              onRemove={() => onToggleFavorite(catalogItemKey(item.catalogRef))}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function FavoriteItem({
  item,
  onRemove,
}: {
  item: CatalogItem;
  onRemove: () => void;
}) {
  return (
    <li>
      <div>
        <strong>{item.snapshot.name}</strong>
        <small>{item.snapshot.category} · {item.snapshot.commerce ? `$${item.snapshot.commerce.price.amount} ${item.snapshot.commerce.price.currency}` : "No price snapshot"}</small>
      </div>
      <button type="button" aria-label={`Remove ${item.snapshot.name} from favorites`} onClick={onRemove}>
        Remove
      </button>
    </li>
  );
}
