import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  findFurniture,
  type CatalogMatch,
  type CatalogQuery,
} from "../room/catalog";
import { DEMO_CATALOG } from "../room/catalog-data";
import type { FurnitureSnapshot, WimyRoomV1 } from "../room/document";
import type { RoomStore } from "../room/store";

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

export function CatalogPanel({ store }: CatalogPanelProps) {
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
    findFurniture(room, query, DEMO_CATALOG);

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
        <p>Search the local fictional demo catalog for a geometric fit.</p>
      </div>
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
                <span>{`$${match.snapshot.commerce.price.amount} USD`}</span>
                <span>
                  {`Best fit: x ${match.suggestedPose.x} m, y ${match.suggestedPose.y} m, rotation ${match.suggestedPose.rotationDeg}°`}
                </span>
              </li>
            ))}
          </ol>
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
