import type { PlacedItem, WimyRoomV1 } from "../room/document";
import {
  type RetailerOffer,
  type RetailerOfferResolution,
  type RetailerOfferResolver,
} from "./retailer-offer-adapter";

export const MAX_SHOPPING_PLAN_VARIANTS = 20;
export const ROOM_SHOPPING_COST_DISCLOSURE =
  "Compared prices exclude delivery, tax, membership discounts or fees, regional costs, and other landed-cost inputs because this synthetic evidence does not provide them.";

export type ShoppingPlanExclusionReason =
  | "ambiguous_identity"
  | "substitute_identity"
  | "stale"
  | "unavailable"
  | "unverified"
  | "different_catalog_ref"
  | "invalid_price_basis"
  | "non_inert_handoff";

export type ShoppingPlanExcludedOffer = {
  readonly offerId: string;
  readonly reason: ShoppingPlanExclusionReason;
};

export type ComparableShoppingOffer = RetailerOffer & {
  readonly normalizedAmountMinor: number;
  readonly normalizedUnitCount: number;
  readonly isCheapest: boolean;
};

export type ShoppingOfferComparisonGroup = {
  readonly currency: string;
  readonly basis: "offer_total" | "per_unit";
  readonly offers: readonly ComparableShoppingOffer[];
  readonly cheapestOfferId: string | undefined;
};

export type ExactRetailerOfferComparison = {
  readonly groups: readonly ShoppingOfferComparisonGroup[];
  readonly excluded: readonly ShoppingPlanExcludedOffer[];
};

export type RoomShoppingRequirement = {
  readonly requirementId: string;
  readonly catalogRef: { readonly catalogId: string; readonly productId: string };
  readonly name: string;
  readonly quantity: number;
  readonly resolutionStatus: RetailerOfferResolution["status"];
  readonly comparison: ExactRetailerOfferComparison;
};

export type RetailerShoppingPlanOffer = ComparableShoppingOffer & {
  readonly requirementId: string;
  readonly requirementName: string;
  readonly quantity: number;
};

export type RetailerShoppingGroup = {
  readonly retailerId: string;
  readonly retailer: string;
  readonly offers: readonly RetailerShoppingPlanOffer[];
};

export type RoomShoppingPlan = {
  readonly status: "ready" | "no_requirements";
  readonly requirements: readonly RoomShoppingRequirement[];
  readonly retailers: readonly RetailerShoppingGroup[];
  readonly untrackedItemCount: number;
  readonly truncatedRequirementCount: number;
  readonly costDisclosure: typeof ROOM_SHOPPING_COST_DISCLOSURE;
};

type PriceBasis = {
  readonly basis: "offer_total" | "per_unit";
  readonly unitCount: number;
};

const inertHandoffUrl = (value: string) => {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      (url.hostname === "example.invalid" || url.hostname.endsWith(".example.invalid"))
    );
  } catch {
    return false;
  }
};

const priceBasisFor = (offer: RetailerOffer): PriceBasis | undefined => {
  const price = offer.price as RetailerOffer["price"] & {
    readonly unit?: "each" | "pack";
    readonly quantity?: number;
  };
  if (price.unit === undefined && price.quantity === undefined) {
    return { basis: "offer_total", unitCount: 1 };
  }
  if (price.unit === undefined || price.quantity === undefined) {
    return undefined;
  }
  if (
    (price.unit !== "each" && price.unit !== "pack") ||
    !Number.isSafeInteger(price.quantity) ||
    price.quantity < 1 ||
    (price.unit === "each" && price.quantity !== 1)
  ) {
    return undefined;
  }
  return {
    basis: "per_unit",
    unitCount: price.quantity,
  };
};

const sameCatalogRef = (
  first: { readonly catalogId: string; readonly productId: string },
  second: { readonly catalogId: string; readonly productId: string },
) => first.catalogId === second.catalogId && first.productId === second.productId;

const hasValidObservationWindow = (offer: RetailerOffer) => {
  const observedAt = Date.parse(offer.observedAt);
  const expiresAt = Date.parse(offer.expiresAt);
  return Number.isFinite(observedAt) && Number.isFinite(expiresAt) && expiresAt > observedAt;
};

const exclusionFor = (
  offer: RetailerOffer,
  expectedCatalogRef?: { readonly catalogId: string; readonly productId: string },
): ShoppingPlanExcludedOffer | undefined => {
  if (
    expectedCatalogRef &&
    (!sameCatalogRef(offer.catalogRef, expectedCatalogRef) ||
      !sameCatalogRef(offer.identityEvidence.catalogRef, expectedCatalogRef))
  ) {
    return { offerId: offer.offerId, reason: "different_catalog_ref" };
  }
  if (offer.identityEvidence.match === "ambiguous") {
    return { offerId: offer.offerId, reason: "ambiguous_identity" };
  }
  if (offer.identityEvidence.match === "substitute") {
    return { offerId: offer.offerId, reason: "substitute_identity" };
  }
  if (offer.eligibility === "stale") {
    return { offerId: offer.offerId, reason: "stale" };
  }
  if (offer.eligibility === "unavailable") {
    return { offerId: offer.offerId, reason: "unavailable" };
  }
  if (offer.availability !== "in_stock") {
    return { offerId: offer.offerId, reason: "unavailable" };
  }
  if (!hasValidObservationWindow(offer)) {
    return { offerId: offer.offerId, reason: "unverified" };
  }
  if (offer.eligibility !== "purchasable") {
    return { offerId: offer.offerId, reason: "unverified" };
  }
  if (!inertHandoffUrl(offer.productUrl)) {
    return { offerId: offer.offerId, reason: "non_inert_handoff" };
  }
  if (offer.identityEvidence.match !== "exact") {
    return { offerId: offer.offerId, reason: "unverified" };
  }
  if (!priceBasisFor(offer)) {
    return { offerId: offer.offerId, reason: "invalid_price_basis" };
  }
  return undefined;
};

export const compareExactRetailerOffers = (
  offers: readonly RetailerOffer[],
  expectedCatalogRef?: { readonly catalogId: string; readonly productId: string },
): ExactRetailerOfferComparison => {
  const excluded: ShoppingPlanExcludedOffer[] = [];
  const candidates: Array<{ offer: RetailerOffer; priceBasis: PriceBasis }> = [];

  for (const offer of offers) {
    const exclusion = exclusionFor(offer, expectedCatalogRef);
    if (exclusion) {
      excluded.push(exclusion);
      continue;
    }
    const priceBasis = priceBasisFor(offer);
    if (!priceBasis) {
      excluded.push({ offerId: offer.offerId, reason: "invalid_price_basis" });
      continue;
    }
    candidates.push({ offer, priceBasis });
  }

  const groups = new Map<string, typeof candidates>();
  for (const candidate of candidates) {
    const key = `${candidate.offer.price.currency}:${candidate.priceBasis.basis}`;
    const group = groups.get(key) ?? [];
    group.push(candidate);
    groups.set(key, group);
  }

  const resultGroups: ShoppingOfferComparisonGroup[] = [];
  for (const group of groups.values()) {
    const first = group[0];
    if (!first) continue;
    const sorted = group.slice().sort((left, right) => {
      const leftAmount = left.offer.price.amountMinor / left.priceBasis.unitCount;
      const rightAmount = right.offer.price.amountMinor / right.priceBasis.unitCount;
      return leftAmount - rightAmount || left.offer.offerId.localeCompare(right.offer.offerId);
    });
    const comparable = sorted.map(({ offer, priceBasis }) => ({
      ...structuredClone(offer),
      normalizedAmountMinor: offer.price.amountMinor / priceBasis.unitCount,
      normalizedUnitCount: priceBasis.unitCount,
      isCheapest:
        sorted.length > 1 && sorted[0]?.offer.offerId === offer.offerId,
    }));
    resultGroups.push({
      currency: first.offer.price.currency,
      basis: first.priceBasis.basis,
      offers: comparable,
      cheapestOfferId: comparable.length > 1 ? comparable[0]?.offerId : undefined,
    });
  }

  return {
    groups: resultGroups.sort(
      (left, right) =>
        left.currency.localeCompare(right.currency) || left.basis.localeCompare(right.basis),
    ),
    excluded: excluded.sort((left, right) => left.offerId.localeCompare(right.offerId)),
  };
};

const requirementKeyFor = (item: PlacedItem) =>
  item.catalogRef
    ? `${item.catalogRef.catalogId}:${item.catalogRef.productId}`
    : undefined;

type MutableRequirement = {
  catalogRef: { catalogId: string; productId: string };
  name: string;
  quantity: number;
};

export type RoomShoppingPlanOptions = {
  readonly signal?: AbortSignal;
  readonly maxVariants?: number;
};

export const createRoomShoppingPlan = async (
  room: WimyRoomV1,
  resolver: RetailerOfferResolver,
  options: RoomShoppingPlanOptions = {},
): Promise<RoomShoppingPlan> => {
  const roomSnapshot = structuredClone(room);
  const maxVariants = options.maxVariants ?? MAX_SHOPPING_PLAN_VARIANTS;
  if (!Number.isSafeInteger(maxVariants) || maxVariants < 1 || maxVariants > 100) {
    throw new RangeError("maxVariants must be a bounded positive integer");
  }

  const requirementMap = new Map<string, MutableRequirement>();
  let untrackedItemCount = 0;
  for (const item of roomSnapshot.items) {
    const key = requirementKeyFor(item);
    if (!key || !item.catalogRef) {
      untrackedItemCount += 1;
      continue;
    }
    const existing = requirementMap.get(key);
    if (existing) {
      existing.quantity += 1;
    } else {
      requirementMap.set(key, {
        catalogRef: structuredClone(item.catalogRef),
        name: item.snapshot.name,
        quantity: 1,
      });
    }
  }

  const keys = [...requirementMap.keys()].sort((left, right) => left.localeCompare(right));
  const selectedKeys = keys.slice(0, maxVariants);
  const truncatedRequirementCount = Math.max(0, keys.length - selectedKeys.length);
  const requirements: RoomShoppingRequirement[] = [];
  for (const key of selectedKeys) {
    const requirement = requirementMap.get(key);
    if (!requirement) continue;
    if (options.signal?.aborted) {
      return {
        status: "no_requirements",
        requirements: [],
        retailers: [],
        untrackedItemCount,
        truncatedRequirementCount,
        costDisclosure: ROOM_SHOPPING_COST_DISCLOSURE,
      };
    }
    const resolution = await resolver.resolve(
      { catalogRef: requirement.catalogRef },
      { signal: options.signal },
    );
    requirements.push({
      requirementId: key,
      catalogRef: structuredClone(requirement.catalogRef),
      name: requirement.name,
      quantity: requirement.quantity,
      resolutionStatus: resolution.status,
      comparison: compareExactRetailerOffers(resolution.offers, requirement.catalogRef),
    });
  }

  const retailerMap = new Map<string, RetailerShoppingPlanOffer[]>();
  for (const requirement of requirements) {
    for (const group of requirement.comparison.groups) {
      for (const offer of group.offers) {
        const retailerOffers = retailerMap.get(offer.retailerId) ?? [];
        retailerOffers.push({
          ...structuredClone(offer),
          requirementId: requirement.requirementId,
          requirementName: requirement.name,
          quantity: requirement.quantity,
        });
        retailerMap.set(offer.retailerId, retailerOffers);
      }
    }
  }

  const retailers = [...retailerMap.entries()]
    .map(([retailerId, offers]) => ({
      retailerId,
      retailer: offers[0]?.provenance.sourceName ?? retailerId,
      offers: offers.sort(
        (left, right) =>
          left.requirementId.localeCompare(right.requirementId) ||
          left.normalizedAmountMinor - right.normalizedAmountMinor ||
          left.offerId.localeCompare(right.offerId),
      ),
    }))
    .sort(
      (left, right) =>
        left.retailer.localeCompare(right.retailer) || left.retailerId.localeCompare(right.retailerId),
    );

  return {
    status: requirements.length > 0 ? "ready" : "no_requirements",
    requirements,
    retailers,
    untrackedItemCount,
    truncatedRequirementCount,
    costDisclosure: ROOM_SHOPPING_COST_DISCLOSURE,
  };
};
