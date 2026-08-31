# Wimy — submission draft

This is public-safe copy for [The WebMCP Challenge](https://webmcp.devpost.com/). It is a draft for review, not a submitted entry.

## Submission fields

| Field | Draft value | State |
| --- | --- | --- |
| Project name | Wimy | Ready to review |
| One-line summary | A person and a browser agent fit, find, and place furniture in one portable room. | Draft |
| Live URL | `[OWNER: add the approved deployed URL]` | Unverified; REL-91 owner gate |
| Public repository | `[OWNER: add the public repository URL after push]` | Unverified; REL-93 owner gate |
| Demo video | `[OWNER: add the public sub-three-minute YouTube URL]` | Unverified; REL-94 owner gate |
| Team, eligibility, and required acknowledgements | `[OWNER: complete from the official rules and account]` | Owner-only; REL-92/REL-95 |
| License | MIT | Repository file present |

The current draft status is: **local release candidate; static application gates are the current evidence, while deployment and exact native WebMCP browser proof remain owner-run release gates.** No live URL, retailer freshness, or native-host transcript is claimed here.

## Short description

Room planning usually splits the human's spatial reasoning from the shopping assistant's recommendations. Wimy makes the room itself the shared artifact. A person edits a primary 2D plan while a browser agent inspects the current dimensions and placed items, finds a fitting option from a local fictional catalog, and applies an exact placement at the revision it observed. The same committed room drives a read-only procedural 3D preview and a portable `.wimy` file that another person can import without an account.

## WebMCP Leverage

Wimy exposes exactly three imperative tools through `document.modelContext`:

- `inspect_room({})` returns the current revision, meter dimensions, openings, placed-item IDs, poses, coordinate convention, and bounded layout warnings. It is read-only and projects imported names as untrusted text without returning commerce URLs.
- `find_furniture(...)` accepts explicit category, style-tag, maximum-price, and maximum-footprint constraints plus a result limit from 1–5. It searches Wimy's ten-item local fictional catalog without changing the room and returns the snapshot facts and first legal deterministic pose for each match.
- `apply_room_edit(...)` accepts an `expectedRevision` and 1–8 exact add, transform, or remove operations. It generates new placed-item IDs, checks bounds/overlap/door clearance, commits all operations or none, and returns a new revision or an actionable rejection such as `REVISION_CONFLICT`.

The agent does not receive a parallel model-specific scene. It reads and writes the same room state the person sees. Read-only calls leave the revision and activity receipts unchanged; accepted agent edits appear in the 2D editor, the receipt panel, the item list, and the derived 3D view. If the host has no WebMCP context, the human editor and file workflow remain available.

## Execution

The implementation is a Vite/React/TypeScript browser app with a strict Zod room document, a Zustand store, SVG 2D projection, React Three Fiber procedural 3D projection, deterministic catalog fit search, and an atomic transaction seam. Human gestures, templates, import, undo, WebMCP, 2D, 3D, and export all consume the same committed room state.

The portable Wimy File is UTF-8 JSON with `format: "wimy-room"` and `schemaVersion: 1`. It stores room dimensions, openings, stable placed-item IDs, poses, and embedded Furniture Snapshots. Fixed key order, millimeter geometry precision, strict validation, a one-megabyte limit, and atomic replacement make export/import predictable. Runtime revision, receipts, prompts, tool calls, selection, account data, and request metadata stay out of the file.

The shipped UI is deliberately human-readable: a catalog rail, a central 2D/3D room workspace, and an activity/warnings rail. The header reports whether all three tools registered, registration degraded, or WebMCP is unavailable. The 3D preview is read-only; unsupported WebGL retains a room summary and placed-item list.

## Potential Impact

Wimy targets an everyday decision: will a piece fit this room, and what could work there? A person can express hard constraints in the room's geometry while an agent performs a bounded catalog search and proposes a legal pose. The stable room file makes the result easy to pass to another person without an account, backend, or hidden conversation state.

The current catalog is explicitly fictional and local. Price fields are deterministic demonstration snapshots, not retailer inventory, freshness, or purchase recommendations. Wimy stops at fit, find, and place; it does not fetch products, checkout, or take an irreversible action.

## Creativity & Ambition

The central design choice is to treat the room document as the collaboration protocol. A placed item carries its own Furniture Snapshot, while `catalogRef` remains only a lookup hint. That means a shared file can stay understandable even when the original catalog entry is unavailable, and document-scoped item IDs remain stable across export/import.

The next layers are intentionally separated from the hackathon slice:

- **MVP2 — sharing:** user-created templates, shareable links/files, import previews, thumbnails, compatibility migrations, and optional local persistence.
- **MVP3 — commerce/community:** authorized retailer adapters with provenance and freshness indicators, user catalog imports, community template discovery, collaboration, and explicit purchase handoff. These need separate licensing, security, moderation, storage, and consent designs.

## Trust and limitations

- No authentication, backend, database, cloud room storage, internal chat, retailer API, scraping, checkout, or real-time inventory feed is shipped.
- The room is rectangular; rotations are quarter-turns; fit is geometric and deterministic, not an aesthetic ranking or a full interior-design recommendation.
- 3D is procedural, read-only, and derived from the room; there is no photo scanning, room reconstruction, imported 3D model, physics, or free-angle editing.
- Community uploads and user-published templates are roadmap items, not current behavior.
- Imported HTTPS product URLs are never fetched automatically and are omitted from WebMCP inspection. Imported text is treated as untrusted, and invalid or stale changes fail closed.
- The repository includes automated unit/component and Playwright harness coverage. The exact native WebMCP browser transcript and deployed cold-load proof are still owner-run release gates for this draft.

## Verification and demo

Reviewers can install Node.js `24.9.0` and pnpm `9.15.9`, run the commands in [README.md](../README.md), and follow the [2:40 demo script](demo-script.md). The script covers a human 2D edit, `inspect_room → find_furniture → apply_room_edit`, a visible agent receipt, a human rotation, the synchronized 3D projection, export/template/import, stable IDs, and stale-revision recovery.

The final recording and submission fields are completed only after the owner verifies the exact release commit in the supported native host, authorizes deployment, reviews the public repository, approves the narration, and submits before the official challenge deadline.
