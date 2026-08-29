---
status: accepted
---

# Use versioned JSON for portable Wimy files

A Wimy File is UTF-8 JSON with an explicit schema version, local instance identities, catalog references, and embedded furniture snapshots. A custom Markdown-like language, YAML, and reference-only exports were rejected for MVP1 because JSON is safe to validate in the browser, round-trips without a bespoke parser, and keeps rooms usable when catalog data changes.
