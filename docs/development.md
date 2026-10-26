# Development

Conventions for working on the code. The rest lives in one place each:

- **Toolchain, install, commands, the browser tests and CI:** [BUILD.md](../BUILD.md) (Node 22 at
  least 22.12, pnpm 10.26.x, `pnpm check`).
- **Running the app and its configuration** (`ACP_PORT`, `ACP_DATA_DIR`, `ACP_MODE` and the rest):
  [START.md](../START.md#configuration).
- **How to contribute** (branches, commits, pull requests, working with a coding agent):
  [CONTRIBUTING.md](../CONTRIBUTING.md); the binding rules are in [AGENTS.md](../AGENTS.md).

Package scripts exist only where a package has source, so root commands report only what really
runs. Do not add placeholder scripts.

## 1. Standard package layout and scripts

Library packages (`core`, `db`, `orchestrator`, `adapters/*`) follow the pattern of `packages/core`:

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
  `resolve.conditions: ['development', ...]` explicitly when importing workspace packages. Verify
  this with a test that imports the dependency.
- **Build configs resolve to `dist`.** A package that depends on another workspace package sets
  `"customConditions": []` in its `tsconfig.build.json`. Otherwise `tsc` pulls the dependency's `.ts`
  source into the program and fails with "not under rootDir". Root `pnpm build` runs in dependency
  order. For one package, use `pnpm --filter @acp/<name>... build` (the trailing `...` builds its
  dependencies first).
- **Node packages** (`db`, `orchestrator`, `adapters/*`, `server`) set `"types": ["node"]` in
  `tsconfig.json`. `core` keeps `"types": []`.
- **Server:** dev runs `node --conditions=development --import tsx src/main.ts`. Build compiles with
  `tsc` to `dist`, and production runs on the built `dist` of the workspace libraries.
- **Web:** Vite dev server on port 5173, which proxies `/api` to the server. The production build is
  served by the server.

## 2. TypeScript conventions

- ESM everywhere (`"type": "module"`). Node packages use `module`/`moduleResolution: NodeNext`, so
  **relative imports end in `.js`**. The web package uses `Bundler` resolution.
- `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, and `verbatimModuleSyntax` are
  on. Use `import type` for types.
- No `any`. Parse unknown data with Zod at every boundary: files, HTTP, hooks, database JSON columns.
- `@acp/core` has `types: []`: no Node or DOM globals, because both the server and the browser
  import it.
- Inject clocks (`now: () => Date`), id generators and file-system access so logic can be tested.

## 3. Pinned versions and why

| Choice                                                                                                                                          | Reason                                                                                   |
| ----------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| TypeScript **6.0.3** (not 7.x)                                                                                                                  | `typescript-eslint@8.71` supports `<6.1.0` only (ADR-0001)                               |
| jsdom **29.1.1** (not 30)                                                                                                                       | jsdom 30 requires Node at least 22.22.2                                                  |
| Vite 8.3.4, Vitest 5.0.3, React 19.3.0, Tailwind 4.3.3, @xyflow/react 12.12.0, Recharts 3.10.1, Express 5.3.0, better-sqlite3 13.0.3, Zod 4.6.5 | current stable versions, compatible with Node 22.12 and later; peers verified at install |

Dependency changes touch the shared lockfile, so they go in a pull request of their own and need a
maintainer's review (AGENTS.md §5).

## 4. Testing rules

- Every behaviour has a test in the same change. Never write empty or placeholder tests.
- Tests never read the real `~/.claude`. Use `test-fixtures/` or temp directories (`fs.mkdtemp`).
  Fixtures are synthetic or sanitized
  ([test-fixtures/claude-code/README.md](../test-fixtures/claude-code/README.md)).
- Database tests use a temp-file database per test (not just `:memory:`, so WAL and migrations are
  exercised).
- No test depends on the wall clock or the network.
- Each scenario in [usage-accounting.md §7](usage-accounting.md#7-required-failure-scenarios) has a
  named test.
- Managed runs are tested with fake agents (`tests/managed/fake-query.ts` in the Claude Code
  adapter, a fake managed adapter in the server tests) and real git in temp repositories, never
  with the real `claude`.
- Safety guarantees have adversarial tests: [testing/adversarial.md](testing/adversarial.md).
- The browser end-to-end suite (Playwright, `packages/web/e2e`) runs against servers in demo mode
  or with scripted fake agents and temp data folders
  ([BUILD.md](../BUILD.md#browser-end-to-end-tests)).
- A real run against Claude Code is never part of the test suite. When one is needed, it uses a
  throwaway repository and data folder, runs only with a maintainer's agreement, and is written up
  with aggregates only in [research/](research/).
