# @acp/web

**Built in:** work package P1-E (see [docs/history/phase-1-3/implementation-plan.md](/docs/history/phase-1-3/implementation-plan.md)).

**Status:** E0–E5 implemented: Command Center, Session Explorer, session detail (`#/sessions/:id`), usage analytics (`#/usage`), project page (`#/projects/:id`). Checked against the demo server only; no real-data run yet (P1-F).

## Responsibility

React, Vite, and Tailwind UI: Command Center, Session Explorer (React Flow graph and timeline), session detail, usage analytics (Recharts), project workspace. Renders only typed API data, with provenance visible.

The Command Center lists the latest provider snapshot of recent top-level sessions, one row per session, under "cost estimated (provider-reported)": cost uses the estimated style, a missing cost reads "cost unavailable", and there is no total. The Command Center's diagnostics panel shows per-source parse errors, unrecognized record types (unknown, kept as events), each adapter's file issues and its **known, skipped** record types (counted, not stored; ADR-0011) as a separate list, and the server's poll and pipeline counters.

## Redesign (DESIGN.md), in progress

Phase 1, the foundation, is implemented on `wp/ui-foundation`:

- design tokens in `src/index.css` (neutral palette, one accent, light and dark, status and
  token-type colors, type scale, radius);
- all UI wording in `src/lib/copy.ts` (glossary, status words, token-type labels, page
  descriptions, empty states, `describeEvent` for the activity feed);
- shared components in `src/components/` (Card, StatCard, PageHeader, InfoTip, StatusBadge,
  TokenBreakdown, TokenValue, EstimatedCost, ShortId, RelativeTime, EmptyState, Details, DataTable,
  Button);
- the new shell: sidebar with Overview (`#/`), Sessions, Tokens (`#/usage`), Projects (`#/projects`
  and each project underneath), Setup (`#/setup`) and Data health (`#/health`); live-connection dot
  and theme toggle in its footer; a slim "sample data" banner in demo mode.

Phase 2, on `wp/ui-overview`, rewrites three screens (checked against the demo server only):

- **Overview** (`#/`): Running now, Need you and Projects stats; sessions by status; token types
  side by side (never added up); running and waiting session lists; estimated cost per session
  (reported by Claude Code, never summed); recent activity as plain sentences with raw events under
  Technical details. A first-run card points to Setup.
- **Setup** (`#/setup`): three steps: add a project folder (plain validation and server messages),
  add a folder with Claude Code activity in one click, and optional live updates through hooks
  (what they add, the steps, the receiver URL, whether one was received; the app never edits
  Claude Code settings).
- **Data health** (`#/health`): a verdict first, then file problems, damaged lines, known records
  skipped on purpose apart from unknown records, reading counters and capabilities in plain words;
  raw counters under Technical details.

The Tokens, Projects and project pages were redone on `wp/ui-tokens`; the Sessions and session
screens still use the old wording and components.

## Allowed dependencies

`@acp/core` (schemas and types only). Never server, db, or adapter packages. These rules are enforced by `eslint.config.js`.
