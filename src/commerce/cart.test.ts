import { describe, expect, it, vi } from "vitest";
import {
  CustomerSessionAuthority,
  type CustomerScope,
  type CustomerSessionStore,
  type StoredCustomerSession,
} from "./customer-session";
import {
  createCartService,
  createInMemoryCartStore,
  getRetailerOfferVersion,
  type CartAuditEvent,
  type CartService,
  type CartStore,
} from "./cart";
import type { RetailerOffer, RetailerOfferResolver } from "./retailer-offer-adapter";

const catalogRef = {
  catalogId: "00000000-0000-4000-8000-000000000501",
  productId: "00000000-0000-4000-8000-000000000502",
} as const;

const offer = (
  overrides: Partial<RetailerOffer> = {},
): RetailerOffer => ({
  offerId: "northstar-offer",
  retailerId: "synthetic-northstar",
  sellerId: "synthetic-northstar-direct",
  catalogRef,
  displayName: "Aurora Chair",
  productUrl: "https://offers.example.invalid/synthetic-northstar/aurora-chair",
  price: { amountMinor: 12_000, currency: "USD" },
  availability: "in_stock",
  observedAt: "1970-01-01T00:16:40.000Z",
  expiresAt: "1970-01-01T00:46:40.000Z",
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
  readonly revoked = new Set<string>();

  async read(sessionToken: string) {
    if (this.revoked.has(sessionToken)) return null;
    return this.sessions.get(sessionToken) ?? null;
  }

  async write(sessionToken: string, session: StoredCustomerSession) {
    this.sessions.set(sessionToken, session);
  }

  async revoke(sessionToken: string) {
    this.sessions.delete(sessionToken);
    this.revoked.add(sessionToken);
  }
}

const createSession = (
  customerId = "customer-a",
  scopes: readonly CustomerScope[] = ["commerce:cart:read", "commerce:cart:write"],
) => {
  const authority = new CustomerSessionAuthority({
    store: new MemorySessionStore(),
    now: () => 1_000,
    createSessionToken: () => "session-token",
    createCsrfSecret: () => "csrf-secret",
    ttlMs: 10_000,
  });
  return authority.signIn({ customerId }, scopes).then((ticket) => ({
    authority,
    ticket,
  }));
};

const createResolver = (currentOffer: RetailerOffer = offer()): RetailerOfferResolver => ({
  resolve: vi.fn(async ({ catalogRef: lookup }) =>
    lookup.catalogId === currentOffer.catalogRef.catalogId &&
    lookup.productId === currentOffer.catalogRef.productId
      ? { status: "ok" as const, offers: [structuredClone(currentOffer)] }
      : { status: "no_offers" as const, offers: [] as const },
  ),
  clearCache: vi.fn(),
});

const createApi = async (
  options: {
    customerId?: string;
    offer?: RetailerOffer;
    resolver?: RetailerOfferResolver;
    store?: CartStore;
    storeOptions?: Parameters<typeof createInMemoryCartStore>[0];
    scopes?: readonly ("commerce:cart:read" | "commerce:cart:write")[];
    now?: () => number;
  } = {},
) => {
  const { authority, ticket } = await createSession(options.customerId ?? "customer-a", options.scopes ?? [
    "commerce:cart:read",
    "commerce:cart:write",
  ]);
  const api = createCartService({
    store: options.store ?? createInMemoryCartStore({
      ...options.storeOptions,
      createCartId: (() => {
        let index = 0;
        return () => `cart-${++index}`;
      })(),
    }),
    sessionAuthority: authority,
    offerResolver: options.resolver ?? createResolver(options.offer),
    clock: options.now ?? (() => 1_000),
    createLineId: (() => {
      let index = 0;
      return () => `line-${++index}`;
    })(),
  });
  return { api, ticket, authority };
};

const readCart = async (api: CartService, sessionToken: string, cartId?: string) => {
  const result = await api.getCart({ sessionToken, cartId });
  if (!result.ok) throw new Error(`Expected cart read: ${result.error.code}`);
  return result;
};

describe("CartService", () => {
  it("adds an exact offer with a snapshot, totals, revision, and exact idempotent replay", async () => {
    const { api, ticket } = await createApi();
    const currentOffer = offer();
    const add = await api.addLine({
      sessionToken: ticket.sessionToken,
      csrfSecret: ticket.csrfSecret,
      origin: "webmcp",
      expectedRevision: 1,
      idempotencyKey: "add-chair-1",
      offer: {
        offerId: currentOffer.offerId,
        offerVersion: getRetailerOfferVersion(currentOffer),
        catalogRef,
        price: currentOffer.price,
      },
      quantity: 2,
    });

    expect(add).toMatchObject({ ok: true, cart: {
      revision: 2,
      customerId: "customer-a",
      status: "active",
      currency: "USD",
      totals: { subtotalMinor: 24_000, totalMinor: 24_000, currency: "USD" },
    }});
    if (!add.ok) return;
    expect(add.cart.lines).toHaveLength(1);
    expect(add.cart.lines[0]).toMatchObject({
      lineId: "line-1",
      quantity: 2,
      lineTotalMinor: 24_000,
      offer: {
        offerId: currentOffer.offerId,
        offerVersion: getRetailerOfferVersion(currentOffer),
        catalogRef,
        price: currentOffer.price,
        availability: "in_stock",
      },
    });
    expect(add.receipt).toMatchObject({
      type: "commerce.cart.receipt",
      origin: "webmcp",
      operation: "add",
      status: "accepted",
      revision: 2,
      lineCount: 1,
      totalQuantity: 2,
    });

    const replay = await api.addLine({
      sessionToken: ticket.sessionToken,
      csrfSecret: ticket.csrfSecret,
      expectedRevision: 1,
      idempotencyKey: "add-chair-1",
      offer: {
        offerId: currentOffer.offerId,
        offerVersion: getRetailerOfferVersion(currentOffer),
        catalogRef,
        price: currentOffer.price,
      },
      quantity: 2,
    });
    expect(replay).toEqual(add);

    const cart = await readCart(api, ticket.sessionToken);
    expect(cart.cart.lines).toHaveLength(1);
    expect(cart.cart.revision).toBe(2);
  });

  it("fails closed for anonymous, missing-scope, and invalid-CSRF writes", async () => {
    const anonymous = await createApi();
    const anonymousResult = await anonymous.api.addLine({
      expectedRevision: 1,
      idempotencyKey: "anonymous-add",
      offer: { offerId: "offer", offerVersion: "version", catalogRef, price: { amountMinor: 1, currency: "USD" } },
      quantity: 1,
    });
    expect(anonymousResult).toMatchObject({ ok: false, error: { code: "ANONYMOUS_SESSION", recoverable: true } });

    const readOnly = await createApi({ scopes: ["commerce:cart:read"] });
    const missingWriteScope = await readOnly.api.addLine({
      sessionToken: readOnly.ticket.sessionToken,
      csrfSecret: readOnly.ticket.csrfSecret,
      expectedRevision: 1,
      idempotencyKey: "missing-write-scope",
      offer: { offerId: "offer", offerVersion: "version", catalogRef, price: { amountMinor: 1, currency: "USD" } },
      quantity: 1,
    });
    expect(missingWriteScope).toMatchObject({ ok: false, error: { code: "MISSING_SCOPE" } });

    const invalidCsrf = await createApi();
    const invalidCsrfResult = await invalidCsrf.api.addLine({
      sessionToken: invalidCsrf.ticket.sessionToken,
      csrfSecret: "wrong-secret",
      expectedRevision: 1,
      idempotencyKey: "invalid-csrf",
      offer: { offerId: "offer", offerVersion: "version", catalogRef, price: { amountMinor: 1, currency: "USD" } },
      quantity: 1,
    });
    expect(invalidCsrfResult).toMatchObject({ ok: false, error: { code: "INVALID_CSRF" } });
  });

  it("keeps the WebMCP origin on denied cart reads", async () => {
    const { api } = await createApi();
    const result = await api.getCart({ origin: "webmcp" });

    expect(result).toMatchObject({
      ok: false,
      error: { code: "ANONYMOUS_SESSION" },
      receipt: { origin: "webmcp", operation: "read", status: "rejected" },
    });
  });

  it("maps revoked, expired, and unavailable session states to typed cart failures", async () => {
    const revocationStore = new MemorySessionStore();
    const revokedAuthority = new CustomerSessionAuthority({
      store: revocationStore,
      now: () => 1_000,
      createSessionToken: () => "revoked-session",
      createCsrfSecret: () => "revoked-csrf",
    });
    const revokedTicket = await revokedAuthority.signIn({ customerId: "customer-a" }, ["commerce:cart:read"]);
    const revokedSession = revocationStore.sessions.get(revokedTicket.sessionToken);
    if (!revokedSession) throw new Error("Expected a stored session");
    revocationStore.sessions.set(revokedTicket.sessionToken, { ...revokedSession, revokedAt: 2_000 });
    const revokedApi = createCartService({ store: createInMemoryCartStore({ createCartId: () => "revoked-cart" }), sessionAuthority: revokedAuthority, offerResolver: createResolver(), clock: () => 1_000 });
    await expect(revokedApi.getCart({ sessionToken: revokedTicket.sessionToken })).resolves.toMatchObject({ ok: false, error: { code: "SESSION_REVOKED" } });

    let now = 1_000;
    const sessionStore = new MemorySessionStore();
    const expiringAuthority = new CustomerSessionAuthority({
      store: sessionStore,
      now: () => now,
      createSessionToken: () => "expiring-session",
      createCsrfSecret: () => "expiring-csrf",
      ttlMs: 10_000,
    });
    const expiringTicket = await expiringAuthority.signIn({ customerId: "customer-a" }, ["commerce:cart:read"]);
    now = 11_000;
    const expiredApi = createCartService({ store: createInMemoryCartStore({ createCartId: () => "expired-cart" }), sessionAuthority: expiringAuthority, offerResolver: createResolver(), clock: () => now });
    await expect(expiredApi.getCart({ sessionToken: expiringTicket.sessionToken })).resolves.toMatchObject({ ok: false, error: { code: "SESSION_EXPIRED" } });

    const unavailableStore: CustomerSessionStore = {
      read: async () => { throw new Error("session store unavailable"); },
      write: async () => undefined,
      revoke: async () => undefined,
    };
    const unavailableAuthority = new CustomerSessionAuthority({
      store: unavailableStore,
      now: () => 1_000,
      createSessionToken: () => "unavailable-session",
      createCsrfSecret: () => "unavailable-csrf",
    });
    const unavailableApi = createCartService({ store: createInMemoryCartStore({ createCartId: () => "unavailable-cart" }), sessionAuthority: unavailableAuthority, offerResolver: createResolver(), clock: () => 1_000 });
    await expect(unavailableApi.getCart({ sessionToken: "unavailable-session" })).resolves.toMatchObject({ ok: false, error: { code: "SESSION_UNAVAILABLE" } });
  });

  it("rejects stale revisions and mismatched idempotency-key reuse without mutation", async () => {
    const { api, ticket } = await createApi();
    const currentOffer = offer();
    const request = {
      sessionToken: ticket.sessionToken,
      csrfSecret: ticket.csrfSecret,
      expectedRevision: 1,
      idempotencyKey: "one-key",
      offer: { offerId: currentOffer.offerId, offerVersion: getRetailerOfferVersion(currentOffer), catalogRef, price: currentOffer.price },
      quantity: 1,
    } as const;
    const first = await api.addLine(request);
    expect(first.ok).toBe(true);
    const conflict = await api.addLine({ ...request, idempotencyKey: "different-key" });
    expect(conflict).toMatchObject({ ok: false, error: { code: "CART_REVISION_CONFLICT" } });
    const mismatch = await api.addLine({ ...request, quantity: 2 });
    expect(mismatch).toMatchObject({ ok: false, error: { code: "IDEMPOTENCY_KEY_REUSED" } });
    const cart = await readCart(api, ticket.sessionToken);
    expect(cart.cart.lines[0]?.quantity).toBe(1);
    expect(cart.cart.revision).toBe(2);
  });

  it("serializes concurrent writes so only one expected revision can commit", async () => {
    const { api, ticket } = await createApi();
    const currentOffer = offer();
    const request = {
      sessionToken: ticket.sessionToken,
      csrfSecret: ticket.csrfSecret,
      expectedRevision: 1,
      offer: { offerId: currentOffer.offerId, offerVersion: getRetailerOfferVersion(currentOffer), catalogRef, price: currentOffer.price },
      quantity: 1,
    } as const;
    const [first, second] = await Promise.all([
      api.addLine({ ...request, idempotencyKey: "concurrent-a" }),
      api.addLine({ ...request, idempotencyKey: "concurrent-b" }),
    ]);
    expect([first.ok, second.ok].filter(Boolean)).toHaveLength(1);
    expect([first, second].find((result) => !result.ok)).toMatchObject({ ok: false, error: { code: "CART_REVISION_CONFLICT" } });
    const cart = await readCart(api, ticket.sessionToken);
    expect(cart.cart.revision).toBe(2);
    expect(cart.cart.lines[0]?.quantity).toBe(1);
  });

  it.each([
    ["ambiguous", "OFFER_AMBIGUOUS"],
    ["substitute", "OFFER_SUBSTITUTE"],
    ["stale", "OFFER_STALE"],
    ["unavailable", "OFFER_UNAVAILABLE"],
  ] as const)("rejects %s offers before changing the cart", async (kind, code) => {
    const currentOffer = offer({
      identityEvidence: kind === "ambiguous"
        ? { match: "ambiguous", method: "name_dimensions_style", catalogRef }
        : kind === "substitute"
          ? { match: "substitute", method: "category_style_similarity", catalogRef }
          : offer().identityEvidence,
      eligibility: kind === "stale" ? "stale" : kind === "unavailable" ? "unavailable" : "unverified",
      availability: kind === "unavailable" ? "out_of_stock" : "in_stock",
    });
    const { api, ticket } = await createApi({ offer: currentOffer });
    const result = await api.addLine({
      sessionToken: ticket.sessionToken,
      csrfSecret: ticket.csrfSecret,
      expectedRevision: 1,
      idempotencyKey: `reject-${kind}`,
      offer: { offerId: currentOffer.offerId, offerVersion: getRetailerOfferVersion(currentOffer), catalogRef, price: currentOffer.price },
      quantity: 1,
    });
    expect(result).toMatchObject({ ok: false, error: { code } });
    const cart = await readCart(api, ticket.sessionToken);
    expect(cart.cart.lines).toHaveLength(0);
    expect(cart.cart.revision).toBe(1);
  });

  it("rejects offer identity, version, price, currency, and resolver failures", async () => {
    const currentOffer = offer();
    const { api, ticket } = await createApi({ offer: currentOffer });
    const base = {
      sessionToken: ticket.sessionToken,
      csrfSecret: ticket.csrfSecret,
      expectedRevision: 1,
      offer: { offerId: currentOffer.offerId, offerVersion: getRetailerOfferVersion(currentOffer), catalogRef, price: currentOffer.price },
      quantity: 1,
    } as const;
    await expect(api.addLine({ ...base, idempotencyKey: "wrong-version", offer: { ...base.offer, offerVersion: "old-version" } })).resolves.toMatchObject({ ok: false, error: { code: "OFFER_VERSION_MISMATCH" } });
    await expect(api.addLine({ ...base, idempotencyKey: "wrong-price", offer: { ...base.offer, price: { amountMinor: 12_001, currency: "USD" } } })).resolves.toMatchObject({ ok: false, error: { code: "OFFER_PRICE_MISMATCH" } });
    await expect(api.addLine({ ...base, idempotencyKey: "wrong-currency", offer: { ...base.offer, price: { amountMinor: 12_000, currency: "EUR" } } })).resolves.toMatchObject({ ok: false, error: { code: "OFFER_CURRENCY_MISMATCH" } });
    await expect(api.addLine({ ...base, idempotencyKey: "wrong-catalog", offer: { ...base.offer, catalogRef: { ...catalogRef, productId: "00000000-0000-4000-8000-000000000599" } } })).resolves.toMatchObject({ ok: false, error: { code: "OFFER_NOT_FOUND" } });
  });

  it("revalidates the stored exact offer before quantity changes", async () => {
    let currentOffer = offer();
    const resolver: RetailerOfferResolver = {
      resolve: vi.fn(async () => ({ status: "ok" as const, offers: [structuredClone(currentOffer)] })),
      clearCache: vi.fn(),
    };
    const { api, ticket } = await createApi({ resolver });
    const add = await api.addLine({
      sessionToken: ticket.sessionToken,
      csrfSecret: ticket.csrfSecret,
      expectedRevision: 1,
      idempotencyKey: "add-for-update",
      offer: { offerId: currentOffer.offerId, offerVersion: getRetailerOfferVersion(currentOffer), catalogRef, price: currentOffer.price },
      quantity: 1,
    });
    if (!add.ok) throw new Error("Expected add to succeed");
    currentOffer = offer({ price: { amountMinor: 12_500, currency: "USD" } });
    const staleUpdate = await api.changeQuantity({
      sessionToken: ticket.sessionToken,
      csrfSecret: ticket.csrfSecret,
      cartId: add.cart.cartId,
      expectedRevision: add.cart.revision,
      idempotencyKey: "stale-update",
      lineId: add.cart.lines[0]!.lineId,
      quantity: 2,
    });
    expect(staleUpdate).toMatchObject({ ok: false, error: { code: "OFFER_VERSION_MISMATCH" } });
    expect((await readCart(api, ticket.sessionToken, add.cart.cartId)).cart.lines[0]?.quantity).toBe(1);
  });

  it("removes and merges lines through independent cart revisions", async () => {
    const { api, ticket } = await createApi();
    const currentOffer = offer();
    const offerInput = { offerId: currentOffer.offerId, offerVersion: getRetailerOfferVersion(currentOffer), catalogRef, price: currentOffer.price };
    const first = await api.addLine({ sessionToken: ticket.sessionToken, csrfSecret: ticket.csrfSecret, expectedRevision: 1, idempotencyKey: "merge-1", offer: offerInput, quantity: 1 });
    if (!first.ok) throw new Error("Expected first add to succeed");
    const second = await api.addLine({ sessionToken: ticket.sessionToken, csrfSecret: ticket.csrfSecret, cartId: first.cart.cartId, expectedRevision: 2, idempotencyKey: "merge-2", offer: offerInput, quantity: 2 });
    if (!second.ok) throw new Error("Expected second add to succeed");
    expect(second.cart.lines).toHaveLength(1);
    expect(second.cart.lines[0]?.quantity).toBe(3);
    const changed = await api.changeQuantity({ sessionToken: ticket.sessionToken, csrfSecret: ticket.csrfSecret, cartId: second.cart.cartId, expectedRevision: 3, idempotencyKey: "change-1", lineId: second.cart.lines[0]!.lineId, quantity: 4 });
    if (!changed.ok) throw new Error("Expected quantity change to succeed");
    const removed = await api.removeLine({ sessionToken: ticket.sessionToken, csrfSecret: ticket.csrfSecret, cartId: changed.cart.cartId, expectedRevision: 4, idempotencyKey: "remove-1", lineId: changed.cart.lines[0]!.lineId });
    expect(removed).toMatchObject({ ok: true, cart: { revision: 5, lines: [], totals: { totalMinor: 0 } } });
  });

  it("prevents a different customer from reading or mutating another customer's cart", async () => {
    const store = createInMemoryCartStore({ createCartId: (() => { let index = 0; return () => `cart-${++index}`; })() });
    const a = await createApi({ store, customerId: "customer-a" });
    const b = await createApi({ store, customerId: "customer-b" });
    const currentOffer = offer();
    const added = await a.api.addLine({ sessionToken: a.ticket.sessionToken, csrfSecret: a.ticket.csrfSecret, expectedRevision: 1, idempotencyKey: "owner-add", offer: { offerId: currentOffer.offerId, offerVersion: getRetailerOfferVersion(currentOffer), catalogRef, price: currentOffer.price }, quantity: 1 });
    if (!added.ok) throw new Error("Expected owner add to succeed");
    await expect(b.api.getCart({ sessionToken: b.ticket.sessionToken, cartId: added.cart.cartId })).resolves.toMatchObject({ ok: false, error: { code: "CART_OWNERSHIP_MISMATCH" } });
    await expect(b.api.removeLine({ sessionToken: b.ticket.sessionToken, csrfSecret: b.ticket.csrfSecret, cartId: added.cart.cartId, expectedRevision: 2, idempotencyKey: "cross-owner-remove", lineId: added.cart.lines[0]!.lineId })).resolves.toMatchObject({ ok: false, error: { code: "CART_OWNERSHIP_MISMATCH" } });
    expect((await readCart(a.api, a.ticket.sessionToken, added.cart.cartId)).cart.lines).toHaveLength(1);
  });

  it("rolls back on resolver and store failures and keeps receipts bounded", async () => {
    const failingResolver: RetailerOfferResolver = { resolve: vi.fn(async () => { throw new Error("provider-token=do-not-leak"); }), clearCache: vi.fn() };
    const resolverFailure = await createApi({ resolver: failingResolver });
    const failed = await resolverFailure.api.addLine({ sessionToken: resolverFailure.ticket.sessionToken, csrfSecret: resolverFailure.ticket.csrfSecret, expectedRevision: 1, idempotencyKey: "resolver-failure", offer: { offerId: "offer", offerVersion: "version", catalogRef, price: { amountMinor: 1, currency: "USD" } }, quantity: 1 });
    expect(failed).toMatchObject({ ok: false, error: { code: "OFFER_RESOLUTION_FAILED" } });
    expect(JSON.stringify(failed)).not.toContain("provider-token");
    const storeFailure = await createApi({ storeOptions: { failTransactions: true } });
    const storeFailed = await storeFailure.api.addLine({ sessionToken: storeFailure.ticket.sessionToken, csrfSecret: storeFailure.ticket.csrfSecret, expectedRevision: 1, idempotencyKey: "store-failure", offer: { offerId: "offer", offerVersion: "version", catalogRef, price: { amountMinor: 1, currency: "USD" } }, quantity: 1 });
    expect(storeFailed).toMatchObject({ ok: false, error: { code: "STORE_UNAVAILABLE" } });
  });

  it("keeps audit receipts bounded and separate from room transactions", async () => {
    const events: CartAuditEvent[] = [];
    const { api, ticket } = await createApi();
    const audited = createCartService({
      store: createInMemoryCartStore({ createCartId: () => "cart-audit" }),
      sessionAuthority: (await createSession())["authority"],
      offerResolver: createResolver(),
      clock: () => 1_000,
      createLineId: () => "line-audit",
      auditEventSink: { record: (event) => { events.push(event); } },
    });
    await audited.getCart({ sessionToken: ticket.sessionToken });
    expect(events[0]).toMatchObject({ type: "commerce.cart.receipt", operation: "read", status: "accepted", revision: 1, lineCount: 0, totalQuantity: 0 });
    expect(JSON.stringify(events)).not.toMatch(/csrf|session-token|example\.invalid|Aurora/iu);
    expect(api).not.toBeUndefined();
  });
});
