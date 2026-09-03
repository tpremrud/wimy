import { useEffect, useRef, useState } from "react";
import type {
  WebMcpRegistrationStatus,
  WebMcpToolDefinition,
} from "../webmcp/room-tools";
import { SIGNED_IN_WEBMCP_TOOL_NAMES } from "../webmcp/tool-catalog";

type ToolListRegistration =
  | { phase: "pending" }
  | { phase: "resolved"; status: WebMcpRegistrationStatus };

type WebMcpToolListProps = {
  authenticated?: boolean;
  definitions: readonly WebMcpToolDefinition[];
  registration: ToolListRegistration;
  statusText?: string;
};

const summarizeRegistration = (
  definitions: readonly WebMcpToolDefinition[],
  registration: ToolListRegistration,
) => {
  if (registration.phase === "pending") {
    return {
      accessible: "WebMCP tools, registration pending",
      badge: "WebMCP · connecting",
      count: "Connecting to browser",
      registered: new Set<string>(),
      state: "pending",
    };
  }

  if (!registration.status.available) {
    return {
      accessible: "WebMCP tools unavailable",
      badge: "WebMCP unavailable",
      count: "Browser support unavailable",
      registered: new Set<string>(),
      state: "unavailable",
    };
  }

  const registered = new Set(registration.status.registered);
  const count = `${registered.size} of ${definitions.length} registered`;
  return {
    accessible: `WebMCP tools, ${registered.size} registered`,
    badge:
      registered.size === definitions.length
        ? `WebMCP · ${registered.size} tools`
        : `WebMCP · ${registered.size}/${definitions.length} tools`,
    count,
    registered,
    state: registered.size === definitions.length ? "ready" : "degraded",
  };
};

export function WebMcpToolList({
  authenticated = false,
  definitions,
  registration,
  statusText,
}: WebMcpToolListProps) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const summary = summarizeRegistration(definitions, registration);

  useEffect(() => {
    if (!open) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      triggerRef.current?.focus();
    };
    const closeOnOutsidePointer = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (
        triggerRef.current?.contains(target) ||
        panelRef.current?.contains(target)
      ) {
        return;
      }
      setOpen(false);
    };
    document.addEventListener("keydown", closeOnEscape);
    document.addEventListener("pointerdown", closeOnOutsidePointer);
    return () => {
      document.removeEventListener("keydown", closeOnEscape);
      document.removeEventListener("pointerdown", closeOnOutsidePointer);
    };
  }, [open]);

  return (
    <aside className="webmcp-tool-list" aria-label="WebMCP integration">
      {statusText ? (
        <span
          className="visually-hidden"
          role="status"
          aria-label="WebMCP status"
          aria-live="polite"
        >
          {statusText}
        </span>
      ) : null}
      {open ? (
        <section
          ref={panelRef}
          id="webmcp-tool-list-panel"
          className="webmcp-tool-list-panel"
          role="dialog"
          aria-modal="false"
          aria-label="WebMCP tools"
        >
          <div className="webmcp-tool-list-heading">
            <strong>WebMCP tools</strong>
            <span>{summary.count}</span>
          </div>
          <p className="webmcp-tool-list-kicker">Available now</p>
          <ul>
            {definitions.map((definition) => {
              const registered = summary.registered.has(definition.name);
              const writes = definition.annotations?.readOnlyHint === false;
              return (
                <li key={definition.name}>
                  <span
                    className={`webmcp-tool-state${registered ? " is-registered" : ""}`}
                    aria-hidden="true"
                  />
                  <code>{definition.name}</code>
                  <span className="webmcp-tool-state-label">
                    {registered ? "Registered" : "Unavailable"}
                  </span>
                  {writes ? (
                    <span className="webmcp-tool-write">
                      {definition.name.endsWith("_cart")
                        ? "Can change plan"
                        : "Can change room"}
                    </span>
                  ) : null}
                </li>
              );
            })}
          </ul>
          {!authenticated ? (
            <>
              <p className="webmcp-tool-list-kicker">Available after sign-in</p>
              <ul aria-label="WebMCP tools available after sign-in">
                {SIGNED_IN_WEBMCP_TOOL_NAMES.map((name) => (
                  <li key={name}>
                    <span
                      aria-hidden="true"
                      className="webmcp-tool-state is-gated"
                    />
                    <code>{name}</code>
                    <span className="webmcp-tool-state-label">Sign in</span>
                  </li>
                ))}
              </ul>
            </>
          ) : null}
          <p className="webmcp-tool-list-legend">
            Tools are registered with this browser. Changes still use Wimy’s room revision checks.
          </p>
        </section>
      ) : null}
      <button
        ref={triggerRef}
        type="button"
        className="webmcp-tool-list-trigger"
        data-state={summary.state}
        aria-label={summary.accessible}
        aria-expanded={open}
        aria-controls="webmcp-tool-list-panel"
        onClick={() => setOpen((current) => !current)}
      >
        <span className="webmcp-badge-state" aria-hidden="true" />
        {summary.badge}
      </button>
    </aside>
  );
}
