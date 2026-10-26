# P-D

> Progress file for P-D. Only its agent edits it. Owner report (2026-10-26): "Lead may escalate
> for a subagents work, but we need to review it once. After few minutes the subagents session is
> getting lost, so the ticket need to be cancelled and reworked." Rules: ADR-0013 §3 and §7,
> ADR-0020, ADR-0021 §3 and §5, ADR-0026. Research:
> [p-d-session-loss-2026-10-26.md](../../research/p-d-session-loss-2026-10-26.md).

| Field  | Value                                                    |
| ------ | -------------------------------------------------------- |
| Status | review                                                   |
| Branch | `wp/p-d-session-loss`, from `release/0.3.1` at `a6bafd6` |

## The cause

**The run timeout stopped the run right after the owner answered.** The timeout (ADR-0013 §3,
2 h) counts from the run's creation, and a loop run stays RUNNING while the lead waits for the
owner, so a run is often close to it when the lead asks. While a change waited for review the
timeout was refused by accident (AWAITING_REVIEW → TIMED_OUT is no transition, and the sweep drops
refusals silently). The owner's decision ended that: a rework restarts the helper and a merge
moves it to SUCCEEDED, so the next sweep (15 s) moved every agent to TIMED_OUT, aborting the
reworking helper's session mid-turn, and the run to CANCELLED. Nothing could be decided after
that, so the ticket had to be run again. Reproduced with the fake SDK and an injected clock
(`owner-wait.test.ts` in the server: `CANCELLED` 20 minutes into the owner's rework of a run
4.5 h old).

Ruled out, with evidence (research note §2 and §4): `ask_owner` returns at once, so no tool call
waits for the owner; the CLI has no idle timeout for in-process (`sdk`) MCP servers; its 5-minute
`dialogExpiry` applies to `request_user_dialog`, not to the `can_use_tool` requests the app
answers; the lead's input stays open, and the CLI's idle exit needs
`CLAUDE_CODE_EXIT_AFTER_STOP_DELAY`, which the app never sets.

Also seen (the coordinator's metadata): a restart turns a waiting helper and the lead into
NEEDS_REVIEW (ADR-0013 §7, ADR-0021 §5). That is the ADRs' rule; see "Proposal" below.

## The fix

### Engine (`@acp/orchestrator`)

- **The wait for the owner does not count.** `waitsOnlyForOwner(view)`: a loop run, RUNNING or
  BLOCKED, with a change at `needs-owner` and no agent but the lead with a process. After every
  command, `Draft.trackOwnerWait()` starts or ends the current wait in `RunState.ownerWait`
  (`{ since, totalMs }`, in memory only like the ledger: after a restart the run is NEEDS_REVIEW
  and never times out again). `runWorkingMs(state, now)` is the time since creation minus the
  waits; `isRunOverdue(state, now, timeoutMs)` is the timeout the sweep now applies. A run whose
  other helpers keep working while one change waits keeps its clock running, so runaway work is
  still stopped.
- **The timeout can always stop a run.** `stopEverything` ends a helper that waits for review as
  CANCELLED (as Stop all does, ADR-0021 §5) instead of the impossible TIMED_OUT, so a run past its
  deadline is no longer kept alive by a waiting change and then killed by the owner's decision.
- **A rework turn in a new session.** A `started` event of a reworking helper with another session
  id than the one it resumed (a resume keeps its id, `forkSession: false`) means its saved session
  could not be continued: the engine keeps the new id for the next rework, sets the helper's Latest
  line ("Started a new session: its earlier conversation could not be continued"), tells the lead
  in plain words, and counts the diagnostic `rework-session-replaced`. The turn goes on as any
  rework turn.

### Adapter (`@acp/adapter-claude-code`)

- A rework turn whose resume ends in an error **before the session answered** (no usage, no tool
  call) starts once more without `resume`, in the same worktree with the same options, the prompt
  prefixed by `REWORK_NEW_SESSION_NOTE`. Never after it answered, after an abort, for a Full auto
  failure, for a first turn, a fresh rework or a follow-up; at most once per turn
  (docs/provider-adapters.md).

### Server (`@acp/server`)

- The sweep uses `isRunOverdue(live.state, …)`.
- `rework-session-replaced` also posts an `app` line on the ticket for the owner: "<Role> could not
  continue its earlier conversation, so it reworks its change in a new session, in the same folder
  with its earlier work." (`reworkNewSessionLine`).
- A second session of the same agent run is linked as `retry` (it was dropped before), so its
  usage and name stay with that agent.
- `managedAgentEnv` drops `CLAUDE_CODE_EXIT_AFTER_STOP_DELAY`, so an owner's shell can never make a
  waiting lead exit.

No contract change: every new field and code is in the orchestrator's own `RunState` and
`EngineEffect` types, and no migration is needed.

## Tests

- `packages/server/tests/board/owner-wait.test.ts` (fake SDK, routes, real git in a temp repo,
  injected clock, sweep by hand):
  - the reproduction: asked at 1.5 h, answered at 4.5 h; the run, lead and helper survive the
    sweep, the owner's rework resumes the helper's own session in its own worktree, and the run
    is still RUNNING 20 minutes into the rework;
  - a late merge: the lead hears "The owner decided: Merged Builder …", the run survives the next
    sweep, and the lead hands over;
  - adversarial: the owner answers a day later and the helper's session is gone (the rework reports
    a new session): the run goes on, the lead is told, the ticket has the app line, the new session
    is linked as `retry`, and the next rework resumes the new session;
  - a run whose other helper works past the deadline is still timed out, the waiting helper
    CANCELLED.
- `packages/orchestrator/tests/owner-wait.test.ts`: the clock stops while only the owner is
  awaited and resumes after the decision (exact milliseconds); it keeps running while another
  helper works; the plain deadline without a wait; a new session on a rework turn is kept and
  announced, the same session is not; the timeout with a change waiting for review succeeds.
- `packages/adapters/claude-code/tests/managed/rework-lost-session.test.ts`: the fallback for an
  error result and for a throw (options, prompt, one `finished`), an init before the error, only
  once, not after the session answered, not for a first turn / fresh rework / follow-up, not after
  abort, not for a Full auto failure.
- `packages/server/tests/control/units.test.ts`: the idle-exit variable is dropped.

Checks (lean, per the brief): see the commit `Checks:` lines.

## Proposal (not made): rework after a restart

After a restart the owner cannot send a waiting helper's change back, though its worktree and
saved session are intact, and the lead is gone, so the rest of the plan is never done. Proposed
ADR-0021 §5 amendment: "A helper that was AWAITING_REVIEW at the restart has no process to
interrupt; the owner may still send its sealed change back for rework, which resumes its saved
session (an owner action, never an automatic relaunch, as in ADR-0020)." It needs
NEEDS_REVIEW → STARTING for such a helper (`AGENT_TRANSITIONS`), `checkChange` to accept it for
the owner, and a way to continue the plan without a lead (or to resume the lead fully), so it is
an ADR decision for the coordinator, not a patch.

## Log

- 2026-10-26 Claimed. Reproduced the timeout after the owner's decision; fixed it in the engine
  and the sweep; added the rework new-session fallback and the env hardening; docs.
