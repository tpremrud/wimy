export const CUSTOMER_SESSION_COOKIE_NAME = "__Host-wimy-session" as const;
export const DEFAULT_CUSTOMER_SESSION_TTL_MS = 30 * 60 * 1_000;

export const CUSTOMER_SCOPES = [
  "commerce:cart:read",
  "commerce:cart:write",
] as const;

export type CustomerScope = (typeof CUSTOMER_SCOPES)[number];

export type CustomerIdentity = Readonly<{
  customerId: string;
}>;

export type StoredCustomerSession = Readonly<{
  customer: CustomerIdentity;
  scopes: readonly CustomerScope[];
  createdAt: number;
  expiresAt: number;
  csrfSecret: string;
  revokedAt?: number;
}>;

export interface CustomerSessionStore {
  read: (sessionToken: string) => Promise<StoredCustomerSession | null>;
  write: (
    sessionToken: string,
    session: StoredCustomerSession,
  ) => Promise<void>;
  revoke: (sessionToken: string, revokedAt: number) => Promise<void>;
}

export type CustomerSessionView =
  | Readonly<{
      authenticated: false;
    }>
  | Readonly<{
      authenticated: true;
      customerId: string;
      scopes: readonly CustomerScope[];
      expiresAt: number;
    }>;

export type SessionCookie = Readonly<{
  name: typeof CUSTOMER_SESSION_COOKIE_NAME;
  value: string;
  httpOnly: true;
  secure: true;
  sameSite: "lax";
  path: "/";
  maxAge: number;
}>;

export type ServerSessionTicket = Readonly<{
  sessionToken: string;
  csrfSecret: string;
  cookie: SessionCookie;
  view: CustomerSessionView;
}>;

export type CartAuthorizationResult =
  | Readonly<{ allowed: true; customerId: string }>
  | Readonly<{
      allowed: false;
      reason: "anonymous" | "expired" | "revoked" | "unavailable" | "missing-scope" | "invalid-csrf";
    }>;

export type CommerceAuthorizationAuditEvent = Readonly<{
  type: "commerce.authorization.attempt";
  operation: "cart.read" | "cart.write";
  outcome:
    | "allowed"
    | "anonymous"
    | "expired"
    | "revoked"
    | "unavailable"
    | "missing-scope"
    | "invalid-csrf";
  authenticated: boolean;
}>;

export interface CommerceAuthorizationAuditEventSink {
  record: (event: CommerceAuthorizationAuditEvent) => void | Promise<void>;
}

type SessionAuthorityOptions = Readonly<{
  store: CustomerSessionStore;
  now: () => number;
  createSessionToken: () => string;
  createCsrfSecret: () => string;
  auditEventSink?: CommerceAuthorizationAuditEventSink;
  ttlMs?: number;
}>;

const ANONYMOUS_SESSION: CustomerSessionView = Object.freeze({
  authenticated: false,
});

const CUSTOMER_SCOPE_SET = new Set<string>(CUSTOMER_SCOPES);

const assertTimestamp = (timestamp: number) => {
  if (!Number.isFinite(timestamp) || timestamp < 0) {
    throw new Error("Session timestamps must be finite non-negative numbers");
  }
};

const assertPositiveDuration = (duration: number) => {
  if (!Number.isSafeInteger(duration) || duration <= 0) {
    throw new Error("Session TTL must be a positive safe integer");
  }
};

const assertCustomerIdentity = (identity: CustomerIdentity) => {
  if (!isBoundedCustomerIdentity(identity)) {
    throw new Error("Customer identity must contain a bounded opaque ID");
  }
};

const hasControlCharacters = (value: string) =>
  Array.from(value).some((character) => {
    const codePoint = character.codePointAt(0);
    return codePoint !== undefined && (codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f));
  });

const normalizeScopes = (scopes: readonly CustomerScope[]) => {
  const uniqueScopes: CustomerScope[] = [];
  for (const scope of scopes) {
    if (!CUSTOMER_SCOPE_SET.has(scope)) {
      throw new Error("Customer session contains an unsupported scope");
    }
    if (!uniqueScopes.includes(scope)) uniqueScopes.push(scope);
  }
  return uniqueScopes;
};

const assertOpaqueSecret = (secret: string, label: string) => {
  if (!isBoundedOpaqueValue(secret)) {
    throw new Error(`${label} must be a bounded opaque value`);
  }
};

const isBoundedOpaqueValue = (value: unknown): value is string =>
  typeof value === "string" &&
  value.length > 0 &&
  value.length <= 512 &&
  !hasControlCharacters(value) &&
  !value.includes(" ");

const isBoundedCustomerIdentity = (value: unknown): value is CustomerIdentity => {
  if (typeof value !== "object" || value === null || !("customerId" in value)) {
    return false;
  }
  const customerId = value.customerId;
  return (
    typeof customerId === "string" &&
    customerId.length > 0 &&
    customerId.length <= 256 &&
    !hasControlCharacters(customerId)
  );
};

const isStoredCustomerSession = (
  value: StoredCustomerSession | null,
): value is StoredCustomerSession => {
  if (typeof value !== "object" || value === null) return false;
  return (
    isBoundedCustomerIdentity(value.customer) &&
    Array.isArray(value.scopes) &&
    value.scopes.every((scope) => CUSTOMER_SCOPE_SET.has(scope)) &&
    Number.isFinite(value.createdAt) &&
    value.createdAt >= 0 &&
    Number.isFinite(value.expiresAt) &&
    value.expiresAt > value.createdAt &&
    isBoundedOpaqueValue(value.csrfSecret) &&
    (value.revokedAt === undefined ||
      (Number.isFinite(value.revokedAt) && value.revokedAt >= 0))
  );
};

const createCookie = (value: string, maxAge: number): SessionCookie => ({
  name: CUSTOMER_SESSION_COOKIE_NAME,
  value,
  httpOnly: true,
  secure: true,
  sameSite: "lax",
  path: "/",
  maxAge,
});

export const serializeSessionCookie = (cookie: SessionCookie) =>
  `${cookie.name}=${encodeURIComponent(cookie.value)}; Max-Age=${cookie.maxAge}; Path=/; HttpOnly; Secure; SameSite=Lax`;

const toSessionView = (
  session: StoredCustomerSession,
): CustomerSessionView => ({
  authenticated: true,
  customerId: session.customer.customerId,
  scopes: [...session.scopes],
  expiresAt: session.expiresAt,
});

const constantTimeEqual = (left: string, right: string) => {
  let difference = left.length ^ right.length;
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    difference |= (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0);
  }
  return difference === 0;
};

type ActiveSessionResult =
  | Readonly<{ status: "active"; session: StoredCustomerSession }>
  | Readonly<{ status: "anonymous" | "expired" | "revoked" | "unavailable" }>;

export class CustomerSessionAuthority {
  private readonly store: CustomerSessionStore;
  private readonly now: () => number;
  private readonly createSessionToken: () => string;
  private readonly createCsrfSecret: () => string;
  private readonly auditEventSink: CommerceAuthorizationAuditEventSink | undefined;
  private readonly ttlMs: number;

  constructor(options: SessionAuthorityOptions) {
    assertPositiveDuration(options.ttlMs ?? DEFAULT_CUSTOMER_SESSION_TTL_MS);
    this.store = options.store;
    this.now = options.now;
    this.createSessionToken = options.createSessionToken;
    this.createCsrfSecret = options.createCsrfSecret;
    this.auditEventSink = options.auditEventSink;
    this.ttlMs = options.ttlMs ?? DEFAULT_CUSTOMER_SESSION_TTL_MS;
  }

  async signIn(
    customer: CustomerIdentity,
    scopes: readonly CustomerScope[],
    previousSessionToken?: string,
  ): Promise<ServerSessionTicket> {
    const createdAt = this.now();
    assertTimestamp(createdAt);
    assertCustomerIdentity(customer);
    const normalizedScopes = normalizeScopes(scopes);
    const sessionToken = this.createSessionToken();
    const csrfSecret = this.createCsrfSecret();
    assertOpaqueSecret(sessionToken, "Session token");
    assertOpaqueSecret(csrfSecret, "CSRF secret");
    if (previousSessionToken === sessionToken) {
      throw new Error("Session sign-in must rotate to a new token");
    }
    if (await this.store.read(sessionToken)) {
      throw new Error("Session token collision");
    }
    const session: StoredCustomerSession = {
      customer: { ...customer },
      scopes: normalizedScopes,
      createdAt,
      expiresAt: createdAt + this.ttlMs,
      csrfSecret,
    };
    if (previousSessionToken) {
      await this.store.revoke(previousSessionToken, createdAt);
    }
    await this.store.write(sessionToken, session);
    return {
      sessionToken,
      csrfSecret,
      cookie: createCookie(sessionToken, Math.ceil(this.ttlMs / 1_000)),
      view: toSessionView(session),
    };
  }

  async resolve(sessionToken: string | undefined): Promise<CustomerSessionView> {
    const result = await this.readActiveSession(sessionToken);
    return result.status === "active"
      ? toSessionView(result.session)
      : ANONYMOUS_SESSION;
  }

  async authorizeCartRead(
    sessionToken: string | undefined,
  ): Promise<CartAuthorizationResult> {
    const result = await this.readActiveSession(sessionToken);
    if (result.status !== "active") {
      await this.recordAuthorization("cart.read", result.status, false);
      return { allowed: false, reason: result.status };
    }
    if (!result.session.scopes.includes("commerce:cart:read")) {
      await this.recordAuthorization("cart.read", "missing-scope", true);
      return { allowed: false, reason: "missing-scope" };
    }
    await this.recordAuthorization("cart.read", "allowed", true);
    return { allowed: true, customerId: result.session.customer.customerId };
  }

  async authorizeCartWrite(
    sessionToken: string | undefined,
    csrfSecret: string | undefined,
  ): Promise<CartAuthorizationResult> {
    const result = await this.readActiveSession(sessionToken);
    if (result.status !== "active") {
      await this.recordAuthorization("cart.write", result.status, false);
      return { allowed: false, reason: result.status };
    }
    if (!result.session.scopes.includes("commerce:cart:write")) {
      await this.recordAuthorization("cart.write", "missing-scope", true);
      return { allowed: false, reason: "missing-scope" };
    }
    if (
      typeof csrfSecret !== "string" ||
      !constantTimeEqual(result.session.csrfSecret, csrfSecret)
    ) {
      await this.recordAuthorization("cart.write", "invalid-csrf", true);
      return { allowed: false, reason: "invalid-csrf" };
    }
    await this.recordAuthorization("cart.write", "allowed", true);
    return { allowed: true, customerId: result.session.customer.customerId };
  }

  async logout(sessionToken: string | undefined): Promise<{ cookie: SessionCookie }> {
    if (sessionToken) {
      await this.store.revoke(sessionToken, this.now());
    }
    return { cookie: createCookie("", 0) };
  }

  private async recordAuthorization(
    operation: CommerceAuthorizationAuditEvent["operation"],
    outcome: CommerceAuthorizationAuditEvent["outcome"],
    authenticated: boolean,
  ) {
    if (!this.auditEventSink) return;
    const event: CommerceAuthorizationAuditEvent = Object.freeze({
      type: "commerce.authorization.attempt",
      operation,
      outcome,
      authenticated,
    });
    try {
      await this.auditEventSink.record(event);
    } catch {
      // Audit delivery must not turn an already-decided authorization into a data leak.
    }
  }

  private async readActiveSession(
    sessionToken: string | undefined,
  ): Promise<ActiveSessionResult> {
    if (!sessionToken) return { status: "anonymous" };
    if (!isBoundedOpaqueValue(sessionToken)) return { status: "anonymous" };
    let session: StoredCustomerSession | null;
    try {
      session = await this.store.read(sessionToken);
    } catch {
      return { status: "unavailable" };
    }
    if (!session || !isStoredCustomerSession(session)) {
      return { status: "anonymous" };
    }
    if (session.revokedAt !== undefined) return { status: "revoked" };
    const now = this.now();
    if (now >= session.expiresAt) {
      try {
        await this.store.revoke(sessionToken, now);
      } catch {
        return { status: "unavailable" };
      }
      return { status: "expired" };
    }
    return { status: "active", session };
  }
}
