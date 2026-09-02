import { describe, expect, it, vi } from "vitest";
import {
  CustomerSessionAuthority,
  type CustomerSessionStore,
  type StoredCustomerSession,
} from "./customer-session";
import {
  createCartService,
  createInMemoryCartStore,
  getRetailerOfferVersion,
  type CartStore,
} from "./cart";
import {
  createCheckoutService,
  type SandboxCheckoutProvider,
} from "./checkout";
import type { RetailerOffer, RetailerOfferResolver } from "./retailer-offer-adapter";

const catalogRef = {
  catalogId: "00000000-0000-4000-8000-000000000501",
  productId: "00000000-0000-4000-8000-000000000502",
} as const;

const offer = (overrides: Partial<RetailerOffer> = {}): RetailerOffer => ({
  offerId: "northstar-offer",
  retailerId: "synthetic-northstar",
  sellerId: "synthetic-northstar-direct",
  catalogRef,
  displayName: "Aurora Chair",
  productUrl: "https://offers.example.invalid/synthetic-northstar/aurora-chair",
  price: { amountMinor: 12_000, currency: "USD" },
  availability: "in_stock",
  observedAt: "1970-01-01T00:00:01.000Z",
  expiresAt: "1970-01-01T00:00:02.800Z",
  provenance: {
    sourceName: "Northstar Furnishings",
    sourceUrl: "https://offers.example.invalid/sources/synthetic-northstar",
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
    catalogRef,
  },
  eligibility: "purchasable",
  ...overrides,
});

class MemorySessionStore implements CustomerSessionStore {
  readonly sessions = new Map<string, StoredCustomerSession>();

  async read(sessionToken: string) {
    return this.sessions.get(sessionToken) ?? null;
  }

  async write(sessionToken: string, session: StoredCustomerSession) {
    this.sessions.set(sessionToken, session);
  }

  async revoke(sessionToken: string) {
    this.sessions.delete(sessionToken);
  }
}

const createCheckoutApi = async (
  providerOverride?: SandboxCheckoutProvider,
  auditEventSink?: { record: (receipt: unknown) => void | Promise<void> },
) => {
  let now = 1_000;
  const authority = new CustomerSessionAuthority({
    store: new MemorySessionStore(),
    now: () => now,
    createSessionToken: () => "session-token",
    createCsrfSecret: () => "csrf-secret",
    ttlMs: 1_000_000,
  });
  const ticket = await authority.signIn(
    { customerId: "customer-a" },
    ["commerce:cart:read", "commerce:cart:write"],
  );
  const store: CartStore = createInMemoryCartStore({
    createCartId: () => "cart-1",
  });
  let currentOffer = offer();
  const resolver: RetailerOfferResolver = {
    resolve: vi.fn(async () => ({ status: "ok" as const, offers: [structuredClone(currentOffer)] })),
    clearCache: vi.fn(),
  };
  const cartService = createCartService({
    store,
    sessionAuthority: authority,
    offerResolver: resolver,
    clock: () => now,
    createLineId: () => "line-1",
  });
  const added = await cartService.addLine({
    sessionToken: ticket.sessionToken,
    csrfSecret: ticket.csrfSecret,
    expectedRevision: 1,
    idempotencyKey: "add-chair",
    offer: {
      offerId: currentOffer.offerId,
      offerVersion: getRetailerOfferVersion(currentOffer),
      catalogRef,
      price: currentOffer.price,
    },
    quantity: 2,
  });
  if (!added.ok) throw new Error(`Expected cart line: ${added.error.code}`);
  const provider: SandboxCheckoutProvider = providerOverride ?? {
    environment: "sandbox",
    createSession: vi.fn(async () => ({
      providerSessionId: "sandbox-provider-session-1",
      handoffUrl: "https://checkout.example.invalid/sandbox/session-1",
      returnUrl: "https://wimy.example.invalid/?checkout=return&session=checkout-1",
    })),
    cancelSession: vi.fn(async () => undefined),
  };
  const service = createCheckoutService({
    store,
    sessionAuthority: authority,
    offerResolver: resolver,
    provider,
    clock: () => now,
    createReviewId: () => "review-1",
    createCheckoutSessionId: () => "checkout-1",
    auditEventSink,
  });
  return {
    service,
    authority,
    ticket,
    cart: added.cart,
    cartService,
    store,
    provider,
    resolver,
    setCurrentOffer: (next: RetailerOffer) => {
      currentOffer = next;
    },
    setNow: (next: number) => {
      now = next;
    },
  };
};

describe("CheckoutService", () => {
  it("creates a bounded review with retailer, totals, freshness, and shipping/tax disclosure", async () => {
    const { service, ticket, cart } = await createCheckoutApi();

    const result = await service.review({
      sessionToken: ticket.sessionToken,
      cartId: cart.cartId,
    });

    expect(result).toMatchObject({
      ok: true,
      review: {
        cartId: "cart-1",
        cartRevision: 2,
        retailer: "Northstar Furnishings",
        totals: { subtotalMinor: 24_000, totalMinor: 24_000, currency: "USD" },
        shippingTaxDisclosure: expect.stringContaining("shipping and tax"),
        canConfirm: true,
        lines: [{
          lineId: "line-1",
          displayName: "Aurora Chair",
          quantity: 2,
          availability: "in_stock",
          price: { amountMinor: 12_000, currency: "USD" },
          freshness: "fresh",
        }],
      },
    });
    expect(JSON.stringify(result)).not.toContain("csrf-secret");
    expect(JSON.stringify(result)).not.toContain("session-token");
    expect(JSON.stringify(result)).not.toContain("customer-a");
    expect(JSON.stringify(result)).not.toContain("provider-session");
  });

  it("requires explicit human confirmation immediately before sandbox handoff", async () => {
    const { service, ticket, cart, provider } = await createCheckoutApi();
    const reviewed = await service.review({ sessionToken: ticket.sessionToken, cartId: cart.cartId });
    if (!reviewed.ok) throw new Error(`Expected checkout review: ${reviewed.error.code}`);

    await expect(service.confirm({
      sessionToken: ticket.sessionToken,
      csrfSecret: ticket.csrfSecret,
      reviewId: reviewed.review.reviewId,
      idempotencyKey: "confirm-chair",
      confirmation: false,
      origin: "human",
    })).resolves.toMatchObject({
      ok: false,
      error: { code: "CHECKOUT_CONFIRMATION_REQUIRED", recoverable: true },
    });
    await expect(service.confirm({
      sessionToken: ticket.sessionToken,
      csrfSecret: ticket.csrfSecret,
      reviewId: reviewed.review.reviewId,
      idempotencyKey: "agent-confirm-chair",
      confirmation: true,
      origin: "webmcp",
    })).resolves.toMatchObject({
      ok: false,
      error: { code: "CHECKOUT_CONFIRMATION_REQUIRED", recoverable: true },
    });

    const confirmed = await service.confirm({
      sessionToken: ticket.sessionToken,
      csrfSecret: ticket.csrfSecret,
      reviewId: reviewed.review.reviewId,
      idempotencyKey: "confirm-chair",
      confirmation: true,
      origin: "human",
    });
    expect(confirmed).toMatchObject({
      ok: true,
      session: {
        checkoutSessionId: "checkout-1",
        retailer: "Northstar Furnishings",
        status: "handoff_ready",
        handoffUrl: "https://checkout.example.invalid/sandbox/session-1",
        returnUrl: "https://wimy.example.invalid/?checkout=return&session=checkout-1",
        totals: { totalMinor: 24_000, currency: "USD" },
      },
    });
    expect(provider.createSession).toHaveBeenCalledTimes(1);
    expect(provider.createSession).toHaveBeenCalledWith(expect.objectContaining({
      cartId: "cart-1",
      cartRevision: 2,
      totalMinor: 24_000,
      currency: "USD",
    }));
    const providerInput = vi.mocked(provider.createSession).mock.calls[0]?.[0];
    expect(JSON.stringify(providerInput)).not.toContain("csrf-secret");
    expect(JSON.stringify(providerInput)).not.toContain("session-token");
  });

  it("projects public confirmation and cancellation results without internal identities", async () => {
    const { service, ticket, cart, provider } = await createCheckoutApi();
    const reviewed = await service.review({ sessionToken: ticket.sessionToken, cartId: cart.cartId });
    if (!reviewed.ok) throw new Error(`Expected checkout review: ${reviewed.error.code}`);
    const confirmed = await service.confirm({
      sessionToken: ticket.sessionToken,
      csrfSecret: ticket.csrfSecret,
      reviewId: reviewed.review.reviewId,
      idempotencyKey: "projected-session",
      confirmation: true,
      origin: "human",
    });
    if (!confirmed.ok) throw new Error(`Expected checkout session: ${confirmed.error.code}`);
    const cancelled = await service.cancel({
      sessionToken: ticket.sessionToken,
      csrfSecret: ticket.csrfSecret,
      checkoutSessionId: confirmed.session.checkoutSessionId,
      origin: "human",
    });
    expect(JSON.stringify(confirmed)).not.toMatch(/customer-a|csrf-secret|session-token|provider-session|address|payment/iu);
    expect(JSON.stringify(cancelled)).not.toMatch(/customer-a|csrf-secret|session-token|provider-session|address|payment/iu);
    expect(provider.cancelSession).toHaveBeenCalledWith({ providerSessionId: "sandbox-provider-session-1" });
  });

  it("fails closed for anonymous and invalid write authorization", async () => {
    const { service, ticket, cart } = await createCheckoutApi();

    await expect(service.review({ cartId: cart.cartId })).resolves.toMatchObject({
      ok: false,
      error: { code: "ANONYMOUS_SESSION", recoverable: true },
    });
    const reviewed = await service.review({ sessionToken: ticket.sessionToken, cartId: cart.cartId });
    if (!reviewed.ok) throw new Error(`Expected checkout review: ${reviewed.error.code}`);

    await expect(service.confirm({
      sessionToken: ticket.sessionToken,
      csrfSecret: "wrong-csrf-secret",
      reviewId: reviewed.review.reviewId,
      idempotencyKey: "invalid-csrf",
      confirmation: true,
      origin: "human",
    })).resolves.toMatchObject({
      ok: false,
      error: { code: "INVALID_CSRF", recoverable: true },
    });
  });

  it("does not confirm expired offer facts or expired checkout reviews", async () => {
    const { service, ticket, cart, provider, setNow } = await createCheckoutApi();
    setNow(2_801);
    const expiredOfferReview = await service.review({ sessionToken: ticket.sessionToken, cartId: cart.cartId });
    if (!expiredOfferReview.ok) throw new Error(`Expected expired offer review: ${expiredOfferReview.error.code}`);
    expect(expiredOfferReview.review).toMatchObject({
      canConfirm: false,
      lines: [{ freshness: "stale", state: "stale" }],
    });

    setNow(1_000);
    const freshReview = await service.review({ sessionToken: ticket.sessionToken, cartId: cart.cartId });
    if (!freshReview.ok) throw new Error(`Expected fresh checkout review: ${freshReview.error.code}`);
    setNow(301_001);
    await expect(service.confirm({
      sessionToken: ticket.sessionToken,
      csrfSecret: ticket.csrfSecret,
      reviewId: freshReview.review.reviewId,
      idempotencyKey: "expired-review",
      confirmation: true,
      origin: "human",
    })).resolves.toMatchObject({
      ok: false,
      error: { code: "CHECKOUT_REVIEW_EXPIRED", recoverable: true },
    });
    expect(provider.createSession).not.toHaveBeenCalled();
  });

  it("fails closed when a sandbox adapter returns a non-inert handoff URL", async () => {
    const unsafeProvider: SandboxCheckoutProvider = {
      environment: "sandbox",
      createSession: async () => ({
        providerSessionId: "unsafe-provider-session",
        handoffUrl: "https://real-retailer.example/checkout",
      returnUrl: "https://wimy.example.invalid/?checkout=return&session=checkout-unsafe",
      }),
      cancelSession: vi.fn(async () => undefined),
    };
    const { service, ticket, cart } = await createCheckoutApi(unsafeProvider);
    const reviewed = await service.review({ sessionToken: ticket.sessionToken, cartId: cart.cartId });
    if (!reviewed.ok) throw new Error(`Expected checkout review: ${reviewed.error.code}`);

    await expect(service.confirm({
      sessionToken: ticket.sessionToken,
      csrfSecret: ticket.csrfSecret,
      reviewId: reviewed.review.reviewId,
      idempotencyKey: "unsafe-handoff",
      confirmation: true,
      origin: "human",
    })).resolves.toMatchObject({
      ok: false,
      error: { code: "CHECKOUT_PROVIDER_FAILURE" },
    });
  });

  it("replays duplicate confirmations without creating duplicate sandbox sessions", async () => {
    const { service, ticket, cart, provider } = await createCheckoutApi();
    const reviewed = await service.review({ sessionToken: ticket.sessionToken, cartId: cart.cartId });
    if (!reviewed.ok) throw new Error(`Expected checkout review: ${reviewed.error.code}`);
    const request = {
      sessionToken: ticket.sessionToken,
      csrfSecret: ticket.csrfSecret,
      reviewId: reviewed.review.reviewId,
      idempotencyKey: "confirm-once",
      confirmation: true as const,
      origin: "human" as const,
    };

    const [first, second] = await Promise.all([
      service.confirm(request),
      service.confirm(request),
    ]);
    expect(first).toEqual(second);
    expect(provider.createSession).toHaveBeenCalledTimes(1);
  });

  it("serializes distinct confirmation keys so one review creates at most one provider session", async () => {
    let release!: () => void;
    let started!: () => void;
    const startedPromise = new Promise<void>((resolve) => { started = resolve; });
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const provider: SandboxCheckoutProvider = {
      environment: "sandbox",
      createSession: vi.fn(async () => {
        started();
        await gate;
        return {
          providerSessionId: "provider-distinct-key",
          handoffUrl: "https://checkout.example.invalid/sandbox/distinct-key",
          returnUrl: "https://wimy.example.invalid/?checkout=return&session=checkout-1",
        };
      }),
      cancelSession: vi.fn(async () => undefined),
    };
    const { service, ticket, cart } = await createCheckoutApi(provider);
    const reviewed = await service.review({ sessionToken: ticket.sessionToken, cartId: cart.cartId });
    if (!reviewed.ok) throw new Error(`Expected checkout review: ${reviewed.error.code}`);
    const first = service.confirm({ sessionToken: ticket.sessionToken, csrfSecret: ticket.csrfSecret, reviewId: reviewed.review.reviewId, idempotencyKey: "distinct-a", confirmation: true, origin: "human" });
    await startedPromise;
    const second = service.confirm({ sessionToken: ticket.sessionToken, csrfSecret: ticket.csrfSecret, reviewId: reviewed.review.reviewId, idempotencyKey: "distinct-b", confirmation: true, origin: "human" });
    release();
    const results = await Promise.all([first, second]);
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(results.find((result) => !result.ok)).toMatchObject({ error: { code: "CHECKOUT_SESSION_ALREADY_CONFIRMED" } });
    expect(provider.createSession).toHaveBeenCalledTimes(1);
  });

  it("retries an ambiguous provider timeout with the same provider idempotency key", async () => {
    const providerSessions = new Map<string, { providerSessionId: string; handoffUrl: string; returnUrl: string }>();
    let attempts = 0;
    const provider: SandboxCheckoutProvider = {
      environment: "sandbox",
      createSession: vi.fn(async (request) => {
        const existing = providerSessions.get(request.idempotencyKey);
        if (existing) return existing;
        const session = {
          providerSessionId: "provider-ambiguous-success",
          handoffUrl: "https://checkout.example.invalid/sandbox/ambiguous-success",
          returnUrl: "https://wimy.example.invalid/?checkout=return&session=checkout-1",
        };
        providerSessions.set(request.idempotencyKey, session);
        attempts += 1;
        if (attempts === 1) throw new Error("success then timeout");
        return session;
      }),
      cancelSession: vi.fn(async () => undefined),
    };
    const { service, ticket, cart } = await createCheckoutApi(provider);
    const reviewed = await service.review({ sessionToken: ticket.sessionToken, cartId: cart.cartId });
    if (!reviewed.ok) throw new Error(`Expected checkout review: ${reviewed.error.code}`);
    const request = { sessionToken: ticket.sessionToken, csrfSecret: ticket.csrfSecret, reviewId: reviewed.review.reviewId, idempotencyKey: "ambiguous-provider", confirmation: true as const, origin: "human" as const };
    await expect(service.confirm(request)).resolves.toMatchObject({ error: { code: "CHECKOUT_PROVIDER_FAILURE" } });
    const retry = await service.confirm(request);
    expect(retry).toMatchObject({ ok: true, session: { handoffUrl: "https://checkout.example.invalid/sandbox/ambiguous-success" } });
    const createSession = vi.mocked(provider.createSession);
    expect(createSession).toHaveBeenCalledTimes(2);
    expect(createSession.mock.calls[0]?.[0].idempotencyKey).toBe(createSession.mock.calls[1]?.[0].idempotencyKey);
  });

  it("forces a new review when current price or availability drifts", async () => {
    const { service, ticket, cart, provider, setCurrentOffer } = await createCheckoutApi();
    const reviewed = await service.review({ sessionToken: ticket.sessionToken, cartId: cart.cartId });
    if (!reviewed.ok) throw new Error(`Expected checkout review: ${reviewed.error.code}`);
    setCurrentOffer(offer({ price: { amountMinor: 13_000, currency: "USD" } }));
    const drifted = await service.review({ sessionToken: ticket.sessionToken, cartId: cart.cartId });
    if (!drifted.ok) throw new Error(`Expected drifted review: ${drifted.error.code}`);
    expect(drifted.review).toMatchObject({
      canConfirm: false,
      lines: [{ price: { amountMinor: 13_000 }, state: "price_changed" }],
    });

    await expect(service.confirm({
      sessionToken: ticket.sessionToken,
      csrfSecret: ticket.csrfSecret,
      reviewId: reviewed.review.reviewId,
      idempotencyKey: "drifted-price",
      confirmation: true,
      origin: "human",
    })).resolves.toMatchObject({
      ok: false,
      error: { code: "CHECKOUT_REVIEW_STALE" },
    });
    expect(provider.createSession).not.toHaveBeenCalled();

    setCurrentOffer(offer({ availability: "out_of_stock" }));
    const unavailableReview = await service.review({ sessionToken: ticket.sessionToken, cartId: cart.cartId });
    if (!unavailableReview.ok) throw new Error(`Expected unavailable review: ${unavailableReview.error.code}`);
    expect(unavailableReview.review).toMatchObject({
      canConfirm: false,
      lines: [{ availability: "out_of_stock", state: "unavailable" }],
    });
  });

  it("returns cancellation when revalidation is aborted", async () => {
    const { service, ticket, cart, provider, resolver } = await createCheckoutApi();
    const reviewed = await service.review({ sessionToken: ticket.sessionToken, cartId: cart.cartId });
    if (!reviewed.ok) throw new Error(`Expected checkout review: ${reviewed.error.code}`);
    const controller = new AbortController();
    vi.mocked(resolver.resolve).mockImplementationOnce(async () => {
      controller.abort();
      return { status: "ok" as const, offers: [offer()] };
    });

    await expect(service.confirm({
      sessionToken: ticket.sessionToken,
      csrfSecret: ticket.csrfSecret,
      reviewId: reviewed.review.reviewId,
      idempotencyKey: "cancelled-revalidation",
      confirmation: true,
      origin: "human",
      signal: controller.signal,
    })).resolves.toMatchObject({
      ok: false,
      error: { code: "CANCELLED", recoverable: true },
    });
    expect(provider.createSession).not.toHaveBeenCalled();
  });

  it("rechecks write authorization immediately before provider handoff", async () => {
    const { service, ticket, cart, provider, resolver, authority } = await createCheckoutApi();
    const reviewed = await service.review({ sessionToken: ticket.sessionToken, cartId: cart.cartId });
    if (!reviewed.ok) throw new Error(`Expected checkout review: ${reviewed.error.code}`);
    vi.mocked(resolver.resolve).mockImplementationOnce(async () => {
      await authority.logout(ticket.sessionToken);
      return { status: "ok" as const, offers: [offer()] };
    });

    await expect(service.confirm({
      sessionToken: ticket.sessionToken,
      csrfSecret: ticket.csrfSecret,
      reviewId: reviewed.review.reviewId,
      idempotencyKey: "signed-out-during-revalidation",
      confirmation: true,
      origin: "human",
    })).resolves.toMatchObject({
      ok: false,
      error: { code: "ANONYMOUS_SESSION", recoverable: true },
    });
    expect(provider.cancelSession).toHaveBeenCalledWith({ providerSessionId: "sandbox-provider-session-1" });
  });

  it.each([
    ["abort", "CANCELLED"],
    ["signout", "ANONYMOUS_SESSION"],
    ["cart mutation", "CHECKOUT_REVIEW_STALE"],
  ] as const)("voids a provider session when %s occurs while creation is pending", async (race, expectedCode) => {
    let release!: () => void;
    let started!: () => void;
    const startedPromise = new Promise<void>((resolve) => { started = resolve; });
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const provider: SandboxCheckoutProvider = {
      environment: "sandbox",
      createSession: vi.fn(async (request) => {
        expect(request.signal).toBeDefined();
        started();
        await gate;
        return {
          providerSessionId: `provider-pending-${race}`,
          handoffUrl: `https://checkout.example.invalid/sandbox/pending-${race}`,
          returnUrl: "https://wimy.example.invalid/?checkout=return&session=checkout-1",
        };
      }),
      cancelSession: vi.fn(async () => undefined),
    };
    const { service, ticket, cart, authority, store } = await createCheckoutApi(provider);
    const reviewed = await service.review({ sessionToken: ticket.sessionToken, cartId: cart.cartId });
    if (!reviewed.ok) throw new Error(`Expected checkout review: ${reviewed.error.code}`);
    const controller = new AbortController();
    const keySuffix = race.replace(/\s+/gu, "-");
    const pending = service.confirm({ sessionToken: ticket.sessionToken, csrfSecret: ticket.csrfSecret, reviewId: reviewed.review.reviewId, idempotencyKey: `pending-${keySuffix}`, confirmation: true, origin: "human", signal: controller.signal });
    await startedPromise;
    if (race === "abort") controller.abort();
    if (race === "signout") await authority.logout(ticket.sessionToken);
    if (race === "cart mutation") {
      const current = await store.read(cart.cartId);
      if (!current) throw new Error("Expected current cart");
      const line = current.lines[0]!;
      const nextLine = { ...line, quantity: 1, lineTotalMinor: line.offer.price.amountMinor };
      const nextCart = { ...current, revision: current.revision + 1, lines: [nextLine], totals: { ...current.totals, subtotalMinor: nextLine.lineTotalMinor, totalMinor: nextLine.lineTotalMinor } };
      const mutation = store.transact({ customerId: ticket.view.authenticated ? ticket.view.customerId : "", cartId: cart.cartId, origin: "human", expectedRevision: current.revision, idempotencyKey: "pending-race-cart-mutation", requestFingerprint: "pending-race-cart-mutation" }, async () => ({
        cart: nextCart,
        receipt: { type: "commerce.cart.receipt" as const, origin: "human" as const, operation: "change_quantity" as const, status: "accepted" as const, revision: nextCart.revision, lineCount: 1, totalQuantity: 1 },
      }));
      release();
      await mutation;
      await expect(pending).resolves.toMatchObject({ ok: false, error: { code: expectedCode } });
      expect(provider.cancelSession).toHaveBeenCalledWith({ providerSessionId: `provider-pending-${race}` });
      return;
    }
    release();
    await expect(pending).resolves.toMatchObject({ ok: false, error: { code: expectedCode } });
    expect(provider.cancelSession).toHaveBeenCalledWith({ providerSessionId: `provider-pending-${race}` });
  });

  it("validates the exact same-app return path before accepting a handoff", async () => {
    const provider: SandboxCheckoutProvider = {
      environment: "sandbox",
      createSession: async () => ({
        providerSessionId: "provider-bad-return",
        handoffUrl: "https://checkout.example.invalid/sandbox/bad-return",
        returnUrl: "https://wimy.example.invalid/?checkout=return&session=other-session",
      }),
      cancelSession: vi.fn(async () => undefined),
    };
    const { service, ticket, cart, provider: injectedProvider } = await createCheckoutApi(provider);
    const reviewed = await service.review({ sessionToken: ticket.sessionToken, cartId: cart.cartId });
    if (!reviewed.ok) throw new Error(`Expected checkout review: ${reviewed.error.code}`);
    await expect(service.confirm({ sessionToken: ticket.sessionToken, csrfSecret: ticket.csrfSecret, reviewId: reviewed.review.reviewId, idempotencyKey: "bad-return", confirmation: true, origin: "human" })).resolves.toMatchObject({ ok: false, error: { code: "CHECKOUT_PROVIDER_FAILURE" } });
    expect(injectedProvider.cancelSession).toHaveBeenCalledWith({ providerSessionId: "provider-bad-return" });
  });

  it("records bounded checkout receipts without private identity or provider data", async () => {
    const audit: unknown[] = [];
    const { service, ticket, cart } = await createCheckoutApi(undefined, { record: (receipt) => { audit.push(receipt); } });
    const reviewed = await service.review({ sessionToken: ticket.sessionToken, cartId: cart.cartId });
    if (!reviewed.ok) throw new Error(`Expected checkout review: ${reviewed.error.code}`);
    const confirmed = await service.confirm({ sessionToken: ticket.sessionToken, csrfSecret: ticket.csrfSecret, reviewId: reviewed.review.reviewId, idempotencyKey: "audit-receipt", confirmation: true, origin: "human" });
    if (!confirmed.ok) throw new Error(`Expected checkout session: ${confirmed.error.code}`);
    await service.returnToWimy({ sessionToken: ticket.sessionToken, csrfSecret: ticket.csrfSecret, checkoutSessionId: confirmed.session.checkoutSessionId, origin: "human" });
    expect(audit.map((receipt) => (receipt as { operation: string }).operation)).toEqual(["review", "confirm", "return"]);
    expect(service.getAuditTrail()).toHaveLength(3);
    expect(JSON.stringify(audit)).not.toMatch(/customer-a|session-token|csrf-secret|provider-session|https?:\/\/|address|payment/iu);
  });

  it("expires old handoff sessions and voids their provider session", async () => {
    const { service, ticket, cart, provider, setNow } = await createCheckoutApi();
    const reviewed = await service.review({ sessionToken: ticket.sessionToken, cartId: cart.cartId });
    if (!reviewed.ok) throw new Error(`Expected checkout review: ${reviewed.error.code}`);
    const confirmed = await service.confirm({ sessionToken: ticket.sessionToken, csrfSecret: ticket.csrfSecret, reviewId: reviewed.review.reviewId, idempotencyKey: "expired-handoff", confirmation: true, origin: "human" });
    if (!confirmed.ok) throw new Error(`Expected checkout session: ${confirmed.error.code}`);
    setNow(301_001);
    await expect(service.open({ sessionToken: ticket.sessionToken, csrfSecret: ticket.csrfSecret, checkoutSessionId: confirmed.session.checkoutSessionId, origin: "human" })).resolves.toMatchObject({
      ok: false,
      error: { code: "CHECKOUT_SESSION_EXPIRED", recoverable: true },
    });
    expect(provider.cancelSession).toHaveBeenCalledWith({ providerSessionId: "sandbox-provider-session-1" });
  });

  it("linearizes concurrent cancel and return transitions", async () => {
    const { service, ticket, cart, provider } = await createCheckoutApi();
    const reviewed = await service.review({ sessionToken: ticket.sessionToken, cartId: cart.cartId });
    if (!reviewed.ok) throw new Error(`Expected checkout review: ${reviewed.error.code}`);
    const confirmed = await service.confirm({ sessionToken: ticket.sessionToken, csrfSecret: ticket.csrfSecret, reviewId: reviewed.review.reviewId, idempotencyKey: "transition-race", confirmation: true, origin: "human" });
    if (!confirmed.ok) throw new Error(`Expected checkout session: ${confirmed.error.code}`);
    const [cancelled, returned] = await Promise.all([
      service.cancel({ sessionToken: ticket.sessionToken, csrfSecret: ticket.csrfSecret, checkoutSessionId: confirmed.session.checkoutSessionId, origin: "human" }),
      service.returnToWimy({ sessionToken: ticket.sessionToken, csrfSecret: ticket.csrfSecret, checkoutSessionId: confirmed.session.checkoutSessionId, origin: "human" }),
    ]);
    expect([cancelled, returned].filter((result) => result.ok)).toHaveLength(1);
    expect([cancelled, returned].find((result) => !result.ok)).toMatchObject({ error: { code: expect.stringMatching(/ALREADY_(CANCELLED|RETURNED)/u) } });
    expect(provider.cancelSession).toHaveBeenCalledTimes(1);
  });

  it("does not replay a handoff-ready state after cancel or return", async () => {
    for (const action of ["cancel", "returnToWimy"] as const) {
      const { service, ticket, cart, provider } = await createCheckoutApi();
      const reviewed = await service.review({ sessionToken: ticket.sessionToken, cartId: cart.cartId });
      if (!reviewed.ok) throw new Error(`Expected checkout review: ${reviewed.error.code}`);
      const confirmRequest = { sessionToken: ticket.sessionToken, csrfSecret: ticket.csrfSecret, reviewId: reviewed.review.reviewId, idempotencyKey: `terminal-${action}`, confirmation: true as const, origin: "human" as const };
      const confirmed = await service.confirm(confirmRequest);
      if (!confirmed.ok) throw new Error(`Expected checkout session: ${confirmed.error.code}`);
      const terminal = await service[action]({ sessionToken: ticket.sessionToken, csrfSecret: ticket.csrfSecret, checkoutSessionId: confirmed.session.checkoutSessionId, origin: "human" });
      if (!terminal.ok) throw new Error(`Expected terminal transition: ${terminal.error.code}`);
      await expect(service.confirm(confirmRequest)).resolves.toMatchObject({
        ok: true,
        session: { checkoutSessionId: confirmed.session.checkoutSessionId, status: action === "cancel" ? "cancelled" : "returned" },
      });
      expect(provider.createSession).toHaveBeenCalledTimes(1);
      await expect(service.open({ sessionToken: ticket.sessionToken, csrfSecret: ticket.csrfSecret, checkoutSessionId: confirmed.session.checkoutSessionId, origin: "human" })).resolves.toMatchObject({
        ok: false,
        error: { code: action === "cancel" ? "CHECKOUT_SESSION_ALREADY_CANCELLED" : "CHECKOUT_SESSION_ALREADY_RETURNED" },
      });
    }
  });

  it("serializes open against cancellation while final freshness is pending", async () => {
    let release!: () => void;
    let started!: () => void;
    const startedPromise = new Promise<void>((resolve) => { started = resolve; });
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const { service, ticket, cart, resolver } = await createCheckoutApi();
    const reviewed = await service.review({ sessionToken: ticket.sessionToken, cartId: cart.cartId });
    if (!reviewed.ok) throw new Error(`Expected checkout review: ${reviewed.error.code}`);
    const confirmed = await service.confirm({ sessionToken: ticket.sessionToken, csrfSecret: ticket.csrfSecret, reviewId: reviewed.review.reviewId, idempotencyKey: "open-transition-race", confirmation: true, origin: "human" });
    if (!confirmed.ok) throw new Error(`Expected checkout session: ${confirmed.error.code}`);
    vi.mocked(resolver.resolve).mockImplementationOnce(async () => {
      started();
      await gate;
      return { status: "ok" as const, offers: [offer()] };
    });
    const events: string[] = [];
    const open = service.open({ sessionToken: ticket.sessionToken, csrfSecret: ticket.csrfSecret, checkoutSessionId: confirmed.session.checkoutSessionId, origin: "human" }).then((result) => { events.push("open"); return result; });
    await startedPromise;
    const cancel = service.cancel({ sessionToken: ticket.sessionToken, csrfSecret: ticket.csrfSecret, checkoutSessionId: confirmed.session.checkoutSessionId, origin: "human" }).then((result) => { events.push("cancel"); return result; });
    release();
    const [openResult, cancelResult] = await Promise.all([open, cancel]);
    expect(events).toEqual(["open", "cancel"]);
    expect(openResult).toMatchObject({ ok: true, session: { status: "handoff_ready" } });
    expect(cancelResult).toMatchObject({ ok: true, session: { status: "cancelled" } });
  });

  it("returns recoverable provider failures and supports cancellation and return", async () => {
    let attempts = 0;
    const provider: SandboxCheckoutProvider = {
      environment: "sandbox",
      createSession: vi.fn(async () => {
        attempts += 1;
        if (attempts === 1) throw new Error("provider secret detail");
        return {
          providerSessionId: "provider-session-retry",
          handoffUrl: "https://checkout.example.invalid/sandbox/retry",
          returnUrl: "https://wimy.example.invalid/?checkout=return&session=checkout-1",
        };
      }),
      cancelSession: vi.fn(async () => undefined),
    };
    const { service, ticket, cart } = await createCheckoutApi(provider);
    const reviewed = await service.review({ sessionToken: ticket.sessionToken, cartId: cart.cartId });
    if (!reviewed.ok) throw new Error(`Expected checkout review: ${reviewed.error.code}`);
    const request = {
      sessionToken: ticket.sessionToken,
      csrfSecret: ticket.csrfSecret,
      reviewId: reviewed.review.reviewId,
      idempotencyKey: "retry-provider",
      confirmation: true as const,
      origin: "human" as const,
    };
    await expect(service.confirm(request)).resolves.toMatchObject({
      ok: false,
      error: { code: "CHECKOUT_PROVIDER_FAILURE", message: expect.not.stringContaining("secret") },
    });
    const confirmed = await service.confirm(request);
    if (!confirmed.ok) throw new Error(`Expected retry to succeed: ${confirmed.error.code}`);
    await expect(service.cancel({
      sessionToken: ticket.sessionToken,
      csrfSecret: ticket.csrfSecret,
      checkoutSessionId: confirmed.session.checkoutSessionId,
      origin: "human",
    })).resolves.toMatchObject({ ok: true, session: { status: "cancelled" } });
    await expect(service.returnToWimy({
      sessionToken: ticket.sessionToken,
      csrfSecret: ticket.csrfSecret,
      checkoutSessionId: confirmed.session.checkoutSessionId,
      origin: "human",
    })).resolves.toMatchObject({ ok: false, error: { code: "CHECKOUT_SESSION_ALREADY_CANCELLED" } });

    const returnApi = await createCheckoutApi();
    const returnReview = await returnApi.service.review({ sessionToken: returnApi.ticket.sessionToken, cartId: returnApi.cart.cartId });
    if (!returnReview.ok) throw new Error(`Expected return review: ${returnReview.error.code}`);
    const returnSession = await returnApi.service.confirm({
      sessionToken: returnApi.ticket.sessionToken,
      csrfSecret: returnApi.ticket.csrfSecret,
      reviewId: returnReview.review.reviewId,
      idempotencyKey: "return-flow",
      confirmation: true,
      origin: "human",
    });
    if (!returnSession.ok) throw new Error(`Expected return session: ${returnSession.error.code}`);
    await expect(returnApi.service.returnToWimy({
      sessionToken: returnApi.ticket.sessionToken,
      csrfSecret: returnApi.ticket.csrfSecret,
      checkoutSessionId: returnSession.session.checkoutSessionId,
      origin: "human",
    })).resolves.toMatchObject({ ok: true, session: { status: "returned" } });
  });
});
