import { describe, expect, it } from "vitest";
import type { RetailerOffer } from "./retailer-offer-adapter";
import {
  compareExactRetailerOffers,
  createRoomShoppingPlan,
} from "./shopping-plan";
import { makeRoom, makePlacedItem } from "../test/room-fixtures";

const lookup = {
  catalogId: "00000000-0000-4000-8000-000000000301",
  productId: "00000000-0000-4000-8000-000000000302",
};

const offer = (
  overrides: Partial<RetailerOffer> = {},
): RetailerOffer => ({
  offerId: "northstar-offer",
  retailerId: "synthetic-northstar",
  sellerId: "synthetic-northstar-direct",
  catalogRef: lookup,
  displayName: "Aurora Chair",
  productUrl: "https://offers.example.invalid/northstar/aurora-chair",
  price: { amountMinor: 12000, currency: "USD" },
  availability: "in_stock",
  observedAt: "2026-09-02T12:00:00.000Z",
  expiresAt: "2026-09-02T12:30:00.000Z",
  provenance: {
    sourceName: "Northstar Furnishings",
    sourceUrl: "https://offers.example.invalid/sources/northstar",
    sourceKind: "authorized_api",
    adapterId: "northstar-adapter",
    retailerId: "synthetic-northstar",
    sellerId: "synthetic-northstar-direct",
    environment: "sandbox",
  },
  identityEvidence: {
    match: "exact",
    method: "authorized_catalog_variant_uuid",
    confidence: "high",
    evidence: ["Authorized sandbox fixture matches the catalog variant UUID"],
    catalogRef: lookup,
  },
  eligibility: "purchasable",
  ...overrides,
});

describe("compareExactRetailerOffers", () => {
  it("ranks only current exact offers and marks the cheapest within a comparable price group", () => {
    const result = compareExactRetailerOffers([
      offer({ offerId: "northstar-offer", price: { amountMinor: 12000, currency: "USD" } }),
      offer({
        offerId: "elm-offer",
        retailerId: "synthetic-elm-commons",
        sellerId: "synthetic-elm-direct",
        price: { amountMinor: 11000, currency: "USD" },
      }),
      offer({
        offerId: "ambiguous-offer",
        identityEvidence: {
          match: "ambiguous",
          method: "name_dimensions_style",
          confidence: "medium",
          evidence: ["Variant UUID is absent"],
          catalogRef: lookup,
        },
        eligibility: "unverified",
      }),
      offer({ offerId: "stale-offer", eligibility: "stale" }),
    ]);

    expect(result.groups).toHaveLength(1);
    expect(result.groups[0]).toMatchObject({
      currency: "USD",
      basis: "offer_total",
      cheapestOfferId: "elm-offer",
      offers: [
        { offerId: "elm-offer", normalizedAmountMinor: 11000, isCheapest: true },
        { offerId: "northstar-offer", normalizedAmountMinor: 12000, isCheapest: false },
      ],
    });
    expect(result.excluded).toEqual([
      { offerId: "ambiguous-offer", reason: "ambiguous_identity" },
      { offerId: "stale-offer", reason: "stale" },
    ]);
  });

  it("does not rank exact offers with different currencies or missing price-basis evidence together", () => {
    const result = compareExactRetailerOffers([
      offer({ offerId: "usd-offer" }),
      offer({
        offerId: "eur-offer",
        price: { amountMinor: 9000, currency: "EUR" },
      }),
    ]);

    expect(result.groups).toHaveLength(2);
    expect(result.groups.every(({ cheapestOfferId }) => cheapestOfferId === undefined)).toBe(true);
    expect(result.excluded).toEqual([]);
  });

  it("normalizes explicit pack counts but rejects non-unit each counts", () => {
    const result = compareExactRetailerOffers([
      offer({
        offerId: "each-offer",
        price: { amountMinor: 10000, currency: "USD", unit: "each", quantity: 1 },
      }),
      offer({
        offerId: "pack-offer",
        price: { amountMinor: 18000, currency: "USD", unit: "pack", quantity: 2 },
      }),
      offer({
        offerId: "invalid-each-offer",
        price: { amountMinor: 5000, currency: "USD", unit: "each", quantity: 2 },
      }),
      offer({
        offerId: "invalid-window-offer",
        observedAt: "2026-09-02T12:30:00.000Z",
        expiresAt: "2026-09-02T12:00:00.000Z",
      }),
    ]);

    expect(result.groups).toHaveLength(1);
    expect(result.groups[0]).toMatchObject({
      basis: "per_unit",
      cheapestOfferId: "pack-offer",
      offers: [
        { offerId: "pack-offer", normalizedAmountMinor: 9000, isCheapest: true },
        { offerId: "each-offer", normalizedAmountMinor: 10000, isCheapest: false },
      ],
    });
    expect(result.excluded).toEqual([
      { offerId: "invalid-each-offer", reason: "invalid_price_basis" },
      { offerId: "invalid-window-offer", reason: "unverified" },
    ]);
  });

  it("rejects an offer whose canonical references do not match the requested variant", () => {
    const result = compareExactRetailerOffers(
      [
        offer({
          offerId: "wrong-catalog-offer",
          catalogRef: { catalogId: lookup.catalogId, productId: "00000000-0000-4000-8000-000000000399" },
          identityEvidence: {
            match: "exact",
            method: "authorized_catalog_variant_uuid",
            confidence: "high",
            catalogRef: { catalogId: lookup.catalogId, productId: "00000000-0000-4000-8000-000000000399" },
          },
        }),
      ],
      lookup,
    );

    expect(result.groups).toEqual([]);
    expect(result.excluded).toEqual([
      { offerId: "wrong-catalog-offer", reason: "different_catalog_ref" },
    ]);
  });
});

describe("createRoomShoppingPlan", () => {
  it("groups a room's canonical variants by retailer without changing the room", async () => {
    const room = makeRoom({
      items: [
        makePlacedItem({
          id: "placed-aurora-chair",
          catalogRef: lookup,
          snapshot: {
            ...makePlacedItem().snapshot,
            name: "Aurora Chair",
          },
        }),
        makePlacedItem({
          id: "placed-aurora-chair-2",
          catalogRef: lookup,
          snapshot: {
            ...makePlacedItem().snapshot,
            name: "Aurora Chair",
          },
        }),
      ],
    });
    const resolver = {
      resolve: async () => ({ status: "ok" as const, offers: [offer()] }),
      clearCache: () => undefined,
    };

    const result = await createRoomShoppingPlan(room, resolver);

    expect(result.requirements).toEqual([
      expect.objectContaining({
        catalogRef: lookup,
        name: "Aurora Chair",
        quantity: 2,
      }),
    ]);
    expect(result.retailers).toEqual([
      expect.objectContaining({
        retailerId: "synthetic-northstar",
        offers: [expect.objectContaining({ offerId: "northstar-offer", quantity: 2 })],
      }),
    ]);
    expect(result.costDisclosure).toContain("delivery");
    expect(room.items).toHaveLength(2);
    expect(room.items[0]?.id).toBe("placed-aurora-chair");
  });
});
