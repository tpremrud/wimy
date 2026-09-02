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
    await expect(demo.signOut()).resolves.toEqual({ authenticated: false });
    expect(demo).not.toHaveProperty("sessionToken");
    expect(demo).not.toHaveProperty("csrfSecret");
  });
});
