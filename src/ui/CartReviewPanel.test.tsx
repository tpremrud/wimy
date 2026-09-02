import { createRef } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { CustomerSessionView } from "../commerce/customer-session";
import type { CartReadResult } from "../commerce/cart";
import type { CustomerCartClient } from "../commerce/customer-session-demo";
import { CartReviewPanel } from "./CartReviewPanel";

const emptyCartResult: CartReadResult = {
  ok: true,
  cart: {
    cartId: "cart-1",
    customerId: "customer-a",
    status: "active",
    revision: 1,
    currency: "USD",
    lines: [],
    totals: { subtotalMinor: 0, totalMinor: 0, currency: "USD" },
    updatedAt: "1970-01-01T00:16:40.000Z",
  },
  receipt: {
    type: "commerce.cart.receipt",
    operation: "read",
    status: "accepted",
    revision: 1,
    lineCount: 0,
    totalQuantity: 0,
  },
};

const signedIn: CustomerSessionView = {
  authenticated: true,
  customerId: "customer-a",
  scopes: ["commerce:cart:read"],
  expiresAt: 10_000,
};

describe("CartReviewPanel", () => {
  it("keeps cart review available as a separate anonymous-safe surface", () => {
    render(<CartReviewPanel open onClose={vi.fn()} onOpen={vi.fn()} openerRef={createRef<HTMLButtonElement>()} session={{ authenticated: false }} />);

    expect(screen.getByRole("heading", { name: "Cart review" })).toBeInTheDocument();
    expect(screen.getByText(/Sign in locally/iu)).toBeInTheDocument();
  });

  it("reads an authenticated cart without reading room state", async () => {
    const client: CustomerCartClient = { getCart: vi.fn(async () => emptyCartResult) };
    render(<CartReviewPanel client={client} open onClose={vi.fn()} onOpen={vi.fn()} openerRef={createRef<HTMLButtonElement>()} session={signedIn} />);

    await waitFor(() => expect(screen.getByText("Your cart is empty.")).toBeInTheDocument());
    expect(client.getCart).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/Checkout, payment, and purchase are not available/iu)).toBeInTheDocument();
  });

  it("renders bounded line and total facts returned by the cart seam", async () => {
    const client: CustomerCartClient = {
      getCart: vi.fn(async (): Promise<CartReadResult> => ({
        ...emptyCartResult,
        cart: {
          ...emptyCartResult.cart,
          revision: 2,
          lines: [{
            lineId: "line-1",
            quantity: 2,
            lineTotalMinor: 24_000,
            offer: {
              offerId: "offer-1",
              offerVersion: "offer-version",
              retailerId: "retailer-1",
              sellerId: "seller-1",
              catalogRef: { catalogId: "catalog-1", productId: "product-1" },
              displayName: "Aurora Chair",
              productUrl: "https://offers.example.invalid/offer-1",
              price: { amountMinor: 12_000, currency: "USD" },
              availability: "in_stock",
              eligibility: "purchasable",
              identityEvidence: { match: "exact", method: "authorized_catalog_variant_uuid" },
              observedAt: "1970-01-01T00:16:40.000Z",
              expiresAt: "1970-01-01T00:46:40.000Z",
              provenance: {
                sourceName: "Synthetic retailer",
                sourceUrl: "https://offers.example.invalid/source",
                sourceKind: "authorized_api",
                adapterId: "adapter-1",
                environment: "sandbox",
              },
            },
          }],
          totals: { subtotalMinor: 24_000, totalMinor: 24_000, currency: "USD" },
        },
      })),
    };
    render(<CartReviewPanel client={client} open onClose={vi.fn()} onOpen={vi.fn()} openerRef={createRef<HTMLButtonElement>()} session={signedIn} />);

    await waitFor(() => expect(screen.getByText("Aurora Chair")).toBeInTheDocument());
    expect(screen.getByText("2 × 12000 USD = 24000 USD")).toBeInTheDocument();
    expect(screen.getByText("Total").parentElement).toHaveTextContent("Total 24000 USD");
    expect(screen.getByLabelText("Cart revision 2")).toBeInTheDocument();
  });
});
