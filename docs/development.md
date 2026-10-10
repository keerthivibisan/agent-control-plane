# Development

## 1. Requirements

| Tool            | Version                                          | Notes                                                                                                                    |
| --------------- | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| Node.js         | **22.x, at least 22.12** (`.nvmrc` pins 22.21.1) | `engines` and `engine-strict` reject other majors. Node 18 and 20 do not work                                            |
| pnpm            | **10.26.x** (`packageManager`)                   | Run `corepack enable` under Node 22, or install pnpm 10. Some Node installs bundle an older pnpm; check `pnpm --version` |
| C/C++ toolchain | Xcode CLT (macOS), `build-essential` (Linux)     | `better-sqlite3` builds from source when no prebuilt binary matches                                                      |
| Claude Code     | optional                                         | Needed only for real-data runs. Tests never need it                                                                      |

```bash
nvm use
```

```bash
corepack enable
```

```bash
pnpm install
```

## 2. Commands (root)

| Command                             | Does                                                                      | Current scope |
| ----------------------------------- | ------------------------------------------------------------------------- | ------------- |
| `pnpm test`                         | `vitest run` in every package that defines `test`                         | `@acp/core`   |
| `pnpm typecheck`                    | `tsc --noEmit` per package                                                | `@acp/core`   |
| `pnpm lint`                         | ESLint (type-aware, plus boundary rules) on the whole repo, zero warnings | whole repo    |
| `pnpm format` / `pnpm format:check` | Prettier                                                                  | whole repo    |
| `pnpm build`                        | builds each package with a `build` script                                 | `@acp/core`   |
| `pnpm check`                        | runs all of the above in order (the same as CI)                           |               |
| `pnpm dev`                          | **does not exist yet.** It will be added by P1-D (server) and P1-E (web)  | —             |

Package scripts are added by the work package that lands the package's first source file. **A package
without source has no `test`, `typecheck`, or `build` script**, so root commands report only what really
runs. Do not add placeholder scripts.

## 3. Standard package layout and scripts

Library packages (`core`, `db`, `adapters/*`) follow the pattern of `packages/core`:

```
package.json   exports: { ".": { development: ./src/index.ts, types: ./dist/index.d.ts, default: ./dist/index.js } }
tsconfig.json        extends ../../tsconfig.base.json (or ../../../ for adapters), noEmit, include src + tests
tsconfig.build.json  rootDir src, outDir dist
src/index.ts         public API (only exports here are public)
tests/**/*.test.ts   vitest
```

Scripts: `"build": "tsc -p tsconfig.build.json"`, `"typecheck": "tsc -p tsconfig.json --noEmit"`,
`"test": "vitest run"`.

- **The `development` export condition** lets TypeScript (`customConditions` in the base tsconfig),
  Vite, and Vitest resolve workspace packages to their TypeScript source. You don't need to build
  dependencies first. In package `vitest.config.ts` and `vite.config.ts`, set
  `resolve.conditions: ['development', ...]` explicitly when importing workspace packages.
- **Server:** dev runs `node --conditions=development --import tsx src/main.ts`. Build compiles with
  `tsc` to `dist`, and production runs on the built `dist` of the workspace libraries.
- **Web:** Vite dev server on port 5173, which proxies `/api` to the server. The production build is
  served by the server.

## 4. TypeScript conventions

- ESM everywhere (`"type": "module"`). Node packages use `module`/`moduleResolution: NodeNext`, so
  **relative imports end in `.js`**. The web package uses `Bundler` resolution.
- `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, and `verbatimModuleSyntax` are
  on. Use `import type` for types.
- No `any`. Parse unknown data with Zod at every boundary: files, HTTP, hooks, database JSON columns.
- `@acp/core` has `types: []`: no Node or DOM globals, because both the server and the browser import it.

### Pinned versions and why

| Choice                                                                                                                                          | Reason                                                                                   |
| ----------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| TypeScript **6.0.3** (not 7.x)                                                                                                                  | `typescript-eslint@8.71` supports `<6.1.0` only (ADR-0001)                               |
| jsdom **29.1.1** (not 30)                                                                                                                       | jsdom 30 requires Node at least 22.22.2                                                  |
| Vite 8.3.4, Vitest 5.0.3, React 19.3.0, Tailwind 4.3.3, @xyflow/react 12.12.0, Recharts 3.10.1, Express 5.3.0, better-sqlite3 13.0.3, Zod 4.6.5 | current stable versions, compatible with Node 22.12 and later; peers verified at install |

Only the coordinator adds or upgrades dependencies, because it changes the shared lockfile
(AGENTS.md §5).

## 5. Runtime configuration (planned, P1-D)

| Env                                           | Default                                | Meaning                                         |
| --------------------------------------------- | -------------------------------------- | ----------------------------------------------- |
| `ACP_PORT`                                    | `7420`                                 | server port (binds 127.0.0.1)                   |
| `ACP_DATA_DIR`                                | `~/.agent-control-plane`               | database, hook token                            |
| `ACP_CLAUDE_DIR`                              | `$CLAUDE_CONFIG_DIR`, else `~/.claude` | Claude data root (read-only)                    |
| `ACP_MODE`                                    | `live`                                 | `live`, or `demo` (demo adapter, `demo.sqlite`) |
| `ACP_POLL_INTERVAL_MS`                        | `5000`                                 | transcript scan interval                        |
| `ACP_ACTIVE_WINDOW_MS` / `ACP_STALE_AFTER_MS` | `120000` / `1800000`                   | status thresholds                               |

## 6. Testing rules

- Every package with source has tests. Never write empty or placeholder tests.
- Tests never read the real `~/.claude`. Use `test-fixtures/` or temp directories (`fs.mkdtemp`).
- Database tests use a temp-file database per test (not just `:memory:`, so WAL and migrations are
  exercised).
- Each scenario in [usage-accounting.md §7](usage-accounting.md#7-required-failure-scenarios) has a
  named test.
- Run e2e tests (Playwright, P1-F) against the server in demo mode. Real-data verification is a
  documented manual procedure (P1-F).

## 7. CI

`.github/workflows/ci.yml` runs on Ubuntu with the Node version from `.nvmrc` and pnpm from
`packageManager`. Steps: `pnpm install --frozen-lockfile`, then format check, lint, typecheck, test,
and build.
