# Wimy

Wimy ("What's in my room?") is a local-first room decision workspace where a person and a browser agent can fit, find, place, edit, preview, and share furniture layouts.

Built for [The WebMCP Challenge](https://webmcp.devpost.com/). The repository is released under the [MIT License](LICENSE).

> Draft status — 2026-08-30: this is a local release candidate. The static application gates are being verified, while a deployed URL and an exact native WebMCP browser transcript remain owner-run release gates. This README does not claim either one.

## What is shipped

- A rectangular room with dimensions in meters, doors and windows, and a primary SVG 2D editor.
- Human selection, keyboard activation, drag-to-move, quarter-turn rotation, add, and remove actions. Accepted changes show a visible activity receipt and advance the runtime revision.
- A read-only procedural 3D preview derived from the same committed room. It uses room geometry and item snapshots to draw floors, walls, openings, and category-shaped primitives; it never edits the room. If WebGL or the preview chunk is unavailable, the room summary and placed-item list remain usable.
- Three independent room templates: Blank Room, Compact Bedroom, and Living Room.
- A twelve-item local fictional catalog. Category, style tags, fictional USD price snapshots, and maximum footprint filters are deterministic. A fit search tries quarter-turns in `0`, `90`, `180`, `270` degree order and scans a fixed 0.1 m grid, returning the first legal pose for each result.
- Three imperative WebMCP tools that share the human editor's committed state: `inspect_room`, `find_furniture`, and `apply_room_edit`.
- A versioned `.wimy` file for no-account export/import. The file is UTF-8 JSON, intentionally human-readable and strict; a custom Markdown-like room language is not part of v1.

## One canonical room

The portable source of truth is a `wimy-room` schema version `1` document:

- `room.name`, `room.dimensions`, and `room.openings` describe the rectangular room. The coordinate origin is the northwest interior floor corner; `+x` points east/right and `+y` points south/down.
- Each placed item has a document-scoped `id`, a pose (`x`, `y`, and a clockwise quarter-turn), and an embedded Furniture Snapshot containing its name, category, dimensions, color, style tags, and optional commerce snapshot.
- `catalogRef` is an optional lookup hint. The embedded snapshot is authoritative, so an imported item with an unavailable catalog reference still renders and can be edited; the UI reports a catalog warning.
- Exports use fixed key order, two-space indentation, and one trailing newline. Imports validate the complete document before one atomic replacement. Entity IDs and array order survive a round trip.
- Runtime revision, receipts, undo state, selection, tool prompts/calls, account data, file paths, cookies, analytics IDs, request headers, and other runtime metadata are not serialized.

The human UI, templates, import, export, undo, WebMCP handlers, 2D projection, and 3D projection all read or write through this one committed room state. Accepted transactions advance the runtime revision once; an `expectedRevision` mismatch returns `REVISION_CONFLICT` without applying the requested change.

## WebMCP interface

When the host exposes `document.modelContext`, Wimy registers exactly three tools once. The header reports `WebMCP ready — 3 tools registered`, a degraded registration, or `WebMCP unavailable — human room access remains available`. The room remains human-editable and file-portable when WebMCP is unavailable.

| Tool | Input and result | Annotation and effect |
| --- | --- | --- |
| `inspect_room` | Empty object. Returns the current revision, meter dimensions, openings, placed-item IDs/names/categories/dimensions/poses, coordinate convention, and bounded layout warnings. | `readOnlyHint: true`, `untrustedContentHint: true`. Imported text is projected as untrusted text; commerce URLs are omitted. Does not change the room. |
| `find_furniture` | Optional `category`, up to eight `styleTags`, `maxPrice`, `maxWidth`, `maxDepth`, and `limit` from 1–5. Returns local catalog/product IDs, snapshot facts, fictional price, and a deterministic `suggestedPose`. | `readOnlyHint: true`, `untrustedContentHint: false` for the local fictional catalog. Does not change the room. |
| `apply_room_edit` | `expectedRevision` plus 1–8 exact `add`, `transform`, or `remove` operations. Returns the accepted revision, applied count, generated item IDs, and warnings, or a bounded failure code/message. | `readOnlyHint: false`, `untrustedContentHint: true`. Valid operations commit atomically through the same transaction seam as human edits. |

An add operation supplies a catalog `productId` and pose; Wimy generates the placed-item ID. Placement checks room bounds, blocking overlaps, and protected door clearance. The tool does not expose arbitrary HTML, file access, arbitrary URL navigation, checkout, or purchase actions.

## Trust, privacy, and catalog scope

Wimy has no authentication, backend, database, cloud room storage, internal chat, retailer API, scraping, checkout, or real-time inventory/price feed. The demo catalog is fictional and local; its price fields are snapshots for deterministic interaction, not retailer facts or freshness claims.

Imported strings are bounded and validated. HTTPS product URLs may be stored in an imported snapshot but are never fetched automatically and are never returned by WebMCP. Imported names are treated as untrusted text. Invalid files fail closed without replacing the current room, and stale agent edits fail closed at the revision seam.

## Local development

Requires Node.js `24.9.0` and pnpm `9.15.9`.

```bash
pnpm install
pnpm exec playwright install chromium
pnpm dev
```

The Playwright install command explicitly installs the Chromium build used by the browser tests. The app is a Vite static frontend; no account or server-side room setup is required.

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

The current release is deliberately a focused vertical slice. It does not include photo/room scanning, wall drawing, multi-room CAD, physics, photoreal rendering, imported 3D models, free-angle rotation, editable 3D, retailer freshness, checkout, community galleries, user-published templates, authentication, or cloud collaboration.

- MVP1 — hackathon: fit, find, place, local fictional catalog, built-in templates, no-auth `.wimy` files, human/agent shared edits, and derived 3D.
- MVP2 — sharing: user-created templates, shareable links/files, import previews, thumbnails, compatibility migrations, and optional local persistence.
- MVP3 — commerce and community: authorized retailer adapters with provenance/freshness indicators, user catalog imports, community discovery, collaboration, and explicit purchase handoff. This requires separate licensing, security, moderation, storage, and consent designs.

Canonical room and furniture vocabulary is documented in [CONTEXT.md](CONTEXT.md). Private planning, research, decisions, and execution evidence live under the ignored `docs/` and `.docs/` directories and are intentionally excluded from the public repository.
