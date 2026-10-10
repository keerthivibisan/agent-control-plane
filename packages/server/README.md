# @acp/server

**Owner:** work package P1-D (see [docs/implementation-plan.md](/docs/implementation-plan.md)).

**Status:** **Not implemented.** Dependencies are pinned.

## Responsibility

Composition root: config, ingestion pipeline (validate → dedupe → persist → project → publish), scheduler, REST API, SSE, hook receiver, and static UI serving. Layering: `routes → services → repositories`.

## Allowed dependencies

`@acp/core`, `@acp/db`, both adapters, `express`, `zod`. Never `@acp/web`. These rules are enforced by `eslint.config.js`.
