import { describe, expect, it, vi } from "vitest";
import {
  createRetailerOfferResolver,
  SANDBOX_RETAILER_ADAPTER,
  type RetailerOfferAdapter,
  type RetailerOfferLookup,
} from "./retailer-offer-adapter";

const uuid = (value: number) =>
  `00000000-0000-4000-8000-${String(value).padStart(12, "0")}`;

const lookup: RetailerOfferLookup = {
  catalogRef: { catalogId: uuid(1), productId: uuid(2) },
};

const now = new Date("2026-09-02T12:05:00.000Z");

const freshOffer = {
  offerId: "offer-solstice-chair",
  retailerId: "fictional-retailer",
  sellerId: "fictional-retailer-direct",
  catalogRef: lookup.catalogRef,
  displayName: "Solstice Chair",
  productUrl: "https://offers.example.invalid/solstice-chair",
  price: { amountMinor: 49900, currency: "USD" },
  availability: "in_stock",
  observedAt: "2026-09-02T12:00:00.000Z",
  expiresAt: "2026-09-02T12:15:00.000Z",
  provenance: {
    sourceName: "Fictional Retailer Sandbox",
    sourceUrl: "https://offers.example.invalid/source",
    sourceKind: "authorized_api",
  },
  identityEvidence: {
    match: "exact",
    method: "authorized_catalog_variant_uuid",
  },
} as const;

const adapterReturning = (
  response: unknown,
  overrides: Partial<RetailerOfferAdapter> = {},
): RetailerOfferAdapter => ({
  adapterId: "fictional-adapter",
  retailerId: "fictional-retailer",
  sellerId: "fictional-retailer-direct",
  environment: "sandbox",
  fetchOffers: async () => response,
  ...overrides,
});

const resolverFor = (
  adapter: RetailerOfferAdapter,
  options: Parameters<typeof createRetailerOfferResolver>[1] = {},
) => createRetailerOfferResolver([adapter], { clock: () => now, ...options });

describe("createRetailerOfferResolver", () => {
  it("returns an exact offer with canonical identity, provenance, and freshness", async () => {
    const fetchOffers = vi.fn(async () => [freshOffer]);
    const resolver = resolverFor(adapterReturning([], { fetchOffers }));

    await expect(resolver.resolve(lookup)).resolves.toEqual({
      status: "ok",
      offers: [
        expect.objectContaining({
          ...freshOffer,
          eligibility: "purchasable",
          identityEvidence: expect.objectContaining(freshOffer.identityEvidence),
          provenance: expect.objectContaining({
            adapterId: "fictional-adapter",
            retailerId: "fictional-retailer",
            sellerId: "fictional-retailer-direct",
            environment: "sandbox",
          }),
        }),
      ],
    });
    expect(fetchOffers).toHaveBeenCalledWith(
      { catalogRef: lookup.catalogRef },
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it("uses canonical IDs for lookup and never treats names or URLs as identity", async () => {
    const fetchOffers = vi.fn(async (request: RetailerOfferLookup) => {
      expect(request).toEqual({ catalogRef: lookup.catalogRef });
      return [freshOffer];
    });
    const resolver = resolverFor(adapterReturning([], { fetchOffers }));

    await expect(resolver.resolve(lookup)).resolves.toMatchObject({
      status: "ok",
      offers: [
        expect.objectContaining({
          productUrl: "https://offers.example.invalid/solstice-chair",
          catalogRef: lookup.catalogRef,
        }),
      ],
    });
    expect(fetchOffers).toHaveBeenCalledTimes(1);
  });

  it("fails closed for missing, ambiguous, or mismatched identity evidence", async () => {
    const variants = [
      { ...freshOffer, identityEvidence: undefined },
      { ...freshOffer, identityEvidence: { match: "ambiguous", method: "name" } },
      {
        ...freshOffer,
        catalogRef: { catalogId: lookup.catalogRef.catalogId, productId: uuid(3) },
      },
    ];

    for (const offer of variants) {
      const resolver = resolverFor(adapterReturning([offer]));
      await expect(resolver.resolve(lookup)).resolves.toEqual({
        status: "invalid_response",
        offers: [],
      });
    }
  });

  it("labels expired and unavailable offers so later cart code can reject them", async () => {
    const stale = {
      ...freshOffer,
      offerId: "offer-stale-chair",
      expiresAt: "2026-09-02T12:04:00.000Z",
    };
    const unavailable = {
      ...freshOffer,
      offerId: "offer-unavailable-chair",
      availability: "out_of_stock",
    };
    const resolver = resolverFor(adapterReturning([stale, unavailable]));

    await expect(resolver.resolve(lookup)).resolves.toMatchObject({
      status: "ok",
      offers: [
        { offerId: "offer-stale-chair", eligibility: "stale" },
        { offerId: "offer-unavailable-chair", eligibility: "unavailable" },
      ],
    });
  });

  it("retries transient adapter failures up to the bounded attempt limit", async () => {
    let attempts = 0;
    const fetchOffers = vi.fn(async () => {
      attempts += 1;
      if (attempts < 3) throw new Error("synthetic provider failure");
      return [freshOffer];
    });
    const resolver = resolverFor(adapterReturning([], { fetchOffers }), {
      maxAttempts: 3,
    });

    await expect(resolver.resolve(lookup)).resolves.toMatchObject({ status: "ok" });
    expect(fetchOffers).toHaveBeenCalledTimes(3);
  });

  it("returns a bounded adapter error without leaking provider details or partial offers", async () => {
    const fetchOffers = vi.fn(async () => {
      throw new Error("secret-token=synthetic-only");
    });
    const resolver = resolverFor(adapterReturning([], { fetchOffers }), {
      maxAttempts: 3,
    });

    await expect(resolver.resolve(lookup)).resolves.toEqual({
      status: "adapter_error",
      offers: [],
    });
    expect(fetchOffers).toHaveBeenCalledTimes(3);
  });

  it("rejects control characters and overlong URLs from adapter output", async () => {
    const controlCharacterResolver = resolverFor(
      adapterReturning([{ ...freshOffer, displayName: "Solstice\u0000Chair" }]),
    );
    await expect(controlCharacterResolver.resolve(lookup)).resolves.toEqual({
      status: "invalid_response",
      offers: [],
    });

    const overlongUrlResolver = resolverFor(
      adapterReturning([
        {
          ...freshOffer,
          productUrl: `https://offers.example.invalid/${"x".repeat(2_050)}`,
        },
      ]),
    );
    await expect(overlongUrlResolver.resolve(lookup)).resolves.toEqual({
      status: "invalid_response",
      offers: [],
    });
  });

  it("caches a successful resolution without sharing mutable offer state", async () => {
    const fetchOffers = vi.fn(async () => [freshOffer]);
    const resolver = resolverFor(adapterReturning([], { fetchOffers }), {
      cacheTtlMs: 60_000,
    });

    const first = await resolver.resolve(lookup);
    if (first.status !== "ok") throw new Error("Expected a successful lookup");
    first.offers[0]!.displayName = "mutated caller copy";

    await expect(resolver.resolve(lookup)).resolves.toMatchObject({
      status: "ok",
      offers: [expect.objectContaining({ displayName: "Solstice Chair" })],
    });
    expect(fetchOffers).toHaveBeenCalledTimes(1);
  });

  it("re-evaluates cached freshness as the clock advances", async () => {
    let currentNow = now;
    const fetchOffers = vi.fn(async () => [freshOffer]);
    const resolver = createRetailerOfferResolver(
      [adapterReturning([], { fetchOffers })],
      { clock: () => currentNow, cacheTtlMs: 3_600_000 },
    );

    await expect(resolver.resolve(lookup)).resolves.toMatchObject({
      offers: [{ eligibility: "purchasable" }],
    });
    currentNow = new Date("2026-09-02T12:20:00.000Z");

    await expect(resolver.resolve(lookup)).resolves.toMatchObject({
      status: "ok",
      offers: [{ eligibility: "stale" }],
    });
    expect(fetchOffers).toHaveBeenCalledTimes(1);
  });

  it("fails closed with a rate-limited result before calling an adapter", async () => {
    const fetchOffers = vi.fn(async () => [freshOffer]);
    const resolver = resolverFor(adapterReturning([], { fetchOffers }), {
      minIntervalMs: 60_000,
      cacheTtlMs: 0,
    });

    await expect(resolver.resolve(lookup)).resolves.toMatchObject({ status: "ok" });
    await expect(resolver.resolve(lookup)).resolves.toEqual({
      status: "rate_limited",
      offers: [],
    });
    expect(fetchOffers).toHaveBeenCalledTimes(1);
  });

  it("does not call an adapter for the fictional non-purchasable demo catalog", async () => {
    const fetchOffers = vi.fn(async () => [freshOffer]);
    const resolver = resolverFor(adapterReturning([], { fetchOffers }));

    await expect(
      resolver.resolve({
        catalogRef: { catalogId: "wimy-demo-v1", productId: "ember-nest-chair" },
      }),
    ).resolves.toEqual({ status: "invalid_request", offers: [] });
    expect(fetchOffers).not.toHaveBeenCalled();
  });

  it("honors cancellation before lookup and does not retry an aborted adapter", async () => {
    const controller = new AbortController();
    controller.abort();
    const fetchOffers = vi.fn(async () => [freshOffer]);
    const resolver = resolverFor(adapterReturning([], { fetchOffers }));

    await expect(
      resolver.resolve(lookup, { signal: controller.signal }),
    ).resolves.toEqual({ status: "cancelled", offers: [] });
    expect(fetchOffers).not.toHaveBeenCalled();
  });

  it("stops after cancellation during an adapter call", async () => {
    const controller = new AbortController();
    const fetchOffers = vi.fn(async (_lookup, context: { signal: AbortSignal }) => {
      controller.abort();
      expect(context.signal.aborted).toBe(false);
      throw new Error("synthetic cancellation");
    });
    const resolver = resolverFor(adapterReturning([], { fetchOffers }), {
      maxAttempts: 3,
    });

    await expect(
      resolver.resolve(lookup, { signal: controller.signal }),
    ).resolves.toEqual({ status: "cancelled", offers: [] });
    expect(fetchOffers).toHaveBeenCalledTimes(1);
  });

  it("bounds the returned offer count and rejects duplicate offer IDs", async () => {
    const tooMany = Array.from({ length: 21 }, (_, index) => ({
      ...freshOffer,
      offerId: `offer-${index}`,
    }));
    const resolver = resolverFor(adapterReturning(tooMany));

    await expect(resolver.resolve(lookup)).resolves.toEqual({
      status: "invalid_response",
      offers: [],
    });

    const duplicateResolver = resolverFor(
      adapterReturning([freshOffer, { ...freshOffer, displayName: "duplicate" }]),
    );
    await expect(duplicateResolver.resolve(lookup)).resolves.toEqual({
      status: "invalid_response",
      offers: [],
    });
  });

  it("keeps inferred mappings explicitly unverified when evidence mode is enabled", async () => {
    const inferredOffer = {
      ...freshOffer,
      offerId: "offer-ambiguous-chair",
      identityEvidence: {
        match: "ambiguous",
        method: "name_dimensions_style",
        confidence: "medium",
        evidence: ["Name and dimensions match; variant UUID is absent"],
      },
    };
    const resolver = resolverFor(adapterReturning([inferredOffer]), {
      allowInferredIdentityEvidence: true,
    });

    await expect(resolver.resolve(lookup)).resolves.toMatchObject({
      status: "ok",
      offers: [
        {
          offerId: "offer-ambiguous-chair",
          eligibility: "unverified",
          identityEvidence: inferredOffer.identityEvidence,
        },
      ],
    });
  });

  it("preserves explicit pack pricing evidence for unit normalization", async () => {
    const resolver = resolverFor(
      adapterReturning([
        {
          ...freshOffer,
          price: {
            amountMinor: 24000,
            currency: "USD",
            unit: "pack",
            quantity: 2,
          },
        },
      ]),
    );

    await expect(resolver.resolve(lookup)).resolves.toMatchObject({
      status: "ok",
      offers: [
        {
          price: { amountMinor: 24000, currency: "USD", unit: "pack", quantity: 2 },
        },
      ],
    });
  });
});

describe("SANDBOX_RETAILER_ADAPTER", () => {
  it("returns deterministic synthetic offers only for its canonical fixture", async () => {
    const resolver = createRetailerOfferResolver([SANDBOX_RETAILER_ADAPTER], {
      clock: () => now,
    });

    await expect(
      resolver.resolve({
        catalogRef: {
          catalogId: uuid(10),
          productId: uuid(11),
        },
      }),
    ).resolves.toMatchObject({ status: "ok" });
    await expect(
      resolver.resolve({
        catalogRef: {
          catalogId: uuid(10),
          productId: uuid(99),
        },
      }),
    ).resolves.toEqual({ status: "no_offers", offers: [] });
  });
});
