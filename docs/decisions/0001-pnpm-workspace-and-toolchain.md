# ADR-0001: pnpm workspace and pinned toolchain

- **Status:** accepted
- **Date:** 2026-10-10

## Context

The project has several packages (core, db, adapters, server, web) that must share types and be built
and tested together. Several agents will work in parallel, and a shared lockfile is the main merge
hazard. The machine's default Node was 18.16, which is too old for current Vite and Vitest. Node 22.21.1
and pnpm 10.26.1 were available.

## Decision

- Use a pnpm workspace with globs `packages/*` and `packages/adapters/*`. Package scope is `@acp/`.
- Node `>=22.12 <23` (`.nvmrc` 22.21.1) and pnpm 10.26.x via `packageManager`, with `engine-strict`.
- Pin all dependencies exactly (`save-exact`). P0 pre-declared every Phase 1 dependency in each
  package manifest, so the lockfile is settled before parallel work. Only the coordinator changes
  dependencies or the lockfile.
- **TypeScript 6.0.3, not 7.x:** `typescript-eslint@8.71.1` declares `typescript >=4.8.4 <6.1.0`.
  **jsdom 29.1.1, not 30:** jsdom 30 requires Node `^22.22.2`.
- Install scripts are allowed only for `better-sqlite3` and `esbuild` (`onlyBuiltDependencies`).
- Libraries export TypeScript source under a `development` condition and `dist` otherwise. No build is
  needed for development or tests.

## Alternatives considered

- npm/yarn workspaces: pnpm's strictness (no phantom dependencies) and speed suit a multi-package repo.
- Turborepo/Nx: unnecessary at six packages. `pnpm -r` is enough.
- TypeScript 7 (native): blocked by lint tooling compatibility. Revisit when typescript-eslint
  supports it.

## Consequences

- Contributors need Node 22 and pnpm 10. Some Node installs bundle an older pnpm; development.md says
  how to check.
- `better-sqlite3` compiled from source on macOS arm64 / Node 22.21.1 (no prebuilt binary used), so a
  C++ toolchain is required.

## Amendment 2026-10-18: why TypeScript

The ADR chose the toolchain but never stated the language. This records it (owner-approved).

### Decision

TypeScript (strict, ESM) on Node 22 for every package, from the database layer to the browser.

### Reasons

- **The Agent SDK is TypeScript.** Claude Code and the Claude Agent SDK are TypeScript/Node, so
  managed runs (ADR-0012) use the SDK in its own language, with typed options such as the
  permission mode and the sandbox settings.
- **One language from the database to the browser.** `@acp/core` holds the Zod contracts and the
  pure logic once; the server, the adapters and the React web app share them. For example, the
  workflow-graph validator runs live in the editor and again on the server, so the two cannot
  disagree.
- **Static types plus runtime validation.** Zod gives both at every boundary: transcripts, HTTP,
  hooks and database JSON.
- **Safe parallel work.** Many packages are built by many agents at once. With strict typing, a
  contract change fails the typecheck wherever it is used.
- **Local-first distribution.** The app is one Node process with Express and SQLite on 127.0.0.1.
  Claude Code users already have Node.

### Alternatives considered

- **Python:** an Agent SDK exists, but the UI would still be TypeScript, so the contracts would be
  written twice.
- **Go or Rust:** one binary to distribute, but no shared contracts with the UI, and the Agent SDK is
  not native there.

### Consequences

- Node 22 is required.
- `better-sqlite3` needs a C++ toolchain on machines where no prebuilt binary matches.
- A single-binary download could be revisited later.
