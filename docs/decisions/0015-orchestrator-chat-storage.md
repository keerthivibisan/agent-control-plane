# ADR-0015: Store the orchestrator chat locally

- **Status:** accepted (project owner, 2026-10-11)
- **Date:** 2026-10-11
- **Amends:** ADR-0009 (content minimization), for the control-panel chat only

## Context

ADR-0009 forbids storing conversation content. The control panel's chat between the owner and the
lead agent is the owner's own working record: they need to scroll back and resume after a restart.

## Decision

- Store, in `orchestrator_messages`, only: the owner's chat messages, the lead agent's text replies to
  the owner, and the task text the lead gives each worker (`agent_runs.task`).
- Approval summaries (tool name and target, redacted, max 200 characters) are stored as part of the
  audit trail (ADR-0013).
- **Never stored:** worker conversation content, thinking, tool inputs or outputs beyond the approval
  summary, and anything read by the observation pipeline (ADR-0009 still applies there).
- Stored text is local only (`<ACP_DATA_DIR>/acp.sqlite`, mode 0600) and is removed with its run.

## Consequences

ADR-0009 gains a pointer to this exception. Logs never contain chat text (redaction tests extend to
the control-panel routes).
