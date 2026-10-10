# ADR-0002: Modular monolith with enforced dependency directions

- **Status:** accepted
- **Date:** 2026-10-10

## Context

The product is local-first and runs on one developer machine. The brief explicitly rejects
microservices, Kafka, and Neo4j unless a requirement justifies them. Several agents will build
separate modules in parallel, so the boundaries must be mechanical, not just conventions.

## Decision

- There is one server process. Modules are workspace packages. The dependency rules are in
  docs/architecture.md §2 and are enforced by `no-restricted-imports` in `eslint.config.js`.
- `@acp/core` is pure and runtime-agnostic (`types: []`).
- Adapters never import `@acp/db` and never write state. The server is the only composition root.
- Inside the server: `routes → services → repositories`. Route handlers hold no business logic.

## Alternatives considered

- Separate ingestion daemon and API services: more moving parts and IPC for no Phase 1 benefit.
- Putting everything in one package: boundaries could not be enforced, and parallel work would collide.

## Consequences

- Changing a dependency direction requires a new ADR and an update to the lint config.
- Postgres or a separate worker can be introduced later behind the repository layer if shared
  deployments require them.
