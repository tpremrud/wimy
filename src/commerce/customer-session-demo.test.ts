import { describe, expect, it } from "vitest";
import {
  CustomerSessionAuthority,
  type CustomerSessionStore,
  type StoredCustomerSession,
} from "./customer-session";
import { createCustomerSessionDemo } from "./customer-session-demo";

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

describe("createCustomerSessionDemo", () => {
  it("keeps anonymous mode available without exposing its session ticket", async () => {
    const authority = new CustomerSessionAuthority({
      store: new MemorySessionStore(),
      now: () => 1_000,
      createSessionToken: () => "session-token",
      createCsrfSecret: () => "csrf-secret",
    });
    const demo = createCustomerSessionDemo({ authority });

    await expect(demo.getSession()).resolves.toEqual({ authenticated: false });
    await expect(demo.signIn("Demo customer")).resolves.toEqual({
      authenticated: true,
      customerId: "Demo customer",
      scopes: ["commerce:cart:read", "commerce:cart:write"],
      expiresAt: 1_801_000,
    });
    await expect(demo.getSession()).resolves.toMatchObject({
      authenticated: true,
    });
    const humanRead = await demo.cart?.getCart();
    expect(humanRead).toMatchObject({
      ok: true,
      receipt: { origin: "human", operation: "read" },
    });
    await expect(demo.signOut()).resolves.toEqual({ authenticated: false });
    expect(demo).not.toHaveProperty("sessionToken");
    expect(demo).not.toHaveProperty("csrfSecret");
  });

  it("retains only the latest mutation receipt within the active local session", async () => {
    const authority = new CustomerSessionAuthority({
      store: new MemorySessionStore(),
      now: () => 1_000,
      createSessionToken: () => "session-token",
      createCsrfSecret: () => "csrf-secret",
    });
    const demo = createCustomerSessionDemo({ authority });
    await demo.signIn("Demo customer");

    const mutation = await demo.cart!.addLine!({
      expectedRevision: 1,
      idempotencyKey: "retained-receipt",
      offer: {
        offerId: "offer",
        offerVersion: "version",
        catalogRef: { catalogId: "catalog", productId: "product" },
        price: { amountMinor: 100, currency: "USD" },
      },
      quantity: 1,
    });
    expect(demo.cart!.getLatestReceipt?.()).toEqual(mutation.receipt);

    await demo.signOut();
    expect(demo.cart!.getLatestReceipt?.()).toBeUndefined();
    await demo.signIn("New demo customer");
    expect(demo.cart!.getLatestReceipt?.()).toBeUndefined();
  });

  it("keeps checkout review behind the authenticated customer client", async () => {
    const authority = new CustomerSessionAuthority({
      store: new MemorySessionStore(),
      now: () => 1_000,
      createSessionToken: () => "session-token",
      createCsrfSecret: () => "csrf-secret",
    });
    const demo = createCustomerSessionDemo({ authority });

    expect(demo.checkout).toBeDefined();
    await expect(demo.checkout!.getReview()).resolves.toMatchObject({
      ok: false,
      error: { code: "ANONYMOUS_SESSION", recoverable: true },
    });
    await demo.signIn("Demo customer");
    await expect(demo.checkout!.getReview()).resolves.toMatchObject({
      ok: false,
      error: { code: "CART_EMPTY", recoverable: true },
    });
    expect(JSON.stringify(demo)).not.toContain("session-token");
    expect(JSON.stringify(demo)).not.toContain("csrf-secret");
  });
});
