# Documentation

Start with the [architecture](architecture.md). Running the app is in [START.md](../START.md),
building and testing it in [BUILD.md](../BUILD.md), and contributing in
[CONTRIBUTING.md](../CONTRIBUTING.md).

See the [KT guide](knowledge-transfer/README.md) for a guided architecture tour and
[branching and releases](../BRANCHING.md) for contribution targets and release preparation.

## Specs (current)

| Document                                                 | What it covers                                                                   |
| -------------------------------------------------------- | -------------------------------------------------------------------------------- |
| [architecture.md](architecture.md)                       | packages, dependency directions, observation, managed runs, workflows, the guard |
| [domain-model.md](domain-model.md)                       | sessions, agent runs, edges, usage and provenance                                |
| [usage-accounting.md](usage-accounting.md)               | event deduplication and token accounting rules (binding)                         |
| [provider-adapters.md](provider-adapters.md)             | the Claude Code adapter, its file allowlist and observed provider behaviour      |
| [orchestration-lifecycle.md](orchestration-lifecycle.md) | run and agent states, the review loop and the ticket branch                      |
| [security.md](security.md)                               | threat model, rules, data at rest, what managed runs may do                      |
| [development.md](development.md)                         | package layout, TypeScript conventions, pinned versions, testing rules           |
| [testing/adversarial.md](testing/adversarial.md)         | the adversarial safety suite and how to extend it                                |
| [roadmap.md](roadmap.md)                                 | phases, what is done and what is planned                                         |

## Decisions and evidence

- [decisions/](decisions/README.md): the architecture decision records (ADR-0001 to ADR-0029).
  Accepted ADRs are binding; a new decision starts from
  [0000-template.md](decisions/0000-template.md).
- [research/](research/): dated notes on observed Claude Code behaviour and real runs, aggregates
  only.

## Releases and history

- [releases/0.4.0.md](releases/0.4.0.md): the reviewed 0.4.0 candidate scope and upgrade notes;
  [CHANGELOG.md](../CHANGELOG.md) records version history.
- [v0.3.1/](v0.3.1/README.md): the historical 0.3.1 implementation plan.
- [v0.3.2/](v0.3.2/README.md): the unimplemented restart-rework proposal, originally assigned
  that version; it is not part of 0.4.0.
- [history/](history/README.md): the plans of earlier series, kept for provenance: how the app was
  built with coding agents.
- [images/](images/) and [brand/](brand/): the README screenshots (demo data only) and the logo
  files.
