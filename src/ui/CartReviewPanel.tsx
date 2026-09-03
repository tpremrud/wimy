import { useEffect, useState, type RefObject } from "react";
import type { CustomerSessionView } from "../commerce/customer-session";
import type { CartLine, CartReceipt } from "../commerce/cart";
import type { CustomerCartClient } from "../commerce/customer-session-demo";
import { formatMinorMoney } from "../commerce/money";
import type { CatalogItem } from "../room/catalog";
import type { RoomStoreState } from "../room/store";
import { CatalogItemPreview } from "./CatalogItemPreview";

const availabilityLabel = (
  availability: "in_stock" | "out_of_stock" | "unknown",
) => {
  switch (availability) {
    case "in_stock":
      return "In stock";
    case "out_of_stock":
      return "Out of stock";
    case "unknown":
      return "Availability unknown";
  }
};

const groupLinesByProvider = (lines: readonly CartLine[]) => {
  const groups = new Map<string, CartLine[]>();
  for (const line of lines) {
    const group = groups.get(line.offer.retailerId) ?? [];
    group.push(line);
    groups.set(line.offer.retailerId, group);
  }
  return [...groups.entries()];
};

const roomRequirements = (room: RoomStoreState["room"]) => {
  const groups = new Map<string, RoomStoreState["room"]["items"][number][]>();
  for (const item of room.items) {
    const key = item.catalogRef
      ? `${item.catalogRef.catalogId}:${item.catalogRef.productId}`
      : `placed:${item.id}`;
    const group = groups.get(key) ?? [];
    group.push(item);
    groups.set(key, group);
  }
  return [...groups.entries()].map(([key, items]) => ({ key, item: items[0], quantity: items.length }));
};

type CartReviewPanelProps = Readonly<{
  catalog?: readonly CatalogItem[];
  open: boolean;
  onClose: () => void;
  onOpen: () => void;
  openerRef: RefObject<HTMLButtonElement | null>;
  room: RoomStoreState["room"];
  roomRevision: number;
  session: CustomerSessionView;
  client?: CustomerCartClient;
}>;

export function CartReviewPanel({
  catalog = [],
  open,
  onClose,
  onOpen,
  openerRef,
  room,
  roomRevision,
  session,
  client,
}: CartReviewPanelProps) {
  const sessionKey = session.authenticated ? session.customerId : "anonymous";
  const [state, setState] = useState<{
    key: string;
    result: Awaited<ReturnType<CustomerCartClient["getCart"]>>;
    receipt: CartReceipt;
  } | null>(null);

  useEffect(() => {
    let current = true;
    if (!open || !client) return () => { current = false; };
    const refresh = async (mutationReceipt?: CartReceipt) => {
      const result = await client.getCart();
      if (current) {
        setState({
          key: sessionKey,
          result,
          receipt: mutationReceipt ?? client.getLatestReceipt?.() ?? result.receipt,
        });
      }
    };
    void refresh();
    const unsubscribe = client.subscribe?.((mutationReceipt) => {
      void refresh(mutationReceipt);
    });
    return () => {
      current = false;
      unsubscribe?.();
    };
  }, [client, open, sessionKey]);

  return (
    <div className={`cart-review-region${open ? " is-open" : ""}`}>
      <button
        ref={openerRef}
        type="button"
        className="header-action-button cart-review-trigger"
        aria-label="Review shopping plan"
        aria-expanded={open}
        aria-controls="cart-review-panel"
        onClick={() => (open ? onClose() : onOpen())}
      >
        Plan · {room.items.length} placed
      </button>
      <section
        id="cart-review-panel"
        className={`cart-review-panel${open ? " is-open" : ""}`}
        data-floating-surface="cart"
        role="dialog"
        aria-modal="false"
        aria-labelledby="cart-review-heading"
        hidden={!open}
        inert={!open ? true : undefined}
      >
        {!session.authenticated ? (
          <>
            <CartReviewHeading onClose={onClose} roomRevision={roomRevision} />
            <RoomItemsInCart room={room} />
            <p>Sign in locally to review a customer-owned cart. Room editing and file sharing remain available anonymously.</p>
          </>
        ) : !client ? (
          <>
            <CartReviewHeading onClose={onClose} roomRevision={roomRevision} />
            <RoomItemsInCart room={room} />
            <p role="status">Shopping-plan review is not configured for this session client.</p>
          </>
        ) : !state || state.key !== sessionKey ? (
          <>
            <CartReviewHeading onClose={onClose} roomRevision={roomRevision} />
            <RoomItemsInCart room={room} />
            <p role="status">Loading cart…</p>
          </>
        ) : !state.result.ok ? (
          <>
            <CartReviewHeading onClose={onClose} roomRevision={roomRevision} />
            <RoomItemsInCart room={room} />
            <p role="alert">Shopping-plan review is unavailable: {state.result.error.message}.</p>
          </>
        ) : (
          <>
            <CartReviewHeading
              cartRevision={state.result.cart.revision}
              onClose={onClose}
              roomRevision={roomRevision}
            />
            {state.result.cart.lines.length === 0 ? (
              <>
                <RoomItemsInCart room={room} />
                <p>No provider selections yet.</p>
              </>
            ) : (
              <>
                <section className="provider-plan" aria-label="Provider selections">
                  <div className="cart-room-items-heading">
                    <h3>Selected offers</h3>
                    <span>{state.result.cart.lines.length} line{state.result.cart.lines.length === 1 ? "" : "s"}</span>
                  </div>
                  <div className="provider-plan-groups">
                    {groupLinesByProvider(state.result.cart.lines).map(([providerId, lines]) => {
                      const providerName = lines[0].offer.provenance.sourceName;
                      const providerTotal = lines.reduce((total, line) => total + line.lineTotalMinor, 0);
                      return (
                        <section key={providerId} className="provider-plan-group" aria-label={`Plan for ${providerName}`}>
                          <div className="provider-plan-heading">
                            <div>
                              <span className="provider-plan-eyebrow">Provider</span>
                              <h4>{providerName}</h4>
                            </div>
                            <span>{formatMinorMoney(providerTotal, lines[0].offer.price.currency)}</span>
                          </div>
                          <ul className="cart-review-lines">
                            {lines.map((line) => {
                      const catalogItem = catalog.find(
                        ({ catalogRef }) =>
                          catalogRef.catalogId === line.offer.catalogRef.catalogId &&
                          catalogRef.productId === line.offer.catalogRef.productId,
                      );
                      const previewSnapshot = catalogItem?.snapshot ?? {
                        name: line.offer.displayName,
                        category: "generic" as const,
                        appearance: { color: "#78928A" },
                      };
                              return (
                                <li key={line.lineId}>
                          <CatalogItemPreview snapshot={previewSnapshot} />
                          <div className="cart-line-copy">
                            <strong>{line.offer.displayName}</strong>
                            <span>{line.offer.provenance.sourceName}</span>
                            <span>{availabilityLabel(line.offer.availability)}</span>
                            {catalogItem ? null : <span>Catalog preview unavailable</span>}
                          </div>
                          <div className="cart-line-price">
                            <span>{line.quantity} × {formatMinorMoney(line.offer.price.amountMinor, line.offer.price.currency)}</span>
                            <strong className="cart-line-subtotal">
                              {formatMinorMoney(line.lineTotalMinor, line.offer.price.currency)}
                            </strong>
                          </div>
                                </li>
                              );
                            })}
                          </ul>
                          <div className="provider-plan-handoff">
                            <button type="button" disabled aria-label={`Checkout at ${providerName} — not connected`}>
                              Checkout at {providerName}
                            </button>
                            <p>Provider connection not available yet.</p>
                          </div>
                        </section>
                      );
                    })}
                  </div>
                  <p className="cart-review-total">
                    <strong>Total</strong>
                    <span>{formatMinorMoney(state.result.cart.totals.totalMinor, state.result.cart.totals.currency)}</span>
                  </p>
                </section>
                <RoomItemsInCart room={room} />
              </>
            )}
            {state.receipt.operation !== "read" && state.receipt.target ? (
              <p role="status" aria-label="Latest cart mutation">
                Latest mutation: {state.receipt.origin} · {state.receipt.operation} · {state.receipt.status} · Cart rev {state.receipt.revision} · {state.receipt.target.displayName} · {state.receipt.target.retailer} · {state.receipt.target.offerId}
              </p>
            ) : null}
            <p className="cart-review-disclosure">
              Local shopping plan only. Provider checkout, payment, and purchase connections are not available yet.
            </p>
          </>
        )}
      </section>
    </div>
  );
}

function RoomItemsInCart({ room }: Readonly<{ room: RoomStoreState["room"] }>) {
  const requirements = roomRequirements(room);
  return (
    <section className="cart-room-items" aria-label="Items in this room">
      <div className="cart-room-items-heading">
        <h3>Items in this room</h3>
        <span>{room.items.length} placed</span>
      </div>
      <p>
        Quantities mirror placed catalog items automatically. Provider selections remain explicit and are not connected to checkout.
      </p>
      {room.items.length === 0 ? (
        <p>No items are placed in this room.</p>
      ) : (
        <ul>
          {requirements.map(({ key, item, quantity }) => (
            <li key={key}>
              <CatalogItemPreview snapshot={item.snapshot} />
              <div className="cart-room-item-copy">
                <strong>{item.snapshot.name}</strong>
                <span>
                  {item.snapshot.category} · {item.snapshot.dimensions.width} × {item.snapshot.dimensions.depth} m
                </span>
                <span className="cart-item-state">
                  {item.catalogRef
                    ? "Placed item · offer lookup ready"
                    : "Placed item · no catalog reference"}
                </span>
                <span>Quantity {quantity}</span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function CartReviewHeading({
  cartRevision,
  onClose,
  roomRevision,
}: Readonly<{
  cartRevision?: number;
  onClose: () => void;
  roomRevision: number;
}>) {
  return (
    <div className="cart-review-heading">
      <div>
        <p className="drawer-kicker">Room-linked purchasing</p>
        <h2 id="cart-review-heading">Shopping plan</h2>
      </div>
      <div className="cart-review-heading-actions">
        <span aria-label={`Room revision ${roomRevision}`}>Room rev {roomRevision}</span>
        {cartRevision === undefined ? null : (
          <span aria-label={`Cart revision ${cartRevision}`}>Cart rev {cartRevision}</span>
        )}
        <button type="button" aria-label="Close shopping plan" onClick={onClose} autoFocus>Close</button>
      </div>
    </div>
  );
}
