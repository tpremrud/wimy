import {
  CUSTOMER_SCOPES,
  CustomerSessionAuthority,
  type CustomerSessionStore,
  type CustomerSessionView,
  type ServerSessionTicket,
  type StoredCustomerSession,
} from "./customer-session";
import {
  createCartService,
  createInMemoryCartStore,
  type CartAddRequest,
  type CartChangeQuantityRequest,
  type CartMutationResult,
  type CartOrigin,
  type CartReceipt,
  type CartReadResult,
  type CartRemoveRequest,
  type CartService,
} from "./cart";
import type { RetailerOfferResolver } from "./retailer-offer-adapter";

export interface CustomerSessionClient {
  getSession: () => Promise<CustomerSessionView>;
  signIn: (customerId: string) => Promise<CustomerSessionView>;
  signOut: () => Promise<CustomerSessionView>;
  cart?: CustomerCartClient;
}

export interface CustomerCartClient {
  getCart: (signal?: AbortSignal, origin?: CartOrigin) => Promise<CartReadResult>;
  addLine?: (
    request: Omit<CartAddRequest, "sessionToken" | "csrfSecret">,
  ) => Promise<CartMutationResult>;
  removeLine?: (
    request: Omit<CartRemoveRequest, "sessionToken" | "csrfSecret">,
  ) => Promise<CartMutationResult>;
  changeQuantity?: (
    request: Omit<CartChangeQuantityRequest, "sessionToken" | "csrfSecret">,
  ) => Promise<CartMutationResult>;
  getLatestReceipt?: () => CartReceipt | undefined;
  subscribe?: (listener: (receipt?: CartReceipt) => void) => () => void;
}

type CustomerSessionDemoOptions = Readonly<{
  authority?: CustomerSessionAuthority;
  cartService?: CartService;
  offerResolver?: RetailerOfferResolver;
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
  const cartService = options.cartService ?? createCartService({
    store: createInMemoryCartStore(),
    sessionAuthority: authority,
    offerResolver: options.offerResolver ?? {
      resolve: async () => ({ status: "no_offers" as const, offers: [] as const }),
      clearCache: () => undefined,
    },
  });
  const listeners = new Set<(receipt?: CartReceipt) => void>();
  let latestMutationReceipt: CartReceipt | undefined;
  const notify = (receipt?: CartReceipt) => {
    if (receipt && receipt.operation !== "read") {
      latestMutationReceipt = structuredClone(receipt);
    }
    for (const listener of listeners) listener(receipt);
  };
  const withSessionSecrets = <Request extends object>(
    request: Request,
    defaultOrigin: CartOrigin,
  ) => ({
    ...request,
    sessionToken: ticket?.sessionToken,
    csrfSecret: ticket?.csrfSecret,
    origin: (request as { origin?: CartOrigin }).origin ?? defaultOrigin,
  });

  return {
    getSession: () => authority.resolve(ticket?.sessionToken),
    signIn: async (customerId) => {
      latestMutationReceipt = undefined;
      ticket = await authority.signIn(
        { customerId },
        CUSTOMER_SCOPES,
        ticket?.sessionToken,
      );
      notify();
      return ticket.view;
    },
    signOut: async () => {
      await authority.logout(ticket?.sessionToken);
      ticket = undefined;
      latestMutationReceipt = undefined;
      notify();
      return { authenticated: false };
    },
    cart: {
      getCart: (signal, origin = "human") =>
        cartService.getCart(withSessionSecrets({ signal }, origin)),
      addLine: async (request) => {
        const result = await cartService.addLine(withSessionSecrets(request, "human"));
        notify(result.receipt);
        return result;
      },
      removeLine: async (request) => {
        const result = await cartService.removeLine(withSessionSecrets(request, "human"));
        notify(result.receipt);
        return result;
      },
      changeQuantity: async (request) => {
        const result = await cartService.changeQuantity(withSessionSecrets(request, "human"));
        notify(result.receipt);
        return result;
      },
      getLatestReceipt: () =>
        latestMutationReceipt ? structuredClone(latestMutationReceipt) : undefined,
      subscribe: (listener) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    },
  };
};
