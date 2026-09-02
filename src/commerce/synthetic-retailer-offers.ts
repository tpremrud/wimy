import type { CatalogItem } from "../room/catalog";
import {
  createRetailerOfferResolver,
  type RetailerOfferAdapter,
  type RetailerOfferResolver,
} from "./retailer-offer-adapter";

export const SYNTHETIC_OFFER_NOW = "2026-09-02T12:05:00.000Z" as const;

type RetailerFixture = {
  readonly retailerId: string;
  readonly retailerName: string;
  readonly sellerId: string;
  readonly kind: "exact" | "ambiguous" | "substitute";
  readonly availability: "in_stock" | "out_of_stock";
  readonly observedAt: string;
  readonly expiresAt: string;
  readonly priceDeltaMinor: number;
};

const RETAILER_FIXTURES: readonly RetailerFixture[] = [
  {
    retailerId: "synthetic-northstar",
    retailerName: "Northstar Furnishings",
    sellerId: "synthetic-northstar-direct",
    kind: "exact",
    availability: "in_stock",
    observedAt: "2026-09-02T12:00:00.000Z",
    expiresAt: "2026-09-02T12:30:00.000Z",
    priceDeltaMinor: 0,
  },
  {
    retailerId: "synthetic-cedar-exchange",
    retailerName: "Cedar Exchange",
    sellerId: "synthetic-cedar-marketplace",
    kind: "ambiguous",
    availability: "in_stock",
    observedAt: "2026-09-02T12:00:00.000Z",
    expiresAt: "2026-09-02T12:30:00.000Z",
    priceDeltaMinor: 1_500,
  },
  {
    retailerId: "synthetic-harbor-home",
    retailerName: "Harbor Home",
    sellerId: "synthetic-harbor-direct",
    kind: "substitute",
    availability: "in_stock",
    observedAt: "2026-09-02T12:00:00.000Z",
    expiresAt: "2026-09-02T12:30:00.000Z",
    priceDeltaMinor: -2_000,
  },
  {
    retailerId: "synthetic-morrow-market",
    retailerName: "Morrow Market",
    sellerId: "synthetic-morrow-direct",
    kind: "exact",
    availability: "out_of_stock",
    observedAt: "2026-09-02T12:00:00.000Z",
    expiresAt: "2026-09-02T12:30:00.000Z",
    priceDeltaMinor: 3_000,
  },
  {
    retailerId: "synthetic-tidehouse",
    retailerName: "Tidehouse Outlet",
    sellerId: "synthetic-tidehouse-direct",
    kind: "exact",
    availability: "in_stock",
    observedAt: "2026-09-02T11:45:00.000Z",
    expiresAt: "2026-09-02T12:04:00.000Z",
    priceDeltaMinor: -4_000,
  },
];

const syntheticOfferFor = (
  item: CatalogItem,
  fixture: RetailerFixture,
) => {
  const amountMinor = Math.max(
    0,
    Math.round((item.snapshot.commerce?.price.amount ?? 0) * 100) +
      fixture.priceDeltaMinor,
  );
  const productId = item.catalogRef.productId;
  const evidence =
    fixture.kind === "exact"
      ? ["Authorized sandbox fixture matches the catalog variant UUID"]
      : fixture.kind === "ambiguous"
        ? ["Name, dimensions, and style overlap; variant UUID is absent"]
        : ["Category and style overlap; variant identity differs"];

  return {
    offerId: `${fixture.retailerId}-offer-${productId}`,
    retailerId: fixture.retailerId,
    sellerId: fixture.sellerId,
    catalogRef: structuredClone(item.catalogRef),
    displayName: item.snapshot.name,
    productUrl: `https://offers.example.invalid/${fixture.retailerId}/${productId}`,
    price: {
      amountMinor,
      currency: item.snapshot.commerce?.price.currency ?? "USD",
    },
    availability: fixture.availability,
    observedAt: fixture.observedAt,
    expiresAt: fixture.expiresAt,
    provenance: {
      sourceName: fixture.retailerName,
      sourceUrl: `https://offers.example.invalid/sources/${fixture.retailerId}`,
      sourceKind: "authorized_api" as const,
    },
    identityEvidence: {
      match: fixture.kind,
      method:
        fixture.kind === "exact"
          ? ("authorized_catalog_variant_uuid" as const)
          : fixture.kind === "ambiguous"
            ? ("name_dimensions_style" as const)
            : ("category_style_similarity" as const),
      confidence:
        fixture.kind === "exact"
          ? ("high" as const)
          : fixture.kind === "ambiguous"
            ? ("medium" as const)
            : ("low" as const),
      evidence,
    },
  };
};

const syntheticAdapterFor = (
  readCatalog: () => readonly CatalogItem[],
  fixture: RetailerFixture,
): RetailerOfferAdapter => ({
  adapterId: `${fixture.retailerId}-adapter`,
  retailerId: fixture.retailerId,
  sellerId: fixture.sellerId,
  environment: "sandbox",
  fetchOffers: async (lookup) => {
    const item = readCatalog().find(
      (candidate) =>
        candidate.metadata?.origin === "project-authored" &&
        candidate.catalogRef.catalogId === lookup.catalogRef.catalogId &&
        candidate.catalogRef.productId === lookup.catalogRef.productId,
    );
    return item ? [syntheticOfferFor(item, fixture)] : [];
  },
});

export const createSyntheticRetailerOfferResolver = (
  readCatalog: () => readonly CatalogItem[],
): RetailerOfferResolver =>
  createRetailerOfferResolver(
    RETAILER_FIXTURES.map((fixture) =>
      syntheticAdapterFor(readCatalog, fixture),
    ),
    {
      allowInferredIdentityEvidence: true,
      clock: () => new Date(SYNTHETIC_OFFER_NOW),
      cacheTtlMs: 0,
    },
  );
