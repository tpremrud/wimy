# Product

## Register

product

## Platform

web

## Users

Wimy is for people making concrete decisions about a real room: what fits, what works together, and what to try next. They may work directly in the browser or invite a browser agent to inspect the same canonical room state, search the available catalog, and propose or apply bounded edits.

The primary task is to understand and improve one room without first creating an account. A room owner should be able to move between a 2D plan, a synchronized 3D preview, a catalog, and a portable `.wimy` file without losing identity, dimensions, orientation, or portable furniture facts. Runtime revision history, receipts, and undo state remain session-local.

## Product Purpose

Wimy turns a room plan into a portable decision workspace. It helps a person fit, find, place, rotate, compare, replace, and review furniture while keeping the human-visible interface and browser-agent tools on the same deterministic Room Document.

Success means a user can begin from a template or imported `.wimy` file, understand the room at a glance, make safe edits, share the design as a file, and optionally translate exact catalog identities into retailer-specific offers. Anonymous planning remains complete; sign-in and commerce add capabilities without becoming prerequisites.

## Positioning

Wimy is the local-first, agent-native room plan that stays portable before it becomes shoppable.

## Brand Personality

Calm, precise, and tasteful. Wimy should feel like a quiet professional planning surface: approachable enough to explore, rigorous enough to trust, and restrained enough that the room remains the focus.

The voice is concise and literal. It names what changed, distinguishes planning items from purchasable offers, and makes uncertainty or unavailable capabilities visible instead of smoothing them over with marketing language.

## Anti-references

Wimy must not feel like a cluttered retail portal, a dashboard made of unrelated cards, or a page that requires whole-document scrolling to reach primary tools. It must not require authentication or a database merely to create, import, export, or share a room.

It must not imply that a planning item is already a retailer cart line, invent a universal checkout across retailers, hide product provenance, or use licensed, copied, scraped, or remotely fetched assets without explicit authorization. It must not bury core room controls behind opaque navigation or let agent actions become invisible to the person reviewing the room.

## Design Principles

1. **The room is the work surface.** Preserve the largest clear area for the plan or preview; supporting tools live at the edges and manage their own overflow.
2. **Portable before personal.** Core planning, templates, `.wimy` import/export, and human-agent collaboration work without authentication.
3. **One canonical state.** The 2D editor, 3D preview, catalog fits, receipts, and WebMCP tools read and mutate the same revisioned Room Document.
4. **Explicit boundaries build trust.** Separate planning items, catalog identity, retailer offers, cart lines, and checkout confirmation in both language and behavior.
5. **Small actions, visible consequences.** Human and agent edits are atomic, validation is deterministic, and outcomes remain reviewable through warnings, revisions, and activity receipts.

## Accessibility & Inclusion

Wimy must remain keyboard-operable, expose semantic names and state for controls, preserve visible focus, and avoid encoding status through color alone. Reduced-motion preferences should be respected. Responsive layouts may change the placement of tools, but must not remove anonymous planning or make essential actions unreachable. No formal WCAG conformance level is claimed yet.
