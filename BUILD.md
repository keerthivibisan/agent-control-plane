# Building from source

How to build Agent Control Plane and check it the same way CI does. To run the app, see
[START.md](START.md). Toolchain details and conventions are in
[docs/development.md](docs/development.md).

## Prerequisites

| Tool                    | Version                                      | How to check                                     |
| ----------------------- | -------------------------------------------- | ------------------------------------------------ |
| Node.js                 | 22.x, at least 22.12 (`.nvmrc` pins 22.21.1) | `node --version`                                 |
| pnpm                    | 10.26.x (`packageManager` pins 10.26.1)      | `pnpm --version`                                 |
| git                     | any recent version                           | `git --version`                                  |
| GitHub CLI (`gh`)       | only for the GitHub features, signed in      | `gh auth status`                                 |
| C/C++ build tools       | only if `better-sqlite3` has to compile      | see below                                        |
| Chromium for Playwright | only for the browser end-to-end tests        | `pnpm --filter @acp/web exec playwright install` |

**Node.** With [nvm](https://github.com/nvm-sh/nvm), run this in the repository root:

```bash
nvm use
```

Node 18 and 20 do not work: `engines` and `engine-strict` stop `pnpm install` on any other major
version.

**pnpm.** Some Node installs bundle an older pnpm (8.x, for example). Check `pnpm --version` after
`nvm use`. If it is not 10.26.x, turn on Corepack, which reads the version from `package.json`:

```bash
corepack enable
```

**C/C++ toolchain.** `better-sqlite3` is a native module. When no prebuilt binary matches your
platform and Node version, `pnpm install` compiles it, and that needs:

- **macOS:** the Xcode Command Line Tools (`xcode-select --install`). On macOS arm64 with Node
  22.21.1 it compiled from source (ADR-0001).
- **Linux:** `build-essential` (or your distribution's gcc, g++ and make) and `python3`.
- **Windows:** untested. Nobody has built or run the project on Windows yet.

## Install

```bash
pnpm install
```

CI uses `pnpm install --frozen-lockfile`, which fails instead of changing `pnpm-lock.yaml`. Only
`better-sqlite3` and `esbuild` may run install scripts (`onlyBuiltDependencies` in
`pnpm-workspace.yaml`).

## Build

```bash
pnpm build
```

It builds every package in dependency order:

- `packages/core`, `packages/db`, `packages/adapters/claude-code`, `packages/adapters/demo`,
  `packages/orchestrator` and `packages/server`: TypeScript compiled to each package's `dist/`
  (JavaScript, type declarations and source maps). `packages/db/dist/migrations` holds the SQL
  migrations.
- `packages/web`: the production UI in `packages/web/dist` (`index.html`, `assets/`, `brand/`),
  built by Vite. The server serves this folder when you run the built app (START.md).

You don't need a build for development or tests: workspace packages resolve to their TypeScript
source through the `development` export condition.

## Check everything

```bash
pnpm check
```

It runs, in order and stopping at the first failure:

1. `pnpm format:check` (Prettier);
2. `pnpm lint` (ESLint, type-aware, with the package boundary rules, zero warnings);
3. `pnpm typecheck` (`tsc --noEmit` in every package, including the e2e specs);
4. `pnpm test` (Vitest in every package, about 5,800 tests);
5. `pnpm build`.

Run it before every commit and push.

### One package

```bash
pnpm --filter @acp/core test
```

The same works with `typecheck` or `build`, and with any package name: `@acp/core`, `@acp/db`,
`@acp/adapter-claude-code`, `@acp/adapter-demo`, `@acp/orchestrator`, `@acp/server` or `@acp/web`.
To build one package and the packages it depends on, add `...`:

```bash
pnpm --filter @acp/server... build
```

## Browser end-to-end tests

The Playwright suite in `packages/web/e2e` is **not** part of `pnpm check`. It needs Chromium once:

```bash
pnpm --filter @acp/web exec playwright install chromium
```

Then:

```bash
pnpm --filter @acp/web test:e2e
```

`test:e2e` builds the UI first, then starts its own servers, each with a fresh temporary
`ACP_DATA_DIR`. The demo servers run with `ACP_MODE=demo`; the others use an empty temporary Claude
folder and scripted fake agents. The suite never reads your Claude Code data, never touches your
real database, and never starts the Agent SDK or `claude`.

| Variable                 | Default                     | Used for                                                    |
| ------------------------ | --------------------------- | ----------------------------------------------------------- |
| `ACP_E2E_PORT`           | `7431`                      | the demo server                                             |
| `ACP_E2E_CONTROL_PORT`   | `7441`                      | the control-panel server, plus the next port for its driver |
| `ACP_E2E_WORKSPACE_PORT` | `ACP_E2E_CONTROL_PORT` + 10 | the workspace server, plus the next port for its driver     |
| `ACP_E2E_LOOP_PORT`      | `ACP_E2E_CONTROL_PORT` + 20 | the review-loop server, plus the next port for its driver   |

All servers start for every run, even when you pick one project. If the defaults are taken (for
example by another checkout running the suite), move them:

```bash
ACP_E2E_PORT=7931 ACP_E2E_CONTROL_PORT=7941 pnpm --filter @acp/web test:e2e --project demo
```

That uses ports 7931, 7941–7942, 7951–7952 and 7961–7962. `--project <name>` runs one project; the
names are in `packages/web/e2e/playwright.config.ts`.

### README screenshots

The images in `docs/images/` come from `packages/web/e2e/readme-screenshots.spec.ts`. It has its own
config, so the normal suite never runs it, and it skips unless `ACP_README_SHOTS` is set:

```bash
ACP_README_SHOTS=1 ACP_E2E_PORT=7931 pnpm --filter @acp/web test:e2e -c e2e/readme-screenshots.config.ts
```

It starts only the demo server and overwrites the PNGs in `docs/images/` (1440 pixels wide; the
board, the ticket page, its Agents tab and Files changed also in the dark theme). Everything in
them is sample data: the demo projects and sessions, plus synthetic tickets, runs, workflow,
branches, a connected GitHub repository, skills and token figures served by the spec. Look at every image before you commit it.

## CI

`.github/workflows/ci.yml` runs on Ubuntu with the Node version from `.nvmrc` and pnpm from
`packageManager`: `pnpm install --frozen-lockfile`, then format check, lint, typecheck, test and
build (the same steps as `pnpm check`). A second job, `e2e`, runs the browser tests
(`pnpm --filter @acp/web test:e2e`, Chromium) for `main` only: pull requests into `main` and pushes
to it. The traces of failed tests are kept as a run artifact for 7 days.

It runs by itself only for `main`, `dev`, `dev/*` and `release/*`: on every pull request into one of them,
including pull requests from forks, and on pushes to them that change code (pushes that change only
`docs/**` or Markdown files are skipped). For any other branch,
start it by hand: the Actions tab, **CI**, **Run workflow**, then pick the branch.

## Troubleshooting

**`Unsupported engine` or `ERR_PNPM_UNSUPPORTED_ENGINE` on install.** Node or pnpm is the wrong
version. Run `nvm use`, then check `node --version` (22.x) and `pnpm --version` (10.26.x). If pnpm is
still older, run `corepack enable` and open a new shell.

**`better-sqlite3` fails to build, or the server fails to load it** (for example `Could not locate the
bindings file`, or a `NODE_MODULE_VERSION` mismatch).

- Install the C/C++ toolchain above, then delete `node_modules` and run `pnpm install` again.
- A native module built under another Node version doesn't load. Switch to Node 22 with `nvm use`,
  then delete `node_modules` and reinstall.

**A port is already in use.**

- The server's port is `ACP_PORT` (default 7420); the dev UI is fixed at 5173 (START.md).
- Find what holds a port with `lsof -iTCP:7420 -sTCP:LISTEN` (macOS and Linux).
- For the e2e suite, set `ACP_E2E_PORT` and `ACP_E2E_CONTROL_PORT` to free ports as shown above.

**Playwright says the browser is missing.** Run
`pnpm --filter @acp/web exec playwright install chromium`.
