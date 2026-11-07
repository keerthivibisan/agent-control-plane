# ADR-0033: Lead and agent messaging: delivery state, ask_lead, held messages

- **Status:** accepted (project owner, 2026-11-03 decisions 2–4; go-ahead 2026-11-07)
- **Date:** 2026-11-07
- **Deciders:** project owner; implementing agent (draft)
- **Amends:** ADR-0013 (control tools), ADR-0015 (what is stored about messages)
- **Relates to:** [ADR-0031](0031-codex-provider.md), ADR-0021 (review loop)

## Context

The codex-agent-comms review (2026-11-03) traced the lead's messaging end to end and found:

- `message_agent` reports success even when nothing is delivered. The server's `sendTo` drops a
  message for an agent with no live handle and only logs it
  (`packages/server/src/control/service.ts`, `sendTo`).
- `notifyLead` skips a lead that is inactive or blocked, so engine notices are lost
  (`packages/orchestrator/src/loop.ts`, `notifyLead`).
- A worker cannot ask the lead anything; it can only report at the end.
- The lead learns that a worker finished only by polling.
- Review findings are summarised to the lead once and cannot be fetched again.
- `merge_change` can wait without limit.

These hold for any provider, and a second provider makes them worse.

## Decision

1. **Honest delivery.** `message_agent` returns `delivered`, `queued` or `dropped` with a reason.
   `queued` means the message is held for an agent that is starting or busy and will be delivered
   on its next turn; `dropped` means the agent has ended and the message will never arrive.
2. **Held messages.** Messages and engine notices to a lead that is blocked or between turns are
   held in order and delivered when it can take input. They are never silently skipped. Held
   messages live in memory only; they do not survive a restart (ADR-0013 §7).
3. **`ask_lead`.** Helpers, reviewers and testers get an `ask_lead(question)` tool. The question
   reaches the lead as a message; the lead answers with `message_agent`. The asking agent keeps
   working unless it chooses to wait.
4. **Finish notice.** When an agent finishes, the lead gets one short notice (who, outcome, where
   the report is). It does not include the agent's text.
5. **Findings on demand.** The lead can fetch a change's review findings again
   (`get_review_findings`), from the data the review loop already stores.
6. **Bounded merge.** `merge_change` has a timeout and reports a timeout as a failure the lead can
   act on.
7. **Metadata only.** For each message ACP may store an id, sender, recipient, state, timestamps,
   length and a SHA-256 hash. It never stores the text (ADR-0009). The orchestrator chat (ADR-0015)
   is unchanged.

All of this is provider-neutral: it lives in `@acp/orchestrator` and `@acp/server`, and the
adapters only deliver turns.

## Alternatives considered

- **Keep fire-and-forget.** Simple, but lost messages already cause stuck runs.
- **Persist messages for restart survival.** Rejected by the owner for now.
- **Agent-to-agent protocols (A2A, MCP sampling).** Heavier than ACP needs; the lead tools already
  form the channel.

## Consequences

- Lead tool results change shape (a delivery state); prompts and tests that read them change.
- New adversarial cases: a message to an ended agent, to a blocked lead, an `ask_lead` flood.
