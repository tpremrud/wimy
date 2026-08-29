# Wimy

Wimy (“What's in my room?”) is an agent-verifiable room decision environment for fitting, finding, placing, and sharing furniture layouts.

The hackathon MVP is currently being built. Its approved scope and execution contract are documented in:

- [MVP design](docs/superpowers/specs/2026-08-29-wimy-mvp-design.md)
- [Implementation plan](docs/superpowers/plans/2026-08-29-wimy-mvp.md)
- [Domain language](CONTEXT.md)

Local research, raw handoff material, and execution evidence live in the ignored `.docs/` directory and are intentionally not part of the public repository.

## Local development

Requires Node.js 24.9.0 and pnpm 9.15.9.

```bash
pnpm install
pnpm exec playwright install chromium
pnpm dev
```

`pnpm exec playwright install chromium` explicitly installs the Chromium browser build used by Playwright.

## Verification

```bash
pnpm typecheck
pnpm lint
pnpm test -- --run
pnpm build
```

The explicit `--` forwards `--run` to Vitest. Without that separator, `pnpm test --run` is rejected by pnpm 9.15.9 as an unsupported pnpm CLI option.

## E2E foundation

Playwright is configured, and the Local development command installs Chromium. REL-81 does not add browser-flow specs, so this command reports that no tests were found until a later implementation slice adds them:

```bash
pnpm test:e2e
```

REL-81 establishes the frontend and quality foundation only. WebMCP behavior is not implemented in REL-81.
