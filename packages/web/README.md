# @acp/web

**Owner:** work package P1-E (see [docs/implementation-plan.md](/docs/implementation-plan.md)).

**Status:** E0–E5 implemented: Command Center, Session Explorer, session detail (`#/sessions/:id`), usage analytics (`#/usage`), project page (`#/projects/:id`). Checked against the demo server only; no real-data run yet (P1-F).

## Responsibility

React, Vite, and Tailwind UI: Command Center, Session Explorer (React Flow graph and timeline), session detail, usage analytics (Recharts), project workspace. Renders only typed API data, with provenance visible.

The Command Center lists the latest provider snapshot of recent top-level sessions, one row per session, under "cost estimated (provider-reported)": cost uses the estimated style, a missing cost reads "cost unavailable", and there is no total. The Command Center's diagnostics panel shows per-source parse errors, unrecognized record types (unknown, kept as events), each adapter's file issues and its **known, skipped** record types (counted, not stored; ADR-0011) as a separate list, and the server's poll and pipeline counters.

## Allowed dependencies

`@acp/core` (schemas and types only). Never server, db, or adapter packages. These rules are enforced by `eslint.config.js`.
