import { useEffect, useState, type FormEvent } from "react";
import type { CustomerSessionView } from "../commerce/customer-session";
import type { CustomerSessionClient } from "../commerce/customer-session-demo";

type CustomerSessionPanelProps = Readonly<{
  client: CustomerSessionClient;
  onSessionChange?: (session: CustomerSessionView) => void;
}>;

const ANONYMOUS_SESSION: CustomerSessionView = { authenticated: false };

export function CustomerSessionPanel({ client, onSessionChange }: CustomerSessionPanelProps) {
  const [session, setSession] = useState<CustomerSessionView>(ANONYMOUS_SESSION);
  const [identity, setIdentity] = useState("Demo customer");
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let current = true;
    void client.getSession().then((nextSession) => {
      if (current) {
        setSession(nextSession);
        onSessionChange?.(nextSession);
      }
    });
    return () => {
      current = false;
    };
  }, [client, onSessionChange]);

  const signIn = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const customerId = identity.trim();
    if (!customerId) {
      setError("Enter a demo customer identity.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const nextSession = await client.signIn(customerId);
      setSession(nextSession);
      onSessionChange?.(nextSession);
      setOpen(false);
    } catch {
      setError("The local session could not be created.");
    } finally {
      setBusy(false);
    }
  };

  const signOut = async () => {
    setBusy(true);
    setError(null);
    try {
      const nextSession = await client.signOut();
      setSession(nextSession);
      onSessionChange?.(nextSession);
    } catch {
      setError("The local session could not be revoked.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="customer-session" aria-labelledby="customer-session-heading">
      <div className="customer-session-summary">
        <p className="drawer-kicker">Optional account</p>
        <h2 id="customer-session-heading">Customer session</h2>
        <p aria-live="polite" className="customer-session-status">
          {session.authenticated
            ? `Signed in locally as ${session.customerId}`
            : "Anonymous mode"}
        </p>
      </div>
      {session.authenticated ? (
        <button type="button" onClick={() => void signOut()} disabled={busy}>
          Sign out
        </button>
      ) : (
        <>
          <button
            type="button"
            aria-label="Sign in (optional)"
            aria-expanded={open}
            aria-controls="customer-session-form"
            onClick={() => {
              setOpen((isOpen) => !isOpen);
              setError(null);
            }}
          >
            Sign in
          </button>
          {open ? (
            <form id="customer-session-form" onSubmit={(event) => void signIn(event)}>
              <p>Local synthetic demonstration only; no provider or credentials are used.</p>
              <label>
                Demo customer identity
                <input
                  value={identity}
                  onChange={(event) => setIdentity(event.target.value)}
                  autoComplete="off"
                  maxLength={256}
                />
              </label>
              <button type="submit" disabled={busy}>Continue locally</button>
              {error ? <p role="alert">{error}</p> : null}
            </form>
          ) : null}
        </>
      )}
      {error && !open ? <p role="alert">{error}</p> : null}
    </section>
  );
}
