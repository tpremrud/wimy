# Wimy demo script (2:40 target)

**Status:** recording draft for the local release candidate. The sequence below is an operator script, not evidence that a deployed URL or a native WebMCP browser run has already been captured.

## Preflight

Use the exact release commit in a clean checkout. The owner supplies the host and final links; keep those fields explicit until verified.

```text
Project URL: [OWNER: add the approved deployed URL after REL-91]
Repository URL: [OWNER: add the public repository URL after REL-93]
Video URL: [OWNER: add the public sub-three-minute video after REL-94]
Browser: [OWNER: record the supported native WebMCP browser and version]
```

For a local rehearsal, install dependencies and run the static gates from the README, then start the Vite app with `pnpm dev`. For the agent portion, open the exact app in a supported WebMCP host and confirm the header says `WebMCP ready — 3 tools registered`. The app also works without that host, but that fallback is a human/file path rather than a WebMCP proof.

Start from the built-in **Living Room** at revision 1. Keep the browser viewport wide enough to show the catalog, room, and activity rails. Have a blank `.wimy` download location ready; no account or server-side room is needed.

## Timed narration and actions

### 0:00–0:15 — human starts in 2D

**Action:** In the primary 2D editor, drag the **Linen Apartment Sofa** a short distance to a clear, in-bounds position and release. Select it if needed so its coordinates are visible.

**Say:**

> Wimy is a shared room decision workspace. I start with a real, editable 2D plan: room dimensions, openings, item identities, and furniture poses are visible in meters. A human can make one bounded change, and the browser agent can work on the same room.

**Show:** the room revision increasing by one and a `Human: Accepted.` receipt. Keep the actual resulting coordinates on screen; the geometry check, not a memorized pixel position, is the contract.

### 0:15–1:30 — agent inspects, finds, and places

**Action:** Ask the browser agent:

> Inspect the current Wimy room. Find one chair with the `warm-modern` style tag priced at no more than 600 USD that fits the current room. Apply the first suggested pose using the revision you inspected. Report the product ID, placed-item ID, and new revision.

**Expected tool sequence:**

1. `inspect_room({})` reads the current revision, meter dimensions, openings, placed items, coordinate convention, and warnings. The room and receipt list do not change.
2. `find_furniture({ category: "chair", styleTags: ["warm-modern"], maxPrice: 600, limit: 1 })` reads the local fictional catalog and returns **Ember Nest Chair** (`ember-nest-chair`) first, with its dimensions, fictional price snapshot, and a legal suggested pose. The room and revision still do not change.
3. `apply_room_edit({ expectedRevision, operations: [{ type: "add", productId, pose: suggestedPose }] })` adds one placed item through the shared transaction seam. Wimy generates the item ID, checks bounds/collision/door clearance, increments the revision once, and publishes an agent receipt.

**Say:**

> The agent is not clicking a mystery button or inventing a second scene. It reads the canonical room, searches explicit constraints, and submits an exact placement against the revision it saw. Wimy validates the operation and gives the new placed-item identity back to the human UI.

**Show:** the new chair in 2D, the `Agent: Accepted.` receipt, the generated `item_…` ID if the inspector exposes it, and the changed revision. If the search returns no match in a different starting room, narrate the bounded no-fit result and restore Living Room before continuing.

### 1:30–1:55 — human adjustment and derived 3D

**Action:** Select **Ember Nest Chair**, use **Rotate 90°**, then choose **Preview in 3D**.

**Say:**

> I remain in control. The human edit is another checked transaction, and the 3D view is a read-only projection of the same committed room—not a second editable model.

**Show:** the new `Human: Accepted.` receipt, the 3D room summary, the procedural scene, and the placed-item list with the same chair name, coordinates, and rotation. Orbit the camera only if it helps the judge see the scene; orbiting never changes the room. If WebGL is unavailable, show the honest room summary and item list and keep the 2D path available.

### 1:55–2:20 — export, replace, and restore without an account

**Action:** Choose **Export .wimy**, then load **Blank Room**, then import the downloaded `.wimy` file.

**Say:**

> The room is also a portable artifact. This `.wimy` file is versioned, human-readable JSON: it carries dimensions, openings, stable placed-item IDs, poses, and embedded furniture snapshots. It does not carry my runtime revision, receipts, prompts, or account data. I can replace a blank room and restore the same layout without signing in.

**Show:** the Blank Room revision, the imported room revision, the restored IDs/poses in the 2D item list, and the `Import: Accepted.` receipt. A catalog reference that is unavailable after import remains renderable from its embedded snapshot and is shown as a catalog warning.

### 2:20–2:40 — trust, concurrency, and implementation proof

**Action:** If time permits, intentionally reuse the pre-adjustment revision in a second `apply_room_edit` call. Show `REVISION_CONFLICT`, then call `inspect_room` and retry with the current revision. Finish by showing the tool names or the repository files and the local verification output.

**Say:**

> There is one transaction seam for the human, the agent, templates, import, undo, 2D, and 3D projections. A stale agent request is rejected instead of silently overwriting the human's newer work. The agent surface is exactly three tools: inspect, find, and apply. The catalog is fictional and local, and imported text is treated as untrusted; Wimy never fetches a stored product URL automatically.

**Show:** the stale failure and successful fresh retry when the host is available, plus the current static-gate output. The repository's Playwright specs are a harness for the flows; a local test result and a native WebMCP transcript are recorded separately. Use only evidence captured against the exact release commit.

### 2:40–2:45 — close

**Say:**

> Wimy makes room planning a concrete, reversible conversation between a person and an agent: fit the geometry, choose an option, place it, and carry the room forward as a portable file. Community templates and licensed live catalogs are the next steps.

## Pass criteria

- The human editor visibly changes the same room the agent later inspects.
- `inspect_room` and `find_furniture` are read-only; `apply_room_edit` changes one expected revision atomically.
- The agent result is visible as a receipt and as a placed item in 2D; the same item appears in the read-only 3D projection.
- Export → Blank Room → import restores the room content and document-scoped item IDs without authentication.
- A stale `expectedRevision` produces `REVISION_CONFLICT`, and a fresh inspect/retry succeeds when the host is available.
- The recording identifies the local fictional catalog and labels any missing deployment/native evidence as owner-gated rather than implying a live retailer or already-proven browser run.
