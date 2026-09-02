import { useEffect, useState, type RefObject } from "react";
import type { CustomerSessionView } from "../commerce/customer-session";
import type { CartReceipt } from "../commerce/cart";
import type { CustomerCartClient } from "../commerce/customer-session-demo";

type CartReviewPanelProps = Readonly<{
  open: boolean;
  onClose: () => void;
  onOpen: () => void;
  openerRef: RefObject<HTMLButtonElement | null>;
  session: CustomerSessionView;
  client?: CustomerCartClient;
}>;

export function CartReviewPanel({
  open,
  onClose,
  onOpen,
  openerRef,
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
        aria-label="Review cart"
        aria-expanded={open}
        aria-controls="cart-review-panel"
        onClick={() => (open ? onClose() : onOpen())}
      >
        Cart
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
            <CartReviewHeading onClose={onClose} />
            <p>Sign in locally to review a customer-owned cart. Room editing and file sharing remain available anonymously.</p>
          </>
        ) : !client ? (
          <>
            <CartReviewHeading onClose={onClose} />
            <p role="status">Cart review is not configured for this session client.</p>
          </>
        ) : !state || state.key !== sessionKey ? (
          <>
            <CartReviewHeading onClose={onClose} />
            <p role="status">Loading cart…</p>
          </>
        ) : !state.result.ok ? (
          <>
            <CartReviewHeading onClose={onClose} />
            <p role="alert">Cart review is unavailable: {state.result.error.message}.</p>
          </>
        ) : (
          <>
            <div className="cart-review-heading">
              <div>
                <p className="drawer-kicker">Commerce review</p>
                <h2 id="cart-review-heading">Cart review</h2>
              </div>
              <div className="cart-review-heading-actions">
                <span aria-label={`Cart revision ${state.result.cart.revision}`}>Revision {state.result.cart.revision}</span>
                <button type="button" aria-label="Close cart review" onClick={onClose} autoFocus>Close</button>
              </div>
            </div>
            {state.receipt.operation !== "read" && state.receipt.target ? (
              <p role="status" aria-label="Latest cart mutation">
                Latest mutation: {state.receipt.origin} · {state.receipt.operation} · {state.receipt.status} · Revision {state.receipt.revision} · {state.receipt.target.displayName} · {state.receipt.target.retailer} · {state.receipt.target.offerId}
              </p>
            ) : null}
            {state.result.cart.lines.length === 0 ? (
              <p>Your cart is empty.</p>
            ) : (
              <>
                <ul className="cart-review-lines">
                  {state.result.cart.lines.map((line) => (
                    <li key={line.lineId}>
                      <span>{line.offer.displayName}</span>
                      <span>{line.quantity} × {line.offer.price.amountMinor} {line.offer.price.currency} = {line.lineTotalMinor} {line.offer.price.currency}</span>
                    </li>
                  ))}
                </ul>
                <p className="cart-review-total"><strong>Total</strong> {state.result.cart.totals.totalMinor} {state.result.cart.totals.currency}</p>
              </>
            )}
            <p className="cart-review-disclosure">Synthetic local cart review only. Checkout, payment, and purchase are not available.</p>
          </>
        )}
      </section>
    </div>
  );
}

function CartReviewHeading({ onClose }: Readonly<{ onClose: () => void }>) {
  return (
    <div className="cart-review-heading">
      <div>
        <p className="drawer-kicker">Commerce review</p>
        <h2 id="cart-review-heading">Cart review</h2>
      </div>
      <button type="button" aria-label="Close cart review" onClick={onClose} autoFocus>Close</button>
    </div>
  );
}
