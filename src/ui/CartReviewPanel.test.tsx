import { createRef } from "react";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CustomerSessionView } from "../commerce/customer-session";
import type { CartLine, CartReadResult } from "../commerce/cart";
import type { CustomerCartClient } from "../commerce/customer-session-demo";
import { makePlacedItem, makeRoom } from "../test/room-fixtures";
import { CartReviewPanel } from "./CartReviewPanel";

const room = makeRoom({ items: [makePlacedItem()] });

afterEach(cleanup);

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
    origin: "human",
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

const cartLine = (
  lineId: string,
  retailerId: string,
  retailer: string,
  productId: string,
): CartLine => ({
  lineId,
  quantity: 1,
  lineTotalMinor: 12_000,
  offer: {
    offerId: `${retailerId}-offer`,
    offerVersion: "offer-version",
    retailerId,
    sellerId: `${retailerId}-direct`,
    catalogRef: { catalogId: "catalog-1", productId },
    displayName: productId === "chair-1" ? "Aurora Chair" : "Solstice Table",
    productUrl: `https://offers.example.invalid/${retailerId}`,
    price: { amountMinor: 12_000, currency: "USD" },
    availability: "in_stock",
    eligibility: "purchasable",
    identityEvidence: {
      match: "exact",
      method: "authorized_catalog_variant_uuid",
    },
    observedAt: "1970-01-01T00:16:40.000Z",
    expiresAt: "1970-01-01T00:46:40.000Z",
    provenance: {
      sourceName: retailer,
      sourceUrl: `https://offers.example.invalid/${retailerId}/source`,
      sourceKind: "authorized_api",
      adapterId: `${retailerId}-adapter`,
      environment: "sandbox",
    },
  },
});

describe("CartReviewPanel", () => {
  it("presents a room-linked shopping plan grouped by disconnected fictional providers", async () => {
    const roomWithRepeatedChair = makeRoom({
      items: [
        makePlacedItem({
          id: "chair_a",
          catalogRef: { catalogId: "catalog-1", productId: "chair-1" },
        }),
        makePlacedItem({
          id: "chair_b",
          catalogRef: { catalogId: "catalog-1", productId: "chair-1" },
        }),
        makePlacedItem({
          id: "table_a",
          catalogRef: { catalogId: "catalog-1", productId: "table-1" },
          snapshot: {
            name: "Solstice Table",
            category: "table",
            dimensions: { width: 0.8, depth: 0.8, height: 0.4 },
            appearance: { color: "#8B6F55" },
            styleTags: ["warm-modern"],
          },
        }),
      ],
    });
    const client: CustomerCartClient = {
      getCart: vi.fn(async (): Promise<CartReadResult> => ({
        ...emptyCartResult,
        cart: {
          ...emptyCartResult.cart,
          lines: [
            cartLine("line-chair", "northstar-home", "Northstar Home", "chair-1"),
            cartLine("line-table", "elm-commons", "Elm Commons", "table-1"),
          ],
          totals: { subtotalMinor: 24_000, totalMinor: 24_000, currency: "USD" },
        },
      })),
    };

    render(
      <CartReviewPanel
        client={client}
        open
        onClose={vi.fn()}
        onOpen={vi.fn()}
        openerRef={createRef<HTMLButtonElement>()}
        room={roomWithRepeatedChair}
        roomRevision={3}
        session={signedIn}
      />,
    );

    expect(await screen.findByRole("heading", { name: "Shopping plan" })).toBeVisible();
    expect(screen.getByRole("region", { name: "Plan for Northstar Home" })).toBeVisible();
    expect(screen.getByRole("region", { name: "Plan for Elm Commons" })).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Checkout at Northstar Home — not connected" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Checkout at Elm Commons — not connected" }),
    ).toBeDisabled();
    expect(screen.getAllByText("Provider connection not available yet.")).toHaveLength(2);
    const roomItems = screen.getByRole("region", { name: "Items in this room" });
    expect(within(roomItems).getByText("Quantity 2")).toBeVisible();
    expect(within(roomItems).getAllByText("Test Chair")).toHaveLength(1);
  });

  it("distinguishes the current room revision from the independent cart revision", async () => {
    const client: CustomerCartClient = {
      getCart: vi.fn(async () => emptyCartResult),
    };
    render(
      <CartReviewPanel
        client={client}
        open
        onClose={vi.fn()}
        onOpen={vi.fn()}
        openerRef={createRef<HTMLButtonElement>()}
        room={room}
        roomRevision={4}
        session={signedIn}
      />,
    );

    await waitFor(() =>
      expect(screen.getByLabelText("Room revision 4")).toBeInTheDocument(),
    );
    expect(screen.getByLabelText("Cart revision 1")).toBeInTheDocument();
  });

  it("keeps cart review available as a separate anonymous-safe surface", () => {
    render(<CartReviewPanel open onClose={vi.fn()} onOpen={vi.fn()} openerRef={createRef<HTMLButtonElement>()} room={room} roomRevision={1} session={{ authenticated: false }} />);

    expect(screen.getByRole("heading", { name: "Shopping plan" })).toBeInTheDocument();
    expect(screen.getByText(/Sign in locally/iu)).toBeInTheDocument();
  });

  it("reads an authenticated retailer cart while mirroring room planning items", async () => {
    const client: CustomerCartClient = { getCart: vi.fn(async () => emptyCartResult) };
    render(<CartReviewPanel client={client} open onClose={vi.fn()} onOpen={vi.fn()} openerRef={createRef<HTMLButtonElement>()} room={room} roomRevision={1} session={signedIn} />);

    await waitFor(() => expect(screen.getByText("No provider selections yet.")).toBeInTheDocument());
    const roomItems = screen.getByRole("region", { name: "Items in this room" });
    expect(roomItems).toHaveTextContent("Test Chair");
    expect(
      within(roomItems).getByRole("img", { name: "Test Chair preview" }),
    ).toBeVisible();
    expect(client.getCart).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/Provider checkout, payment, and purchase connections are not available yet/iu)).toBeInTheDocument();
  });

  it("renders bounded line and total facts returned by the cart seam", async () => {
    const roomWithStalePlacedSnapshot = makeRoom({
      items: [
        makePlacedItem({
          catalogRef: { catalogId: "catalog-1", productId: "product-1" },
        }),
      ],
    });
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
        receipt: {
          ...emptyCartResult.receipt,
          origin: "webmcp",
          operation: "add",
          status: "accepted",
          revision: 2,
          lineCount: 1,
          totalQuantity: 2,
          target: {
            offerId: "offer-1",
            displayName: "Aurora Chair",
            retailer: "Synthetic retailer",
          },
        },
      })),
    };
    render(<CartReviewPanel client={client} open onClose={vi.fn()} onOpen={vi.fn()} openerRef={createRef<HTMLButtonElement>()} room={roomWithStalePlacedSnapshot} roomRevision={1} session={signedIn} />);

    await waitFor(() => expect(screen.getByText("Aurora Chair")).toBeInTheDocument());
    expect(screen.getByRole("img", { name: "Aurora Chair preview" })).toBeVisible();
    expect(screen.getByText("Catalog preview unavailable")).toBeVisible();
    expect(screen.getByText("2 × $120.00")).toBeInTheDocument();
    expect(screen.getByText("$240.00", { selector: ".cart-line-subtotal" })).toBeInTheDocument();
    expect(screen.getByText("Total").parentElement).toHaveTextContent("Total$240.00");
    expect(screen.getByLabelText("Cart revision 2")).toBeInTheDocument();
    expect(screen.getByRole("status", { name: "Latest cart mutation" })).toHaveTextContent(
      "webmcp · add · accepted · Cart rev 2 · Aurora Chair · Synthetic retailer · offer-1",
    );
  });

  it("refreshes the explicit popover when a Cart tool commits a mutation", async () => {
    let notify!: () => void;
    let result: CartReadResult = emptyCartResult;
    const client: CustomerCartClient = {
      getCart: vi.fn(async () => result),
      subscribe: (listener) => {
        notify = listener;
        return () => undefined;
      },
    };
    render(<CartReviewPanel client={client} open onClose={vi.fn()} onOpen={vi.fn()} openerRef={createRef<HTMLButtonElement>()} room={room} roomRevision={1} session={signedIn} />);

    await waitFor(() => expect(screen.getByText("No provider selections yet.")).toBeInTheDocument());
    result = {
      ...emptyCartResult,
      cart: {
        ...emptyCartResult.cart,
        revision: 2,
        lines: [{
          lineId: "line-1",
          quantity: 1,
          lineTotalMinor: 12_000,
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
        totals: { subtotalMinor: 12_000, totalMinor: 12_000, currency: "USD" },
      },
    };
    notify();

    await waitFor(() => expect(screen.getByText("Aurora Chair")).toBeInTheDocument());
    expect(within(screen.getAllByRole("dialog", { name: "Shopping plan" }).at(-1)!).getByLabelText("Cart revision 2")).toBeInTheDocument();
    expect(client.getCart).toHaveBeenCalledTimes(2);
  });

});
