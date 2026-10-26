# A helper "lost" while the owner reviews an escalated change (2026-10-26)

Research for v0.3.1 WP P-D. Owner report: the lead escalates a helper's change; the owner looks a
few minutes later; the helper's session is gone, and the ticket has to be cancelled and redone.

Sources: the app's code on `release/0.3.1`, its tests with the fake SDK and an injected clock, and
the Agent SDK 0.3.296 package as installed (`sdk.mjs`, `sdk.d.ts`, and the bundled
`claude-agent-sdk-darwin-arm64` `claude` binary, searched as text). **Nothing was run against
Anthropic.** The CLI items below are read from bundled code, not observed at runtime.

## Findings

### 1. The run timeout stopped a run as soon as the owner answered (proven, fixed)

- The run timeout (ADR-0013 §3, 2 h by default) counts from the run's **creation**
  (`isRunPastDeadline`: `now − run.createdAt`), and the sweep (every 15 s) applies it to QUEUED,
  PLANNING, RUNNING and BLOCKED runs. A loop run stays RUNNING while the lead waits for the owner.
  Plan review, helpers, change reviews, checks and rework rounds all count, so a run is often near
  2 h when the lead asks.
- While any helper was AWAITING_REVIEW, the timeout was **refused**: `stopEverything` moved every
  live non-lead agent to TIMED_OUT, and AWAITING_REVIEW → TIMED_OUT is not a transition
  (`IllegalTransitionError` → refusal, silently dropped by the sweep). So the run survived the
  wait, by accident.
- The moment no change waited any more, the next sweep stopped the run: the owner's **rework**
  restarts the helper (STARTING, so nothing is AWAITING_REVIEW) and the owner's **merge** moves it
  to SUCCEEDED. Within 15 s every agent was TIMED_OUT (the reworking helper's session aborted
  mid-turn) and the run CANCELLED: the owner cannot decide anything more, and the ticket must be
  run again. This matches "a few minutes later, the session is lost".
- Reproduced in `packages/server/tests/board/owner-wait.test.ts` before the fix: the run reported
  `CANCELLED` 20 minutes into the owner's rework of a run 4.5 h old.

### 2. `ask_owner` and in-process tools never block (ruled out)

- `ask_owner` (`orchestrator/src/lead-tools.ts`, the `ask_owner` case → `recordChangeDecision` →
  `applyDecision`) returns at once ("The owner will decide on X's change. You will get a message
  when they do."). No SDK tool call stays open while the owner reviews.
- The CLI's MCP tool idle timeout (`CLAUDE_CODE_MCP_TOOL_IDLE_TIMEOUT`; default 30 min for stdio
  servers and 5 min for others) is **0 (none) for server types `sse-ide`, `ws-ide` and `sdk`**,
  and our `acp` server is an in-process `sdk` server.
- The CLI's `dialogExpiry` setting (env `CLAUDE_CODE_USER_DIALOG_TIMEOUT_MS`; `60s`, `5m`, `10m`
  or `never`; **default 5 min**) cancels a "permission/user dialog forwarded to a remote client".
  In the SDK's structured I/O it is applied to `request_user_dialog` requests; no deadline was
  found on `can_use_tool` requests, which the app answers itself (`APPROVAL_TIMEOUT_MS`, 15 min,
  then deny). Not involved here: the app never sees `request_user_dialog`.

### 3. A rework turn whose session cannot be resumed (hardened)

- A rework resumes the helper's saved session (`resume`, `forkSession: false`) in its own
  worktree. The worktree and the session id stay while the change waits (the worktree is removed
  only after a merge or discard; the id is in memory and in `agent_run_sessions`).
- If the resume fails anyway (Claude Code's transcripts age out after `cleanupPeriodDays`, or a
  transcript is moved or missing), the turn ended in an error every time the change was sent back,
  so the helper's work could only be merged as it was or discarded. Not observed; the exact
  failure shape for a missing session is still unverified (research 2026-10-16 §5).
- Now the adapter starts the same rework turn once more in a new session, in the same worktree,
  and the engine keeps the new id (docs/provider-adapters.md, "Rework turn whose session cannot be
  resumed").

### 4. The lead's process while it waits (ruled out in the app; one environment risk removed)

- The lead's input stays open (`specKeepsInputOpen`), so its process idles between turns. The SDK
  closes stdin only for single-turn queries or when the input iterable ends.
- `CLAUDE_CODE_EXIT_AFTER_STOP_DELAY` is an idle-exit timer in the CLI ("Exiting after N ms of
  idle time"), active only when the variable is set. The app never set it, but the agent
  environment was the server's own minus `ACP_*` and `GIT_*`, so a value in the owner's shell
  would have reached every agent and ended a waiting lead. It is now dropped
  (`managedAgentEnv`).

### 5. A server restart (by design; a proposal)

- The coordinator's metadata shows an earlier run whose lead and two helpers all went to
  NEEDS_REVIEW at the same instant, 8 hours after the start: the restart recovery
  (`recoverAfterRestart`, ADR-0013 §7, ADR-0021 §5). After it the lead is gone and a helper that
  waited for review is NEEDS_REVIEW, so the owner may merge or discard its change but not send it
  back ("has stopped, so it cannot rework"), even though its worktree and saved session are
  intact. The rest of the plan has no lead to do it, so the ticket must be run again.
- This is the ADRs' rule, not a bug, so P-D does not change it. See the proposal in
  `docs/v0.3.1/wp/P-D.md`.

## What a real run could still confirm (not needed for the fixes)

- The failure shape of a resume of a missing session (an error result with `errors` such as "No
  conversation found with session ID: …", or a throw), and whether `system/init` comes first. The
  adapter handles both shapes.
