import {
  CustomerSessionAuthority,
  type CartAuthorizationResult,
} from "./customer-session";
import {
  getRetailerOfferVersion,
  type RetailerOffer,
  type RetailerOfferLookup,
  type RetailerOfferResolver,
} from "./retailer-offer-adapter";

export { getRetailerOfferVersion } from "./retailer-offer-adapter";

export const DEFAULT_CART_CURRENCY = "USD" as const;
export const MAX_CART_LINES = 50;
export const MAX_CART_QUANTITY = 99;
export const MAX_IDEMPOTENCY_KEY_LENGTH = 128;

type CatalogRef = RetailerOfferLookup["catalogRef"];

export type CartStatus = "active" | "abandoned";

export type CartMoney = Readonly<{
  amountMinor: number;
  currency: string;
  unit?: "each" | "pack";
  quantity?: number;
}>;

export type RetailerOfferSnapshot = Readonly<{
  offerId: string;
  offerVersion: string;
  retailerId: string;
  sellerId: string;
  catalogRef: CatalogRef;
  displayName: string;
  productUrl: string;
  price: CartMoney;
  availability: RetailerOffer["availability"];
  provider?: Readonly<{
    providerId: string;
    name: string;
  }>;
  eligibility: RetailerOffer["eligibility"];
  identityEvidence: Readonly<{
    match: "exact";
    method: "authorized_catalog_variant_uuid";
  }>;
  observedAt: string;
  expiresAt: string;
  provenance: Readonly<{
    sourceName: string;
    sourceUrl: string;
    sourceKind: "authorized_api";
    adapterId: string;
    environment: RetailerOffer["provenance"]["environment"];
  }>;
}>;

export type CartLine = Readonly<{
  lineId: string;
  quantity: number;
  lineTotalMinor: number;
  offer: RetailerOfferSnapshot;
}>;

export type Cart = Readonly<{
  cartId: string;
  customerId: string;
  status: CartStatus;
  revision: number;
  currency: string;
  lines: readonly CartLine[];
  totals: Readonly<{
    subtotalMinor: number;
    totalMinor: number;
    currency: string;
  }>;
  updatedAt: string;
}>;

export type CartOperation = "read" | "add" | "remove" | "change_quantity";
export type CartOrigin = "human" | "webmcp";

export type CartReceiptTarget = Readonly<{
  offerId: string;
  displayName: string;
  retailer: string;
}>;

export type CartAuditEvent = Readonly<{
  type: "commerce.cart.receipt";
  origin: CartOrigin;
  operation: CartOperation;
  status: "accepted" | "rejected";
  revision: number;
  lineCount: number;
  totalQuantity: number;
  errorCode?: CartErrorCode;
  target?: CartReceiptTarget;
}>;

export interface CartAuditEventSink {
  record: (event: CartAuditEvent) => void | Promise<void>;
}

export type CartReceipt = CartAuditEvent;

export type CartErrorCode =
  | "CANCELLED"
  | "ANONYMOUS_SESSION"
  | "SESSION_EXPIRED"
  | "SESSION_REVOKED"
  | "SESSION_UNAVAILABLE"
  | "MISSING_SCOPE"
  | "INVALID_CSRF"
  | "INVALID_REQUEST"
  | "CART_NOT_FOUND"
  | "CART_OWNERSHIP_MISMATCH"
  | "CART_LIFECYCLE_REJECTED"
  | "CART_REVISION_CONFLICT"
  | "IDEMPOTENCY_KEY_REQUIRED"
  | "IDEMPOTENCY_KEY_REUSED"
  | "CART_LIMIT_REACHED"
  | "QUANTITY_OUT_OF_RANGE"
  | "LINE_NOT_FOUND"
  | "OFFER_NOT_FOUND"
  | "OFFER_RESOLUTION_FAILED"
  | "OFFER_AMBIGUOUS"
  | "OFFER_SUBSTITUTE"
  | "OFFER_IDENTITY_MISMATCH"
  | "OFFER_STALE"
  | "OFFER_UNAVAILABLE"
  | "OFFER_VERSION_MISMATCH"
  | "OFFER_PRICE_MISMATCH"
  | "OFFER_CURRENCY_MISMATCH"
  | "CART_CURRENCY_MISMATCH"
  | "CART_TOTAL_OVERFLOW"
  | "STORE_UNAVAILABLE";

export class CartError extends Error {
  readonly code: CartErrorCode;
  readonly recoverable = true as const;

  constructor(code: CartErrorCode, message: string) {
    super(message);
    this.name = "CartError";
    this.code = code;
  }
}

export type CartErrorView = Readonly<{
  code: CartErrorCode;
  message: string;
  recoverable: true;
}>;

export type CartReadRequest = Readonly<{
  origin?: CartOrigin;
  signal?: AbortSignal;
  sessionToken?: string;
  cartId?: string;
}>;

export type CartAddRequest = Readonly<{
  origin?: CartOrigin;
  signal?: AbortSignal;
  sessionToken?: string;
  csrfSecret?: string;
  cartId?: string;
  expectedRevision: number;
  idempotencyKey: string;
  offer: Readonly<{
    offerId: string;
    offerVersion: string;
    catalogRef: CatalogRef;
    price: CartMoney;
  }>;
  quantity: number;
  quantityMode?: "increment" | "set";
}>;

export type CartRemoveRequest = Readonly<{
  origin?: CartOrigin;
  signal?: AbortSignal;
  sessionToken?: string;
  csrfSecret?: string;
  cartId?: string;
  expectedRevision: number;
  idempotencyKey: string;
  lineId: string;
}>;

export type CartChangeQuantityRequest = Readonly<{
  origin?: CartOrigin;
  signal?: AbortSignal;
  sessionToken?: string;
  csrfSecret?: string;
  cartId?: string;
  expectedRevision: number;
  idempotencyKey: string;
  lineId: string;
  quantity: number;
}>;

export type CartReadResult =
  | Readonly<{ ok: true; cart: Cart; receipt: CartReceipt }>
  | Readonly<{ ok: false; error: CartErrorView; receipt: CartReceipt }>;

export type CartMutationResult =
  | Readonly<{
      ok: true;
      cart: Cart;
      receipt: CartReceipt;
    }>
  | Readonly<{ ok: false; error: CartErrorView; receipt: CartReceipt }>;

export type CartService = Readonly<{
  getCart: (request: CartReadRequest) => Promise<CartReadResult>;
  addLine: (request: CartAddRequest) => Promise<CartMutationResult>;
  removeLine: (request: CartRemoveRequest) => Promise<CartMutationResult>;
  changeQuantity: (
    request: CartChangeQuantityRequest,
  ) => Promise<CartMutationResult>;
}>;

type CartMutationPlan = Readonly<{
  cart: Cart;
  receipt: CartReceipt;
}>;

type CartStoreTransactionRequest = Readonly<{
  origin: CartOrigin;
  signal?: AbortSignal;
  customerId: string;
  cartId: string;
  expectedRevision: number;
  idempotencyKey: string;
  requestFingerprint: string;
}>;

type CartStoreTransactionResult =
  | Readonly<{ status: "committed"; cart: Cart; receipt: CartReceipt }>
  | Readonly<{ status: "replayed"; cart: Cart; receipt: CartReceipt }>
  | Readonly<{ status: "revision_conflict"; cart: Cart }>
  | Readonly<{ status: "idempotency_mismatch"; cart: Cart }>
  | Readonly<{ status: "rejected"; cart: Cart; error: CartError }>
  | Readonly<{ status: "not_found" }>
  | Readonly<{ status: "owner_mismatch"; cart: Cart }>;

export interface CartStore {
  getOrCreateForCustomer: (
    customerId: string,
    currency: string,
  ) => Promise<Cart>;
  read: (cartId: string) => Promise<Cart | null>;
  transact: (
    request: CartStoreTransactionRequest,
    apply: (cart: Cart) => Promise<CartMutationPlan>,
  ) => Promise<CartStoreTransactionResult>;
}

type StoredIdempotencyResult = Readonly<{
  requestFingerprint: string;
  cart: Cart;
  receipt: CartReceipt;
}>;

type InMemoryCartStoreOptions = Readonly<{
  clock?: () => number;
  createCartId?: () => string;
  failTransactions?: boolean;
}>;

const hasControlCharacters = (value: string) =>
  Array.from(value).some((character) => {
    const codePoint = character.codePointAt(0);
    return codePoint !== undefined && (codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f));
  });

const clone = <T>(value: T): T => structuredClone(value);

const RECEIPT_URL_PATTERN =
  /\b[a-z][a-z0-9+.-]*:(?:\/\/)?[^\s<>]+|\/\/[^\s<>]+/giu;

const receiptText = (value: string) => {
  const projected = value
    .replace(/<[^>]*(?:>|$)/gu, " ")
    .replace(/[<>]/gu, " ")
    .replace(RECEIPT_URL_PATTERN, " ")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, 160);
  return projected || "[untrusted text omitted]";
};

const assertBoundedText = (value: unknown, label: string, maximum: number) => {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > maximum ||
    hasControlCharacters(value)
  ) {
    throw new CartError("INVALID_REQUEST", `${label} is invalid`);
  }
};

const assertBoundedIdentifier = (value: unknown, label: string) => {
  assertBoundedText(value, label, 128);
  if (!/^[A-Za-z][A-Za-z0-9_-]{0,127}$/u.test(value as string)) {
    throw new CartError("INVALID_REQUEST", `${label} is invalid`);
  }
};

const assertCatalogRef: (value: unknown) => asserts value is CatalogRef = (value) => {
  if (
    typeof value !== "object" ||
    value === null ||
    !("catalogId" in value) ||
    !("productId" in value)
  ) {
    throw new CartError("INVALID_REQUEST", "Catalog identity is invalid");
  }
  assertBoundedText(value.catalogId, "Catalog identity", 128);
  assertBoundedText(value.productId, "Catalog identity", 128);
};

const assertRevision = (value: unknown) => {
  if (!Number.isSafeInteger(value) || (value as number) < 1) {
    throw new CartError("INVALID_REQUEST", "Cart revision is invalid");
  }
};

const assertQuantity = (value: unknown) => {
  if (!Number.isSafeInteger(value) || (value as number) < 1 || (value as number) > MAX_CART_QUANTITY) {
    throw new CartError("QUANTITY_OUT_OF_RANGE", "Quantity must be between 1 and 99");
  }
};

const assertMoney = (value: unknown, label: string) => {
  if (typeof value !== "object" || value === null || !("amountMinor" in value) || !("currency" in value)) {
    throw new CartError("INVALID_REQUEST", `${label} is invalid`);
  }
  const money = value as { amountMinor: unknown; currency: unknown };
  if (!Number.isSafeInteger(money.amountMinor) || (money.amountMinor as number) < 0 || (money.amountMinor as number) > 1_000_000_000) {
    throw new CartError("INVALID_REQUEST", `${label} is invalid`);
  }
  if (typeof money.currency !== "string" || !/^[A-Z]{3}$/u.test(money.currency)) {
    throw new CartError("INVALID_REQUEST", `${label} is invalid`);
  }
  const withBasis = value as { unit?: unknown; quantity?: unknown };
  if ((withBasis.unit === undefined) !== (withBasis.quantity === undefined)) {
    throw new CartError("INVALID_REQUEST", `${label} is invalid`);
  }
  if (
    withBasis.unit !== undefined &&
    (withBasis.unit !== "each" && withBasis.unit !== "pack" ||
      !Number.isSafeInteger(withBasis.quantity) ||
      (withBasis.quantity as number) < 1 ||
      (withBasis.quantity as number) > 10_000 ||
      (withBasis.unit === "each" && withBasis.quantity !== 1))
  ) {
    throw new CartError("INVALID_REQUEST", `${label} is invalid`);
  }
};

const assertIdempotencyKey = (value: unknown) => {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > MAX_IDEMPOTENCY_KEY_LENGTH ||
    hasControlCharacters(value) ||
    value.includes(" ")
  ) {
    throw new CartError("IDEMPOTENCY_KEY_REQUIRED", "A bounded idempotency key is required");
  }
};

const assertCartRequest = (request: {
  cartId?: string;
  expectedRevision: number;
  idempotencyKey: string;
}) => {
  if (request.cartId !== undefined) assertBoundedIdentifier(request.cartId, "Cart identity");
  assertRevision(request.expectedRevision);
  assertIdempotencyKey(request.idempotencyKey);
};

const emptyReceipt = (operation: CartOperation, errorCode?: CartErrorCode): CartReceipt => ({
  type: "commerce.cart.receipt",
  origin: "human",
  operation,
  status: "rejected",
  revision: 0,
  lineCount: 0,
  totalQuantity: 0,
  ...(errorCode ? { errorCode } : {}),
});

const receiptFor = (
  operation: CartOperation,
  status: CartReceipt["status"],
  cart: Cart,
  origin: CartOrigin = "human",
  errorCode?: CartErrorCode,
  target?: CartReceiptTarget,
): CartReceipt => ({
  type: "commerce.cart.receipt",
  origin,
  operation,
  status,
  revision: cart.revision,
  lineCount: cart.lines.length,
  totalQuantity: cart.lines.reduce((total, line) => total + line.quantity, 0),
  ...(errorCode ? { errorCode } : {}),
  ...(target ? { target } : {}),
});

const receiptTargetForOffer = (
  offer: Pick<RetailerOfferSnapshot, "offerId" | "displayName" | "provenance">,
): CartReceiptTarget => ({
  offerId: offer.offerId,
  displayName: receiptText(offer.displayName),
  retailer: receiptText(offer.provenance.sourceName),
});

const receiptTargetForRequest = (
  cart: Cart,
  operation: Exclude<CartOperation, "read">,
  request: CartAddRequest | CartRemoveRequest | CartChangeQuantityRequest,
) => {
  const line = operation === "add"
    ? cart.lines.find(({ offer }) => offer.offerId === (request as CartAddRequest).offer.offerId)
    : cart.lines.find(({ lineId }) => lineId === (request as CartRemoveRequest).lineId);
  return line ? receiptTargetForOffer(line.offer) : undefined;
};

const errorView = (error: CartError): CartErrorView => ({
  code: error.code,
  message: error.message,
  recoverable: true,
});

const hashText = (value: string, seed: number) => {
  let hash = seed;
  for (const character of value) hash = Math.imul(hash ^ character.charCodeAt(0), 16_777_619);
  return (hash >>> 0).toString(16).padStart(8, "0");
};

const fingerprintFor = (value: unknown) => {
  const serialized = JSON.stringify(value);
  return `request-v1:${hashText(serialized, 2_166_136_261)}${hashText(serialized, 2_247_144_179)}`;
};

const cartWithTotals = (
  cart: Omit<Cart, "totals">,
): Cart => {
  const subtotalMinor = cart.lines.reduce((total, line) => {
    const next = total + line.lineTotalMinor;
    if (!Number.isSafeInteger(next) || next > 1_000_000_000_000) {
      throw new CartError("CART_TOTAL_OVERFLOW", "Cart total exceeds the supported bound");
    }
    return next;
  }, 0);
  return {
    ...cart,
    totals: {
      subtotalMinor,
      totalMinor: subtotalMinor,
      currency: cart.currency,
    },
  };
};

const createEmptyCart = (
  cartId: string,
  customerId: string,
  currency: string,
  updatedAt: string,
): Cart => cartWithTotals({
  cartId,
  customerId,
  status: "active",
  revision: 1,
  currency,
  lines: [],
  updatedAt,
});

export const createInMemoryCartStore = (
  options: InMemoryCartStoreOptions = {},
): CartStore => {
  const clock = options.clock ?? (() => Date.now());
  const createCartId = options.createCartId ?? (() => `cart-${Math.random().toString(36).slice(2)}`);
  const carts = new Map<string, Cart>();
  const cartByCustomer = new Map<string, string>();
  const idempotency = new Map<string, StoredIdempotencyResult>();
  const queues = new Map<string, Promise<void>>();

  const runSerially = async <T>(cartId: string, operation: () => Promise<T>): Promise<T> => {
    const previous = queues.get(cartId) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => { release = resolve; });
    queues.set(cartId, current);
    await previous;
    try {
      return await operation();
    } finally {
      release();
      if (queues.get(cartId) === current) queues.delete(cartId);
    }
  };

  return {
    getOrCreateForCustomer: async (customerId, currency) => {
      assertBoundedText(customerId, "Customer identity", 256);
      if (!/^[A-Z]{3}$/u.test(currency)) throw new CartError("INVALID_REQUEST", "Cart currency is invalid");
      const existingId = cartByCustomer.get(customerId);
      if (existingId) {
        const existing = carts.get(existingId);
        if (!existing) throw new Error("Cart index is inconsistent");
        return clone(existing);
      }
      const cartId = createCartId();
      assertBoundedIdentifier(cartId, "Cart identity");
      if (carts.has(cartId)) throw new Error("Cart identity collision");
      const cart = createEmptyCart(cartId, customerId, currency, new Date(clock()).toISOString());
      carts.set(cartId, cart);
      cartByCustomer.set(customerId, cartId);
      return clone(cart);
    },
    read: async (cartId) => clone(carts.get(cartId) ?? null),
    transact: (request, apply) => runSerially(request.cartId, async () => {
      if (options.failTransactions) throw new Error("synthetic cart store failure");
      const current = carts.get(request.cartId);
      if (!current) return { status: "not_found" };
      if (current.customerId !== request.customerId) return { status: "owner_mismatch", cart: clone(current) };
      if (request.signal?.aborted) {
        return {
          status: "rejected",
          cart: clone(current),
          error: new CartError("CANCELLED", "Cart operation was cancelled"),
        };
      }

      const idempotencyKey = `${request.customerId}:${request.idempotencyKey}`;
      const prior = idempotency.get(idempotencyKey);
      if (prior) {
        if (prior.requestFingerprint !== request.requestFingerprint) {
          return { status: "idempotency_mismatch", cart: clone(current) };
        }
        return { status: "replayed", cart: clone(prior.cart), receipt: clone(prior.receipt) };
      }
      if (current.revision !== request.expectedRevision) return { status: "revision_conflict", cart: clone(current) };

      try {
        const plan = await apply(clone(current));
        if (request.signal?.aborted) {
          return {
            status: "rejected",
            cart: clone(current),
            error: new CartError("CANCELLED", "Cart operation was cancelled"),
          };
        }
        if (plan.cart.customerId !== current.customerId || plan.cart.revision !== current.revision + 1) {
          throw new Error("Cart transaction returned an invalid next state");
        }
        const nextCart = clone(plan.cart);
        const receipt = clone(plan.receipt);
        carts.set(request.cartId, nextCart);
        idempotency.set(idempotencyKey, {
          requestFingerprint: request.requestFingerprint,
          cart: nextCart,
          receipt,
        });
        return { status: "committed", cart: clone(nextCart), receipt: clone(receipt) };
      } catch (error) {
        if (error instanceof CartError) return { status: "rejected", cart: clone(current), error };
        throw error;
      }
    }),
  };
};

const snapshotFor = (offer: RetailerOffer): RetailerOfferSnapshot => ({
  offerId: offer.offerId,
  offerVersion: getRetailerOfferVersion(offer),
  retailerId: offer.retailerId,
  sellerId: offer.sellerId,
  catalogRef: clone(offer.catalogRef),
  displayName: offer.displayName,
  productUrl: offer.productUrl,
  price: {
    amountMinor: offer.price.amountMinor,
    currency: offer.price.currency,
    ...(offer.price.unit !== undefined ? { unit: offer.price.unit, quantity: offer.price.quantity } : {}),
  },
  availability: offer.availability,
  ...(offer.provider ? { provider: clone(offer.provider) } : {}),
  eligibility: offer.eligibility,
  identityEvidence: {
    match: "exact",
    method: "authorized_catalog_variant_uuid",
  },
  observedAt: offer.observedAt,
  expiresAt: offer.expiresAt,
  provenance: {
    sourceName: offer.provenance.sourceName,
    sourceUrl: offer.provenance.sourceUrl,
    sourceKind: offer.provenance.sourceKind,
    adapterId: offer.provenance.adapterId,
    environment: offer.provenance.environment,
  },
});

const findExactOffer = async (
  resolver: RetailerOfferResolver,
  requested: CartAddRequest["offer"],
  signal?: AbortSignal,
): Promise<RetailerOfferSnapshot> => {
  assertBoundedIdentifier(requested.offerId, "Offer identity");
  assertBoundedText(requested.offerVersion, "Offer version", 8_192);
  assertCatalogRef(requested.catalogRef);
  assertMoney(requested.price, "Offer price");
  let resolution;
  try {
    resolution = await resolver.resolve(
      { catalogRef: clone(requested.catalogRef) },
      { signal },
    );
    if (signal?.aborted) {
      throw new CartError("CANCELLED", "Cart operation was cancelled");
    }
  } catch {
    if (signal?.aborted) {
      throw new CartError("CANCELLED", "Cart operation was cancelled");
    }
    throw new CartError(
      "OFFER_RESOLUTION_FAILED",
      "The exact offer could not be revalidated",
    );
  }
  if (resolution.status !== "ok") {
    if (resolution.status === "cancelled" || signal?.aborted) {
      throw new CartError("CANCELLED", "Cart operation was cancelled");
    }
    throw new CartError(
      resolution.status === "no_offers" ? "OFFER_NOT_FOUND" : "OFFER_RESOLUTION_FAILED",
      "The exact offer could not be revalidated",
    );
  }
  const matches = resolution.offers.filter(({ offerId }) => offerId === requested.offerId);
  if (matches.length === 0) throw new CartError("OFFER_NOT_FOUND", "The exact offer could not be found");
  if (matches.length !== 1) throw new CartError("OFFER_AMBIGUOUS", "The exact offer is ambiguous");
  const current = matches[0];
  if (current.identityEvidence.match === "ambiguous") throw new CartError("OFFER_AMBIGUOUS", "The exact offer identity is ambiguous");
  if (current.identityEvidence.match === "substitute") throw new CartError("OFFER_SUBSTITUTE", "A substitute offer cannot be added");
  if (
    current.catalogRef.catalogId !== requested.catalogRef.catalogId ||
    current.catalogRef.productId !== requested.catalogRef.productId ||
    current.identityEvidence.catalogRef.catalogId !== requested.catalogRef.catalogId ||
    current.identityEvidence.catalogRef.productId !== requested.catalogRef.productId
  ) throw new CartError("OFFER_IDENTITY_MISMATCH", "Offer identity does not match the requested catalog variant");
  if (current.eligibility === "stale") throw new CartError("OFFER_STALE", "The offer is stale");
  if (current.eligibility === "unavailable" || current.availability !== "in_stock") throw new CartError("OFFER_UNAVAILABLE", "The offer is unavailable");
  if (current.eligibility !== "purchasable") throw new CartError("OFFER_IDENTITY_MISMATCH", "The offer is not verified for cart use");
  if (getRetailerOfferVersion(current) !== requested.offerVersion) throw new CartError("OFFER_VERSION_MISMATCH", "The offer version changed; review the current offer");
  if (
    current.price.amountMinor !== requested.price.amountMinor ||
    current.price.unit !== requested.price.unit ||
    current.price.quantity !== requested.price.quantity
  ) throw new CartError("OFFER_PRICE_MISMATCH", "The offer price changed; review the current offer");
  if (current.price.currency !== requested.price.currency) throw new CartError("OFFER_CURRENCY_MISMATCH", "The offer currency changed; review the current offer");
  return snapshotFor(current);
};

const mapAuthorizationError = (result: CartAuthorizationResult): CartError => {
  if (result.allowed) throw new Error("Expected a denied authorization result");
  const code: Record<Exclude<CartAuthorizationResult, { allowed: true }>['reason'], CartErrorCode> = {
    anonymous: "ANONYMOUS_SESSION",
    expired: "SESSION_EXPIRED",
    revoked: "SESSION_REVOKED",
    unavailable: "SESSION_UNAVAILABLE",
    "missing-scope": "MISSING_SCOPE",
    "invalid-csrf": "INVALID_CSRF",
  };
  return new CartError(code[result.reason], "Cart authorization was denied");
};

const throwIfAborted = (signal: AbortSignal | undefined) => {
  if (signal?.aborted) {
    throw new CartError("CANCELLED", "Cart operation was cancelled");
  }
};

const originFor = (request: { origin?: CartOrigin }) => request.origin ?? "human";

const safeAudit = async (sink: CartAuditEventSink | undefined, receipt: CartReceipt) => {
  if (!sink) return;
  try { await sink.record(clone(receipt)); } catch { /* Audit failure never changes cart outcome. */ }
};

type CartServiceOptions = Readonly<{
  store: CartStore;
  sessionAuthority: CustomerSessionAuthority;
  offerResolver: RetailerOfferResolver;
  clock?: () => number;
  createLineId?: () => string;
  defaultCurrency?: string;
  auditEventSink?: CartAuditEventSink;
}>;

export const createCartService = (options: CartServiceOptions): CartService => {
  const clock = options.clock ?? (() => Date.now());
  const createLineId = options.createLineId ?? (() => `line-${Math.random().toString(36).slice(2)}`);
  const defaultCurrency = options.defaultCurrency ?? DEFAULT_CART_CURRENCY;
  if (!/^[A-Z]{3}$/u.test(defaultCurrency)) throw new Error("Cart currency must be an ISO-like uppercase code");

  const resolveCart = async (customerId: string, cartId: string | undefined) => {
    if (cartId) return options.store.read(cartId);
    return options.store.getOrCreateForCustomer(customerId, defaultCurrency);
  };

  const getDeniedRead = async (
    error: CartError,
    origin: CartOrigin = "human",
  ): Promise<CartReadResult> => {
    const receipt = { ...emptyReceipt("read", error.code), origin };
    await safeAudit(options.auditEventSink, receipt);
    return { ok: false, error: errorView(error), receipt };
  };

  const getCart = async (request: CartReadRequest): Promise<CartReadResult> => {
    if (request.signal?.aborted) {
      return getDeniedRead(
        new CartError("CANCELLED", "Cart operation was cancelled"),
        originFor(request),
      );
    }
    const authorization = await options.sessionAuthority.authorizeCartRead(request.sessionToken);
    if (!authorization.allowed) {
      return getDeniedRead(mapAuthorizationError(authorization), originFor(request));
    }
    try {
      if (request.cartId !== undefined) assertBoundedIdentifier(request.cartId, "Cart identity");
      const cart = await resolveCart(authorization.customerId, request.cartId);
      if (!cart) {
        const error = new CartError("CART_NOT_FOUND", "Cart was not found");
        return getDeniedRead(error, originFor(request));
      }
      if (cart.customerId !== authorization.customerId) {
        const error = new CartError("CART_OWNERSHIP_MISMATCH", "Cart ownership does not match the active customer");
        return getDeniedRead(error, originFor(request));
      }
      throwIfAborted(request.signal);
      const receipt = receiptFor("read", "accepted", cart, request.origin ?? "human");
      await safeAudit(options.auditEventSink, receipt);
      return { ok: true, cart: clone(cart), receipt };
    } catch (error) {
      const cartError = error instanceof CartError ? error : new CartError("STORE_UNAVAILABLE", "Cart storage is unavailable");
      return getDeniedRead(cartError, originFor(request));
    }
  };

  const mutate = async (
    operation: Exclude<CartOperation, "read">,
    request: CartAddRequest | CartRemoveRequest | CartChangeQuantityRequest,
    apply: (cart: Cart) => Promise<CartMutationPlan>,
  ): Promise<CartMutationResult> => {
    try {
      throwIfAborted(request.signal);
    } catch (caught) {
      const error = caught instanceof CartError
        ? caught
        : new CartError("CANCELLED", "Cart operation was cancelled");
      const receipt = { ...emptyReceipt(operation, error.code), origin: originFor(request) };
      await safeAudit(options.auditEventSink, receipt);
      return { ok: false, error: errorView(error), receipt };
    }
    const authorization = await options.sessionAuthority.authorizeCartWrite(request.sessionToken, request.csrfSecret);
    if (!authorization.allowed) {
      const error = mapAuthorizationError(authorization);
      const receipt = { ...emptyReceipt(operation, error.code), origin: originFor(request) };
      await safeAudit(options.auditEventSink, receipt);
      return { ok: false, error: errorView(error), receipt };
    }

    try {
      assertCartRequest(request);
      if (operation === "add") {
        const addRequest = request as CartAddRequest;
        assertQuantity(addRequest.quantity);
        if (
          addRequest.quantityMode !== undefined &&
          addRequest.quantityMode !== "increment" &&
          addRequest.quantityMode !== "set"
        ) {
          throw new CartError("INVALID_REQUEST", "Cart quantity mode is invalid");
        }
      } else {
        assertBoundedIdentifier((request as CartRemoveRequest).lineId, "Cart line identity");
        if (operation === "change_quantity") assertQuantity((request as CartChangeQuantityRequest).quantity);
      }
      const cart = await resolveCart(authorization.customerId, request.cartId);
      if (!cart) {
        const error = new CartError("CART_NOT_FOUND", "Cart was not found");
        const receipt = { ...emptyReceipt(operation, error.code), origin: originFor(request) };
        await safeAudit(options.auditEventSink, receipt);
        return { ok: false, error: errorView(error), receipt };
      }
      if (cart.customerId !== authorization.customerId) {
        const error = new CartError("CART_OWNERSHIP_MISMATCH", "Cart ownership does not match the active customer");
        const receipt = receiptFor(
          operation,
          "rejected",
          cart,
          originFor(request),
          error.code,
          receiptTargetForRequest(cart, operation, request),
        );
        await safeAudit(options.auditEventSink, receipt);
        return { ok: false, error: errorView(error), receipt };
      }
      const requestFingerprint = fingerprintFor({
        operation,
        cartId: cart.cartId,
        expectedRevision: request.expectedRevision,
        ...(operation === "add"
          ? {
              offer: (request as CartAddRequest).offer,
              quantity: (request as CartAddRequest).quantity,
              quantityMode: (request as CartAddRequest).quantityMode ?? "increment",
            }
          : { lineId: (request as CartRemoveRequest).lineId, quantity: operation === "change_quantity" ? (request as CartChangeQuantityRequest).quantity : undefined }),
      });
      const storeResult = await options.store.transact(
        {
          customerId: authorization.customerId,
          cartId: cart.cartId,
          origin: originFor(request),
          signal: request.signal,
          expectedRevision: request.expectedRevision,
          idempotencyKey: request.idempotencyKey,
          requestFingerprint,
        },
        apply,
      );
      if (storeResult.status === "committed") {
        await safeAudit(options.auditEventSink, storeResult.receipt);
        return { ok: true, cart: clone(storeResult.cart), receipt: clone(storeResult.receipt) };
      }
      if (storeResult.status === "replayed") {
        await safeAudit(options.auditEventSink, storeResult.receipt);
        return { ok: true, cart: clone(storeResult.cart), receipt: clone(storeResult.receipt) };
      }
      let error: CartError;
      if (storeResult.status === "revision_conflict") error = new CartError("CART_REVISION_CONFLICT", "Cart revision is stale; reload and retry");
      else if (storeResult.status === "idempotency_mismatch") error = new CartError("IDEMPOTENCY_KEY_REUSED", "Idempotency key was already used for a different request");
      else if (storeResult.status === "not_found") error = new CartError("CART_NOT_FOUND", "Cart was not found");
      else if (storeResult.status === "owner_mismatch") error = new CartError("CART_OWNERSHIP_MISMATCH", "Cart ownership does not match the active customer");
      else error = storeResult.error;
      if (storeResult.status === "not_found") {
        const receipt = { ...emptyReceipt(operation, error.code), origin: originFor(request) };
        await safeAudit(options.auditEventSink, receipt);
        return { ok: false, error: errorView(error), receipt };
      }
      const receipt = receiptFor(
        operation,
        "rejected",
        storeResult.cart,
        originFor(request),
        error.code,
        receiptTargetForRequest(storeResult.cart, operation, request),
      );
      await safeAudit(options.auditEventSink, receipt);
      return { ok: false, error: errorView(error), receipt };
    } catch (caught) {
      const error = caught instanceof CartError ? caught : new CartError("STORE_UNAVAILABLE", "Cart storage is unavailable");
      const receipt = { ...emptyReceipt(operation, error.code), origin: originFor(request) };
      await safeAudit(options.auditEventSink, receipt);
      return { ok: false, error: errorView(error), receipt };
    }
  };

  const addLine = (request: CartAddRequest) => mutate("add", request, async (cart) => {
    const offerSnapshot = await findExactOffer(options.offerResolver, request.offer);
    if (cart.status !== "active") throw new CartError("CART_LIFECYCLE_REJECTED", "Cart is not active");
    if (cart.currency !== offerSnapshot.price.currency) throw new CartError("CART_CURRENCY_MISMATCH", "Offer currency does not match the cart");
    const existing = cart.lines.find(({ offer: lineOffer }) => lineOffer.offerId === offerSnapshot.offerId);
    if (existing && existing.offer.offerVersion !== offerSnapshot.offerVersion) throw new CartError("OFFER_VERSION_MISMATCH", "The existing cart line has a stale offer version");
    if (!existing && cart.lines.length >= MAX_CART_LINES) throw new CartError("CART_LIMIT_REACHED", "Cart line limit reached");
    const nextQuantity = request.quantityMode === "set"
      ? request.quantity
      : (existing?.quantity ?? 0) + request.quantity;
    assertQuantity(nextQuantity);
    const line: CartLine = {
      lineId: existing?.lineId ?? createLineId(),
      quantity: nextQuantity,
      lineTotalMinor: nextQuantity * offerSnapshot.price.amountMinor,
      offer: offerSnapshot,
    };
    const lines = existing
      ? cart.lines.map((candidate) => candidate.lineId === existing.lineId ? line : candidate)
      : [...cart.lines, line];
    const nextCart = cartWithTotals({ ...cart, lines, revision: cart.revision + 1, updatedAt: new Date(clock()).toISOString() });
    return {
      cart: nextCart,
      receipt: receiptFor(
        "add",
        "accepted",
        nextCart,
        originFor(request),
        undefined,
        receiptTargetForOffer(offerSnapshot),
      ),
    };
  });

  const removeLine = (request: CartRemoveRequest) => mutate("remove", request, async (cart) => {
    if (cart.status !== "active") throw new CartError("CART_LIFECYCLE_REJECTED", "Cart is not active");
    const existing = cart.lines.find(({ lineId }) => lineId === request.lineId);
    if (!existing) throw new CartError("LINE_NOT_FOUND", "Cart line was not found");
    const lines = cart.lines.filter(({ lineId }) => lineId !== request.lineId);
    const nextCart = cartWithTotals({ ...cart, lines, revision: cart.revision + 1, updatedAt: new Date(clock()).toISOString() });
    return {
      cart: nextCart,
      receipt: receiptFor(
        "remove",
        "accepted",
        nextCart,
        originFor(request),
        undefined,
        receiptTargetForOffer(existing.offer),
      ),
    };
  });

  const changeQuantity = (request: CartChangeQuantityRequest) => mutate("change_quantity", request, async (cart) => {
    if (cart.status !== "active") throw new CartError("CART_LIFECYCLE_REJECTED", "Cart is not active");
    const existing = cart.lines.find(({ lineId }) => lineId === request.lineId);
    if (!existing) throw new CartError("LINE_NOT_FOUND", "Cart line was not found");
    const offerSnapshot = await findExactOffer(options.offerResolver, {
      offerId: existing.offer.offerId,
      offerVersion: existing.offer.offerVersion,
      catalogRef: existing.offer.catalogRef,
      price: existing.offer.price,
    });
    const line: CartLine = {
      ...existing,
      quantity: request.quantity,
      lineTotalMinor: request.quantity * offerSnapshot.price.amountMinor,
      offer: offerSnapshot,
    };
    const lines = cart.lines.map((candidate) => candidate.lineId === request.lineId ? line : candidate);
    const nextCart = cartWithTotals({ ...cart, lines, revision: cart.revision + 1, updatedAt: new Date(clock()).toISOString() });
    return {
      cart: nextCart,
      receipt: receiptFor(
        "change_quantity",
        "accepted",
        nextCart,
        originFor(request),
        undefined,
        receiptTargetForOffer(offerSnapshot),
      ),
    };
  });

  return { getCart, addLine, removeLine, changeQuantity };
};
