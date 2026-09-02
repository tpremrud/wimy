import { useEffect, useRef, useState, type RefObject } from "react";
import type { CustomerSessionView } from "../commerce/customer-session";
import type { CartReceipt } from "../commerce/cart";
import type {
  CustomerCartClient,
  CustomerCheckoutClient,
} from "../commerce/customer-session-demo";
import type { CheckoutReceipt, CheckoutReview, CheckoutSession } from "../commerce/checkout";
import type { RoomStoreState } from "../room/store";

type CartReviewPanelProps = Readonly<{
  open: boolean;
  onClose: () => void;
  onOpen: () => void;
  openerRef: RefObject<HTMLButtonElement | null>;
  room: RoomStoreState["room"];
  session: CustomerSessionView;
  client?: CustomerCartClient;
  checkout?: CustomerCheckoutClient;
}>;

export function CartReviewPanel({
  open,
  onClose,
  onOpen,
  openerRef,
  room,
  session,
  client,
  checkout,
}: CartReviewPanelProps) {
  const sessionKey = session.authenticated ? session.customerId : "anonymous";
  const [state, setState] = useState<{
    key: string;
    result: Awaited<ReturnType<CustomerCartClient["getCart"]>>;
    receipt: CartReceipt;
  } | null>(null);
  const [checkoutState, setCheckoutState] = useState<
    | { phase: "idle" }
    | { phase: "loading" }
    | { phase: "reviewed"; review: CheckoutReview }
    | { phase: "session"; session: CheckoutSession }
    | { phase: "error"; message: string }
  >({ phase: "idle" });
  const [checkoutBusy, setCheckoutBusy] = useState(false);
  const [checkoutReceipt, setCheckoutReceipt] = useState<CheckoutReceipt | undefined>();
  const confirmationKeyRef = useRef<string | null>(null);

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

  const prepareCheckout = async () => {
    if (!checkout) return;
    setCheckoutState({ phase: "loading" });
    const result = await checkout.getReview();
    if (!result.ok) {
      setCheckoutReceipt(result.receipt);
      setCheckoutState({ phase: "error", message: result.error.message });
      return;
    }
    setCheckoutReceipt(result.receipt);
    setCheckoutState({ phase: "reviewed", review: result.review });
  };

  const confirmCheckout = async () => {
    if (!checkout || checkoutState.phase !== "reviewed" || !checkoutState.review.canConfirm) return;
    setCheckoutBusy(true);
    const reviewId = checkoutState.review.reviewId;
    confirmationKeyRef.current ??= `checkout-confirm-${reviewId}`;
    const result = await checkout.confirm(reviewId, confirmationKeyRef.current);
    setCheckoutReceipt(result.receipt);
    if (result.ok) {
      setCheckoutState({ phase: "session", session: result.session });
    } else {
      setCheckoutState({ phase: "error", message: result.error.message });
    }
    setCheckoutBusy(false);
  };

  const updateCheckoutSession = async (action: "cancel" | "returnToWimy") => {
    if (!checkout || checkoutState.phase !== "session") return;
    setCheckoutBusy(true);
    const result = await checkout[action](checkoutState.session.checkoutSessionId);
    setCheckoutReceipt(result.receipt);
    if (result.ok && action === "returnToWimy") {
      window.history.replaceState({}, "", result.session.returnPath);
    }
    if (result.ok) setCheckoutState({ phase: "session", session: result.session });
    else setCheckoutState({ phase: "error", message: result.error.message });
    setCheckoutBusy(false);
  };

  const openCheckout = async () => {
    if (!checkout || checkoutState.phase !== "session") return;
    setCheckoutBusy(true);
    const result = await checkout.open(checkoutState.session.checkoutSessionId);
    setCheckoutReceipt(result.receipt);
    if (result.ok) setCheckoutState({ phase: "session", session: result.session });
    else setCheckoutState({ phase: "error", message: result.error.message });
    setCheckoutBusy(false);
  };

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
        Cart · {room.items.length} planned
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
            <RoomItemsInCart room={room} />
            <p>Sign in locally to review a customer-owned cart. Room editing and file sharing remain available anonymously.</p>
          </>
        ) : !client ? (
          <>
            <CartReviewHeading onClose={onClose} />
            <RoomItemsInCart room={room} />
            <p role="status">Cart review is not configured for this session client.</p>
          </>
        ) : !state || state.key !== sessionKey ? (
          <>
            <CartReviewHeading onClose={onClose} />
            <RoomItemsInCart room={room} />
            <p role="status">Loading cart…</p>
          </>
        ) : !state.result.ok ? (
          <>
            <CartReviewHeading onClose={onClose} />
            <RoomItemsInCart room={room} />
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
            <RoomItemsInCart room={room} />
            {state.receipt.operation !== "read" && state.receipt.target ? (
              <p role="status" aria-label="Latest cart mutation">
                Latest mutation: {state.receipt.origin} · {state.receipt.operation} · {state.receipt.status} · Revision {state.receipt.revision} · {state.receipt.target.displayName} · {state.receipt.target.retailer} · {state.receipt.target.offerId}
              </p>
            ) : null}
            {state.result.cart.lines.length === 0 ? (
              <p>No retailer cart lines yet.</p>
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
            {checkout && state.result.cart.lines.length > 0 ? (
              <SandboxCheckoutReview
                busy={checkoutBusy}
                onCancel={() => void updateCheckoutSession("cancel")}
                onConfirm={() => void confirmCheckout()}
                onOpen={() => void openCheckout()}
                onPrepare={() => void prepareCheckout()}
                onReturn={() => void updateCheckoutSession("returnToWimy")}
                receipt={checkoutReceipt}
                state={checkoutState}
              />
            ) : null}
            <p className="cart-review-disclosure">
              {checkout
                ? "Cart addition and sandbox checkout handoff are separate from any completed purchase; payment, addresses, and orders remain provider-owned."
                : "Synthetic local cart review only. Checkout, payment, and purchase are not available."}
            </p>
          </>
        )}
      </section>
    </div>
  );
}

function RoomItemsInCart({ room }: Readonly<{ room: RoomStoreState["room"] }>) {
  return (
    <section className="cart-room-items" aria-label="Items in this room">
      <div className="cart-room-items-heading">
        <h3>Items in this room</h3>
        <span>{room.items.length} placed</span>
      </div>
      <p>
        This planning list mirrors the room automatically. Retailer cart lines remain explicit and require an exact eligible offer.
      </p>
      {room.items.length === 0 ? (
        <p>No items are placed in this room.</p>
      ) : (
        <ul>
          {room.items.map((item) => (
            <li key={item.id}>
              <strong>{item.snapshot.name}</strong>
              <span>
                {item.catalogRef
                  ? "Catalog identity available; exact retailer offer still required."
                  : "Planning item only; canonical catalog identity is unavailable."}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function SandboxCheckoutReview({
  busy,
  onCancel,
  onConfirm,
  onOpen,
  onPrepare,
  onReturn,
  receipt,
  state,
}: Readonly<{
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  onOpen: () => void;
  onPrepare: () => void;
  onReturn: () => void;
  receipt?: CheckoutReceipt;
  state:
    | { phase: "idle" }
    | { phase: "loading" }
    | { phase: "reviewed"; review: CheckoutReview }
    | { phase: "session"; session: CheckoutSession }
    | { phase: "error"; message: string };
}>) {
  if (state.phase === "idle") {
    return <button type="button" onClick={onPrepare}>Review sandbox checkout</button>;
  }
  if (state.phase === "loading") return <p role="status">Refreshing sandbox offer facts…</p>;
  if (state.phase === "error") {
    return (
      <div className="checkout-review-state">
        <p role="alert">Sandbox checkout unavailable: {state.message}.</p>
        <CheckoutReceiptView receipt={receipt} />
        <button type="button" onClick={onPrepare}>Review sandbox checkout again</button>
      </div>
    );
  }
  if (state.phase === "session") {
    return (
      <div className="checkout-review-state">
        <h3>Sandbox checkout handoff ready</h3>
        <p>Only a sandbox handoff session was created; no order or payment was created.</p>
        {state.session.status === "returned" ? <p role="status">Returned to Wimy through the local synthetic return path.</p> : null}
        {state.session.status === "handoff_ready" ? <button type="button" disabled={busy} onClick={onOpen}>Open sandbox checkout (inert)</button> : null}
        {state.session.status === "handoff_ready" ? <button type="button" disabled={busy} onClick={onCancel}>Cancel sandbox handoff</button> : null}
        {state.session.status === "handoff_ready" ? <button type="button" disabled={busy} onClick={onReturn}>Return to Wimy</button> : null}
        <p>Inert handoff URL: {state.session.handoffUrl}</p>
        <p role="status">Handoff status: {state.session.status}. Return path: {state.session.returnUrl}</p>
        <CheckoutReceiptView receipt={receipt} />
      </div>
    );
  }
  return (
    <div className="checkout-review-state">
      <h3>Sandbox checkout review</h3>
      <p>Retailer: {state.review.retailer}</p>
      <ul className="checkout-review-lines">
        {state.review.lines.map((line) => (
          <li key={line.lineId}>
            <strong>{line.displayName}</strong>
            <span>{line.quantity} × {line.price.amountMinor} {line.price.currency} = {line.lineTotalMinor} {line.price.currency}</span>
            <span>Availability: {line.availability} · Freshness: {line.freshness}</span>
            {line.priceChangeMinor !== 0 ? <span>Price changed by {line.priceChangeMinor} minor units.</span> : null}
          </li>
        ))}
      </ul>
      <p><strong>Total</strong> {state.review.totals.totalMinor} {state.review.totals.currency}</p>
      <p>{state.review.shippingTaxDisclosure}</p>
      {state.review.warnings.length > 0 ? (
        <ul aria-label="Checkout review warnings">
          {state.review.warnings.map((warning) => <li key={warning}>{warning}</li>)}
        </ul>
      ) : null}
      <button type="button" disabled={busy || !state.review.canConfirm} onClick={onConfirm}>
        Confirm sandbox checkout handoff
      </button>
      {!state.review.canConfirm ? <button type="button" disabled={busy} onClick={onPrepare}>Review sandbox checkout again</button> : null}
      {state.review.retailerIds.length > 1 ? <p>One retailer handoff at a time; split the cart before confirming.</p> : null}
      <CheckoutReceiptView receipt={receipt} />
    </div>
  );
}

function CheckoutReceiptView({ receipt }: Readonly<{ receipt?: CheckoutReceipt }>) {
  if (!receipt) return null;
  return <p aria-label="Latest checkout receipt">Latest checkout receipt: {receipt.operation} · {receipt.status} · Revision {receipt.cartRevision} · {receipt.lineCount} lines · {receipt.totalMinor} {receipt.currency}</p>;
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
