import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  catalogItemKey,
  findFurniture,
  rankCatalogRelations,
  type CatalogMatch,
  type CatalogQuery,
} from "../room/catalog";
import { getCatalogPresentation } from "../room/catalog-presentation";
import type { FurnitureSnapshot, WimyRoomV1 } from "../room/document";
import type { RoomStore } from "../room/store";
import { LOCAL_CATALOG_TRANSACTION } from "../room/transaction";

const CATEGORIES: readonly FurnitureSnapshot["category"][] = [
  "bed",
  "desk",
  "chair",
  "sofa",
  "dresser",
  "rug",
  "table",
  "plant",
  "generic",
];

type CatalogPanelProps = {
  favoriteIds?: ReadonlySet<string>;
  onToggleFavorite?: (key: string) => void;
  store: RoomStore;
};

type SearchState = {
  announcement: string;
  attempt: number;
  owner: RoomStore;
  query: CatalogQuery;
  matches: CatalogMatch[];
};

type ActionState = {
  owner: RoomStore;
  message: string;
};

const optionalNumber = (value: string) =>
  value === "" ? undefined : Number(value);

const categoryLabel = (category: FurnitureSnapshot["category"]) =>
  `${category[0]?.toUpperCase() ?? ""}${category.slice(1)}`;

const presentationSummary = (productId: string) => {
  const presentation = getCatalogPresentation(productId);
  if (!presentation) return "Generic procedural fallback";

  return `${presentation.origin === "project-authored" ? "Project-authored" : "Catalog"} procedural geometry · ${presentation.license.spdxId}`;
};

const searchSummary = (
  attempt: number,
  matches: CatalogMatch[],
  phase: "complete" | "results refreshed" = "complete",
) => {
  const bestMatch = matches[0];
  if (!bestMatch) {
    return `Search ${attempt} ${phase}: no furniture matches these filters and fits the current room.`;
  }

  const matchLabel = matches.length === 1 ? "match" : "matches";
  const { x, y, rotationDeg } = bestMatch.suggestedPose;
  return `Search ${attempt} ${phase}: ${matches.length} ${matchLabel}. Best match: ${bestMatch.snapshot.name} at x ${x} m, y ${y} m, rotation ${rotationDeg}°.`;
};

export function CatalogPanel({
  favoriteIds = new Set<string>(),
  onToggleFavorite,
  store,
}: CatalogPanelProps) {
  const [category, setCategory] = useState("");
  const [styleTags, setStyleTags] = useState("");
  const [maxPrice, setMaxPrice] = useState("");
  const [maxWidth, setMaxWidth] = useState("");
  const [maxDepth, setMaxDepth] = useState("");
  const [searchState, setSearchState] = useState<SearchState | null>(null);
  const [actionState, setActionState] = useState<ActionState | null>(null);
  const searchButtonRef = useRef<HTMLButtonElement>(null);
  const visibleSearch = searchState?.owner === store ? searchState : null;
  const visibleAction = actionState?.owner === store ? actionState : null;
  const catalog = store.readCatalog();

  useEffect(
    () =>
      store.subscribe((current, previous) => {
        const receipt = current.receipts[0];
        if (
          receipt === previous.receipts[0] ||
          receipt?.status !== "accepted" ||
          receipt.changeType !== "replace"
        ) {
          return;
        }

        const activeElement = document.activeElement;
        const restoreSearchFocus =
          activeElement instanceof Element &&
          activeElement.closest(".catalog-results, .catalog-panel > button") !==
            null;
        setSearchState(null);
        setActionState(null);
        if (restoreSearchFocus) {
          searchButtonRef.current?.focus();
        }
      }),
    [store],
  );

  const currentQuery = (): CatalogQuery => ({
    category:
      category === ""
        ? undefined
        : (category as FurnitureSnapshot["category"]),
    styleTags: styleTags
      .split(",")
      .map((styleTag) => styleTag.trim())
      .filter((styleTag) => styleTag.length > 0),
    maxPrice: optionalNumber(maxPrice),
    maxWidth: optionalNumber(maxWidth),
    maxDepth: optionalNumber(maxDepth),
  });

  const matchesFor = (room: WimyRoomV1, query: CatalogQuery) =>
    findFurniture(room, query, store.readCatalog());

  const search = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const query = currentQuery();
    const current = store.getState();
    const matches = matchesFor(current.room as WimyRoomV1, query);
    const attempt = (visibleSearch?.attempt ?? 0) + 1;
    setSearchState({
      announcement: searchSummary(attempt, matches),
      attempt,
      owner: store,
      query,
      matches,
    });
    setActionState(null);
  };

  const addBestFit = () => {
    if (!visibleSearch) return;

    const current = store.getState();
    const latestMatches = matchesFor(
      current.room as WimyRoomV1,
      visibleSearch.query,
    );
    setSearchState({
      announcement: searchSummary(
        visibleSearch.attempt,
        latestMatches,
        "results refreshed",
      ),
      attempt: visibleSearch.attempt,
      owner: store,
      query: visibleSearch.query,
      matches: latestMatches,
    });
    const bestMatch = latestMatches[0];
    if (!bestMatch) {
      setActionState({
        owner: store,
        message:
          "No furniture matches these filters and fits the current room.",
      });
      searchButtonRef.current?.focus();
      return;
    }

    const result = current.transact({
      [LOCAL_CATALOG_TRANSACTION]: true,
      expectedRevision: current.revision,
      origin: "human",
      change: {
        type: "edit",
        operations: [
          {
            type: "add",
            productId: bestMatch.catalogRef.productId,
            pose: bestMatch.suggestedPose,
          },
        ],
      },
    });

    setActionState({
      owner: store,
      message: result.ok
        ? `Accepted: ${result.receipt.summary}. Revision ${result.revision}.`
        : `Rejected: ${result.message}. Revision ${result.revision}.`,
    });
    if (result.ok) {
      const latest = store.getState();
      const refreshedMatches = matchesFor(
        latest.room as WimyRoomV1,
        visibleSearch.query,
      );
      setSearchState({
        announcement: searchSummary(
          visibleSearch.attempt,
          refreshedMatches,
          "results refreshed",
        ),
        attempt: visibleSearch.attempt,
        owner: store,
        query: visibleSearch.query,
        matches: refreshedMatches,
      });
      if (refreshedMatches.length === 0) {
        searchButtonRef.current?.focus();
      }
    }
  };

  return (
    <section className="catalog-panel" aria-labelledby="catalog-heading">
      <div className="catalog-panel-heading">
        <h2 id="catalog-heading">Furniture catalog</h2>
        <p>Find a local catalog item that fits the current room.</p>
      </div>
      <section className="catalog-browse" aria-labelledby="catalog-browse-heading">
        <div className="catalog-subheading">
          <h3 id="catalog-browse-heading">Browse the catalog</h3>
          <span>{catalog.length} local choices</span>
        </div>
        <ul className="catalog-browse-list" aria-label="Available catalog items">
          {catalog.map((item) => {
            const key = catalogItemKey(item.catalogRef);
            const favorite = favoriteIds.has(key);
            return (
              <li key={key}>
                <span>
                  <strong>{item.snapshot.name}</strong>
                  <small>{item.snapshot.category} · {item.snapshot.dimensions.width} × {item.snapshot.dimensions.depth} m</small>
                  <small>{presentationSummary(item.catalogRef.productId)}</small>
                </span>
                {onToggleFavorite ? (
                  <button
                    type="button"
                    className="favorite-toggle"
                    aria-pressed={favorite}
                    aria-label={`${favorite ? "Remove" : "Add"} ${item.snapshot.name} ${favorite ? "from" : "to"} favorites`}
                    onClick={() => onToggleFavorite(key)}
                  >
                    {favorite ? "Saved" : "Save"}
                  </button>
                ) : null}
              </li>
            );
          })}
        </ul>
      </section>
      <form className="catalog-filters" onSubmit={search}>
        <label>
          Category
          <select
            value={category}
            onChange={(event) => setCategory(event.target.value)}
          >
            <option value="">Any category</option>
            {CATEGORIES.map((option) => (
              <option key={option} value={option}>
                {categoryLabel(option)}
              </option>
            ))}
          </select>
        </label>
        <label>
          Style tags
          <input
            type="text"
            value={styleTags}
            placeholder="warm-modern, compact"
            onChange={(event) => setStyleTags(event.target.value)}
          />
        </label>
        <label>
          Maximum price (USD)
          <input
            type="number"
            min="0"
            step="0.01"
            value={maxPrice}
            onChange={(event) => setMaxPrice(event.target.value)}
          />
        </label>
        <label>
          Maximum width (m)
          <input
            type="number"
            min="0"
            step="0.001"
            value={maxWidth}
            onChange={(event) => setMaxWidth(event.target.value)}
          />
        </label>
        <label>
          Maximum depth (m)
          <input
            type="number"
            min="0"
            step="0.001"
            value={maxDepth}
            onChange={(event) => setMaxDepth(event.target.value)}
          />
        </label>
        <button ref={searchButtonRef} type="submit">
          Search catalog
        </button>
      </form>

      <p
        className="catalog-search-summary"
        role="status"
        aria-label="Catalog search result"
        aria-live="polite"
        aria-atomic="true"
      >
        {visibleSearch?.announcement ?? ""}
      </p>
      {visibleSearch && visibleSearch.matches.length > 0 ? (
        <>
          <ol className="catalog-results" aria-label="Catalog results">
            {visibleSearch.matches.map((match) => (
              <li key={match.catalogRef.productId}>
                <strong>{match.snapshot.name}</strong>
                <span>
                  {`${match.snapshot.category} · ${match.snapshot.dimensions.width} × ${match.snapshot.dimensions.depth} m`}
                </span>
                <span>{`Styles: ${match.snapshot.styleTags.join(", ")}`}</span>
                <span>{presentationSummary(match.catalogRef.productId)}</span>
                <span>{`$${match.snapshot.commerce.price.amount} USD`}</span>
                <span>
                  {`Best fit: x ${match.suggestedPose.x} m, y ${match.suggestedPose.y} m, rotation ${match.suggestedPose.rotationDeg}°`}
                </span>
                {onToggleFavorite ? (
                  <button
                    type="button"
                    className="favorite-toggle"
                    aria-pressed={favoriteIds.has(catalogItemKey(match.catalogRef))}
                    aria-label={`${favoriteIds.has(catalogItemKey(match.catalogRef)) ? "Remove" : "Add"} ${match.snapshot.name} ${favoriteIds.has(catalogItemKey(match.catalogRef)) ? "from" : "to"} favorites`}
                    onClick={() => onToggleFavorite(catalogItemKey(match.catalogRef))}
                  >
                    {favoriteIds.has(catalogItemKey(match.catalogRef)) ? "Saved" : "Save"}
                  </button>
                ) : null}
              </li>
            ))}
          </ol>
          {(() => {
            const source = visibleSearch.matches[0];
            if (!source) return null;
            const similar = rankCatalogRelations(source, catalog, "similar");
            const companions = rankCatalogRelations(source, catalog, "goes-well-with");
            return (
              <section className="catalog-relations" aria-label="Similar and goes well with">
                <div>
                  <h3>Similar</h3>
                  <p>{similar.map(({ snapshot }) => snapshot.name).join(" · ") || "No local matches yet."}</p>
                </div>
                <div>
                  <h3>Goes well with</h3>
                  <p>{companions.map(({ snapshot }) => snapshot.name).join(" · ") || "No local pairings yet."}</p>
                </div>
              </section>
            );
          })()}
          <button type="button" onClick={addBestFit}>
            Add best fit
          </button>
        </>
      ) : null}
      {visibleAction ? (
        <p role="status" aria-label="Catalog add result" aria-atomic="true">
          {visibleAction.message}
        </p>
      ) : null}
    </section>
  );
}
