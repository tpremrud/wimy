# Wimy

Wimy ("What's in my room?") is a local-first room decision workspace where a person and a browser agent can fit, find, place, edit, preview, and share furniture layouts.

Built for [The WebMCP Challenge](https://webmcp.devpost.com/). The repository is released under the [MIT License](LICENSE).

> Draft status — 2026-08-30: this is a local release candidate. The static application gates are being verified, while a deployed URL and an exact native WebMCP browser transcript remain owner-run release gates. This README does not claim either one.

## What is shipped

- One rectangular or L-shaped room with dimensions in meters, movable/addable/removable doors and windows, and a primary SVG 2D editor.
- Human selection, keyboard activation, drag-to-move, quarter-turn rotation, add, and remove actions. Accepted changes show a visible activity receipt and advance the runtime revision.
- A read-only procedural 3D preview derived from the same committed room. It uses room geometry and item snapshots to draw floors, walls, openings, and category-shaped primitives; it never edits the room. If WebGL or the preview chunk is unavailable, the room summary and placed-item list remain usable.
- Three independent room templates: Blank Room, Compact Bedroom, and Living Room.
- A twelve-item local fictional catalog. Category, style tags, fictional USD price snapshots, and maximum footprint filters are deterministic. A fit search tries quarter-turns in `0`, `90`, `180`, `270` degree order and scans a fixed 0.1 m grid, returning the first legal pose for each result.
- Six anonymous WebMCP room tools that share the human editor's committed state: `inspect_room`, `find_furniture`, `apply_room_edit`, the read-only `inspect_retailer_offers` evidence lookup, the read-only `inspect_room_shopping_plan` comparison, and the read-only `find_substitutes` ranking. An authenticated local demo session additionally exposes bounded cart reads and mutations for exact project-authored offers plus a human-only synthetic sandbox checkout handoff; no checkout, order, payment, or buy write tool exists in WebMCP.
- A versioned `.wimy` file for no-account export/import. The file is UTF-8 JSON, intentionally human-readable and strict; a custom Markdown-like room language is not part of v1.

## One canonical room

The portable source of truth is a `wimy-room` schema version `2` document. Version 1 rectangular files that also satisfy the current non-overlapping-opening constraint remain importable and migrate in memory without changing their room content; legacy files with stacked openings fail closed and must be corrected before import:

- `room.name`, `room.dimensions`, optional `room.geometry`, and `room.openings` describe one room. Omitted geometry means a rectangle; the v2 L shape uses a southeast notch. The coordinate origin is the northwest interior floor corner; `+x` points east/right and `+y` points south/down.
- Each placed item has a document-scoped `id`, a pose (`x`, `y`, and a clockwise quarter-turn), and an embedded Furniture Snapshot containing its name, category, dimensions, color, optional material, style tags, and optional commerce snapshot.
- `catalogRef` is an optional lookup hint. The embedded snapshot is authoritative, so an imported item with an unavailable catalog reference still renders and can be edited; the UI reports a catalog warning.
- Exports use fixed key order, two-space indentation, and one trailing newline. Imports validate the complete document before one atomic replacement. Entity IDs and array order survive a round trip.
- Runtime revision, receipts, undo state, selection, tool prompts/calls, account data, file paths, cookies, analytics IDs, request headers, and other runtime metadata are not serialized.

The human UI, templates, import, export, undo, WebMCP handlers, 2D projection, and 3D projection all read or write through this one committed room state. Accepted transactions advance the runtime revision once; an `expectedRevision` mismatch returns `REVISION_CONFLICT` without applying the requested change.

## WebMCP interface

When the host exposes `document.modelContext`, Wimy registers exactly six anonymous room tools. After local sign-in with the cart scopes, it replaces that registration with the six room tools plus `inspect_cart`, `find_retailer_offers`, `add_to_cart`, `remove_from_cart`, and `set_cart_quantity`. At the session's natural expiry, Wimy revalidates once and unregisters the commerce tools. The header reports the live registered count, a degraded registration, or `WebMCP unavailable — human room access remains available`. The room remains human-editable and file-portable when WebMCP is unavailable.

| Tool | Input and result | Annotation and effect |
| --- | --- | --- |
| `inspect_room` | Empty object. Returns the current revision, meter dimensions, openings, placed-item IDs/names/categories/dimensions/poses, coordinate convention, and bounded layout warnings. | `readOnlyHint: true`, `untrustedContentHint: true`. Imported text is projected as untrusted text; commerce URLs are omitted. Does not change the room. |
| `find_furniture` | Optional `category`, up to eight `styleTags`, `maxPrice`, `maxWidth`, `maxDepth`, and `limit` from 1–5. Returns local catalog/product IDs, snapshot facts, fictional price, and a deterministic `suggestedPose`. | `readOnlyHint: true`, `untrustedContentHint: false` for the local fictional catalog. Does not change the room. |
| `apply_room_edit` | `expectedRevision` plus 1–8 exact `add`, `transform`, or `remove` operations. Returns the accepted revision, applied count, generated item IDs, and warnings, or a bounded failure code/message. | `readOnlyHint: false`, `untrustedContentHint: true`. Valid operations commit atomically through the same transaction seam as human edits. |
| `inspect_retailer_offers` | Canonical project-authored `catalogId` and `productId` UUIDs. Returns synthetic retailer/source, price/currency, availability, inert product URL text, observed/expiry timestamps, mapping confidence/evidence, and exact/ambiguous/substitute/stale/unavailable state. | `readOnlyHint: true`, `untrustedContentHint: true`. Reads volatile evidence only; it never changes the room. |
| `inspect_room_shopping_plan` | Empty object. Resolves the canonical catalog variants currently placed in the room, compares only current exact offers with compatible currency and price basis, and groups the bounded result by retailer. | `readOnlyHint: true`, `untrustedContentHint: true`. Reads volatile evidence only; it never changes the room. Prices exclude delivery, tax, membership discounts or fees, regional costs, and other unavailable landed-cost inputs. |
| `find_substitutes` | A placed `itemId` and optional limit from 1–5. Returns fit-validated, same-category catalog substitutes with deterministic identity differences, rationale, tradeoffs, and catalog provenance; it does not return prices. | `readOnlyHint: true`, `untrustedContentHint: true`. Does not change the room. A replacement is a separate human-confirmed action in the UI and is stale-safe at the room revision seam. |
| `inspect_cart` | Empty object. Requires the local customer session's `commerce:cart:read` scope. Returns bounded cart totals, lines, exact-offer freshness, and recoverable warnings without customer secrets or retailer URLs. | `readOnlyHint: true`, `untrustedContentHint: true`. Does not change the room or place an order. |
| `find_retailer_offers` | One canonical `catalogId`/`productId` pair or a placed `itemId`. Requires `commerce:cart:read`. Returns at most 20 exact synthetic offers plus the total exact count and truncation metadata; source URLs, seller IDs, and hidden metadata are omitted. | `readOnlyHint: true`, `untrustedContentHint: true`. Reads local volatile evidence and never purchases anything. |
| `add_to_cart` | An exact offer ID/version, canonical catalog identity, observed price/currency, bounded quantity, current cart revision, and idempotency key. Requires `commerce:cart:write`. | `readOnlyHint: false`, `untrustedContentHint: true`. Commits only through the customer cart seam and returns a visible `commerce.cart.receipt` naming the offer and retailer; checkout remains a separate human UI action. |
| `remove_from_cart` | A cart line ID, current cart revision, and idempotency key. Requires `commerce:cart:write`. | `readOnlyHint: false`, `untrustedContentHint: true`. Uses exact revision/idempotency checks and returns a visible cart receipt naming the affected offer and retailer. |
| `set_cart_quantity` | A cart line ID, bounded quantity, current cart revision, and idempotency key. Requires `commerce:cart:write`. | `readOnlyHint: false`, `untrustedContentHint: true`. Revalidates the exact offer and returns a visible cart receipt naming the affected offer and retailer; checkout remains a separate human UI action. |

An add operation supplies a catalog `productId` and pose; Wimy generates the placed-item ID. Placement checks room bounds, blocking overlaps, and protected door clearance. The tool does not expose arbitrary HTML, file access, arbitrary URL navigation, checkout, or purchase actions.

## Trust, privacy, and catalog scope

Wimy has no server authentication, backend, database, cloud room storage, internal chat, live retailer API, scraping, real checkout, order placement, payment, or real-time inventory/price feed. The optional customer session, cart, and synthetic sandbox handoff are local demo seams with bounded scopes and no purchase capability. Human cart reads/actions default to `human` receipts; WebMCP calls explicitly use `webmcp` receipts. Offer evidence in this slice is synthetic, local, volatile, and only exact project-authored offers are cart-eligible. The demo catalog remains fictional and non-purchasable; its price fields are snapshots for deterministic interaction, not retailer facts or freshness claims.

Imported strings are bounded and validated. HTTPS product URLs may be stored in an imported snapshot but are never fetched automatically. Synthetic offer URLs use `example.invalid` and are exposed only as transparent inert handoff links. Imported names are treated as untrusted text. Invalid files fail closed without replacing the current room, and stale agent edits fail closed at the revision seam.

## Local development

Requires Node.js `24.9.0` and pnpm `9.15.9`.

```bash
pnpm install
pnpm exec playwright install chromium
pnpm dev
```

The Playwright install command explicitly installs the Chromium build used by the browser tests. The app is a Vite static frontend; no account or server-side room setup is required. The optional local customer session is demo-only and does not create a remote account.

## Verification

Run these commands against the exact commit you intend to review or submit:

```bash
pnpm install --frozen-lockfile
pnpm typecheck
pnpm lint
pnpm test -- --run
pnpm test:e2e
pnpm build
git diff --check
```

The explicit `--` forwards `--run` to Vitest. `pnpm test:e2e` starts a local Vite server and exercises the human workspace and WebMCP harness; a local automated result is separate from owner verification in a supported native WebMCP host and from deployed cold-load proof.

## Release boundaries and roadmap

The current release is deliberately a focused vertical slice. It does not include photo/room scanning, wall drawing, multi-room CAD, physics, photoreal rendering, imported 3D models, free-angle rotation, editable 3D, live retailer freshness, real retailer checkout, payment, order placement, community galleries, user-published templates, server authentication, or cloud collaboration.

- MVP1 — hackathon: fit, find, place, local fictional catalog, built-in templates, no-account `.wimy` files, human/agent shared edits, optional local cart scope demo, and derived 3D.
- MVP2 — sharing: user-created templates, shareable links/files, import previews, thumbnails, compatibility migrations, and optional local persistence.
- MVP3 — commerce and community: authorized retailer adapters with provenance/freshness indicators, user catalog imports, community discovery, collaboration, and explicit purchase handoff. This requires separate licensing, security, moderation, storage, and consent designs.

Canonical room and furniture vocabulary is documented in [CONTEXT.md](CONTEXT.md). Private planning, research, decisions, and execution evidence live under the ignored `docs/` and `.docs/` directories and are intentionally excluded from the public repository.
