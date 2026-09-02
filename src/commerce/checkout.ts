import {
  CustomerSessionAuthority,
  type CartAuthorizationResult,
} from "./customer-session";
import type { Cart, CartStore } from "./cart";
import {
  getRetailerOfferVersion,
  type RetailerOffer,
  type RetailerOfferResolver,
} from "./retailer-offer-adapter";

export const CHECKOUT_SHIPPING_TAX_DISCLOSURE =
  "shipping and tax are unknown until the sandbox provider calculates them; this review excludes delivery, tax, membership fees, regional costs, and other landed-cost inputs.";
export const CHECKOUT_RETURN_PATH = "/?checkout=return";
const REVIEW_TTL_MS = 5 * 60 * 1_000;
const HANDOFF_TTL_MS = 5 * 60 * 1_000;
const MAX_AUDIT_TRAIL = 20;

export type CheckoutErrorCode =
  | "ANONYMOUS_SESSION"
  | "SESSION_EXPIRED"
  | "SESSION_REVOKED"
  | "SESSION_UNAVAILABLE"
  | "MISSING_SCOPE"
  | "INVALID_CSRF"
  | "CANCELLED"
  | "INVALID_REQUEST"
  | "CART_NOT_FOUND"
  | "CART_EMPTY"
  | "CHECKOUT_REVIEW_NOT_FOUND"
  | "CHECKOUT_REVIEW_EXPIRED"
  | "CHECKOUT_REVIEW_STALE"
  | "CHECKOUT_CONFIRMATION_REQUIRED"
  | "CHECKOUT_PROVIDER_FAILURE"
  | "CHECKOUT_SESSION_NOT_FOUND"
  | "CHECKOUT_SESSION_ALREADY_RETURNED"
  | "CHECKOUT_SESSION_ALREADY_CANCELLED"
  | "CHECKOUT_SESSION_EXPIRED"
  | "CHECKOUT_SESSION_ALREADY_CONFIRMED"
  | "CHECKOUT_SESSION_OWNERSHIP_MISMATCH"
  | "CHECKOUT_MULTIPLE_RETAILERS"
  | "CHECKOUT_REVALIDATION_FAILED"
  | "CHECKOUT_OFFER_CHANGED"
  | "CHECKOUT_OFFER_UNAVAILABLE"
  | "IDEMPOTENCY_KEY_REQUIRED"
  | "IDEMPOTENCY_KEY_REUSED";

export type CheckoutReceipt = Readonly<{
  type: "commerce.checkout.receipt";
  operation: "review" | "confirm" | "provider_failure" | "cancel" | "return" | "open";
  status: "accepted" | "rejected";
  cartRevision: number;
  lineCount: number;
  totalMinor: number;
  currency: string;
  errorCode?: CheckoutErrorCode;
}>;

export type CheckoutErrorView = Readonly<{
  code: CheckoutErrorCode;
  message: string;
  recoverable: true;
}>;

export type CheckoutReviewLine = Readonly<{
  lineId: string;
  offerId: string;
  retailer: string;
  retailerId: string;
  displayName: string;
  quantity: number;
  price: Readonly<{ amountMinor: number; currency: string }>;
  originalPrice: Readonly<{ amountMinor: number; currency: string }>;
  lineTotalMinor: number;
  originalLineTotalMinor: number;
  priceChangeMinor: number;
  availability: RetailerOffer["availability"];
  freshness: "fresh" | "stale" | "unknown";
  offerVersion: string;
  originalOfferVersion: string;
  state: "ready" | "price_changed" | "unavailable" | "stale" | "revalidation_failed";
  observedAt: string;
  expiresAt: string;
}>;

export type CheckoutReview = Readonly<{
  reviewId: string;
  cartId: string;
  cartRevision: number;
  retailer: string;
  retailerIds: readonly string[];
  lines: readonly CheckoutReviewLine[];
  totals: Readonly<{
    subtotalMinor: number;
    totalMinor: number;
    currency: string;
  }>;
  originalTotals: Readonly<{
    subtotalMinor: number;
    totalMinor: number;
    currency: string;
  }>;
  shippingTaxDisclosure: typeof CHECKOUT_SHIPPING_TAX_DISCLOSURE;
  reviewedAt: string;
  expiresAt: string;
  canConfirm: boolean;
  warnings: readonly string[];
}>;

export type CheckoutReviewRequest = Readonly<{
  sessionToken?: string;
  cartId: string;
  signal?: AbortSignal;
}>;

export type CheckoutReviewResult =
  | Readonly<{ ok: true; review: CheckoutReview; receipt: CheckoutReceipt }>
  | Readonly<{ ok: false; error: CheckoutErrorView; receipt: CheckoutReceipt }>;

export type SandboxCheckoutProvider = Readonly<{
  environment: "sandbox";
  createSession: (request: Readonly<{
    retailerId: string;
    cartId: string;
    cartRevision: number;
    lines: readonly Readonly<{
      lineId: string;
      offerId: string;
      quantity: number;
      amountMinor: number;
    }>[];
    totalMinor: number;
    currency: string;
    returnPath: string;
    idempotencyKey: string;
    signal?: AbortSignal;
  }>) => Promise<Readonly<{
    providerSessionId: string;
    handoffUrl: string;
    returnUrl: string;
  }>>;
  cancelSession: (request: Readonly<{
    providerSessionId: string;
    signal?: AbortSignal;
  }>) => Promise<void>;
}>;

export type CheckoutSession = Readonly<{
  checkoutSessionId: string;
  retailer: string;
  status: "handoff_ready" | "cancelled" | "returned";
  handoffUrl: string;
  returnUrl: string;
  returnPath: string;
  cartId: string;
  cartRevision: number;
  totals: Readonly<{
    totalMinor: number;
    currency: string;
  }>;
  createdAt: string;
  handoffExpiresAt: string;
}>;

export type CheckoutConfirmRequest = Readonly<{
  sessionToken?: string;
  csrfSecret?: string;
  reviewId: string;
  idempotencyKey: string;
  confirmation: boolean;
  origin?: "human" | "webmcp";
  humanUiToken?: object;
  signal?: AbortSignal;
}>;

export type CheckoutConfirmResult =
  | Readonly<{ ok: true; session: CheckoutSession; receipt: CheckoutReceipt }>
  | Readonly<{ ok: false; error: CheckoutErrorView; receipt: CheckoutReceipt }>;

export type CheckoutSessionRequest = Readonly<{
  sessionToken?: string;
  csrfSecret?: string;
  checkoutSessionId: string;
  origin?: "human" | "webmcp";
  humanUiToken?: object;
  signal?: AbortSignal;
}>;

export type CheckoutSessionResult =
  | Readonly<{ ok: true; session: CheckoutSession; receipt: CheckoutReceipt }>
  | Readonly<{ ok: false; error: CheckoutErrorView; receipt: CheckoutReceipt }>;

export type CheckoutService = Readonly<{
  review: (request: CheckoutReviewRequest) => Promise<CheckoutReviewResult>;
  confirm: (request: CheckoutConfirmRequest) => Promise<CheckoutConfirmResult>;
  cancel: (request: CheckoutSessionRequest) => Promise<CheckoutSessionResult>;
  returnToWimy: (request: CheckoutSessionRequest) => Promise<CheckoutSessionResult>;
  open: (request: CheckoutSessionRequest) => Promise<CheckoutSessionResult>;
  getLatestReceipt: () => CheckoutReceipt | undefined;
  getAuditTrail: () => readonly CheckoutReceipt[];
}>;

export const createSyntheticSandboxCheckoutProvider = (): SandboxCheckoutProvider => {
  let sequence = 0;
  const sessions = new Map<string, Readonly<{ providerSessionId: string; handoffUrl: string; returnUrl: string }>>();
  return {
    environment: "sandbox",
    createSession: async (request) => {
      const existing = sessions.get(request.idempotencyKey);
      if (existing) return existing;
      const providerSessionId = `sandbox-provider-session-${++sequence}`;
      const session = {
        providerSessionId,
        handoffUrl: `https://checkout.example.invalid/sandbox/${providerSessionId}`,
        returnUrl: `https://wimy.example.invalid${request.returnPath}`,
      };
      sessions.set(request.idempotencyKey, session);
      return session;
    },
    cancelSession: async ({ providerSessionId }) => {
      for (const [key, session] of sessions) {
        if (session.providerSessionId === providerSessionId) sessions.delete(key);
      }
    },
  };
};

type CheckoutServiceOptions = Readonly<{
  store: CartStore;
  sessionAuthority: CustomerSessionAuthority;
  offerResolver: RetailerOfferResolver;
  provider: SandboxCheckoutProvider;
  humanUiToken?: object;
  auditEventSink?: { record: (receipt: CheckoutReceipt) => void | Promise<void> };
  clock?: () => number;
  createReviewId?: () => string;
  createCheckoutSessionId?: () => string;
}>;

type StoredReview = CheckoutReview & Readonly<{ customerId: string }>;
type StoredSession = CheckoutSession & Readonly<{ customerId: string; providerSessionId: string }>;
type StoredIdempotency = Readonly<{
  fingerprint: string;
  session: CheckoutSession;
  receipt: CheckoutReceipt;
}>;
type ConfirmationAttempt = Readonly<{ idempotencyKey: string; providerIdempotencyKey: string }>;

const clone = <T,>(value: T): T => structuredClone(value);

const safeText = (value: string) =>
  value
    .replace(/<[^>]*(?:>|$)/gu, " ")
    .replace(/[<>]/gu, " ")
    .replace(/\b[a-z][a-z0-9+.-]*:(?:\/\/)?[^\s<>]+/giu, " ")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, 160) || "[untrusted text omitted]";

const errorView = (code: CheckoutErrorCode, message: string): CheckoutErrorView => ({
  code,
  message,
  recoverable: true,
});

const projectReview = (stored: StoredReview): CheckoutReview => {
  const { customerId, ...review } = stored;
  void customerId;
  return clone(review);
};
const projectSession = (stored: StoredSession): CheckoutSession => {
  const { customerId, providerSessionId, ...session } = stored;
  void customerId;
  void providerSessionId;
  return clone(session);
};

const receiptFor = (
  operation: CheckoutReceipt["operation"],
  status: CheckoutReceipt["status"],
  cart: Pick<Cart, "revision" | "lines" | "totals"> | undefined,
  errorCode?: CheckoutErrorCode,
): CheckoutReceipt => ({
  type: "commerce.checkout.receipt",
  operation,
  status,
  cartRevision: cart?.revision ?? 0,
  lineCount: cart?.lines.length ?? 0,
  totalMinor: cart?.totals.totalMinor ?? 0,
  currency: cart?.totals.currency ?? "USD",
  ...(errorCode ? { errorCode } : {}),
});

const authorizationCode = (
  result: CartAuthorizationResult,
): Exclude<CheckoutErrorCode, "CHECKOUT_REVIEW_NOT_FOUND"> => {
  if (result.allowed) throw new Error("Expected denied authorization");
  const codes = {
    anonymous: "ANONYMOUS_SESSION",
    expired: "SESSION_EXPIRED",
    revoked: "SESSION_REVOKED",
    unavailable: "SESSION_UNAVAILABLE",
    "missing-scope": "MISSING_SCOPE",
    "invalid-csrf": "INVALID_CSRF",
  } as const;
  return codes[result.reason];
};

const assertIdempotencyKey = (value: string) =>
  typeof value === "string" &&
  value.length > 0 &&
  value.length <= 128 &&
  !value.includes(" ") &&
  !Array.from(value).some((character) => {
    const codePoint = character.codePointAt(0);
    return codePoint !== undefined &&
      (codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f));
  });

const isFresh = (offer: RetailerOffer, now: number) => {
  const observedAt = Date.parse(offer.observedAt);
  const expiresAt = Date.parse(offer.expiresAt);
  return offer.eligibility === "purchasable" &&
    offer.availability === "in_stock" &&
    Number.isFinite(observedAt) &&
    observedAt <= now &&
    expiresAt > now;
};

const sameCatalogRef = (
  left: RetailerOffer["catalogRef"],
  right: RetailerOffer["catalogRef"],
) => left.catalogId === right.catalogId && left.productId === right.productId;

const isInertUrl = (value: string) => {
  try {
    const url = new URL(value);
    return url.protocol === "https:" &&
      (url.hostname === "example.invalid" || url.hostname.endsWith(".example.invalid"));
  } catch {
    return false;
  }
};

const expectedReturnUrl = (returnPath: string) => `https://wimy.example.invalid${returnPath}`;

const isSafeReturnPath = (value: string, checkoutSessionId: string) =>
  value === `${CHECKOUT_RETURN_PATH}&session=${encodeURIComponent(checkoutSessionId)}`;

const offerForLine = async (
  resolver: RetailerOfferResolver,
  line: Cart["lines"][number],
  signal?: AbortSignal,
) => {
  const resolution = await resolver.resolve(
    { catalogRef: clone(line.offer.catalogRef) },
    { signal },
  );
  if (signal?.aborted) return { status: "cancelled" as const };
  if (resolution.status !== "ok") return { status: "revalidation_failed" as const };
  const matches = resolution.offers.filter(({ offerId }) => offerId === line.offer.offerId);
  if (matches.length !== 1) return { status: "offer_changed" as const };
  return { status: "ok" as const, offer: clone(matches[0]) };
};

const reviewLineFor = async (
  resolver: RetailerOfferResolver,
  line: Cart["lines"][number],
  now: number,
  signal?: AbortSignal,
): Promise<CheckoutReviewLine> => {
  const originalPrice = {
    amountMinor: line.offer.price.amountMinor,
    currency: line.offer.price.currency,
  };
  const failed: CheckoutReviewLine = {
    lineId: line.lineId,
    offerId: line.offer.offerId,
    retailer: safeText(line.offer.provenance.sourceName),
    retailerId: line.offer.retailerId,
    displayName: safeText(line.offer.displayName),
    quantity: line.quantity,
    price: originalPrice,
    originalPrice,
    lineTotalMinor: line.lineTotalMinor,
    originalLineTotalMinor: line.lineTotalMinor,
    priceChangeMinor: 0,
    availability: line.offer.availability,
    freshness: "unknown",
    offerVersion: line.offer.offerVersion,
    originalOfferVersion: line.offer.offerVersion,
    state: "revalidation_failed",
    observedAt: line.offer.observedAt,
    expiresAt: line.offer.expiresAt,
  };
  try {
    const result = await offerForLine(resolver, line, signal);
    if (result.status !== "ok") {
      return result.status === "cancelled"
        ? failed
        : { ...failed, state: result.status === "offer_changed" ? "stale" : "revalidation_failed" };
    }
    const current = result.offer;
    const currentPrice = {
      amountMinor: current.price.amountMinor,
      currency: current.price.currency,
    };
    const priceChangeMinor =
      (current.price.amountMinor - line.offer.price.amountMinor) * line.quantity;
    const fresh = isFresh(current, now);
    const sameVersion = getRetailerOfferVersion(current) === line.offer.offerVersion;
    const samePrice =
      current.price.amountMinor === line.offer.price.amountMinor &&
      current.price.currency === line.offer.price.currency;
    const sameIdentity =
      sameCatalogRef(current.catalogRef, line.offer.catalogRef) &&
      current.identityEvidence.match === "exact" &&
      current.identityEvidence.catalogRef.catalogId === line.offer.catalogRef.catalogId &&
      current.identityEvidence.catalogRef.productId === line.offer.catalogRef.productId;
    const state = !sameIdentity
      ? "stale"
      : current.availability !== "in_stock"
        ? "unavailable"
        : !fresh
          ? "stale"
          : !samePrice
            ? "price_changed"
            : !sameVersion
              ? "stale"
              : "ready";
    return {
      ...failed,
      retailer: safeText(current.provenance.sourceName),
      retailerId: current.retailerId,
      displayName: safeText(current.displayName),
      price: currentPrice,
      lineTotalMinor: current.price.amountMinor * line.quantity,
      priceChangeMinor,
      availability: current.availability,
      freshness: fresh ? "fresh" : "stale",
      offerVersion: getRetailerOfferVersion(current),
      state,
      observedAt: current.observedAt,
      expiresAt: current.expiresAt,
    };
  } catch {
    return failed;
  }
};

const buildReview = async (
  reviewId: string,
  customerId: string,
  cart: Cart,
  resolver: RetailerOfferResolver,
  clock: () => number,
  signal?: AbortSignal,
): Promise<StoredReview> => {
  const now = clock();
  const lines = await Promise.all(cart.lines.map((line) => reviewLineFor(resolver, line, now, signal)));
  const retailerIds = [...new Set(lines.map(({ retailerId }) => retailerId))];
  const currentSubtotal = lines.reduce((total, line) => total + line.lineTotalMinor, 0);
  const warnings = lines.flatMap((line) => {
    if (line.state === "ready") return [];
    if (line.state === "price_changed") {
      return [`${line.displayName} price changed by ${line.priceChangeMinor} minor units; review again.`];
    }
    if (line.state === "unavailable") return [`${line.displayName} is unavailable.`];
    if (line.state === "stale") return [`${line.displayName} offer freshness or identity changed.`];
    return [`${line.displayName} could not be revalidated.`];
  });
  return {
    reviewId,
    customerId,
    cartId: cart.cartId,
    cartRevision: cart.revision,
    retailer: retailerIds.length === 1 ? lines[0]?.retailer ?? "Unknown retailer" : "Multiple retailers",
    retailerIds,
    lines,
    totals: {
      subtotalMinor: currentSubtotal,
      totalMinor: currentSubtotal,
      currency: cart.currency,
    },
    originalTotals: clone(cart.totals),
    shippingTaxDisclosure: CHECKOUT_SHIPPING_TAX_DISCLOSURE,
    reviewedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + REVIEW_TTL_MS).toISOString(),
    canConfirm:
      cart.lines.length > 0 &&
      retailerIds.length === 1 &&
      lines.every(({ state }) => state === "ready"),
    warnings,
  };
};

const defaultOpaqueId = (prefix: string) => {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return `${prefix}-${globalThis.crypto.randomUUID()}`;
  }
  return `${prefix}-${Math.random().toString(36).slice(2)}`;
};

export const createCheckoutService = (options: CheckoutServiceOptions): CheckoutService => {
  if (options.provider.environment !== "sandbox") throw new Error("Checkout provider must be sandbox-only");
  const clock = options.clock ?? (() => Date.now());
  const createReviewId = options.createReviewId ?? (() => defaultOpaqueId("review"));
  const createCheckoutSessionId = options.createCheckoutSessionId ?? (() => defaultOpaqueId("checkout"));
  const reviews = new Map<string, StoredReview>();
  const sessions = new Map<string, StoredSession>();
  const customerStates = new Map<string, Map<string, { attempt?: ConfirmationAttempt; confirmation?: StoredIdempotency }>>();
  const queues = new Map<string, Map<string, Promise<void>>>();
  const sessionQueues = new Map<string, Map<string, Promise<void>>>();
  const auditTrail: CheckoutReceipt[] = [];
  let latestReceipt: CheckoutReceipt | undefined;

  const recordReceipt = async (receipt: CheckoutReceipt) => {
    latestReceipt = clone(receipt);
    auditTrail.push(clone(receipt));
    if (auditTrail.length > MAX_AUDIT_TRAIL) auditTrail.shift();
    try { await options.auditEventSink?.record(clone(receipt)); } catch { /* Audit failure never changes checkout outcome. */ }
  };

  const reject = async (
    operation: CheckoutReceipt["operation"],
    code: CheckoutErrorCode,
    message: string,
    cart?: Cart,
  ) => {
    const receipt = receiptFor(operation, "rejected", cart, code);
    await recordReceipt(receipt);
    return { ok: false as const, error: errorView(code, message), receipt };
  };

  const accept = async (
    operation: CheckoutReceipt["operation"],
    cart?: Cart,
  ) => {
    const receipt = receiptFor(operation, "accepted", cart);
    await recordReceipt(receipt);
    return receipt;
  };

  const authorizeRead = async (sessionToken: string | undefined) => {
    return options.sessionAuthority.authorizeCartRead(sessionToken);
  };

  const authorizeWrite = async (sessionToken: string | undefined, csrfSecret: string | undefined) => {
    return options.sessionAuthority.authorizeCartWrite(sessionToken, csrfSecret);
  };

  const runReviewSerially = async <T,>(customerId: string, reviewId: string, operation: () => Promise<T>) => {
    let customerQueues = queues.get(customerId);
    if (!customerQueues) {
      customerQueues = new Map();
      queues.set(customerId, customerQueues);
    }
    const previous = customerQueues.get(reviewId) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => { release = resolve; });
    customerQueues.set(reviewId, current);
    await previous;
    try { return await operation(); }
    finally {
      release();
      if (customerQueues.get(reviewId) === current) customerQueues.delete(reviewId);
      if (customerQueues.size === 0) queues.delete(customerId);
    }
  };

  const runSessionSerially = async <T,>(customerId: string, sessionId: string, operation: () => Promise<T>) => {
    let customerQueues = sessionQueues.get(customerId);
    if (!customerQueues) {
      customerQueues = new Map();
      sessionQueues.set(customerId, customerQueues);
    }
    const previous = customerQueues.get(sessionId) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => { release = resolve; });
    customerQueues.set(sessionId, current);
    await previous;
    try { return await operation(); }
    finally {
      release();
      if (customerQueues.get(sessionId) === current) customerQueues.delete(sessionId);
      if (customerQueues.size === 0) sessionQueues.delete(customerId);
    }
  };

  const stateFor = (customerId: string, reviewId: string) => {
    let customer = customerStates.get(customerId);
    if (!customer) {
      customer = new Map();
      customerStates.set(customerId, customer);
    }
    let state = customer.get(reviewId);
    if (!state) {
      state = {};
      customer.set(reviewId, state);
    }
    return state;
  };

  const voidProviderSession = async (providerSessionId: string) => {
    try {
      await options.provider.cancelSession({ providerSessionId });
      return true;
    } catch {
      return false;
    }
  };

  const review = async (request: CheckoutReviewRequest): Promise<CheckoutReviewResult> => {
    if (request.signal?.aborted) return reject("review", "CANCELLED", "Checkout review was cancelled");
    const authorization = await authorizeRead(request.sessionToken);
    if (!authorization.allowed) return reject("review", authorizationCode(authorization), "Checkout authorization was denied");
    if (typeof request.cartId !== "string" || request.cartId.length < 1) return reject("review", "INVALID_REQUEST", "A cart identity is required");
    const cart = await options.store.read(request.cartId);
    if (!cart || cart.customerId !== authorization.customerId) return reject("review", "CART_NOT_FOUND", "Cart was not found");
    if (cart.lines.length === 0) return reject("review", "CART_EMPTY", "The cart is empty", cart);
    const checkoutReview = await buildReview(createReviewId(), authorization.customerId, cart, options.offerResolver, clock, request.signal);
    if (request.signal?.aborted) return reject("review", "CANCELLED", "Checkout review was cancelled", cart);
    reviews.set(checkoutReview.reviewId, checkoutReview);
    const receipt = await accept("review", cart);
    return { ok: true, review: projectReview(checkoutReview), receipt };
  };

  const confirm = async (request: CheckoutConfirmRequest): Promise<CheckoutConfirmResult> => {
    if (request.signal?.aborted) return reject("confirm", "CANCELLED", "Checkout confirmation was cancelled");
    if (request.origin !== "human" || request.confirmation !== true || (options.humanUiToken !== undefined && request.humanUiToken !== options.humanUiToken)) {
      return reject("confirm", "CHECKOUT_CONFIRMATION_REQUIRED", "Only an explicit human confirmation from the checkout UI can start sandbox checkout");
    }
    if (!assertIdempotencyKey(request.idempotencyKey)) return reject("confirm", "IDEMPOTENCY_KEY_REQUIRED", "A bounded idempotency key is required");
    const authorization = await authorizeWrite(request.sessionToken, request.csrfSecret);
    if (!authorization.allowed) return reject("confirm", authorizationCode(authorization), "Checkout authorization was denied");
    return runReviewSerially(authorization.customerId, request.reviewId, async () => {
      const fingerprint = JSON.stringify({ reviewId: request.reviewId, confirmation: request.confirmation, origin: request.origin });
      const state = stateFor(authorization.customerId, request.reviewId);
      const prior = state.confirmation;
      if (prior) {
        if (state.attempt?.idempotencyKey !== request.idempotencyKey || prior.fingerprint !== fingerprint) {
          return reject("confirm", "CHECKOUT_SESSION_ALREADY_CONFIRMED", "This checkout review already has a confirmed sandbox handoff");
        }
        return runSessionSerially(authorization.customerId, prior.session.checkoutSessionId, async () => {
          const currentSession = sessions.get(prior.session.checkoutSessionId);
          if (!currentSession || currentSession.customerId !== authorization.customerId) {
            return reject("confirm", "CHECKOUT_SESSION_NOT_FOUND", "Checkout session was not found");
          }
          await recordReceipt(prior.receipt);
          return { ok: true as const, session: projectSession(currentSession), receipt: clone(prior.receipt) };
        });
      }
      if (state.attempt && state.attempt.idempotencyKey !== request.idempotencyKey) {
        return reject("confirm", "IDEMPOTENCY_KEY_REUSED", "This checkout review already has a provider attempt; retry with its original idempotency key");
      }
      const storedReview = reviews.get(request.reviewId);
      if (!storedReview || storedReview.customerId !== authorization.customerId) return reject("confirm", "CHECKOUT_REVIEW_NOT_FOUND", "Checkout review was not found");
      if (Date.parse(storedReview.expiresAt) <= clock()) return reject("confirm", "CHECKOUT_REVIEW_EXPIRED", "Checkout review expired; review the cart again");
      const cart = await options.store.read(storedReview.cartId);
      if (!cart || cart.customerId !== authorization.customerId) return reject("confirm", "CART_NOT_FOUND", "Cart was not found");
      if (cart.revision !== storedReview.cartRevision) return reject("confirm", "CHECKOUT_REVIEW_STALE", "Cart changed after review; review the current cart again", cart);
      const latestReview = await buildReview(storedReview.reviewId, authorization.customerId, cart, options.offerResolver, clock, request.signal);
      if (request.signal?.aborted) return reject("confirm", "CANCELLED", "Checkout confirmation was cancelled", cart);
      if (!latestReview.canConfirm) return reject("confirm", latestReview.retailerIds.length > 1 ? "CHECKOUT_MULTIPLE_RETAILERS" : "CHECKOUT_REVIEW_STALE", latestReview.retailerIds.length > 1 ? "Sandbox checkout supports one retailer handoff at a time; review one retailer cart at a time" : (latestReview.warnings[0] ?? "Offer facts changed; review the current cart again"), cart);
      if (latestReview.retailerIds.length !== 1) return reject("confirm", "CHECKOUT_MULTIPLE_RETAILERS", "Sandbox checkout supports one retailer handoff at a time", cart);
      const checkoutSessionId = createCheckoutSessionId();
      const returnPath = `${CHECKOUT_RETURN_PATH}&session=${encodeURIComponent(checkoutSessionId)}`;
      const providerIdempotencyKey = `wimy-checkout-${request.reviewId}-${request.idempotencyKey}`;
      state.attempt ??= { idempotencyKey: request.idempotencyKey, providerIdempotencyKey };
      let providerSession: Awaited<ReturnType<SandboxCheckoutProvider["createSession"]>>;
      try {
        providerSession = await options.provider.createSession({
          retailerId: latestReview.retailerIds[0]!,
          cartId: cart.cartId,
          cartRevision: cart.revision,
          lines: latestReview.lines.map(({ lineId, offerId, quantity, price }) => ({ lineId, offerId, quantity, amountMinor: price.amountMinor })),
          totalMinor: latestReview.totals.totalMinor,
          currency: latestReview.totals.currency,
          returnPath,
          idempotencyKey: state.attempt.providerIdempotencyKey,
          signal: request.signal,
        });
      } catch {
        if (request.signal?.aborted) return reject("confirm", "CANCELLED", "Checkout confirmation was cancelled", cart);
        return reject("provider_failure", "CHECKOUT_PROVIDER_FAILURE", "Sandbox checkout could not be prepared; no purchase was created", cart);
      }
      const discardProvider = async (operation: CheckoutReceipt["operation"], code: CheckoutErrorCode, message: string) => {
        await voidProviderSession(providerSession.providerSessionId);
        return reject(operation, code, message, cart);
      };
      if (request.signal?.aborted) return discardProvider("confirm", "CANCELLED", "Checkout confirmation was cancelled");
      if (!isInertUrl(providerSession.handoffUrl) || providerSession.returnUrl !== expectedReturnUrl(returnPath)) return discardProvider("provider_failure", "CHECKOUT_PROVIDER_FAILURE", "Sandbox checkout returned an unsafe handoff; no purchase was created");
      const finalAuthorization = await authorizeWrite(request.sessionToken, request.csrfSecret);
      if (!finalAuthorization.allowed) return discardProvider("confirm", authorizationCode(finalAuthorization), "Checkout authorization was denied");
      const finalCart = await options.store.read(storedReview.cartId);
      if (!finalCart || finalCart.customerId !== finalAuthorization.customerId) return discardProvider("confirm", "CART_NOT_FOUND", "Cart was not found");
      if (finalCart.revision !== latestReview.cartRevision) return discardProvider("confirm", "CHECKOUT_REVIEW_STALE", "Cart changed during sandbox handoff preparation; review the current cart again");
      if (Date.parse(latestReview.expiresAt) <= clock()) return discardProvider("confirm", "CHECKOUT_REVIEW_EXPIRED", "Checkout review expired during sandbox handoff preparation; review the cart again");
      if (request.signal?.aborted) return discardProvider("confirm", "CANCELLED", "Checkout confirmation was cancelled");
      const now = clock();
      const session: CheckoutSession = {
        checkoutSessionId,
        retailer: latestReview.retailer,
        status: "handoff_ready",
        handoffUrl: providerSession.handoffUrl,
        returnUrl: providerSession.returnUrl,
        returnPath,
        cartId: finalCart.cartId,
        cartRevision: finalCart.revision,
        totals: { totalMinor: latestReview.totals.totalMinor, currency: latestReview.totals.currency },
        createdAt: new Date(now).toISOString(),
        handoffExpiresAt: new Date(now + HANDOFF_TTL_MS).toISOString(),
      };
      const storedSession: StoredSession = { ...session, customerId: finalAuthorization.customerId, providerSessionId: providerSession.providerSessionId };
      sessions.set(checkoutSessionId, storedSession);
      const receipt = await accept("confirm", finalCart);
      state.confirmation = { fingerprint, session, receipt };
      return { ok: true, session: projectSession(storedSession), receipt };
    });
  };

  const updateSession = async (request: CheckoutSessionRequest, action: "cancel" | "return" | "open"): Promise<CheckoutSessionResult> => {
    if (request.signal?.aborted) return reject(action, "CANCELLED", "Checkout session action was cancelled");
    const authorization = await authorizeWrite(request.sessionToken, request.csrfSecret);
    if (!authorization.allowed) return reject(action, authorizationCode(authorization), "Checkout authorization was denied");
    if (request.origin !== "human" || (options.humanUiToken !== undefined && request.humanUiToken !== options.humanUiToken)) return reject(action, "CHECKOUT_CONFIRMATION_REQUIRED", "Only a human checkout UI action can change sandbox handoff state");
    return runSessionSerially(authorization.customerId, request.checkoutSessionId, async () => {
      const session = sessions.get(request.checkoutSessionId);
      if (!session) return reject(action, "CHECKOUT_SESSION_NOT_FOUND", "Checkout session was not found");
      if (session.customerId !== authorization.customerId) return reject(action, "CHECKOUT_SESSION_OWNERSHIP_MISMATCH", "Checkout session was not found");
      if (!isSafeReturnPath(session.returnPath, session.checkoutSessionId) || session.returnUrl !== expectedReturnUrl(session.returnPath)) return reject(action, "CHECKOUT_PROVIDER_FAILURE", "Sandbox return path integrity check failed");
      if (session.status === "returned") return reject(action, "CHECKOUT_SESSION_ALREADY_RETURNED", "Checkout session already returned to Wimy");
      if (session.status === "cancelled") return reject(action, "CHECKOUT_SESSION_ALREADY_CANCELLED", "Checkout session already cancelled");
      const cart = await options.store.read(session.cartId);
      if (!cart || cart.customerId !== authorization.customerId) return reject(action, "CART_NOT_FOUND", "Cart was not found");
      if (Date.parse(session.handoffExpiresAt) <= clock()) {
        await voidProviderSession(session.providerSessionId);
        sessions.set(session.checkoutSessionId, { ...session, status: "cancelled" });
        return reject(action, "CHECKOUT_SESSION_EXPIRED", "Sandbox handoff expired; review the cart again", cart);
      }
      if (cart.revision !== session.cartRevision) {
        if (action === "open") {
          await voidProviderSession(session.providerSessionId);
          sessions.set(session.checkoutSessionId, { ...session, status: "cancelled" });
        }
        return reject(action, "CHECKOUT_REVIEW_STALE", "Cart changed; review the current cart again", cart);
      }
      if (action === "open") {
        const latestReview = await buildReview(session.checkoutSessionId, authorization.customerId, cart, options.offerResolver, clock, request.signal);
        if (request.signal?.aborted) return reject("open", "CANCELLED", "Checkout session open was cancelled", cart);
        if (!latestReview.canConfirm) {
          await voidProviderSession(session.providerSessionId);
          sessions.set(session.checkoutSessionId, { ...session, status: "cancelled" });
          return reject("open", "CHECKOUT_REVIEW_STALE", latestReview.warnings[0] ?? "Offer facts changed; review the current cart again", cart);
        }
        const finalAuthorization = await authorizeWrite(request.sessionToken, request.csrfSecret);
        if (!finalAuthorization.allowed) return reject("open", authorizationCode(finalAuthorization), "Checkout authorization was denied", cart);
        const finalCart = await options.store.read(session.cartId);
        if (!finalCart || finalCart.customerId !== finalAuthorization.customerId) return reject("open", "CART_NOT_FOUND", "Cart was not found", cart);
        if (finalCart.revision !== latestReview.cartRevision || Date.parse(session.handoffExpiresAt) <= clock()) {
          await voidProviderSession(session.providerSessionId);
          sessions.set(session.checkoutSessionId, { ...session, status: "cancelled" });
          return reject("open", "CHECKOUT_REVIEW_STALE", "Sandbox handoff became stale; review the cart again", finalCart);
        }
        const receipt = await accept("open", finalCart);
        return { ok: true, session: projectSession(session), receipt };
      }
      if (!await voidProviderSession(session.providerSessionId)) return reject("provider_failure", "CHECKOUT_PROVIDER_FAILURE", "Sandbox provider could not cancel the handoff", cart);
      const updated: StoredSession = { ...session, status: action === "cancel" ? "cancelled" : "returned" };
      sessions.set(updated.checkoutSessionId, updated);
      const receipt = await accept(action, cart);
      return { ok: true, session: projectSession(updated), receipt };
    });
  };

  return {
    review,
    confirm,
    cancel: (request) => updateSession(request, "cancel"),
    returnToWimy: (request) => updateSession(request, "return"),
    open: (request) => updateSession(request, "open"),
    getLatestReceipt: () => latestReceipt ? clone(latestReceipt) : undefined,
    getAuditTrail: () => clone(auditTrail),
  };
};
