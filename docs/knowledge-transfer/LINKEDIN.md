# LinkedIn draft — publish manually after hosting is verified

We are building Agent Control Plane (ACP), a local-first workspace for coordinating AI coding
agents around projects and tickets.

The design separates four jobs: agents propose work, a deterministic engine authorizes actions,
the server prepares isolated workspaces and performs Git operations, and provider adapters enforce
role-specific tools. Review and verification evidence are separate from an agent saying it finished.

Our latest architecture guide explains that boundary, configurable workflows, conflict recovery
and the tradeoffs behind autonomous delivery. It also covers a less obvious scaling problem:
multiple agents can repeatedly rediscover the same repository, or spend tokens retrying work they
cannot perform.

We are evaluating focused task context, reusable source-backed project knowledge and better
outcome reporting. The guide includes numerical examples to explain the economics; those examples
are hypothetical, not measured savings.

Claude Code is the current managed provider. Codex support is a future roadmap item, with the same
permission, lifecycle and usage-accounting expectations. Multi-provider support needs more than
changing a model name.

The useful question for us: how much work does it take to deliver a correctly accepted ticket,
including retries and verification—not just how many agents can run at once?

The guide will be linked once its public deployment has been verified.

#AgentOrchestration #DeveloperTools #AIEngineering

## Editing notes

This is a draft, not a posted announcement. Add the verified site URL before posting. Do not add a
savings percentage, an unsupported integration, a production reliability claim or private project
screenshots. Replace the deployment sentence rather than posting an unfinished link placeholder.
