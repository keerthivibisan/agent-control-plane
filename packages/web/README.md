# @acp/web

The Agent Control Plane web UI: a React 19 single-page app built with Vite and Tailwind. It is
project-first: you pick a project, then every page (board, tickets, workflow, skills, harness,
tokens, sessions, settings) is about that project. It renders only typed data from the local
`@acp/server` REST API and keeps provenance visible: a missing value reads "Not reported", never 0,
and provider-reported cost is always shown as an estimate.

## What it contains

| Path                | What is there                                                        |
| ------------------- | -------------------------------------------------------------------- |
| `src/main.tsx`      | entry point: theme, a `QueryStore` over `createApiClient()`, `<App>` |
| `src/app/`          | the shell: `App.tsx` (route to screen), sidebar, top bar, redirects  |
| `src/lib/`          | router, API client, query store, live updates, theme, `copy.ts`      |
| `src/components/`   | shared building blocks, including the diff viewer in `diff/`         |
| `src/features/<x>/` | one folder per page or part of a page (below)                        |
| `DESIGN.md`         | the design brief; read it before changing a screen                   |

## Pages and addresses

Routing is hash-based with no router dependency (`src/lib/router.ts`: `parseRoute`, `href`,
`useRoute`). `#/` opens the last used project's board, or All projects when there is none. The
project pages are listed once, in sidebar order, in `src/app/project-pages.ts` (`PROJECT_PAGES`),
which feeds both the sidebar and the palette.

| Address                            | Page                                    | Feature folder    |
| ---------------------------------- | --------------------------------------- | ----------------- |
| `#/projects`                       | All projects: project cards, activity   | `all-projects`    |
| `#/projects/new`                   | New project wizard                      | `project-setup`   |
| `#/p/:id/board`                    | tickets in columns by stage, New ticket | `board`           |
| `#/p/:id/tickets/:ticketId?tab=…`  | the ticket page (below)                 | `ticket`          |
| `#/p/:id/workflow`                 | the workflow graph editor and defaults  | `workflow`        |
| `#/p/:id/skills`, `…/skills/:name` | Skills & Agents (`?tab=agents`)         | `skills`          |
| `#/p/:id/harness`                  | status, checks, setup, runs on main     | `harness`         |
| `#/p/:id/tokens`                   | token use over a range                  | `tokens`          |
| `#/p/:id/sessions`                 | Sessions explorer (graph, timeline)     | `sessions`        |
| `#/sessions/:id`                   | one session                             | `session-detail`  |
| `#/p/:id/settings`                 | project settings, code host, branching  | `project-setup`   |
| `#/p/:id/runs/:runId`              | a run without a ticket: chat, approvals | `control`         |
| `#/health`, `#/health/connection`  | Data health and Connection (hooks)      | `health`, `setup` |

Every older address (`#/usage`, `#/sessions`, `#/setup`, `#/control`, `#/board`, …) parses to a
`legacy` route and redirects to its new home (`src/app/redirects.ts`), so old links keep working.

**Ticket page.** Tabs modelled on a GitHub pull request, chosen by the `tab` query
(`features/ticket/ticket-tabs.ts`): Comments (the default, with the plan under review and
attachments), Agents (the run's live workflow graph), Files changed (`features/review`: file tree,
side-by-side diff, line comments, Review changes), Checks, and Conversation (the timeline). The
review loop's parts (the Start dialog and run options, change cards, the ticket branch card and the
final step) are in `features/review-loop`; pull request, merge and branch parts in
`features/branching`.

**Workflow editor.** `features/workflow/editor/GraphEditor.tsx` draws the project's graph with React
Flow (`@xyflow/react`): a palette of blocks, node and link panels, an issues list and templates.
Linking blocks: a connector on every side of a block (`nodes.tsx`); a dropped link snaps onto a
valid block within `SNAP_RADIUS` (`linking.ts`); click a connector, then a block; the "Link to…"
menu (`LinkMenu.tsx`); drag a link's end to reconnect it; Undo and Redo (`history.ts`, at most
`HISTORY_LIMIT` steps); Tidy layout (`layout.ts`). Whether a link may exist is always core's rule,
so every way of linking makes only links the server accepts. Leaving with unsaved changes asks
first (`useUnsavedGuard.ts`).

**Shell.** ⌘K (Ctrl+K) opens the command palette (`features/palette`): jump to a project, a page or
a ticket by key, New ticket, Run checks. The top bar has the project switcher, the breadcrumbs and
the theme menu (Light, Dark, System). In demo mode (`ACP_MODE=demo`) a "sample data" banner shows on
every page (`components/DemoBanner.tsx`).

## Data and live updates

- **API client** (`src/lib/api.ts`): `createApiClient()` plus typed helpers per area. Every
  response is parsed with a Zod schema from `@acp/core/api`; a body that does not match the contract
  is an `ApiError` of kind `parse`, never swallowed, and error bodies are read with
  `ErrorDtoSchema`. Every mutation (POST, PUT, PATCH, DELETE) sends the CSRF token in the
  `X-ACP-CSRF` header (`CSRF_HEADER`); a 403 fetches a fresh token and retries once.
- **Queries** (`src/lib/query-store.ts`, `query.tsx`): a small cache keyed by API path;
  `useApiQuery(path, schema)` reads it.
- **Live updates** (`src/lib/useEventStream.ts`): one `EventSource` on the server's event stream.
  Notices carry ids only and are checked with `StreamNoticeDtoSchema`; `invalidation.ts` decides
  which cached paths are stale, and the UI refetches them over REST. It reconnects with capped
  backoff and refetches everything after an interruption.
- **Words** (`src/lib/copy.ts`): every label, status word, glossary tip and empty state. Screens
  import their text from it instead of writing their own.

## Running and testing

- Dev: `pnpm dev` from the repo root starts the server on `127.0.0.1:7420` and Vite on
  `127.0.0.1:5173` (strict port), which forwards `/api` to the server. See
  [START.md](../../START.md) and [BUILD.md](../../BUILD.md).
- Unit and component tests: `pnpm --filter @acp/web test` (Vitest in jsdom with Testing Library;
  `tests/**/*.test.{ts,tsx}`, setup in `tests/setup.ts`, synthetic data in `tests/fixtures/`).
- Browser tests: `pnpm --filter @acp/web test:e2e` (Playwright, `e2e/playwright.config.ts`). It
  builds the UI, then starts its own servers, each with a fresh temporary `ACP_DATA_DIR`: a demo
  server (`ACP_E2E_PORT`, default 7431) and servers with scripted fake agents
  (`ACP_E2E_CONTROL_PORT`, default 7441, and that port +10 and +20). Many specs answer routes from
  synthetic fixtures. It never reads Claude Code data and never starts the Agent SDK or `claude`.
  It is not part of `pnpm check` and needs Chromium once; see [BUILD.md](../../BUILD.md).

## Dependency rules

Among workspace packages the web package imports only `@acp/core` (schemas, types and pure logic,
including the `@acp/core/api` subpath); `eslint.config.js` forbids `@acp/db`, `@acp/server`,
`@acp/adapter-*` and `@acp/orchestrator`. It runs in the browser, so `src/` uses no Node APIs (the
app tsconfig is DOM only; only `e2e/` has Node types).

## Read next

- [DESIGN.md](DESIGN.md): the design brief, binding for every screen
- [docs/architecture.md](../../docs/architecture.md): packages, live updates, managed runs,
  workflow graphs, the review loop
- [docs/domain-model.md](../../docs/domain-model.md), [docs/security.md](../../docs/security.md)
- ADRs: [0007 demo isolation](../../docs/decisions/0007-event-provenance-and-demo-isolation.md),
  [0013 guardrails and CSRF](../../docs/decisions/0013-managed-execution-guardrails.md),
  [0021 review loop](../../docs/decisions/0021-approval-modes-review-loop-ticket-branch.md),
  [0023 workflow graphs](../../docs/decisions/0023-editable-workflow-graphs.md),
  [0025 GitHub and branching](../../docs/decisions/0025-code-hosting-and-branching.md),
  [0026 comments, attachments](../../docs/decisions/0026-comments-conversation-and-attachments.md),
  [0028 effort and Finish](../../docs/decisions/0028-agent-effort-optional-checks-finish-block.md)
