# Phase 4 status (coordinator-maintained)

> Only the coordinator edits this file, when a WP is merged or a wave starts. Agents record their
> progress in `docs/phase-4/wp/<WP>.md` (README §9).

| WP   | Title                                                        | Depends           | Status | Branch                  | Merged |
| ---- | ------------------------------------------------------------ | ----------------- | ------ | ----------------------- | ------ |
| P4-0 | [Contracts, ADRs and core logic](wp/P4-0.md)                 | owner approval    | todo   | `wp/p4-0-contracts`     | —      |
| P4-A | [Engine: plan phase, limits, depth 2, allowlist](wp/P4-A.md) | P4-0              | todo   | `wp/p4-a-engine`        | —      |
| P4-B | [Database: migration 0003 and repositories](wp/P4-B.md)      | P4-0              | todo   | `wp/p4-b-db`            | —      |
| P4-C | [Harness: manifest, context files, check runner](wp/P4-C.md) | P4-0              | todo   | `wp/p4-c-harness`       | —      |
| P4-I | [Adapter: context, nested helpers, submit_plan](wp/P4-I.md)  | P4-0              | todo   | `wp/p4-i-adapter`       | —      |
| P4-E | [Board UI](wp/P4-E.md)                                       | P4-0              | todo   | `wp/p4-e-board`         | —      |
| P4-F | [Project wizard and settings UI](wp/P4-F.md)                 | P4-0              | todo   | `wp/p4-f-project-setup` | —      |
| P4-D | [Server wiring](wp/P4-D.md)                                  | P4-A, B, C, I     | todo   | `wp/p4-d-server`        | —      |
| P4-G | [Ticket page UI](wp/P4-G.md)                                 | P4-0 (DTOs); P4-D | todo   | `wp/p4-g-ticket`        | —      |
| P4-H | [Verification](wp/P4-H.md)                                   | P4-D, E, F, G     | todo   | `wp/p4-h-verify`        | —      |

**Current wave (2026-10-13):** wave 1 — P4-A, P4-B, P4-C, P4-I, P4-E, P4-F.

**Waves:** P4-0 → (P4-A, P4-B, P4-C, P4-I, P4-E, P4-F in parallel) → P4-D (+ P4-G from P4-0) → P4-H.
