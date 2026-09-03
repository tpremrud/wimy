import { describe, expect, it, vi } from "vitest";
import { getRetailerOfferVersion } from "../commerce/cart";
import { createCustomerSessionDemo } from "../commerce/customer-session-demo";
import type { RetailerOffer, RetailerOfferResolver } from "../commerce/retailer-offer-adapter";
import { resolveCatalogProduct } from "../room/catalog";
import { createRoomStore } from "../room/store";
import { getTemplate } from "../room/templates";
import { TEST_TRANSACTION_DEPENDENCIES } from "../room/transaction";
import {
  AUTHENTICATED_WEBMCP_TOOL_NAMES,
  CART_WEBMCP_TOOL_NAMES,
} from "../test/webmcp-fixtures";
import { createRoomToolDefinitions } from "./room-tools";

const CATALOG_TRANSACTION_DEPENDENCIES = {
  ...TEST_TRANSACTION_DEPENDENCIES,
  resolveProduct: resolveCatalogProduct,
};

const catalogRef = {
  catalogId: "wimy-demo-v1",
  productId: "ember-nest-chair",
} as const;

const createOffer = (overrides: Partial<RetailerOffer> = {}): RetailerOffer => ({
  offerId: "northstar-chair",
  retailerId: "synthetic-northstar",
  sellerId: "synthetic-northstar-direct",
  catalogRef,
  displayName: "Ember Nest Chair",
  productUrl: "https://offers.example.invalid/northstar-chair",
  price: { amountMinor: 49_900, currency: "USD" },
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
    evidence: ["trusted synthetic fixture"],
    catalogRef,
  },
  eligibility: "purchasable",
  ...overrides,
});

const createResolver = (readOffer: () => RetailerOffer): RetailerOfferResolver => ({
  resolve: async ({ catalogRef: lookup }, { signal } = {}) => {
    if (signal?.aborted) return { status: "cancelled", offers: [] };
    const current = readOffer();
    return current.catalogRef.catalogId === lookup.catalogId && current.catalogRef.productId === lookup.productId
      ? { status: "ok", offers: [structuredClone(current)] }
      : { status: "no_offers", offers: [] };
  },
  clearCache: () => undefined,
});

describe("authenticated WebMCP Cart tools", () => {
  it("publishes four bounded shopping-plan tools only for a scoped Customer Session", async () => {
    const store = createRoomStore(
      getTemplate("living-room"),
      CATALOG_TRANSACTION_DEPENDENCIES,
    );
    const customerSession = createCustomerSessionDemo();

    expect(
      createRoomToolDefinitions(store).map(({ name }) => name),
    ).not.toEqual(expect.arrayContaining([...CART_WEBMCP_TOOL_NAMES]));

    const session = await customerSession.signIn("Demo customer");
    const definitions = createRoomToolDefinitions(
      store,
      undefined,
      { customerSession, session } as never,
    );

    expect(definitions.map(({ name }) => name)).toEqual(
      AUTHENTICATED_WEBMCP_TOOL_NAMES,
    );
    expect(
      definitions
        .filter(({ name }) => ["inspect_cart", "add_to_cart", "remove_from_cart"].includes(name))
        .map(({ name, annotations }) => ({ name, annotations })),
    ).toEqual([
      { name: "inspect_cart", annotations: { readOnlyHint: true, untrustedContentHint: true } },
      { name: "add_to_cart", annotations: { readOnlyHint: false, untrustedContentHint: true } },
      { name: "remove_from_cart", annotations: { readOnlyHint: false, untrustedContentHint: true } },
    ]);
  });

  it("keeps advertised cart money validation aligned with the cart seam", async () => {
    const store = createRoomStore(getTemplate("living-room"), CATALOG_TRANSACTION_DEPENDENCIES);
    const customerSession = createCustomerSessionDemo({ offerResolver: createResolver(() => createOffer()) });
    const session = await customerSession.signIn("Demo customer");
    const addLine = vi.fn(async () => ({ ok: true } as never));
    customerSession.cart!.addLine = addLine;
    const definition = createRoomToolDefinitions(
      store,
      createResolver(() => createOffer()),
      { customerSession, session },
    ).find(({ name }) => name === "add_to_cart");
    if (!definition) throw new Error("add_to_cart was not defined");

    const priceSchema = (definition.inputSchema as {
      properties: {
        offer: {
          properties: {
            price: { oneOf?: Array<{ properties?: { unit?: { const?: string }; quantity?: { const?: number } } }> };
          };
        };
      };
    }).properties.offer.properties.price;
    expect(priceSchema.oneOf).toEqual(expect.arrayContaining([
      expect.objectContaining({
        properties: expect.objectContaining({
          unit: { const: "each" },
          quantity: { const: 1 },
        }),
      }),
    ]));
    expect((definition.inputSchema as { properties: Record<string, unknown> }).properties).not.toHaveProperty("quantity");

    const rejected = await definition.execute(
      {
        expectedRevision: 1,
        idempotencyKey: "each-pack-drift",
        offer: {
          offerId: createOffer().offerId,
          offerVersion: getRetailerOfferVersion(createOffer()),
          catalogRef,
          price: { amountMinor: 49_900, currency: "USD", unit: "each", quantity: 2 },
        },
      },
      { signal: new AbortController().signal },
    );
    expect(rejected).toMatchObject({ ok: false, error: { code: "INVALID_REQUEST" } });
    expect(addLine).not.toHaveBeenCalled();
  });

  it("caps projected exact offers and reports deterministic truncation metadata", async () => {
    const store = createRoomStore(getTemplate("living-room"), CATALOG_TRANSACTION_DEPENDENCIES);
    const offers = Array.from({ length: 25 }, (_, index) =>
      createOffer({ offerId: `northstar-chair-${String(index).padStart(2, "0")}` }),
    );
    const customerSession = createCustomerSessionDemo();
    const session = await customerSession.signIn("Demo customer");
    const resolver: RetailerOfferResolver = {
      resolve: async () => ({ status: "ok", offers: structuredClone(offers) }),
      clearCache: () => undefined,
    };
    const definition = createRoomToolDefinitions(store, resolver, { customerSession, session })
      .find(({ name }) => name === "find_retailer_offers");
    if (!definition) throw new Error("find_retailer_offers was not defined");

    const result = await definition.execute(catalogRef, { signal: new AbortController().signal });
    expect(result).toMatchObject({ ok: true, offerCount: 25, offersTruncated: true });
    expect((result as { offers: unknown[] }).offers).toHaveLength(20);
    expect(JSON.stringify(result)).not.toMatch(/https?:\/\/|seller|sourceUrl/iu);
  });

  it("redacts hostile retailer text while keeping the client contract bounded", async () => {
    const store = createRoomStore(getTemplate("living-room"), CATALOG_TRANSACTION_DEPENDENCIES);
    const hostileOffer = createOffer({
      displayName: '<img src="https://evil.example.invalid/x">Chair <script>alert(1)</script>',
      provenance: {
        ...createOffer().provenance,
        sourceName: '<script>Retailer</script> https://evil.example.invalid/source',
      },
    });
    const customerSession = createCustomerSessionDemo({ offerResolver: createResolver(() => hostileOffer) });
    const session = await customerSession.signIn("Demo customer");
    const definition = createRoomToolDefinitions(
      store,
      createResolver(() => hostileOffer),
      { customerSession, session },
    ).find(({ name }) => name === "find_retailer_offers");
    if (!definition) throw new Error("find_retailer_offers was not defined");

    const result = await definition.execute(
      catalogRef,
      { signal: new AbortController().signal },
    );
    const serialized = JSON.stringify(result);
    expect(serialized).not.toMatch(/https?:\/\/|<|>|script|seller|sourceUrl/iu);
    expect(serialized.length).toBeLessThan(16_000);
  });

  it("keeps mutations unavailable when a session has only the cart read scope", () => {
    const store = createRoomStore(getTemplate("living-room"), CATALOG_TRANSACTION_DEPENDENCIES);
    const customerSession = createCustomerSessionDemo();
    const session = {
      authenticated: true as const,
      customerId: "read-only-customer",
      scopes: ["commerce:cart:read" as const],
      expiresAt: 10_000,
    };
    const names = createRoomToolDefinitions(
      store,
      undefined,
      { customerSession, session },
    ).map(({ name }) => name);

    expect(names).toContain("inspect_cart");
    expect(names).toContain("find_retailer_offers");
    expect(names).not.toContain("add_to_cart");
    expect(names).not.toContain("remove_from_cart");
    expect(names).not.toContain("set_cart_quantity");
  });

  it("projects exact offers and mutations without secrets, URLs, hidden metadata, or room changes", async () => {
    const shoppingRoom = getTemplate("living-room");
    shoppingRoom.items[0]!.catalogRef = catalogRef;
    shoppingRoom.items[1]!.catalogRef = catalogRef;
    const store = createRoomStore(shoppingRoom, CATALOG_TRANSACTION_DEPENDENCIES);
    let currentOffer = createOffer();
    const customerSession = createCustomerSessionDemo({
      offerResolver: createResolver(() => currentOffer),
    });
    const session = await customerSession.signIn("Demo customer");
    const definitions = createRoomToolDefinitions(
      store,
      createResolver(() => currentOffer),
      { customerSession, session },
    );
    const tool = (name: string) => {
      const definition = definitions.find((candidate) => candidate.name === name);
      if (!definition) throw new Error(`${name} was not defined`);
      return definition;
    };
    const signal = new AbortController().signal;

    const offers = await tool("find_retailer_offers").execute(
      catalogRef,
      { signal },
    );
    expect(offers).toMatchObject({
      ok: true,
      catalogRef,
      offers: [{
        offerId: currentOffer.offerId,
        offerVersion: getRetailerOfferVersion(currentOffer),
        retailer: "Northstar Furnishings",
        displayName: "Ember Nest Chair",
        price: currentOffer.price,
        identity: { match: "exact" },
      }],
    });
    expect(JSON.stringify(offers)).not.toMatch(/https?:\/\/|seller|sourceUrl|csrf|session-token/iu);

    const empty = await tool("inspect_cart").execute({}, { signal });
    expect(empty).toMatchObject({ ok: true, cart: { revision: 1, lines: [], totals: { totalMinor: 0, currency: "USD" } } });
    const roomRevision = store.getState().revision;
    const offerInput = {
      offerId: currentOffer.offerId,
      offerVersion: getRetailerOfferVersion(currentOffer),
      catalogRef,
      price: currentOffer.price,
    };
    const added = await tool("add_to_cart").execute(
      { expectedRevision: 1, idempotencyKey: "add-chair", offer: offerInput },
      { signal },
    );
    expect(added).toMatchObject({
      ok: true,
      cart: { revision: 2, lines: [{ lineId: expect.any(String), quantity: 2 }] },
      receipt: {
        origin: "webmcp",
        operation: "add",
        status: "accepted",
        revision: 2,
        target: {
          offerId: "northstar-chair",
          displayName: "Ember Nest Chair",
          retailer: "Northstar Furnishings",
        },
      },
    });
    expect(store.getState().revision).toBe(roomRevision);
    expect(JSON.stringify(added)).not.toMatch(/https?:\/\/|seller|sourceUrl|csrf|session-token/iu);

    const replay = await tool("add_to_cart").execute(
      { expectedRevision: 1, idempotencyKey: "add-chair", offer: offerInput },
      { signal },
    );
    expect(replay).toEqual(added);

    const refreshed = await tool("add_to_cart").execute(
      { expectedRevision: 2, idempotencyKey: "refresh-chair", offer: offerInput },
      { signal },
    );
    expect(refreshed).toMatchObject({
      ok: true,
      cart: { revision: 3, lines: [{ quantity: 2 }] },
    });

    const lineId = (added as { cart: { lines: Array<{ lineId: string }> } }).cart.lines[0]!.lineId;
    const removed = await tool("remove_from_cart").execute(
      { expectedRevision: 3, idempotencyKey: "remove-chair", lineId },
      { signal },
    );
    expect(removed).toMatchObject({
      ok: true,
      cart: { revision: 4, lines: [] },
      receipt: {
        origin: "webmcp",
        operation: "remove",
        target: {
          offerId: "northstar-chair",
          displayName: "Ember Nest Chair",
          retailer: "Northstar Furnishings",
        },
      },
    });

    currentOffer = createOffer({ price: { amountMinor: 50_000, currency: "USD" } });
    const stale = await tool("add_to_cart").execute(
      { expectedRevision: 4, idempotencyKey: "stale-chair", offer: offerInput },
      { signal },
    );
    expect(stale).toMatchObject({ ok: false, error: { code: "OFFER_VERSION_MISMATCH" }, receipt: { origin: "webmcp" } });
  });

  it("fails captured commerce tools closed after sign-out and on cancellation", async () => {
    const roomWithCatalogItem = getTemplate("living-room");
    roomWithCatalogItem.items[0]!.catalogRef = catalogRef;
    const store = createRoomStore(roomWithCatalogItem, CATALOG_TRANSACTION_DEPENDENCIES);
    let resolveOffer!: (value: RetailerOffer) => void;
    const pendingOffer = new Promise<RetailerOffer>((resolve) => { resolveOffer = resolve; });
    const customerSession = createCustomerSessionDemo({
      offerResolver: {
        resolve: async (_lookup, { signal } = {}) => {
          const current = await pendingOffer;
          if (signal?.aborted) return { status: "cancelled", offers: [] };
          return { status: "ok", offers: [current] };
        },
        clearCache: () => undefined,
      },
    });
    const session = await customerSession.signIn("Demo customer");
    const definitions = createRoomToolDefinitions(store, createResolver(() => createOffer()), { customerSession, session });
    const add = definitions.find(({ name }) => name === "add_to_cart");
    if (!add) throw new Error("add_to_cart was not defined");
    const controller = new AbortController();
    const pending = add.execute(
      {
        expectedRevision: 1,
        idempotencyKey: "cancelled-add",
        offer: {
          offerId: "northstar-chair",
          offerVersion: getRetailerOfferVersion(createOffer()),
          catalogRef,
          price: createOffer().price,
        },
      },
      { signal: controller.signal },
    );
    controller.abort();
    resolveOffer(createOffer());
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    const afterCancellation = await customerSession.cart!.getCart();
    expect(afterCancellation).toMatchObject({ ok: true, cart: { revision: 1, lines: [] } });

    await customerSession.signOut();
    const inspect = definitions.find(({ name }) => name === "inspect_cart");
    if (!inspect) throw new Error("inspect_cart was not defined");
    await expect(inspect.execute({}, { signal: new AbortController().signal })).resolves.toMatchObject({
      ok: false,
      error: { code: "ANONYMOUS_SESSION" },
    });
  });
});
