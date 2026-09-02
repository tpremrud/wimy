/// <reference types="webmcp-types" />

import { z } from "zod";
import type {
  Cart,
  CartErrorCode,
  CartMutationResult,
  CartReadResult,
} from "../commerce/cart";
import { getRetailerOfferVersion } from "../commerce/cart";
import type { RetailerOffer } from "../commerce/retailer-offer-adapter";
import type {
  CustomerSessionClient,
  CustomerCartClient,
} from "../commerce/customer-session-demo";
import {
  getRetailerOfferEvidenceState,
  type RetailerOfferResolver,
} from "../commerce/retailer-offer-adapter";
import { createSyntheticRetailerOfferResolver } from "../commerce/synthetic-retailer-offers";
import {
  createRoomShoppingPlan,
  type ComparableShoppingOffer,
  type RoomShoppingPlan,
} from "../commerce/shopping-plan";
import {
  catalogItemKey,
  findFurniture,
  type CatalogItem,
} from "../room/catalog";
import {
  EntityIdSchema,
  PoseSchema,
  type WimyRoomV1,
} from "../room/document";
import { projectFurnitureOrientation } from "../room/orientation";
import { projectOpeningSemantics } from "../room/opening";
import { findLayoutWarnings, type RoomWarning } from "../room/placement";
import type { RoomStore } from "../room/store";
import { LOCAL_CATALOG_TRANSACTION } from "../room/transaction";
import {
  rankComparableSubstitutes,
  type SubstituteSuggestion,
} from "../room/substitutes";

export type WebMcpToolDefinition = WebMCP.ModelContextTool;
export type WebMcpRegistrationStatus =
  | { available: false; registered: []; errors: [] }
  | { available: true; registered: string[]; errors: string[] };

export const MAX_WEBMCP_WARNINGS = 50;
export const MAX_WEBMCP_OUTPUT_BYTES = 128 * 1_024;

const throwIfAborted = (signal?: AbortSignal) => {
  if (signal?.aborted) {
    throw new DOMException("The operation was aborted", "AbortError");
  }
};

const conciseRegistrationError = (reason: unknown) => {
  const rawMessage =
    reason instanceof Error
      ? reason.message
      : typeof reason === "string"
        ? reason
        : "registration failed";
  const withoutControlCharacters = Array.from(rawMessage, (character) => {
    const codePoint = character.codePointAt(0);
    return codePoint !== undefined &&
      (codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f))
      ? " "
      : character;
  }).join("");
  const message = withoutControlCharacters
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, 160);

  return message || "registration failed";
};

const projectWarning = (warning: RoomWarning): RoomWarning => {
  if (warning.code === "OVERLAP") {
    return {
      code: warning.code,
      message: `${warning.itemIds[0]} overlaps ${warning.itemIds[1]}`,
      itemIds: [...warning.itemIds],
    };
  }

  if (warning.code === "DOOR_CLEARANCE") {
    return {
      code: warning.code,
      message: warning.message,
      itemIds: [...warning.itemIds],
    };
  }

  return {
    code: warning.code,
    message: `${warning.itemIds[0]} references an unavailable catalog item`,
    itemIds: [...warning.itemIds],
  };
};

const projectWarnings = (warnings: readonly RoomWarning[]) => ({
  warnings: warnings.slice(0, MAX_WEBMCP_WARNINGS).map(projectWarning),
  warningCount: warnings.length,
  warningsTruncated: warnings.length > MAX_WEBMCP_WARNINGS,
});

const URL_FRAGMENT_PATTERN =
  /\b(?:[a-z][a-z0-9+.-]*:(?:\/\/)?|www\.)[^\s<>]+|\/\/[^\s<>]+/giu;

const SPACED_URL_SCHEME_PATTERN =
  /\b([a-z][a-z0-9+.-]*):\s+([^\s<>]+)/giu;
const SCHEME_ONLY_PATTERN = /\b([a-z][a-z0-9+.-]*):(?=$|\s)/giu;
const KNOWN_URL_SCHEMES = new Set([
  "about",
  "blob",
  "data",
  "file",
  "ftp",
  "ftps",
  "gopher",
  "http",
  "https",
  "irc",
  "ircs",
  "javascript",
  "ldap",
  "ldaps",
  "mailto",
  "news",
  "nntp",
  "sms",
  "ssh",
  "tel",
  "urn",
  "ws",
  "wss",
]);
const SAFE_LOWERCASE_PROSE_LABELS = new Set([
  "category",
  "color",
  "depth",
  "height",
  "item",
  "name",
  "note",
  "price",
  "revision",
  "room",
  "status",
  "style",
  "width",
]);
const looksLikeUrlScheme = (scheme: string) =>
  KNOWN_URL_SCHEMES.has(scheme.toLowerCase()) ||
  /[+.-]/u.test(scheme);
const looksLikeProseLabel = (scheme: string) =>
  SAFE_LOWERCASE_PROSE_LABELS.has(scheme.toLowerCase());
const looksLikeSpacedUrl = (scheme: string, payload: string) =>
  looksLikeUrlScheme(scheme) ||
  /[/@,()[\]{}]/u.test(payload) ||
  !looksLikeProseLabel(scheme);

const projectUntrustedText = (value: string) => {
  const withoutMarkup = value
    .replace(/<[^>]*(?:>|$)/gu, " ")
    .replace(/[<>]/gu, " ");
  const withoutSpacedUrls = withoutMarkup.replace(
    SPACED_URL_SCHEME_PATTERN,
    (_fragment, scheme: string, payload: string) =>
      looksLikeSpacedUrl(scheme, payload)
        ? " "
        : `${scheme} — ${payload}`,
  );
  const withoutUrls = withoutSpacedUrls.replace(URL_FRAGMENT_PATTERN, " ");
  const withoutSchemeOnly = withoutUrls.replace(SCHEME_ONLY_PATTERN, " ");
  const projected = withoutSchemeOnly.replace(/\s+/gu, " ").trim();
  return projected || "[untrusted text omitted]";
};

const enforceWebMcpOutputBound = <Output,>(output: Output): Output => {
  const byteLength = new TextEncoder().encode(JSON.stringify(output)).byteLength;
  if (byteLength > MAX_WEBMCP_OUTPUT_BYTES) {
    throw new RangeError(
      `WebMCP output exceeds ${MAX_WEBMCP_OUTPUT_BYTES} UTF-8 bytes`,
    );
  }

  return output;
};

const InspectRoomInputSchema = z.object({}).strict();

const isStoreCatalogProductAvailable = (
  store: RoomStore,
  catalogRef: {
  catalogId: string;
  productId: string;
  },
) => {
  const resolved = store.resolveProduct(catalogRef.productId);
  return (
    resolved?.catalogRef.catalogId === catalogRef.catalogId &&
    resolved.catalogRef.productId === catalogRef.productId
  );
};

const CATALOG_CATEGORIES = [
  "bed",
  "desk",
  "chair",
  "sofa",
  "dresser",
  "rug",
  "table",
  "plant",
  "generic",
] as const;
const STYLE_TAG_PATTERN =
  "^(?:\\S|\\S[^\\u0000-\\u001F\\u007F-\\u009F]*\\S)$";

const FIND_FURNITURE_INPUT_SCHEMA = {
  type: "object",
  properties: {
    category: { enum: CATALOG_CATEGORIES },
    styleTags: {
      type: "array",
      maxItems: 8,
      items: {
        type: "string",
        minLength: 1,
        maxLength: 80,
        pattern: STYLE_TAG_PATTERN,
      },
    },
    maxPrice: { type: "number", minimum: 0 },
    maxWidth: {
      type: "number",
      exclusiveMinimum: 0,
    },
    maxDepth: {
      type: "number",
      exclusiveMinimum: 0,
    },
    limit: {
      type: "integer",
      minimum: 1,
      maximum: 5,
      default: 5,
    },
  },
  additionalProperties: false,
} as const;

const FindFurnitureInputSchema = z
  .object({
    category: z.enum(CATALOG_CATEGORIES).optional(),
    styleTags: z
      .array(z.string().min(1).max(80).regex(new RegExp(STYLE_TAG_PATTERN, "u")))
      .max(8)
      .optional(),
    maxPrice: z.number().nonnegative().optional(),
    maxWidth: z.number().positive().optional(),
    maxDepth: z.number().positive().optional(),
    limit: z.number().int().min(1).max(5).default(5),
  })
  .strict();

const INSPECT_RETAILER_OFFERS_INPUT_SCHEMA = {
  type: "object",
  properties: {
    catalogId: { type: "string", format: "uuid" },
    productId: { type: "string", format: "uuid" },
  },
  required: ["catalogId", "productId"],
  additionalProperties: false,
} as const;

const INSPECT_ROOM_SHOPPING_PLAN_INPUT_SCHEMA = {
  type: "object",
  properties: {},
  additionalProperties: false,
} as const;

const InspectRetailerOffersInputSchema = z
  .object({
    catalogId: z.string().uuid(),
    productId: z.string().uuid(),
  })
  .strict();

const InspectRoomShoppingPlanInputSchema = z.object({}).strict();

const ENTITY_ID_INPUT_SCHEMA = {
  type: "string",
  pattern: "^[A-Za-z][A-Za-z0-9_-]{0,63}$",
  minLength: 1,
  maxLength: 64,
} as const;

const CART_READ_INPUT_SCHEMA = {
  type: "object",
  properties: {},
  additionalProperties: false,
} as const;

const CANONICAL_CATALOG_REF_SCHEMA = {
  type: "object",
  properties: {
    catalogId: { type: "string", minLength: 1, maxLength: 128 },
    productId: { type: "string", minLength: 1, maxLength: 128 },
  },
  required: ["catalogId", "productId"],
  additionalProperties: false,
} as const;

const FIND_RETAILER_OFFERS_INPUT_SCHEMA = {
  type: "object",
  oneOf: [
    CANONICAL_CATALOG_REF_SCHEMA,
    {
      type: "object",
      properties: { placedItemId: ENTITY_ID_INPUT_SCHEMA },
      required: ["placedItemId"],
      additionalProperties: false,
    },
  ],
} as const;

const CART_MONEY_INPUT_SCHEMA = {
  type: "object",
  oneOf: [
    {
      type: "object",
      properties: {
        amountMinor: { type: "integer", minimum: 0, maximum: 1_000_000_000 },
        currency: { type: "string", pattern: "^[A-Z]{3}$" },
      },
      required: ["amountMinor", "currency"],
      additionalProperties: false,
    },
    {
      type: "object",
      properties: {
        amountMinor: { type: "integer", minimum: 0, maximum: 1_000_000_000 },
        currency: { type: "string", pattern: "^[A-Z]{3}$" },
        unit: { const: "each" },
        quantity: { const: 1 },
      },
      required: ["amountMinor", "currency", "unit", "quantity"],
      additionalProperties: false,
    },
    {
      type: "object",
      properties: {
        amountMinor: { type: "integer", minimum: 0, maximum: 1_000_000_000 },
        currency: { type: "string", pattern: "^[A-Z]{3}$" },
        unit: { const: "pack" },
        quantity: { type: "integer", minimum: 1, maximum: 10_000 },
      },
      required: ["amountMinor", "currency", "unit", "quantity"],
      additionalProperties: false,
    },
  ],
} as const;

const CART_MUTATION_COMMON_SCHEMA = {
  type: "object",
  properties: {
    expectedRevision: { type: "integer", minimum: 1, maximum: Number.MAX_SAFE_INTEGER },
    idempotencyKey: {
      type: "string",
      minLength: 1,
      maxLength: 128,
      pattern: "^[^\\u0000-\\u001F\\u007F-\\u009F ]+$",
    },
  },
  required: ["expectedRevision", "idempotencyKey"],
  additionalProperties: false,
} as const;

const ADD_TO_CART_INPUT_SCHEMA = {
  ...CART_MUTATION_COMMON_SCHEMA,
  properties: {
    ...CART_MUTATION_COMMON_SCHEMA.properties,
    offer: {
      type: "object",
      properties: {
        offerId: {
          type: "string",
          minLength: 1,
          maxLength: 128,
          pattern: "^[A-Za-z][A-Za-z0-9_-]{0,127}$",
        },
        offerVersion: { type: "string", minLength: 1, maxLength: 8_192 },
        catalogRef: CANONICAL_CATALOG_REF_SCHEMA,
        price: CART_MONEY_INPUT_SCHEMA,
      },
      required: ["offerId", "offerVersion", "catalogRef", "price"],
      additionalProperties: false,
    },
    quantity: { type: "integer", minimum: 1, maximum: 99 },
  },
  required: ["expectedRevision", "idempotencyKey", "offer", "quantity"],
  additionalProperties: false,
} as const;

const REMOVE_FROM_CART_INPUT_SCHEMA = {
  ...CART_MUTATION_COMMON_SCHEMA,
  properties: {
    ...CART_MUTATION_COMMON_SCHEMA.properties,
    lineId: ENTITY_ID_INPUT_SCHEMA,
  },
  required: ["expectedRevision", "idempotencyKey", "lineId"],
  additionalProperties: false,
} as const;

const SET_CART_QUANTITY_INPUT_SCHEMA = {
  ...REMOVE_FROM_CART_INPUT_SCHEMA,
  properties: {
    ...CART_MUTATION_COMMON_SCHEMA.properties,
    lineId: ENTITY_ID_INPUT_SCHEMA,
    quantity: { type: "integer", minimum: 1, maximum: 99 },
  },
  required: ["expectedRevision", "idempotencyKey", "lineId", "quantity"],
  additionalProperties: false,
} as const;

const CatalogRefInputSchema = z.object({
  catalogId: z.string().min(1).max(128),
  productId: z.string().min(1).max(128),
}).strict();

const FindRetailerOffersInputSchema = z.union([
  z.object({ catalogId: z.string().min(1).max(128), productId: z.string().min(1).max(128) }).strict(),
  z.object({ placedItemId: EntityIdSchema }).strict(),
]);

const CartReadInputSchema = z.object({}).strict();
const hasControlCharacters = (value: string) =>
  Array.from(value).some((character) => {
    const codePoint = character.codePointAt(0);
    return codePoint !== undefined &&
      (codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f));
  });
const CartMutationCommonInputSchema = z.object({
  expectedRevision: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  idempotencyKey: z.string().min(1).max(128).refine(
    (value) => !value.includes(" ") && !hasControlCharacters(value),
    "Idempotency keys cannot contain spaces or control characters",
  ),
}).strict();
const CartMoneyBaseInputSchema = z.object({
  amountMinor: z.number().int().nonnegative().max(1_000_000_000),
  currency: z.string().regex(/^[A-Z]{3}$/u),
}).strict();
const CartMoneyInputSchema = z.union([
  CartMoneyBaseInputSchema,
  CartMoneyBaseInputSchema.extend({
    unit: z.literal("each"),
    quantity: z.literal(1),
  }).strict(),
  CartMoneyBaseInputSchema.extend({
    unit: z.literal("pack"),
    quantity: z.number().int().positive().max(10_000),
  }).strict(),
]);
const AddToCartInputSchema = CartMutationCommonInputSchema.extend({
  offer: z.object({
    offerId: z.string().min(1).max(128).regex(/^[A-Za-z][A-Za-z0-9_-]{0,127}$/u),
    offerVersion: z.string().min(1).max(8_192),
    catalogRef: CatalogRefInputSchema,
    price: CartMoneyInputSchema,
  }).strict(),
  quantity: z.number().int().min(1).max(99),
}).strict();
const RemoveFromCartInputSchema = CartMutationCommonInputSchema.extend({
  lineId: EntityIdSchema,
}).strict();
const SetCartQuantityInputSchema = RemoveFromCartInputSchema.extend({
  quantity: z.number().int().min(1).max(99),
}).strict();

const PRODUCT_ID_INPUT_SCHEMA = {
  type: "string",
  pattern: "^[a-z][a-z0-9-]{0,127}$",
  minLength: 1,
  maxLength: 128,
} as const;
const FIND_SUBSTITUTES_INPUT_SCHEMA = {
  type: "object",
  properties: {
    itemId: ENTITY_ID_INPUT_SCHEMA,
    limit: {
      type: "integer",
      minimum: 1,
      maximum: 5,
      default: 5,
    },
  },
  required: ["itemId"],
  additionalProperties: false,
} as const;
const FindSubstitutesInputSchema = z
  .object({
    itemId: EntityIdSchema,
    limit: z.number().int().min(1).max(5).default(5),
  })
  .strict();
const PORTABLE_COORDINATE_INPUT_SCHEMA = {
  type: "number",
} as const;

const inspectRoom = (
  store: RoomStore,
  rawInput: Record<string, unknown>,
  signal?: AbortSignal,
) => {
  throwIfAborted(signal);
  if (!InspectRoomInputSchema.safeParse(rawInput).success) {
    throw new TypeError("inspect_room input must be an empty object");
  }

  const state = store.getState();
  const room = structuredClone(state.room) as WimyRoomV1;

  const warnings = findLayoutWarnings(room, (catalogRef) =>
    isStoreCatalogProductAvailable(store, catalogRef),
  );
  return enforceWebMcpOutputBound({
    revision: state.revision,
    units: "meters" as const,
    room: {
      name: projectUntrustedText(room.name),
      dimensions: { ...room.dimensions },
      geometry: room.geometry ?? { shape: "rectangle" as const },
      openings: room.openings.map((opening) => ({
        ...opening,
        ...projectOpeningSemantics(opening),
      })),
      items: room.items.map((item) => ({
        id: item.id,
        name: projectUntrustedText(item.snapshot.name),
        category: item.snapshot.category,
        dimensions: { ...item.snapshot.dimensions },
        pose: { ...item.pose },
        orientation: projectFurnitureOrientation(
          item.snapshot.category,
          item.pose.rotationDeg,
          item.snapshot.dimensions,
        ),
      })),
    },
    coordinateConvention: {
      origin: "northwest interior floor corner",
      planNorth: "top of the plan (room-local, not geographic north)",
      xAxis: "east/right",
      yAxis: "south/down",
      rotation: "clockwise quarter turns in degrees",
    },
    ...projectWarnings(warnings),
  });
};

const findFurnitureForRoom = (
  store: RoomStore,
  rawInput: unknown,
  signal?: AbortSignal,
) => {
  throwIfAborted(signal);
  const parsedInput = FindFurnitureInputSchema.safeParse(rawInput);
  if (!parsedInput.success) {
    throw new TypeError(
      "find_furniture input must match the exact catalog query schema",
    );
  }

  const state = store.getState();
  const room = structuredClone(state.room) as WimyRoomV1;
  const availableCatalog = store.readCatalog();
  const matches = findFurniture(room, parsedInput.data, availableCatalog).map(
    (match) => ({
      catalogId: match.catalogRef.catalogId,
      productId: match.catalogRef.productId,
      name: match.snapshot.name,
      category: match.snapshot.category,
      dimensions: { ...match.snapshot.dimensions },
      styleTags: [...match.snapshot.styleTags],
      ...(match.snapshot.commerce
        ? { price: { ...match.snapshot.commerce.price } }
        : {}),
      suggestedPose: { ...match.suggestedPose },
    }),
  );

  return enforceWebMcpOutputBound({
    revision: state.revision,
    units: "meters" as const,
    matches,
  });
};

const projectCatalogMetadata = (item: CatalogItem) =>
  item.metadata
    ? {
        origin: item.metadata.origin,
        publisherId: item.metadata.publisherId,
        catalogId: item.metadata.catalogId,
        catalogVersion: item.metadata.catalogVersion,
        itemId: item.metadata.itemId,
        variantId: item.metadata.variantId,
        provenance: {
          sourceName: projectUntrustedText(item.metadata.provenance.sourceName),
          observedAt: item.metadata.provenance.observedAt,
        },
        license: {
          name: projectUntrustedText(item.metadata.license.name),
          ...(item.metadata.license.spdxId
            ? { spdxId: item.metadata.license.spdxId }
            : {}),
        },
      }
    : undefined;

const projectSubstituteSuggestion = (suggestion: SubstituteSuggestion) => ({
  catalogRef: { ...suggestion.catalogRef },
  name: projectUntrustedText(suggestion.snapshot.name),
  category: suggestion.snapshot.category,
  dimensions: { ...suggestion.snapshot.dimensions },
  material: suggestion.snapshot.material
    ? projectUntrustedText(suggestion.snapshot.material)
    : null,
  color: suggestion.snapshot.appearance.color,
  styleTags: suggestion.snapshot.styleTags.map(projectUntrustedText),
  metadata: projectCatalogMetadata(suggestion),
  actionable: suggestion.actionable,
  fit: { ok: suggestion.fit.ok, pose: { ...suggestion.fit.pose } },
  identity: {
    source: suggestion.identity.source ? { ...suggestion.identity.source } : null,
    substitute: { ...suggestion.identity.substitute },
  },
  differences: {
    category: { ...suggestion.differences.category },
    dimensions: {
      source: { ...suggestion.differences.dimensions.source },
      substitute: { ...suggestion.differences.dimensions.substitute },
      delta: { ...suggestion.differences.dimensions.delta },
    },
    style: {
      shared: suggestion.differences.style.shared.map(projectUntrustedText),
      onlyInSource: suggestion.differences.style.onlyInSource.map(projectUntrustedText),
      onlyInSubstitute: suggestion.differences.style.onlyInSubstitute.map(projectUntrustedText),
    },
    material: { ...suggestion.differences.material },
    color: { ...suggestion.differences.color },
  },
  rationale: projectUntrustedText(suggestion.rationale),
  tradeoffs: suggestion.tradeoffs.map(projectUntrustedText),
});

const findSubstitutesForRoom = (
  store: RoomStore,
  rawInput: unknown,
  signal?: AbortSignal,
) => {
  throwIfAborted(signal);
  const parsedInput = FindSubstitutesInputSchema.safeParse(rawInput);
  if (!parsedInput.success) {
    throw new TypeError(
      "find_substitutes input must contain a placed item ID and bounded limit",
    );
  }

  const state = store.getState();
  const placedItem = state.room.items.find(({ id }) => id === parsedInput.data.itemId);
  if (!placedItem?.catalogRef) {
    return enforceWebMcpOutputBound({
      ok: false as const,
      revision: state.revision,
      code: "UNKNOWN_ITEM" as const,
      message: "Substitutes require a placed item with a canonical catalog identity",
    });
  }

  const source = store.readCatalog().find(
    (item) => catalogItemKey(item.catalogRef) === catalogItemKey(placedItem.catalogRef!),
  );
  if (!source) {
    return enforceWebMcpOutputBound({
      ok: false as const,
      revision: state.revision,
      code: "UNKNOWN_PRODUCT" as const,
      message: "The placed item's catalog identity is not available in the local catalog",
    });
  }

  const matches = rankComparableSubstitutes(
    state.room as WimyRoomV1,
    source,
    store.readCatalog(),
    placedItem.id,
    parsedInput.data.limit,
  );
  return enforceWebMcpOutputBound({
    ok: true as const,
    revision: state.revision,
    source: {
      itemId: placedItem.id,
      catalogRef: { ...source.catalogRef },
      name: projectUntrustedText(placedItem.snapshot.name),
      category: placedItem.snapshot.category,
      dimensions: { ...placedItem.snapshot.dimensions },
      material: placedItem.snapshot.material
        ? projectUntrustedText(placedItem.snapshot.material)
        : null,
      color: placedItem.snapshot.appearance.color,
      styleTags: placedItem.snapshot.styleTags.map(projectUntrustedText),
      pose: { ...placedItem.pose },
      metadata: projectCatalogMetadata(source),
    },
    matches: matches.map(projectSubstituteSuggestion),
  });
};

const inspectRetailerOffers = async (
  resolver: RetailerOfferResolver,
  rawInput: unknown,
  signal?: AbortSignal,
) => {
  throwIfAborted(signal);
  const parsedInput = InspectRetailerOffersInputSchema.safeParse(rawInput);
  if (!parsedInput.success) {
    throw new TypeError(
      "inspect_retailer_offers input must contain canonical catalog and product UUIDs",
    );
  }

  const resolution = await resolver.resolve(
    { catalogRef: parsedInput.data },
    { signal },
  );
  throwIfAborted(signal);

  return enforceWebMcpOutputBound({
    catalogId: parsedInput.data.catalogId,
    productId: parsedInput.data.productId,
    status: resolution.status,
    offers: resolution.offers.map((offer) => ({
      offerId: offer.offerId,
      retailer: offer.provenance.sourceName,
      sellerId: offer.sellerId,
      displayName: projectUntrustedText(offer.displayName),
      price: { ...offer.price },
      availability: offer.availability,
      productUrl: offer.productUrl,
      observedAt: offer.observedAt,
      expiresAt: offer.expiresAt,
      state: getRetailerOfferEvidenceState(offer),
      eligibility: offer.eligibility,
      identityEvidence: {
        match: offer.identityEvidence.match,
        method: offer.identityEvidence.method,
        confidence: offer.identityEvidence.confidence ?? "not_provided",
        evidence: offer.identityEvidence.evidence?.map(projectUntrustedText) ?? [],
      },
    })),
  });
};

const projectShoppingOffer = (offer: ComparableShoppingOffer) => ({
  offerId: offer.offerId,
  retailer: projectUntrustedText(offer.provenance.sourceName),
  sellerId: offer.sellerId,
  displayName: projectUntrustedText(offer.displayName),
  price: { ...offer.price },
  normalizedAmountMinor: offer.normalizedAmountMinor,
  normalizedUnitCount: offer.normalizedUnitCount,
  isCheapest: offer.isCheapest,
  availability: offer.availability,
  productUrl: offer.productUrl,
  provenance: {
    sourceName: projectUntrustedText(offer.provenance.sourceName),
    sourceUrl: offer.provenance.sourceUrl,
    sourceKind: offer.provenance.sourceKind,
  },
  observedAt: offer.observedAt,
  expiresAt: offer.expiresAt,
  identityEvidence: {
    match: offer.identityEvidence.match,
    method: offer.identityEvidence.method,
    confidence: offer.identityEvidence.confidence ?? "not_provided",
    evidence: offer.identityEvidence.evidence?.map(projectUntrustedText) ?? [],
  },
});

const MAX_PROJECTED_SHOPPING_OFFERS = 24;

const projectShoppingPlan = (plan: RoomShoppingPlan, revision: number) => {
  const allOffers = plan.retailers.flatMap(({ offers }) => offers);
  const visibleOfferIds = new Set(
    allOffers.slice(0, MAX_PROJECTED_SHOPPING_OFFERS).map(({ offerId }) => offerId),
  );

  return enforceWebMcpOutputBound({
    revision,
    status: plan.status,
    costDisclosure: plan.costDisclosure,
    untrackedItemCount: plan.untrackedItemCount,
    truncatedRequirementCount: plan.truncatedRequirementCount,
    truncatedOfferCount: Math.max(0, allOffers.length - visibleOfferIds.size),
    requirements: plan.requirements.map((requirement) => ({
      requirementId: requirement.requirementId,
      catalogRef: { ...requirement.catalogRef },
      name: projectUntrustedText(requirement.name),
      quantity: requirement.quantity,
      resolutionStatus: requirement.resolutionStatus,
      comparisons: requirement.comparison.groups.map((group) => ({
        currency: group.currency,
        basis: group.basis,
        cheapestOfferId: group.cheapestOfferId,
        offerIds: group.offers.map(({ offerId }) => offerId),
      })),
      excluded: requirement.comparison.excluded.map(({ offerId, reason }) => ({
        offerId,
        reason,
      })),
    })),
    retailers: plan.retailers
      .map((retailer) => ({
        retailerId: retailer.retailerId,
        retailer: projectUntrustedText(retailer.retailer),
        offers: retailer.offers
          .filter(({ offerId }) => visibleOfferIds.has(offerId))
          .map((offer) => ({
            ...projectShoppingOffer(offer),
            requirementId: offer.requirementId,
            requirementName: projectUntrustedText(offer.requirementName),
            quantity: offer.quantity,
          })),
      }))
      .filter(({ offers }) => offers.length > 0),
  });
};

const inspectRoomShoppingPlan = async (
  store: RoomStore,
  resolver: RetailerOfferResolver,
  rawInput: unknown,
  signal?: AbortSignal,
) => {
  throwIfAborted(signal);
  if (!InspectRoomShoppingPlanInputSchema.safeParse(rawInput).success) {
    throw new TypeError("inspect_room_shopping_plan input must be an empty object");
  }

  const state = store.getState();
  const plan = await createRoomShoppingPlan(
    state.room as WimyRoomV1,
    resolver,
    { signal },
  );
  throwIfAborted(signal);
  return projectShoppingPlan(plan, state.revision);
};

export type WebMcpCommerceContext = Readonly<{
  customerSession: CustomerSessionClient;
  session: import("../commerce/customer-session").CustomerSessionView;
}>;

const CART_TOOL_MAX_WARNINGS = 20;
const CART_TOOL_MAX_LINES = 50;
const CART_TOOL_MAX_OFFERS = 20;

const projectCartError = (error: { code: CartErrorCode; message: string; recoverable: true }) => ({
  code: error.code,
  message: projectUntrustedText(error.message).slice(0, 240),
  recoverable: true as const,
});

const projectCartReceipt = (receipt: CartReadResult["receipt"]) => ({
  type: receipt.type,
  origin: receipt.origin,
  operation: receipt.operation,
  status: receipt.status,
  revision: receipt.revision,
  lineCount: receipt.lineCount,
  totalQuantity: receipt.totalQuantity,
  ...(receipt.errorCode ? { errorCode: receipt.errorCode } : {}),
  ...(receipt.target
    ? {
        target: {
          offerId: receipt.target.offerId,
          displayName: projectUntrustedText(receipt.target.displayName),
          retailer: projectUntrustedText(receipt.target.retailer),
        },
      }
    : {}),
});

const cartOfferState = (line: Cart["lines"][number]) => {
  if (line.offer.eligibility === "stale" || Date.parse(line.offer.expiresAt) <= Date.now()) {
    return "stale" as const;
  }
  if (line.offer.eligibility !== "purchasable" || line.offer.availability !== "in_stock") {
    return "unavailable" as const;
  }
  return "fresh" as const;
};

const projectCart = (cart: Cart) => {
  const warnings = cart.lines
    .map((line) => {
      const state = cartOfferState(line);
      if (state === "fresh") return null;
      return {
        code: state === "stale" ? "OFFER_STALE" : "OFFER_UNAVAILABLE",
        message: `${projectUntrustedText(line.offer.displayName)} needs offer review before use`,
        recoverable: true as const,
      };
    })
    .filter((warning): warning is NonNullable<typeof warning> => warning !== null);

  return {
    revision: cart.revision,
    status: cart.status,
    currency: cart.currency,
    totals: { ...cart.totals },
    lines: cart.lines.slice(0, CART_TOOL_MAX_LINES).map((line) => ({
      lineId: line.lineId,
      quantity: line.quantity,
      lineTotalMinor: line.lineTotalMinor,
      offer: {
        offerId: line.offer.offerId,
        offerVersion: line.offer.offerVersion,
        catalogRef: { ...line.offer.catalogRef },
        retailer: projectUntrustedText(line.offer.provenance.sourceName),
        displayName: projectUntrustedText(line.offer.displayName),
        price: { ...line.offer.price },
        availability: line.offer.availability,
        state: cartOfferState(line),
        observedAt: line.offer.observedAt,
        expiresAt: line.offer.expiresAt,
      },
    })),
    lineCount: cart.lines.length,
    linesTruncated: cart.lines.length > CART_TOOL_MAX_LINES,
    warnings: warnings.slice(0, CART_TOOL_MAX_WARNINGS),
    warningCount: warnings.length,
    warningsTruncated: warnings.length > CART_TOOL_MAX_WARNINGS,
  };
};

const cartToolFailure = (operation: "read" | "add" | "remove" | "change_quantity", code: CartErrorCode, message: string) => ({
  ok: false as const,
  error: { code, message: projectUntrustedText(message).slice(0, 240), recoverable: true as const },
  receipt: {
    type: "commerce.cart.receipt" as const,
    origin: "webmcp" as const,
    operation,
    status: "rejected" as const,
    revision: 0,
    lineCount: 0,
    totalQuantity: 0,
    errorCode: code,
  },
});

const authorizeCartReadTool = async (
  customerSession: CustomerSessionClient,
  signal: AbortSignal,
) => {
  throwIfAborted(signal);
  let session;
  try {
    session = await customerSession.getSession();
  } catch {
    return cartToolFailure("read", "SESSION_UNAVAILABLE", "Cart authorization is unavailable");
  }
  throwIfAborted(signal);
  if (!session.authenticated) {
    return cartToolFailure("read", "ANONYMOUS_SESSION", "Cart authorization requires an active customer session");
  }
  if (!session.scopes.includes("commerce:cart:read")) {
    return cartToolFailure("read", "MISSING_SCOPE", "Cart read scope is required");
  }
  return { ok: true as const };
};

const projectRetailerOffer = (offer: RetailerOffer) => ({
  offerId: offer.offerId,
  offerVersion: getRetailerOfferVersion(offer),
  catalogRef: { ...offer.catalogRef },
  retailer: projectUntrustedText(offer.provenance.sourceName),
  displayName: projectUntrustedText(offer.displayName),
  price: { ...offer.price },
  availability: offer.availability,
  state: getRetailerOfferEvidenceState(offer),
  eligibility: offer.eligibility,
  observedAt: offer.observedAt,
  expiresAt: offer.expiresAt,
  identity: {
    match: offer.identityEvidence.match,
    method: offer.identityEvidence.method,
  },
});

const resolveOfferLookup = (
  store: RoomStore,
  input: import("zod").infer<typeof FindRetailerOffersInputSchema>,
) => {
  const catalogRef = "placedItemId" in input
    ? store.getState().room.items.find(({ id }) => id === input.placedItemId)?.catalogRef
    : input;
  if (!catalogRef) {
    return { ok: false as const, code: "INVALID_REQUEST" as const, message: "A canonical catalog item or placed item is required" };
  }
  const catalogItem = store.readCatalog().find(
    ({ catalogRef: candidate }) =>
      candidate.catalogId === catalogRef.catalogId && candidate.productId === catalogRef.productId,
  );
  if (!catalogItem) {
    return { ok: false as const, code: "OFFER_NOT_FOUND" as const, message: "The canonical catalog item is unavailable" };
  }
  return { ok: true as const, catalogRef: { ...catalogItem.catalogRef } };
};

const inspectCartTool = async (
  customerSession: CustomerSessionClient,
  rawInput: unknown,
  signal: AbortSignal,
) => {
  const parsed = CartReadInputSchema.safeParse(rawInput);
  if (!parsed.success) return cartToolFailure("read", "INVALID_REQUEST", "inspect_cart input must be empty");
  const authorization = await authorizeCartReadTool(customerSession, signal);
  if (!authorization.ok) return authorization;
  const cart = customerSession.cart;
  if (!cart) return cartToolFailure("read", "SESSION_UNAVAILABLE", "Cart access is unavailable");
  const result = await cart.getCart(signal, "webmcp");
  throwIfAborted(signal);
  if (!result.ok) {
    return {
      ok: false as const,
      error: projectCartError(result.error),
      receipt: projectCartReceipt(result.receipt),
    };
  }
  return {
    ok: true as const,
    cart: projectCart(result.cart),
    receipt: projectCartReceipt(result.receipt),
  };
};

const findRetailerOffersTool = async (
  store: RoomStore,
  resolver: RetailerOfferResolver,
  customerSession: CustomerSessionClient,
  rawInput: unknown,
  signal: AbortSignal,
) => {
  const parsed = FindRetailerOffersInputSchema.safeParse(rawInput);
  if (!parsed.success) return cartToolFailure("read", "INVALID_REQUEST", "find_retailer_offers requires one canonical catalog or placed item identity");
  const authorization = await authorizeCartReadTool(customerSession, signal);
  if (!authorization.ok) return authorization;
  const lookup = resolveOfferLookup(store, parsed.data);
  if (!lookup.ok) return cartToolFailure("read", lookup.code, lookup.message);
  const resolution = await resolver.resolve({ catalogRef: lookup.catalogRef }, { signal });
  throwIfAborted(signal);
  const exactOffers = resolution.offers.filter(
    ({ identityEvidence }) => identityEvidence.match === "exact",
  );
  return enforceWebMcpOutputBound({
    ok: true as const,
    catalogRef: lookup.catalogRef,
    status: resolution.status,
    offerCount: exactOffers.length,
    offersTruncated: exactOffers.length > CART_TOOL_MAX_OFFERS,
    offers: exactOffers.slice(0, CART_TOOL_MAX_OFFERS).map(projectRetailerOffer),
  });
};

const projectMutation = (result: CartMutationResult) => result.ok
  ? { ok: true as const, cart: projectCart(result.cart), receipt: projectCartReceipt(result.receipt) }
  : { ok: false as const, error: projectCartError(result.error), receipt: projectCartReceipt(result.receipt) };

const addToCartTool = async (client: CustomerCartClient, rawInput: unknown, signal: AbortSignal) => {
  const parsed = AddToCartInputSchema.safeParse(rawInput);
  if (!parsed.success) return cartToolFailure("add", "INVALID_REQUEST", "add_to_cart input is invalid");
  throwIfAborted(signal);
  if (!client.addLine) return cartToolFailure("add", "SESSION_UNAVAILABLE", "Cart access is unavailable");
  const result = await client.addLine({ ...parsed.data, signal, origin: "webmcp" });
  throwIfAborted(signal);
  return projectMutation(result);
};

const removeFromCartTool = async (client: CustomerCartClient, rawInput: unknown, signal: AbortSignal) => {
  const parsed = RemoveFromCartInputSchema.safeParse(rawInput);
  if (!parsed.success) return cartToolFailure("remove", "INVALID_REQUEST", "remove_from_cart input is invalid");
  throwIfAborted(signal);
  if (!client.removeLine) return cartToolFailure("remove", "SESSION_UNAVAILABLE", "Cart access is unavailable");
  const result = await client.removeLine({ ...parsed.data, signal, origin: "webmcp" });
  throwIfAborted(signal);
  return projectMutation(result);
};

const setCartQuantityTool = async (client: CustomerCartClient, rawInput: unknown, signal: AbortSignal) => {
  const parsed = SetCartQuantityInputSchema.safeParse(rawInput);
  if (!parsed.success) return cartToolFailure("change_quantity", "INVALID_REQUEST", "set_cart_quantity input is invalid");
  throwIfAborted(signal);
  if (!client.changeQuantity) return cartToolFailure("change_quantity", "SESSION_UNAVAILABLE", "Cart access is unavailable");
  const result = await client.changeQuantity({ ...parsed.data, signal, origin: "webmcp" });
  throwIfAborted(signal);
  return projectMutation(result);
};

const APPLY_ROOM_EDIT_INPUT_SCHEMA = {
  type: "object",
  properties: {
    expectedRevision: {
      type: "integer",
      minimum: 1,
      maximum: Number.MAX_SAFE_INTEGER,
    },
    operations: {
      type: "array",
      minItems: 1,
      maxItems: 8,
      items: {
        oneOf: [
          {
            type: "object",
            properties: {
              type: { const: "add" },
              productId: PRODUCT_ID_INPUT_SCHEMA,
              pose: {
                type: "object",
                properties: {
                  x: PORTABLE_COORDINATE_INPUT_SCHEMA,
                  y: PORTABLE_COORDINATE_INPUT_SCHEMA,
                  rotationDeg: { enum: [0, 90, 180, 270] },
                },
                required: ["x", "y", "rotationDeg"],
                additionalProperties: false,
              },
            },
            required: ["type", "productId", "pose"],
            additionalProperties: false,
          },
          {
            type: "object",
            properties: {
              type: { const: "transform" },
              itemId: ENTITY_ID_INPUT_SCHEMA,
              pose: {
                type: "object",
                properties: {
                  x: PORTABLE_COORDINATE_INPUT_SCHEMA,
                  y: PORTABLE_COORDINATE_INPUT_SCHEMA,
                  rotationDeg: { enum: [0, 90, 180, 270] },
                },
                minProperties: 1,
                additionalProperties: false,
              },
            },
            required: ["type", "itemId", "pose"],
            additionalProperties: false,
          },
          {
            type: "object",
            properties: {
              type: { const: "remove" },
              itemId: ENTITY_ID_INPUT_SCHEMA,
            },
            required: ["type", "itemId"],
            additionalProperties: false,
          },
        ],
      },
    },
  },
  required: ["expectedRevision", "operations"],
  additionalProperties: false,
} as const;

const canonicalizeWebMcpCoordinate = (value: number) => {
  const scaled = value * 1_000;
  const canonical = Number.isFinite(scaled)
    ? Math.round(scaled) / 1_000
    : value;
  return Object.is(canonical, -0) ? 0 : canonical;
};
const WebMcpCoordinateSchema = z
  .number()
  .transform(canonicalizeWebMcpCoordinate);
const WebMcpPoseSchema = z
  .object({
    x: WebMcpCoordinateSchema,
    y: WebMcpCoordinateSchema,
    rotationDeg: PoseSchema.shape.rotationDeg,
  })
  .strict();
const TransformPoseSchema = WebMcpPoseSchema.partial().refine(
  (pose) => Object.keys(pose).length > 0,
  "A transform pose must change at least one field",
);
const ProductIdSchema = z
  .string()
  .regex(/^[a-z][a-z0-9-]{0,127}$/u);
const WebMcpRoomOperationSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("add"),
      productId: ProductIdSchema,
      pose: WebMcpPoseSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal("transform"),
      itemId: EntityIdSchema,
      pose: TransformPoseSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal("remove"),
      itemId: EntityIdSchema,
    })
    .strict(),
]);
const ApplyRoomEditInputSchema = z
  .object({
    expectedRevision: z
      .number()
      .int()
      .positive()
      .max(Number.MAX_SAFE_INTEGER),
    operations: z.array(WebMcpRoomOperationSchema).min(1).max(8),
  })
  .strict();

const applyRoomEdit = (
  store: RoomStore,
  rawInput: unknown,
  signal?: AbortSignal,
) => {
  throwIfAborted(signal);
  const current = store.getState();
  if (
    rawInput === null ||
    typeof rawInput !== "object" ||
    Array.isArray(rawInput)
  ) {
    return enforceWebMcpOutputBound({
      ok: false as const,
      revision: current.revision,
      code: "INVALID_DOCUMENT" as const,
      message:
        "input must contain only exact add, transform, or remove operations",
    });
  }
  const inputObject = rawInput as Record<string, unknown>;

  if (
    typeof inputObject.expectedRevision !== "number" ||
    !Number.isSafeInteger(inputObject.expectedRevision) ||
    inputObject.expectedRevision < 1
  ) {
    return enforceWebMcpOutputBound({
      ok: false as const,
      revision: current.revision,
      code: "INVALID_DOCUMENT" as const,
      message: "expectedRevision must be a positive integer",
    });
  }
  if (
    !Array.isArray(inputObject.operations) ||
    inputObject.operations.length < 1 ||
    inputObject.operations.length > 8
  ) {
    return enforceWebMcpOutputBound({
      ok: false as const,
      revision: current.revision,
      code: "TOO_MANY_OPERATIONS" as const,
      message: "operations must contain 1 to 8 items",
    });
  }

  const parsedInput = ApplyRoomEditInputSchema.safeParse(inputObject);
  if (!parsedInput.success) {
    return enforceWebMcpOutputBound({
      ok: false as const,
      revision: current.revision,
      code: "INVALID_DOCUMENT" as const,
      message:
        "input must contain only exact add, transform, or remove operations",
    });
  }

  const input = parsedInput.data;
  throwIfAborted(signal);
  const result = current.transact({
    [LOCAL_CATALOG_TRANSACTION]: true,
    expectedRevision: input.expectedRevision,
    origin: "webmcp",
    change: { type: "edit", operations: input.operations },
  });

  if (!result.ok) {
    return enforceWebMcpOutputBound({
      ok: false as const,
      revision: result.revision,
      code: result.code,
      message: result.message,
    });
  }

  return enforceWebMcpOutputBound({
    ok: true as const,
    revision: result.revision,
    applied: result.applied,
    itemIds: [...result.affectedItemIds],
    ...projectWarnings(result.warnings),
  });
};

export const createRoomToolDefinitions = (
  store: RoomStore,
  offerResolver: RetailerOfferResolver = createSyntheticRetailerOfferResolver(
    store.readCatalog,
  ),
  commerce?: WebMcpCommerceContext,
): WebMcpToolDefinition[] => {
  const definitions: WebMcpToolDefinition[] = [
    {
      name: "inspect_room",
      title: "Inspect room",
      description:
        "Read the current Wimy room revision, geometry, placed items, and layout warnings.",
      inputSchema: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
      annotations: {
        readOnlyHint: true,
        untrustedContentHint: true,
      },
      execute: (input, { signal }) => inspectRoom(store, input, signal),
    },
    {
      name: "find_furniture",
      title: "Find furniture",
      description:
        "Find deterministic geometric fits in Wimy's local fictional catalog without changing the room; suggestions are not aesthetic guarantees.",
      inputSchema: FIND_FURNITURE_INPUT_SCHEMA,
      annotations: {
        readOnlyHint: true,
        untrustedContentHint: false,
      },
      execute: (input, { signal }) =>
        findFurnitureForRoom(store, input, signal),
    },
    {
      name: "apply_room_edit",
      title: "Apply room edit",
      description:
        "Atomically add, transform, or remove placed items at an exact room revision.",
      inputSchema: APPLY_ROOM_EDIT_INPUT_SCHEMA,
      annotations: {
        readOnlyHint: false,
        untrustedContentHint: true,
      },
      execute: (input, { signal }) => applyRoomEdit(store, input, signal),
    },
    {
      name: "inspect_retailer_offers",
      title: "Inspect retailer offer evidence",
      description:
        "Read synthetic retailer offer evidence for one project-authored catalog variant by canonical UUID; this never changes the room.",
      inputSchema: INSPECT_RETAILER_OFFERS_INPUT_SCHEMA,
      annotations: {
        readOnlyHint: true,
        untrustedContentHint: true,
      },
      execute: (input, { signal }) =>
        inspectRetailerOffers(offerResolver, input, signal),
    },
    {
      name: "inspect_room_shopping_plan",
      title: "Inspect room shopping plan",
      description:
        "Read a bounded retailer-grouped comparison of current exact synthetic offers for the placed room variants; this never changes the room.",
      inputSchema: INSPECT_ROOM_SHOPPING_PLAN_INPUT_SCHEMA,
      annotations: {
        readOnlyHint: true,
        untrustedContentHint: true,
      },
      execute: (input, { signal }) =>
        inspectRoomShoppingPlan(store, offerResolver, input, signal),
    },
    {
      name: "find_substitutes",
      title: "Find furniture substitutes",
      description:
        "Rank deterministic same-category catalog substitutes for one placed item without changing the room; every actionable suggestion includes fit, identity differences, rationale, tradeoffs, and provenance, and replacement requires explicit human confirmation.",
      inputSchema: FIND_SUBSTITUTES_INPUT_SCHEMA,
      annotations: {
        readOnlyHint: true,
        untrustedContentHint: true,
      },
      execute: (input, { signal }) =>
        findSubstitutesForRoom(store, input, signal),
    },
  ];

  const cart = commerce?.customerSession.cart;
  const hasCartReadScope = commerce?.session.authenticated === true &&
    commerce.session.scopes.includes("commerce:cart:read");
  const hasCartWriteScope = commerce?.session.authenticated === true &&
    commerce.session.scopes.includes("commerce:cart:write");

  if (hasCartReadScope) {
    definitions.push(
      {
        name: "inspect_cart",
        title: "Inspect cart",
        description:
          "Read bounded totals, lines, offer freshness, and recoverable warnings for the signed-in customer cart; this never changes the room or places an order.",
        inputSchema: CART_READ_INPUT_SCHEMA,
        annotations: { readOnlyHint: true, untrustedContentHint: true },
        execute: (input, { signal }) => inspectCartTool(commerce.customerSession, input, signal),
      },
      {
        name: "find_retailer_offers",
        title: "Find retailer offers",
        description:
          "Read bounded authorized synthetic exact offers for one canonical catalog item or placed item; imported text is untrusted and this never changes the room or purchases anything.",
        inputSchema: FIND_RETAILER_OFFERS_INPUT_SCHEMA,
        annotations: { readOnlyHint: true, untrustedContentHint: true },
        execute: (input, { signal }) => findRetailerOffersTool(store, offerResolver, commerce.customerSession, input, signal),
      },
    );
  }

  if (hasCartWriteScope && cart) {
    definitions.push(
      {
        name: "add_to_cart",
        title: "Add to cart",
        description:
          "Add a bounded quantity of one exact authorized offer using the current cart revision, offer version, price, currency, catalog identity, and idempotency key; no checkout or purchase is available.",
        inputSchema: ADD_TO_CART_INPUT_SCHEMA,
        annotations: { readOnlyHint: false, untrustedContentHint: true },
        execute: (input, { signal }) => addToCartTool(cart, input, signal),
      },
      {
        name: "remove_from_cart",
        title: "Remove from cart",
        description:
          "Remove one exact cart line using the current cart revision and idempotency key; this is not checkout or purchase.",
        inputSchema: REMOVE_FROM_CART_INPUT_SCHEMA,
        annotations: { readOnlyHint: false, untrustedContentHint: true },
        execute: (input, { signal }) => removeFromCartTool(cart, input, signal),
      },
      {
        name: "set_cart_quantity",
        title: "Set cart quantity",
        description:
          "Set one exact cart line quantity using the current cart revision and idempotency key; this is not checkout or purchase.",
        inputSchema: SET_CART_QUANTITY_INPUT_SCHEMA,
        annotations: { readOnlyHint: false, untrustedContentHint: true },
        execute: (input, { signal }) => setCartQuantityTool(cart, input, signal),
      },
    );
  }

  return definitions;
};

export const registerRoomTools = async (
  modelContext: WebMCP.ModelContext | undefined,
  store: RoomStore,
  controller: AbortController,
  definitions = createRoomToolDefinitions(store),
): Promise<WebMcpRegistrationStatus> => {
  if (!modelContext) {
    return { available: false, registered: [], errors: [] };
  }

  const liveDefinitions = definitions.map((definition) => ({
    ...definition,
    execute: (
      input: Record<string, unknown>,
      { signal }: { signal: AbortSignal },
    ) =>
      definition.execute(input, {
        signal: signal
          ? AbortSignal.any([controller.signal, signal])
          : controller.signal,
      }),
  }));
  const settlements = await Promise.allSettled(
    liveDefinitions.map((definition) =>
      Promise.resolve().then(async () => {
        if (controller.signal.aborted) return false;

        await modelContext.registerTool(definition, {
          signal: controller.signal,
        });
        return !controller.signal.aborted;
      }),
    ),
  );
  if (controller.signal.aborted) {
    return { available: true, registered: [], errors: [] };
  }
  const registered: string[] = [];
  const errors: string[] = [];

  settlements.forEach((settlement, index) => {
    const definition = liveDefinitions[index];
    if (!definition) return;

    if (settlement.status === "fulfilled" && settlement.value) {
      registered.push(definition.name);
      return;
    }

    if (settlement.status === "fulfilled") return;

    errors.push(
      `${definition.name}: ${conciseRegistrationError(settlement.reason)}`,
    );
  });

  return { available: true, registered, errors };
};
