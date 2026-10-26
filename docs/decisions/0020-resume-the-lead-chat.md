# ADR-0020: Resume the lead's chat on an owner message

- **Status:** accepted — owner decision 2026-10-16 (docs/history/redesign/README.md §6b)
- **Date:** 2026-10-16
- **Amends:** ADR-0013 §7 (restart), for this one owner action

## Context

Each run of a ticket has one lead agent, which the owner chats with (ADR-0015). The engine stops
the lead:

- when the final code review or unit-tests stage starts (`Draft.startStage`);
- when the run completes;
- on Stop all, a budget limit or a timeout.

An app restart also ends it: the work becomes `NEEDS_REVIEW` and is never relaunched (ADR-0013 §7).
The chat then closes for good, and the owner loses the agent that knows the run best.

(Amended by ADR-0021 §5: with the review loop the lead is no longer stopped when the final code
review or unit-tests stage starts; it stays live until no stage is left. The follow-up turn still
applies once the lead has ended.)

The lead's conversation is not lost. The SDK saves every session to disk by default
(`persistSession`, default true, sdk 0.3.296), and the app already links each agent to its provider
session (`agent_run_sessions`). The SDK's `resume: <sessionId>` continues a saved conversation.

## Decision

1. **Resume on message.** On a run whose lead has ended, the ticket page keeps a chat box. Each
   owner message starts a **follow-up turn**: the server starts the lead again with SDK
   `resume: <the lead's linked session id>`, in the same folder (the project checkout), and sends
   the message. The reply is stored like any lead reply (ADR-0015). The agent's input closes when
   the turn ends, so nothing waits idle between messages.
2. **Answers only.** A follow-up lead can read the project and answer.
   - It gets the read-only toolset (`READ_ONLY_DISALLOWED_TOOLS`, like the planner) and no
     control-plane tool that starts or changes work: no helpers, plans, reviews or merges.
   - Any new code change goes through a **new run** with a new plan the owner approves, so the
     plan-first rule (ADR-0016) stays.
   - The owner can start that run from the ticket page as today.
3. **Never automatic.** Only an owner message (CSRF, the existing chat route) starts a follow-up
   turn. A restart still relaunches nothing (ADR-0013 §7 keeps holding for all other work). The run's
   status does not change: a `COMPLETED` run stays `COMPLETED`.
4. **Same safety settings as any managed agent:**
   - `settingSources: []`, `permissionMode: 'default'`, the `canUseTool` gate;
   - `strictMcpConfig`, no `allowedTools`;
   - the stage agent file rules (ADR-0019 §6) for the lead's stage.

   A follow-up turn has its own token budget, a project limit with a safe default, and its usage
   is attributed to the run through the linked session, as usual.

5. **When it is not possible.** These cases show "This chat can't be continued" with the reason,
   and no turn starts:
   - there is no linked session id;
   - the saved session cannot be resumed (an SDK error);
   - managed agents are off.

## Alternatives considered

- **Keep the lead running until the ticket closes.** Simpler, but every finished ticket holds an idle
  Claude process, and a restart still loses it. Rejected by the owner.
- **A resumed lead with full powers.** Faster for small follow-ups, but it would start new work
  without an approved plan. Rejected by the owner.

## Consequences

- An engine change: a follow-up command that is accepted on ended runs, and a follow-up lead agent
  record that never changes the run's status.
- A contract change (coordinator commit): `ManagedAgentSpec` gains a resume session id and a
  follow-up flag.
- WP R-J builds it; the R-V real run (owner consent) checks that resume keeps the conversation and
  that the follow-up lead stays read-only.
