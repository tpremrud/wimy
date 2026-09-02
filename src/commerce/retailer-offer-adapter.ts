import { z } from "zod";

const MAX_ATTEMPTS = 3;
const MAX_OFFERS = 20;
const DEFAULT_CACHE_TTL_MS = 30_000;

const CatalogRefSchema = z
  .object({
    catalogId: z.string().uuid(),
    productId: z.string().uuid(),
  })
  .strict();

const StableIdSchema = z
  .string()
  .regex(/^[A-Za-z][A-Za-z0-9_-]{0,127}$/u, "Expected a stable identifier");

const containsControlCharacter = (value: string) =>
  Array.from(value).some((character) => {
    const codePoint = character.codePointAt(0);
    return (
      codePoint !== undefined &&
      (codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f))
    );
  });

const boundedText = (maxLength: number) =>
  z
    .string()
    .refine((value) => !containsControlCharacter(value), {
      message: "Control characters are not allowed",
    })
    .transform((value) => value.trim())
    .pipe(z.string().min(1).max(maxLength));

const HttpsUrlSchema = boundedText(2_048).refine((value) => {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}, "Expected an HTTPS URL");

const TimestampSchema = z.string().datetime({ offset: true });

const OfferPriceSchema = z
  .object({
    amountMinor: z.number().int().nonnegative().max(1_000_000_000),
    currency: z.string().regex(/^[A-Z]{3}$/u),
    unit: z.enum(["each", "pack"]).optional(),
    quantity: z.number().int().positive().max(10_000).optional(),
  })
  .strict()
  .superRefine((price, context) => {
    if ((price.unit === undefined) !== (price.quantity === undefined)) {
      context.addIssue({
        code: "custom",
        message: "Price unit and quantity must be supplied together",
        path: [price.unit === undefined ? "unit" : "quantity"],
      });
    }
  });

const IdentityEvidenceSchema = z.discriminatedUnion("match", [
  z
    .object({
      match: z.literal("exact"),
      method: z.literal("authorized_catalog_variant_uuid"),
      confidence: z.enum(["high", "medium", "low"]).optional(),
      evidence: z.array(boundedText(240)).max(8).optional(),
    })
    .strict(),
  z
    .object({
      match: z.literal("ambiguous"),
      method: z.literal("name_dimensions_style"),
      confidence: z.enum(["high", "medium", "low"]).optional(),
      evidence: z.array(boundedText(240)).max(8).optional(),
    })
    .strict(),
  z
    .object({
      match: z.literal("substitute"),
      method: z.literal("category_style_similarity"),
      confidence: z.enum(["high", "medium", "low"]).optional(),
      evidence: z.array(boundedText(240)).max(8).optional(),
    })
    .strict(),
]);

const RetailerOfferSchema = z
  .object({
    offerId: StableIdSchema,
    retailerId: StableIdSchema,
    sellerId: StableIdSchema,
    catalogRef: CatalogRefSchema,
    displayName: boundedText(160),
    productUrl: HttpsUrlSchema,
    price: OfferPriceSchema,
    availability: z.enum(["in_stock", "out_of_stock", "unknown"]),
    observedAt: TimestampSchema,
    expiresAt: TimestampSchema,
    provenance: z
      .object({
        sourceName: boundedText(160),
        sourceUrl: HttpsUrlSchema,
        sourceKind: z.literal("authorized_api"),
      })
      .strict(),
    identityEvidence: IdentityEvidenceSchema,
  })
  .strict();

const LookupSchema = z
  .object({ catalogRef: CatalogRefSchema })
  .strict();

type RawRetailerOffer = z.infer<typeof RetailerOfferSchema>;

export type RetailerOfferLookup = z.infer<typeof LookupSchema>;

export type RetailerOffer = RawRetailerOffer & {
  eligibility: "purchasable" | "stale" | "unavailable" | "unverified";
  provenance: RawRetailerOffer["provenance"] & {
    adapterId: string;
    retailerId: string;
    sellerId: string;
    environment: RetailerOfferAdapter["environment"];
  };
  identityEvidence: RawRetailerOffer["identityEvidence"] & {
    catalogRef: RetailerOfferLookup["catalogRef"];
  };
};

const hashText = (value: string, seed: number) => {
  let hash = seed;
  for (const character of value) {
    hash = Math.imul(hash ^ character.charCodeAt(0), 16_777_619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
};

/**
 * Produces a bounded, deterministic digest for an exact offer snapshot.
 * The digest is derived from every fact the cart relies on without exposing
 * URLs, names, or other source metadata in a client-visible version token.
 */
export const getRetailerOfferVersion = (offer: RetailerOffer): string => {
  const canonicalFacts = JSON.stringify([
    offer.offerId,
    offer.retailerId,
    offer.sellerId,
    offer.catalogRef.catalogId,
    offer.catalogRef.productId,
    offer.displayName,
    offer.productUrl,
    offer.price.amountMinor,
    offer.price.currency,
    offer.price.unit ?? null,
    offer.price.quantity ?? null,
    offer.availability,
    offer.observedAt,
    offer.expiresAt,
    offer.provenance.sourceName,
    offer.provenance.sourceUrl,
    offer.provenance.sourceKind,
    offer.provenance.adapterId,
    offer.provenance.environment,
    offer.identityEvidence.match,
    offer.identityEvidence.method,
    offer.identityEvidence.confidence ?? null,
    offer.identityEvidence.evidence ?? [],
    offer.identityEvidence.catalogRef.catalogId,
    offer.identityEvidence.catalogRef.productId,
  ]);
  return `offer-v1:${hashText(canonicalFacts, 2_166_136_261)}${hashText(canonicalFacts, 2_247_144_179)}`;
};

export type RetailerOfferResolution =
  | { status: "ok"; offers: readonly RetailerOffer[] }
  | { status: "no_offers"; offers: readonly [] }
  | {
      status:
        | "invalid_request"
        | "invalid_response"
        | "adapter_error"
        | "rate_limited"
        | "cancelled";
      offers: readonly [];
    };

export type RetailerOfferAdapter = {
  readonly adapterId: string;
  readonly retailerId: string;
  readonly sellerId: string;
  readonly environment: "sandbox" | "production";
  readonly fetchOffers: (
    lookup: RetailerOfferLookup,
    context: { readonly signal: AbortSignal },
  ) => Promise<unknown>;
};

export type RetailerOfferResolverOptions = {
  readonly clock?: () => Date;
  readonly maxAttempts?: number;
  readonly cacheTtlMs?: number;
  readonly maxOffers?: number;
  readonly minIntervalMs?: number;
  readonly allowInferredIdentityEvidence?: boolean;
};

export type RetailerOfferEvidenceState =
  | "exact"
  | "ambiguous"
  | "substitute"
  | "stale"
  | "unavailable";

type CachedOffers = {
  readonly cachedAt: number;
  readonly offers: readonly RetailerOffer[];
};

const emptyResolution = (
  status: Exclude<RetailerOfferResolution["status"], "ok" | "no_offers">,
): RetailerOfferResolution => ({ status, offers: [] });

const cloneOffers = (offers: readonly RetailerOffer[]) =>
  structuredClone(offers);

const optionNumber = (
  name: string,
  value: number | undefined,
  defaultValue: number,
  maximum?: number,
) => {
  const result = value ?? defaultValue;
  if (
    !Number.isInteger(result) ||
    result < 0 ||
    (maximum !== undefined && result > maximum)
  ) {
    throw new RangeError(`${name} must be a bounded non-negative integer`);
  }
  return result;
};

const sameCatalogRef = (
  first: RetailerOfferLookup["catalogRef"],
  second: RetailerOfferLookup["catalogRef"],
) =>
  first.catalogId === second.catalogId && first.productId === second.productId;

const offerIsFreshlyStructured = (offer: RawRetailerOffer, now: number) => {
  const observedAt = Date.parse(offer.observedAt);
  const expiresAt = Date.parse(offer.expiresAt);
  return (
    Number.isFinite(observedAt) &&
    Number.isFinite(expiresAt) &&
    observedAt <= now &&
    expiresAt > observedAt
  );
};

const eligibilityFor = (
  offer: RawRetailerOffer,
  now: number,
): RetailerOffer["eligibility"] => {
  if (offer.identityEvidence.match !== "exact") return "unverified";
  if (offer.availability !== "in_stock") return "unavailable";
  return Date.parse(offer.expiresAt) > now ? "purchasable" : "stale";
};

export const getRetailerOfferEvidenceState = (
  offer: Pick<RetailerOffer, "eligibility" | "identityEvidence">,
): RetailerOfferEvidenceState => {
  if (offer.eligibility === "unverified") return offer.identityEvidence.match;
  if (offer.eligibility === "stale") return "stale";
  return "unavailable" === offer.eligibility ? "unavailable" : "exact";
};

const revalidateEligibility = (
  offers: readonly RetailerOffer[],
  now: number,
) =>
  offers.map((offer) => ({
    ...structuredClone(offer),
    eligibility: eligibilityFor(offer, now),
  }));

const normalizeOffers = (
  adapter: RetailerOfferAdapter,
  lookup: RetailerOfferLookup,
  response: unknown,
  now: number,
  maxOffers: number,
  allowInferredIdentityEvidence: boolean,
): readonly RetailerOffer[] | undefined => {
  const parsed = z.array(RetailerOfferSchema).safeParse(response);
  if (!parsed.success || parsed.data.length > maxOffers) return undefined;

  const offerIds = new Set<string>();
  const offers: RetailerOffer[] = [];
  for (const offer of parsed.data) {
    if (
      offerIds.has(offer.offerId) ||
      offer.retailerId !== adapter.retailerId ||
      offer.sellerId !== adapter.sellerId ||
      !sameCatalogRef(offer.catalogRef, lookup.catalogRef) ||
      !offerIsFreshlyStructured(offer, now) ||
      (offer.identityEvidence.match !== "exact" &&
        !allowInferredIdentityEvidence)
    ) {
      return undefined;
    }

    offerIds.add(offer.offerId);
    offers.push({
      ...structuredClone(offer),
      provenance: {
        ...structuredClone(offer.provenance),
        adapterId: adapter.adapterId,
        retailerId: adapter.retailerId,
        sellerId: adapter.sellerId,
        environment: adapter.environment,
      },
      identityEvidence: {
        ...structuredClone(offer.identityEvidence),
        catalogRef: structuredClone(lookup.catalogRef),
      },
      eligibility: eligibilityFor(offer, now),
    });
  }

  return offers;
};

const callWithRetries = async (
  adapter: RetailerOfferAdapter,
  lookup: RetailerOfferLookup,
  signal: AbortSignal,
  maxAttempts: number,
): Promise<
  | { status: "success"; response: unknown }
  | { status: "adapter_error" | "cancelled" }
> => {
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    if (signal.aborted) return { status: "cancelled" };

    try {
      return {
        status: "success",
        response: await adapter.fetchOffers(
          structuredClone(lookup),
          { signal },
        ),
      };
    } catch {
      if (signal.aborted) return { status: "cancelled" };
    }
  }

  return { status: "adapter_error" };
};

export type RetailerOfferResolver = {
  readonly resolve: (
    lookup: RetailerOfferLookup,
    options?: { readonly signal?: AbortSignal },
  ) => Promise<RetailerOfferResolution>;
  readonly clearCache: () => void;
};

export const createRetailerOfferResolver = (
  adapters: readonly RetailerOfferAdapter[],
  options: RetailerOfferResolverOptions = {},
): RetailerOfferResolver => {
  const clock = options.clock ?? (() => new Date());
  const maxAttempts = optionNumber("maxAttempts", options.maxAttempts, MAX_ATTEMPTS, MAX_ATTEMPTS);
  const cacheTtlMs = optionNumber("cacheTtlMs", options.cacheTtlMs, DEFAULT_CACHE_TTL_MS);
  const maxOffers = optionNumber("maxOffers", options.maxOffers, MAX_OFFERS, MAX_OFFERS);
  const minIntervalMs = optionNumber("minIntervalMs", options.minIntervalMs, 0);
  const allowInferredIdentityEvidence = options.allowInferredIdentityEvidence ?? false;
  const cache = new Map<string, CachedOffers>();
  const lastCallAt = new Map<string, number>();

  const resolve = async (
    lookup: RetailerOfferLookup,
    resolveOptions: { readonly signal?: AbortSignal } = {},
  ): Promise<RetailerOfferResolution> => {
    const parsedLookup = LookupSchema.safeParse(lookup);
    if (!parsedLookup.success) return emptyResolution("invalid_request");

    const now = clock().valueOf();
    if (!Number.isFinite(now)) return emptyResolution("invalid_request");

    const signal = resolveOptions.signal ?? new AbortController().signal;
    if (signal.aborted) return emptyResolution("cancelled");

    const allOffers: RetailerOffer[] = [];
    for (const adapter of adapters) {
      const cacheKey = `${adapter.adapterId}:${parsedLookup.data.catalogRef.catalogId}:${parsedLookup.data.catalogRef.productId}`;
      const cached = cache.get(cacheKey);
      if (cached && now - cached.cachedAt < cacheTtlMs) {
        allOffers.push(...revalidateEligibility(cached.offers, now));
        continue;
      }

      const previousCallAt = lastCallAt.get(cacheKey);
      if (
        previousCallAt !== undefined &&
        now - previousCallAt < minIntervalMs
      ) {
        return emptyResolution("rate_limited");
      }
      lastCallAt.set(cacheKey, now);

      const result = await callWithRetries(
        adapter,
        parsedLookup.data,
        signal,
        maxAttempts,
      );
      if (result.status !== "success") {
        return emptyResolution(result.status);
      }

      const normalized = normalizeOffers(
        adapter,
        parsedLookup.data,
        result.response,
        now,
        maxOffers,
        allowInferredIdentityEvidence,
      );
      if (normalized === undefined) return emptyResolution("invalid_response");

      cache.set(cacheKey, {
        cachedAt: now,
        offers: cloneOffers(normalized),
      });
      allOffers.push(...normalized);
      if (allOffers.length > maxOffers) return emptyResolution("invalid_response");
    }

    const seenOfferIds = new Set<string>();
    if (allOffers.some(({ offerId }) => {
      if (seenOfferIds.has(offerId)) return true;
      seenOfferIds.add(offerId);
      return false;
    })) {
      return emptyResolution("invalid_response");
    }

    return allOffers.length > 0
      ? { status: "ok", offers: cloneOffers(allOffers) }
      : { status: "no_offers", offers: [] };
  };

  return {
    resolve,
    clearCache: () => {
      cache.clear();
      lastCallAt.clear();
    },
  };
};

const SANDBOX_CATALOG_ID = "00000000-0000-4000-8000-000000000010";
const SANDBOX_VARIANT_ID = "00000000-0000-4000-8000-000000000011";

const SANDBOX_FIXTURE_OFFERS: readonly RawRetailerOffer[] = [
  {
    offerId: "sandbox-offer-solstice-chair",
    retailerId: "fictional-retailer",
    sellerId: "fictional-retailer-direct",
    catalogRef: {
      catalogId: SANDBOX_CATALOG_ID,
      productId: SANDBOX_VARIANT_ID,
    },
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
  },
];

export const SANDBOX_RETAILER_ADAPTER: RetailerOfferAdapter = {
  adapterId: "fictional-adapter",
  retailerId: "fictional-retailer",
  sellerId: "fictional-retailer-direct",
  environment: "sandbox",
  fetchOffers: async (lookup) => {
    const isFixture =
      lookup.catalogRef.catalogId === SANDBOX_CATALOG_ID &&
      lookup.catalogRef.productId === SANDBOX_VARIANT_ID;
    return isFixture ? structuredClone(SANDBOX_FIXTURE_OFFERS) : [];
  },
};
