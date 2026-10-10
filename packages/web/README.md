# @acp/web

**Owner:** work package P1-E (see [docs/implementation-plan.md](/docs/implementation-plan.md)).

**Status:** E0–E5 implemented: Command Center, Session Explorer, session detail (`#/sessions/:id`), usage analytics (`#/usage`), project page (`#/projects/:id`). Checked against the demo server only; no real-data run yet (P1-F).

## Responsibility

React, Vite, and Tailwind UI: Command Center, Session Explorer (React Flow graph and timeline), session detail, usage analytics (Recharts), project workspace. Renders only typed API data, with provenance visible.

## Allowed dependencies

`@acp/core` (schemas and types only). Never server, db, or adapter packages. These rules are enforced by `eslint.config.js`.
