import {
  CUSTOMER_SCOPES,
  CustomerSessionAuthority,
  type CustomerSessionStore,
  type CustomerSessionView,
  type ServerSessionTicket,
  type StoredCustomerSession,
} from "./customer-session";

export interface CustomerSessionClient {
  getSession: () => Promise<CustomerSessionView>;
  signIn: (customerId: string) => Promise<CustomerSessionView>;
  signOut: () => Promise<CustomerSessionView>;
}

type CustomerSessionDemoOptions = Readonly<{
  authority?: CustomerSessionAuthority;
}>;

const createBrowserOpaqueValue = () => {
  const bytes = new Uint8Array(32);
  if (!globalThis.crypto) {
    throw new Error("Secure randomness is unavailable");
  }
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
};

const createMemorySessionStore = (): CustomerSessionStore => {
  const sessions = new Map<string, StoredCustomerSession>();
  return {
    read: async (sessionToken) => sessions.get(sessionToken) ?? null,
    write: async (sessionToken, session) => {
      sessions.set(sessionToken, session);
    },
    revoke: async (sessionToken) => {
      sessions.delete(sessionToken);
    },
  };
};

const createDefaultAuthority = () =>
  new CustomerSessionAuthority({
    store: createMemorySessionStore(),
    now: () => Date.now(),
    createSessionToken: createBrowserOpaqueValue,
    createCsrfSecret: createBrowserOpaqueValue,
  });

export const createCustomerSessionDemo = (
  options: CustomerSessionDemoOptions = {},
): CustomerSessionClient => {
  const authority = options.authority ?? createDefaultAuthority();
  let ticket: ServerSessionTicket | undefined;

  return {
    getSession: () => authority.resolve(ticket?.sessionToken),
    signIn: async (customerId) => {
      ticket = await authority.signIn(
        { customerId },
        CUSTOMER_SCOPES,
        ticket?.sessionToken,
      );
      return ticket.view;
    },
    signOut: async () => {
      await authority.logout(ticket?.sessionToken);
      ticket = undefined;
      return { authenticated: false };
    },
  };
};
