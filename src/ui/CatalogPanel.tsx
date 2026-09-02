import { useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { useStore } from "zustand";
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
import { parseWimyCatalogFile } from "../catalog/package-file";
import type { CatalogItem } from "../room/catalog";
import {
  getRetailerOfferEvidenceState,
  type RetailerOffer,
  type RetailerOfferResolution,
  type RetailerOfferResolver,
} from "../commerce/retailer-offer-adapter";
import { createSyntheticRetailerOfferResolver } from "../commerce/synthetic-retailer-offers";
import {
  createRoomShoppingPlan,
  type RoomShoppingPlan,
  type ShoppingPlanExclusionReason,
} from "../commerce/shopping-plan";

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
  offerResolver?: RetailerOfferResolver;
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

type ImportState = {
  owner: RoomStore;
  message: string;
};

type OfferState = {
  owner: RoomStore;
  catalogKey: string;
  itemName: string;
  phase: "loading" | RetailerOfferResolution["status"];
  offers: readonly RetailerOffer[];
};

type ShoppingPlanState = {
  owner: RoomStore;
  revision: number;
  phase: "loading" | "ready" | "error";
  plan?: RoomShoppingPlan;
};

const optionalNumber = (value: string) =>
  value === "" ? undefined : Number(value);

const categoryLabel = (category: FurnitureSnapshot["category"]) =>
  `${category[0]?.toUpperCase() ?? ""}${category.slice(1)}`;

const presentationSummary = (productId: string, item?: CatalogItem) => {
  const metadata = item?.metadata;
  if (metadata?.origin === "fictional") {
    return `Fictional demo catalog · ${metadata.license.spdxId ?? metadata.license.name}`;
  }
  if (metadata?.origin === "project-authored") {
    return `Project-authored catalog · ${metadata.license.spdxId ?? metadata.license.name}`;
  }
  const presentation = getCatalogPresentation(productId);
  if (!presentation) return "Generic procedural fallback";

  return `${presentation.origin === "project-authored" ? "Project-authored" : "Catalog"} procedural geometry · ${presentation.license.spdxId}`;
};

const presentationLicense = (productId: string, item?: CatalogItem) =>
  item?.metadata?.license.spdxId ??
  getCatalogPresentation(productId)?.license.spdxId ??
  "Procedural";

const priceSummary = (item: CatalogItem) =>
  item.snapshot.commerce
    ? `$${item.snapshot.commerce.price.amount} ${item.snapshot.commerce.price.currency}`
    : "No price snapshot";

const offerStateLabel = (offer: RetailerOffer) => {
  switch (getRetailerOfferEvidenceState(offer)) {
    case "exact":
      return "Exact product";
    case "ambiguous":
      return "Unverified candidate · ambiguous mapping";
    case "substitute":
      return "Substitute · unverified mapping";
    case "stale":
      return "Stale evidence";
    case "unavailable":
      return "Unavailable";
  }
};

const availabilityLabel = (availability: RetailerOffer["availability"]) => {
  switch (availability) {
    case "in_stock":
      return "In stock";
    case "out_of_stock":
      return "Out of stock";
    case "unknown":
      return "Availability unknown";
  }
};

const offerPrice = (offer: RetailerOffer) =>
  `${offer.price.currency} ${(offer.price.amountMinor / 100).toFixed(2)}`;

const normalizedOfferPrice = (offer: RetailerOffer & { normalizedAmountMinor?: number; normalizedUnitCount?: number }) =>
  `${offer.price.currency} ${((offer.normalizedAmountMinor ?? offer.price.amountMinor) / 100).toFixed(2)}${(offer.normalizedUnitCount ?? 1) > 1 ? " / unit" : ""}`;

const exclusionLabel = (reason: ShoppingPlanExclusionReason) => {
  switch (reason) {
    case "ambiguous_identity":
      return "ambiguous identity";
    case "substitute_identity":
      return "substitute identity";
    case "stale":
      return "stale evidence";
    case "unavailable":
      return "unavailable offer";
    case "unverified":
      return "unverified offer";
    case "different_catalog_ref":
      return "different catalog variant";
    case "invalid_price_basis":
      return "invalid price basis";
    case "non_inert_handoff":
      return "non-inert handoff URL";
  }
};

function OfferEvidencePanel({ state }: { state: OfferState }) {
  if (state.phase === "loading") {
    return (
      <section className="offer-evidence" aria-label={`Offer evidence for ${state.itemName}`}>
        <p role="status" aria-label="Offer evidence status">Loading synthetic offer evidence…</p>
      </section>
    );
  }

  return (
    <section className="offer-evidence" aria-label={`Offer evidence for ${state.itemName}`}>
      <div className="offer-evidence-heading">
        <h4>Offer evidence</h4>
        <span>{state.offers.length} synthetic offer{state.offers.length === 1 ? "" : "s"}</span>
      </div>
      {state.phase !== "ok" ? (
        <p role="status" aria-label="Offer evidence status">
          No offer evidence is available ({state.phase.replaceAll("_", " ")}).
        </p>
      ) : (
        <ul className="offer-evidence-list" aria-label="Retailer offer evidence">
          {state.offers.map((offer) => {
            const identityEvidence = offer.identityEvidence;
            return (
              <li key={offer.offerId} data-offer-state={getRetailerOfferEvidenceState(offer)}>
                <strong>{offer.provenance.sourceName}</strong>
                <span>{offerStateLabel(offer)}</span>
                <span>{offerPrice(offer)} · {availabilityLabel(offer.availability)}</span>
                <span>
                  Product URL: <code>{offer.productUrl}</code>
                </span>
                <span>Observed {offer.observedAt} · Expires {offer.expiresAt}</span>
                <span>
                  Identity confidence: {identityEvidence.confidence ?? "not provided"} · {identityEvidence.method}
                </span>
                {identityEvidence.evidence?.map((evidence) => (
                  <span key={evidence}>Evidence: {evidence}</span>
                ))}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function RoomShoppingPlanPanel({ state }: { state: ShoppingPlanState }) {
  if (state.phase === "loading") {
    return (
      <section className="shopping-plan" aria-label="Room shopping plan">
        <p role="status" aria-label="Room shopping plan status">Building a synthetic room shopping plan…</p>
      </section>
    );
  }

  if (state.phase === "error" || !state.plan) {
    return (
      <section className="shopping-plan" aria-label="Room shopping plan">
        <p role="status" aria-label="Room shopping plan status">
          The room shopping plan could not be built from the available synthetic evidence.
        </p>
      </section>
    );
  }

  const { plan } = state;
  return (
    <section className="shopping-plan" aria-label="Room shopping plan">
      <div className="shopping-plan-heading">
        <div>
          <h3>Room shopping plan</h3>
          <p>Read-only synthetic evidence for room revision {state.revision}.</p>
        </div>
        <span>{plan.requirements.length} required variant{plan.requirements.length === 1 ? "" : "s"}</span>
      </div>
      <p className="shopping-plan-disclosure">{plan.costDisclosure}</p>
      {plan.truncatedRequirementCount > 0 ? (
        <p role="status">
          {plan.truncatedRequirementCount} additional variant{plan.truncatedRequirementCount === 1 ? "" : "s"} omitted to keep this plan bounded.
        </p>
      ) : null}
      {plan.untrackedItemCount > 0 ? (
        <p role="status">
          {plan.untrackedItemCount} placed item{plan.untrackedItemCount === 1 ? "" : "s"} without a canonical catalog variant is not included.
        </p>
      ) : null}
      <ul className="shopping-plan-requirements" aria-label="Required room variants">
        {plan.requirements.map((requirement) => (
          <li key={requirement.requirementId}>
            <strong>{requirement.name} · quantity {requirement.quantity}</strong>
            <span>{requirement.catalogRef.catalogId} / {requirement.catalogRef.productId}</span>
            {requirement.comparison.excluded.length > 0 ? (
              <span>
                Excluded from exact price ranking: {requirement.comparison.excluded.map(({ offerId, reason }) => `${offerId} (${exclusionLabel(reason)})`).join(", ")}
              </span>
            ) : null}
            {requirement.resolutionStatus !== "ok" ? (
              <span>Offer evidence status: {requirement.resolutionStatus.replaceAll("_", " ")}.</span>
            ) : null}
          </li>
        ))}
      </ul>
      {plan.retailers.length === 0 ? (
        <p role="status">No current, comparable exact offers are eligible for a retailer handoff.</p>
      ) : (
        <div className="shopping-plan-retailers" aria-label="Retailer shopping groups">
          {plan.retailers.map((retailer) => (
            <section key={retailer.retailerId} aria-label={`Shopping plan for ${retailer.retailer}`}>
              <h4>{retailer.retailer}</h4>
              <ul>
                {retailer.offers.map((offer) => (
                  <li key={offer.offerId}>
                    <strong>{offer.requirementName} · quantity {offer.quantity}</strong>
                    <span>{normalizedOfferPrice(offer)} · observed {offer.observedAt}</span>
                    {offer.isCheapest ? <span>Cheapest current comparable exact offer</span> : null}
                    <span>Same variant evidence: {offer.identityEvidence.evidence?.join("; ") || offer.identityEvidence.method}</span>
                    <span>Source: {offer.provenance.sourceName} · {offer.provenance.sourceUrl}</span>
                    <a href={offer.productUrl} rel="noreferrer" target="_blank">Open inert retailer handoff</a>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </section>
  );
}

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
  offerResolver,
  store,
}: CatalogPanelProps) {
  const [category, setCategory] = useState("");
  const [styleTags, setStyleTags] = useState("");
  const [maxPrice, setMaxPrice] = useState("");
  const [maxWidth, setMaxWidth] = useState("");
  const [maxDepth, setMaxDepth] = useState("");
  const [searchState, setSearchState] = useState<SearchState | null>(null);
  const [actionState, setActionState] = useState<ActionState | null>(null);
  const [importState, setImportState] = useState<ImportState | null>(null);
  const [offerState, setOfferState] = useState<OfferState | null>(null);
  const [shoppingPlanState, setShoppingPlanState] = useState<ShoppingPlanState | null>(null);
  const searchButtonRef = useRef<HTMLButtonElement>(null);
  const moreFiltersRef = useRef<HTMLDetailsElement>(null);
  const offerRequestRef = useRef(0);
  const shoppingPlanRequestRef = useRef(0);
  const visibleSearch = searchState?.owner === store ? searchState : null;
  const visibleAction = actionState?.owner === store ? actionState : null;
  const visibleImport = importState?.owner === store ? importState : null;
  const visibleOffer = offerState?.owner === store ? offerState : null;
  const visibleShoppingPlan = shoppingPlanState?.owner === store ? shoppingPlanState : null;
  const resolvedOfferResolver = useMemo(
    () => offerResolver ?? createSyntheticRetailerOfferResolver(store.readCatalog),
    [offerResolver, store],
  );
  useStore(store, (state) => state.catalogRevision);
  const catalog = store.readCatalog();
  const categoryCounts = new Map<FurnitureSnapshot["category"], number>();
  for (const item of catalog) {
    categoryCounts.set(
      item.snapshot.category,
      (categoryCounts.get(item.snapshot.category) ?? 0) + 1,
    );
  }
  const categoryCatalog = category === ""
    ? catalog
    : catalog.filter(({ snapshot }) => snapshot.category === category);

  const changeCategory = (value: string) => {
    setCategory(value);
    setSearchState(null);
    setActionState(null);
  };

  useEffect(
    () =>
      store.subscribe((current, previous) => {
        const receipt = current.receipts[0];
        const roomChanged = current.revision !== previous.revision;
        const acceptedReplace =
          receipt !== previous.receipts[0] &&
          receipt?.status === "accepted" &&
          receipt.changeType === "replace";
        if (!roomChanged && !acceptedReplace) {
          return;
        }

        if (roomChanged) {
          shoppingPlanRequestRef.current += 1;
          setShoppingPlanState(null);
        }

        if (!acceptedReplace) {
          return;
        }

        const activeElement = document.activeElement;
        const restoreSearchFocus =
          activeElement instanceof Element &&
          activeElement.closest(".catalog-results, .catalog-content button") !==
            null;
        setSearchState(null);
        setActionState(null);
        setOfferState(null);
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
    moreFiltersRef.current?.removeAttribute("open");
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

  const showOfferEvidence = async (item: CatalogItem) => {
    if (item.metadata?.origin !== "project-authored") return;

    const requestId = offerRequestRef.current + 1;
    offerRequestRef.current = requestId;
    const catalogKey = catalogItemKey(item.catalogRef);
    setOfferState({
      owner: store,
      catalogKey,
      itemName: item.snapshot.name,
      phase: "loading",
      offers: [],
    });
    const resolution = await resolvedOfferResolver.resolve({ catalogRef: item.catalogRef });
    if (offerRequestRef.current !== requestId) return;
    setOfferState({
      owner: store,
      catalogKey,
      itemName: item.snapshot.name,
      phase: resolution.status,
      offers: resolution.offers,
    });
  };

  const showShoppingPlan = async () => {
    const requestId = shoppingPlanRequestRef.current + 1;
    shoppingPlanRequestRef.current = requestId;
    const current = store.getState();
    setShoppingPlanState({ owner: store, revision: current.revision, phase: "loading" });
    try {
      const plan = await createRoomShoppingPlan(current.room as WimyRoomV1, resolvedOfferResolver);
      if (shoppingPlanRequestRef.current !== requestId) return;
      setShoppingPlanState({ owner: store, revision: current.revision, phase: "ready", plan });
    } catch {
      if (shoppingPlanRequestRef.current !== requestId) return;
      setShoppingPlanState({ owner: store, revision: current.revision, phase: "error" });
    }
  };

  const importCatalogPackage = async (
    event: ChangeEvent<HTMLInputElement>,
  ) => {
    const input = event.currentTarget;
    const files = Array.from(input.files ?? []);
    if (files.length === 0) return;

    try {
      const parsedCatalogs = await Promise.all(
        files.map((file) => parseWimyCatalogFile(file)),
      );
      const rejected = parsedCatalogs.find((parsed) => !parsed.ok);
      if (rejected && !rejected.ok) {
        setImportState({
          owner: store,
          message: `Catalog import rejected. ${rejected.code}${rejected.path ? ` at ${rejected.path}` : ""}: ${rejected.message}.`,
        });
        return;
      }

      const catalogs = parsedCatalogs.flatMap((parsed) =>
        parsed.ok ? [parsed.catalog] : [],
      );
      const result = store.importCatalogPackages(catalogs);
      if (!result.ok) {
        setImportState({
          owner: store,
          message: `${result.message}${result.conflicts?.[0] ? ` (${result.conflicts[0].code})` : ""}.`,
        });
        return;
      }

      const names = catalogs.flatMap(({ items }) =>
        items.flatMap(({ variants }) => variants.map(({ snapshot }) => snapshot.name)),
      );
      const publishers = [...new Set(catalogs.map(({ publisher }) => publisher.name))];
      const versions = [...new Set(catalogs.map(({ catalog }) => catalog.version))];
      const duplicateText =
        result.duplicatePackages > 0 ? " Package/version was already imported." : "";
      setImportState({
        owner: store,
        message: `Imported ${result.addedItems} project-authored catalog item${result.addedItems === 1 ? "" : "s"}: ${names.join(", ")}. ${publishers.join(", ")} · ${versions.join(", ")}.${duplicateText}`,
      });
    } finally {
      input.value = "";
    }
  };

  return (
    <section className="catalog-panel" aria-labelledby="catalog-heading">
      <div className="catalog-panel-heading">
        <h2 id="catalog-heading">Furniture catalog</h2>
        <p>Find a local catalog item that fits the current room.</p>
        <p>Fictional/project-authored records only; imports stay local to this session.</p>
      </div>
      <details className="catalog-utilities" open={visibleImport ? true : undefined}>
        <summary>Catalog utilities</summary>
        <div className="catalog-utility-actions">
          <button type="button" className="shopping-plan-toggle" onClick={() => void showShoppingPlan()}>
            Build room shopping plan
          </button>
          <div className="catalog-import">
            <label>
              Import catalog package
              <input
                aria-label="Import project-authored catalog package"
                accept=".wimy-catalog,application/json"
                multiple
                type="file"
                onChange={(event) => void importCatalogPackage(event)}
              />
            </label>
            {visibleImport ? (
              <p role="status" aria-label="Catalog import result" aria-atomic="true">
                {visibleImport.message}
              </p>
            ) : null}
          </div>
        </div>
      </details>
      <div className="catalog-content">
        {visibleShoppingPlan ? <RoomShoppingPlanPanel state={visibleShoppingPlan} /> : null}
        {!visibleSearch ? (
          <section className="catalog-browse" aria-labelledby="catalog-browse-heading">
            <div className="catalog-subheading">
              <h3 id="catalog-browse-heading">Catalog items</h3>
              <span>{categoryCatalog.length} items</span>
            </div>
            <ul className="catalog-browse-list" aria-label="Available catalog items">
              {categoryCatalog.map((item) => {
                const key = catalogItemKey(item.catalogRef);
                const favorite = favoriteIds.has(key);
                return (
                  <li key={key}>
                    <span>
                      <strong>{item.snapshot.name}</strong>
                      <small title={presentationSummary(item.catalogRef.productId, item)}>
                        {item.snapshot.category} · {item.snapshot.dimensions.width} × {item.snapshot.dimensions.depth} m · {presentationLicense(item.catalogRef.productId, item)}
                      </small>
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
                    {item.metadata?.origin === "project-authored" ? (
                      <>
                        <button
                          type="button"
                          className="offer-evidence-toggle"
                          aria-expanded={visibleOffer?.catalogKey === key}
                          onClick={() => void showOfferEvidence(item)}
                        >
                          Show offer evidence for {item.snapshot.name}
                        </button>
                        {visibleOffer?.catalogKey === key ? (
                          <OfferEvidencePanel state={visibleOffer} />
                        ) : null}
                      </>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </section>
        ) : (
          <section className="catalog-search-view" aria-label="Catalog search">
            <p
              className="catalog-search-summary"
              role="status"
              aria-label="Catalog search result"
              aria-live="polite"
              aria-atomic="true"
            >
              {visibleSearch.announcement}
            </p>
            <button
              type="button"
              className="catalog-return"
              onClick={() => {
                setSearchState(null);
                setActionState(null);
              }}
            >
              Back to quick browse
            </button>
            {visibleSearch.matches.length > 0 ? (
              <>
                <ol className="catalog-results" aria-label="Catalog results">
                  {visibleSearch.matches.map((match) => (
                    <li key={match.catalogRef.productId}>
                      <strong>{match.snapshot.name}</strong>
                      <span>
                        {`${match.snapshot.category} · ${match.snapshot.dimensions.width} × ${match.snapshot.dimensions.depth} m`}
                      </span>
                      <span>{`Styles: ${match.snapshot.styleTags.join(", ")}`}</span>
                      <span>{presentationSummary(match.catalogRef.productId, match)}</span>
                      {match.metadata ? (
                        <span>{`${match.metadata.provenance.sourceName} · ${match.metadata.catalogVersion}`}</span>
                      ) : null}
                      <span>{priceSummary(match)}</span>
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
                      {match.metadata?.origin === "project-authored" ? (
                        <>
                          <button
                            type="button"
                            className="offer-evidence-toggle"
                            aria-expanded={visibleOffer?.catalogKey === catalogItemKey(match.catalogRef)}
                            onClick={() => void showOfferEvidence(match)}
                          >
                            Show offer evidence for {match.snapshot.name}
                          </button>
                          {visibleOffer?.catalogKey === catalogItemKey(match.catalogRef) ? (
                            <OfferEvidencePanel state={visibleOffer} />
                          ) : null}
                        </>
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
                    <details className="catalog-suggestions">
                      <summary>Similar and goes well with</summary>
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
                    </details>
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
        )}
      </div>
      <form className="catalog-filters" onSubmit={search}>
        <details ref={moreFiltersRef} className="catalog-more-filters">
          <summary>More filters</summary>
          <div className="catalog-filter-details">
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
          </div>
        </details>
        <div className="catalog-filter-primary">
          <label>
            Category
            <select
              value={category}
              onChange={(event) => changeCategory(event.target.value)}
            >
              <option value="">All categories ({catalog.length})</option>
              {CATEGORIES.filter(
                (option) => (categoryCounts.get(option) ?? 0) > 0,
              ).map((option) => (
                <option key={option} value={option}>
                  {categoryLabel(option)} ({categoryCounts.get(option)})
                </option>
              ))}
            </select>
          </label>
          <button ref={searchButtonRef} type="submit">
            Search catalog
          </button>
        </div>
      </form>
    </section>
  );
}
