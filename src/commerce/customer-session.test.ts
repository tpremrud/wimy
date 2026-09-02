import { describe, expect, it } from "vitest";
import {
  CustomerSessionAuthority,
  serializeSessionCookie,
  type CommerceAuthorizationAuditEvent,
  type CustomerSessionStore,
  type StoredCustomerSession,
} from "./customer-session";

class MemorySessionStore implements CustomerSessionStore {
  readonly sessions = new Map<string, StoredCustomerSession>();
  readonly revoked = new Map<string, number>();

  async read(sessionToken: string) {
    return this.sessions.get(sessionToken) ?? null;
  }

  async write(sessionToken: string, session: StoredCustomerSession) {
    this.sessions.set(sessionToken, session);
  }

  async revoke(sessionToken: string, revokedAt: number) {
    this.sessions.delete(sessionToken);
    this.revoked.set(sessionToken, revokedAt);
  }
}

const createAuthority = (store = new MemorySessionStore()) => {
  let tokenIndex = 0;
  let csrfIndex = 0;
  return {
    authority: new CustomerSessionAuthority({
      store,
      now: () => 1_000,
      createSessionToken: () => `session-token-${++tokenIndex}`,
      createCsrfSecret: () => `csrf-secret-${++csrfIndex}`,
    }),
    store,
  };
};

describe("CustomerSessionAuthority", () => {
  it("uses anonymous fallback without a session token", async () => {
    const { authority } = createAuthority();

    await expect(authority.resolve(undefined)).resolves.toEqual({
      authenticated: false,
    });
  });

  it("creates an opaque authenticated session with a secure host cookie", async () => {
    const { authority, store } = createAuthority();

    const ticket = await authority.signIn(
      { customerId: "customer-123" },
      ["commerce:cart:read", "commerce:cart:write"],
    );

    expect(ticket.sessionToken).toBe("session-token-1");
    expect(ticket.csrfSecret).toBe("csrf-secret-1");
    expect(ticket.cookie).toEqual({
      name: "__Host-wimy-session",
      value: "session-token-1",
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
      maxAge: 1_800,
    });
    expect(store.sessions.get("session-token-1")).toMatchObject({
      customer: { customerId: "customer-123" },
      scopes: ["commerce:cart:read", "commerce:cart:write"],
      createdAt: 1_000,
      expiresAt: 1_801_000,
    });
    expect(serializeSessionCookie(ticket.cookie)).toBe(
      "__Host-wimy-session=session-token-1; Max-Age=1800; Path=/; HttpOnly; Secure; SameSite=Lax",
    );
  });

  it("rotates and revokes a previous session during sign-in", async () => {
    const { authority, store } = createAuthority();
    const first = await authority.signIn(
      { customerId: "customer-123" },
      ["commerce:cart:read"],
    );

    const second = await authority.signIn(
      { customerId: "customer-123" },
      ["commerce:cart:write"],
      first.sessionToken,
    );

    expect(second.sessionToken).not.toBe(first.sessionToken);
    await expect(authority.resolve(first.sessionToken)).resolves.toEqual({
      authenticated: false,
    });
    expect(store.revoked.get(first.sessionToken)).toBe(1_000);
    await expect(authority.resolve(second.sessionToken)).resolves.toMatchObject({
      authenticated: true,
      scopes: ["commerce:cart:write"],
    });
  });

  it("fails closed for anonymous and missing cart scopes", async () => {
    const { authority } = createAuthority();
    const ticket = await authority.signIn(
      { customerId: "customer-123" },
      ["commerce:cart:read"],
    );

    await expect(authority.authorizeCartRead(undefined)).resolves.toEqual({
      allowed: false,
      reason: "anonymous",
    });
    await expect(authority.authorizeCartRead(ticket.sessionToken)).resolves.toEqual({
      allowed: true,
      customerId: "customer-123",
    });
    await expect(authority.authorizeCartWrite(ticket.sessionToken, undefined)).resolves.toEqual({
      allowed: false,
      reason: "missing-scope",
    });
  });

  it("requires the session-bound CSRF secret for cart writes", async () => {
    const { authority } = createAuthority();
    const ticket = await authority.signIn(
      { customerId: "customer-123" },
      ["commerce:cart:write"],
    );

    await expect(
      authority.authorizeCartWrite(ticket.sessionToken, "wrong-secret"),
    ).resolves.toEqual({ allowed: false, reason: "invalid-csrf" });
    await expect(
      authority.authorizeCartWrite(ticket.sessionToken, ticket.csrfSecret),
    ).resolves.toEqual({ allowed: true, customerId: "customer-123" });
  });

  it("expires sessions, revokes them, and clears the host cookie on logout", async () => {
    let now = 1_000;
    const store = new MemorySessionStore();
    const authority = new CustomerSessionAuthority({
      store,
      now: () => now,
      createSessionToken: () => "session-token",
      createCsrfSecret: () => "csrf-secret",
    });
    const ticket = await authority.signIn(
      { customerId: "customer-123" },
      ["commerce:cart:write"],
    );

    now = 1_801_000;
    await expect(authority.authorizeCartWrite(ticket.sessionToken, ticket.csrfSecret)).resolves.toEqual({
      allowed: false,
      reason: "expired",
    });
    expect(store.revoked.get(ticket.sessionToken)).toBe(now);

    now = 2_000_000;
    const next = await authority.signIn(
      { customerId: "customer-123" },
      ["commerce:cart:write"],
    );
    await expect(authority.logout(next.sessionToken)).resolves.toEqual({
      cookie: {
        name: "__Host-wimy-session",
        value: "",
        httpOnly: true,
        secure: true,
        sameSite: "lax",
        path: "/",
        maxAge: 0,
      },
    });
    await expect(authority.resolve(next.sessionToken)).resolves.toEqual({
      authenticated: false,
    });
  });

  it("keeps secrets out of the public view and rejects invalid session inputs", async () => {
    const { authority } = createAuthority();
    const ticket = await authority.signIn(
      { customerId: "customer-123" },
      ["commerce:cart:read"],
    );

    const view = await authority.resolve(ticket.sessionToken);
    expect(view).toEqual({
      authenticated: true,
      customerId: "customer-123",
      scopes: ["commerce:cart:read"],
      expiresAt: 1_801_000,
    });
    expect(view).not.toHaveProperty("sessionToken");
    expect(view).not.toHaveProperty("csrfSecret");
    expect(JSON.stringify(view)).not.toContain("csrf-secret");

    await expect(
      authority.signIn({ customerId: "" }, ["commerce:cart:read"]),
    ).rejects.toThrow("Customer identity");
    await expect(
      authority.signIn(
        { customerId: "customer-123" },
        ["commerce:cart:unknown" as "commerce:cart:read"],
      ),
    ).rejects.toThrow("unsupported scope");
  });

  it("rejects session fixation when a token generator reuses the prior token", async () => {
    const store = new MemorySessionStore();
    const authority = new CustomerSessionAuthority({
      store,
      now: () => 1_000,
      createSessionToken: () => "same-token",
      createCsrfSecret: () => "csrf-secret",
    });
    const first = await authority.signIn(
      { customerId: "customer-123" },
      ["commerce:cart:read"],
    );

    await expect(
      authority.signIn(
        { customerId: "customer-123" },
        ["commerce:cart:write"],
        first.sessionToken,
      ),
    ).rejects.toThrow("rotate");
    await expect(authority.resolve(first.sessionToken)).resolves.toMatchObject({
      authenticated: true,
    });
  });

  it("emits bounded authorization outcomes without customer or secret content", async () => {
    const events: CommerceAuthorizationAuditEvent[] = [];
    const { store } = createAuthority();
    const authority = new CustomerSessionAuthority({
      store,
      now: () => 1_000,
      createSessionToken: () => "session-token",
      createCsrfSecret: () => "csrf-secret",
      auditEventSink: {
        record: (event) => {
          events.push(event);
        },
      },
    });
    const ticket = await authority.signIn(
      { customerId: "customer-123" },
      ["commerce:cart:write"],
    );

    await authority.authorizeCartWrite(ticket.sessionToken, ticket.csrfSecret);
    await authority.authorizeCartWrite(ticket.sessionToken, "wrong-secret");
    await authority.authorizeCartRead(undefined);

    expect(events).toEqual([
      {
        type: "commerce.authorization.attempt",
        operation: "cart.write",
        outcome: "allowed",
        authenticated: true,
      },
      {
        type: "commerce.authorization.attempt",
        operation: "cart.write",
        outcome: "invalid-csrf",
        authenticated: true,
      },
      {
        type: "commerce.authorization.attempt",
        operation: "cart.read",
        outcome: "anonymous",
        authenticated: false,
      },
    ]);
    expect(JSON.stringify(events)).not.toContain(ticket.sessionToken);
    expect(JSON.stringify(events)).not.toContain(ticket.csrfSecret);
    expect(JSON.stringify(events)).not.toContain("customer-123");
  });

  it("fails closed when the session store is unavailable", async () => {
    const authority = new CustomerSessionAuthority({
      store: {
        read: async () => {
          throw new Error("database unavailable");
        },
        write: async () => {},
        revoke: async () => {},
      },
      now: () => 1_000,
      createSessionToken: () => "session-token",
      createCsrfSecret: () => "csrf-secret",
    });

    await expect(
      authority.authorizeCartWrite("untrusted-token", "untrusted-csrf"),
    ).resolves.toEqual({ allowed: false, reason: "unavailable" });
    await expect(authority.resolve("untrusted-token")).resolves.toEqual({
      authenticated: false,
    });
  });

  it("rejects malformed incoming tokens before consulting the session store", async () => {
    const reads: string[] = [];
    const authority = new CustomerSessionAuthority({
      store: {
        read: async (sessionToken) => {
          reads.push(sessionToken);
          return null;
        },
        write: async () => {},
        revoke: async () => {},
      },
      now: () => 1_000,
      createSessionToken: () => "session-token",
      createCsrfSecret: () => "csrf-secret",
    });

    await expect(authority.resolve(" ")).resolves.toEqual({ authenticated: false });
    await expect(authority.authorizeCartRead("x".repeat(513))).resolves.toEqual({
      allowed: false,
      reason: "anonymous",
    });
    expect(reads).toEqual([]);
  });

  it("fails closed for malformed server-side session records", async () => {
    const authority = new CustomerSessionAuthority({
      store: {
        read: async () => ({
          customer: { customerId: "customer-123" },
          scopes: ["commerce:cart:write"],
          createdAt: 1_000,
          expiresAt: 2_000,
          csrfSecret: " ",
        } as unknown as StoredCustomerSession),
        write: async () => {},
        revoke: async () => {},
      },
      now: () => 1_100,
      createSessionToken: () => "session-token",
      createCsrfSecret: () => "csrf-secret",
    });

    await expect(
      authority.authorizeCartWrite("session-token", " "),
    ).resolves.toEqual({ allowed: false, reason: "anonymous" });
  });

  it("fails closed when expiring a session cannot be persisted as revoked", async () => {
    const authority = new CustomerSessionAuthority({
      store: {
        read: async () => ({
          customer: { customerId: "customer-123" },
          scopes: ["commerce:cart:write"],
          createdAt: 1_000,
          expiresAt: 2_000,
          csrfSecret: "csrf-secret",
        }),
        write: async () => {},
        revoke: async () => {
          throw new Error("database unavailable");
        },
      },
      now: () => 2_000,
      createSessionToken: () => "session-token",
      createCsrfSecret: () => "csrf-secret",
    });

    await expect(
      authority.authorizeCartWrite("session-token", "csrf-secret"),
    ).resolves.toEqual({ allowed: false, reason: "unavailable" });
  });

  it("revokes the prior session before writing its rotated replacement", async () => {
    const actions: string[] = [];
    const store = new MemorySessionStore();
    const authority = new CustomerSessionAuthority({
      store: {
        read: async (sessionToken) => store.read(sessionToken),
        write: async (sessionToken, session) => {
          actions.push(`write:${sessionToken}`);
          await store.write(sessionToken, session);
        },
        revoke: async (sessionToken, revokedAt) => {
          actions.push(`revoke:${sessionToken}`);
          await store.revoke(sessionToken, revokedAt);
        },
      },
      now: () => 1_000,
      createSessionToken: (() => {
        let index = 0;
        return () => `session-token-${++index}`;
      })(),
      createCsrfSecret: () => "csrf-secret",
    });
    const first = await authority.signIn(
      { customerId: "customer-123" },
      ["commerce:cart:read"],
    );
    actions.length = 0;

    await authority.signIn(
      { customerId: "customer-123" },
      ["commerce:cart:read"],
      first.sessionToken,
    );

    expect(actions).toEqual(["revoke:session-token-1", "write:session-token-2"]);
  });
});
