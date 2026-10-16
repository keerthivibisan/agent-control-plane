# R-J — The lead's chat after the lead ends (backend: engine, server, adapter)

> Progress file for the backend part of R-J. Only the agent working on it edits it (coordinator:
> `docs/redesign/STATUS.md`). Protocol: `docs/phase-4/README.md` §9 with redesign paths. Scope:
> `docs/redesign/README.md` §6b; spec: ADR-0020; research:
> `docs/research/sdk-session-resume-2026-10-16.md`. The web part (chat box on ended runs) is a
> separate agent on its own branch (`wp/r-j-web`, merged `0224740`).

| Field   | Value              |
| ------- | ------------------ |
| Status  | review             |
| Owner   | backend agent      |
| Branch  | `wp/r-j-follow-up` |
| Started | 2026-10-16         |
| Updated | 2026-10-16         |

Owned paths: `packages/orchestrator/**`, `packages/server/**`, `packages/adapters/claude-code/**`,
their tests, this file, `docs/provider-adapters.md` (managed execution).

## Tasks

- [x] 1. Engine: follow-up command accepted on ended runs; never changes run status; one turn at a
      time; follow-up state (`available | running | unavailable`)
- [x] 2. Server: chat route starts a follow-up turn when the lead has ended; linked session id;
      turn budget from project limits; "can't be continued" reasons; no relaunch on restart
- [x] 3. Adapter: SDK `resume` (no fork), read-only toolset, no `acp` MCP server, one turn
- [x] 4. Docs: `docs/provider-adapters.md` managed execution; proposed README text here

## Work log (append-only; newest last)

Commit ids are the ones after the rebase on `main` (`94519a3`).

| Date       | What was done                                                                                                                                                                    | Commit    | Checks                                            |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- | ------------------------------------------------- |
| 2026-10-16 | Claimed R-J (backend) on the branch                                                                                                                                              | `6ee3a8a` | docs only                                         |
| 2026-10-16 | Engine: `followUpChat`/`followUpEvent`/`stopFollowUp`/`followUpView`, in-memory `RunState.followUp`, Stop all and restart handling                                               | `7afa386` | pnpm check ✓: test 2,035/2,035 (orchestrator 451) |
| 2026-10-16 | Adapter: `resume` (no fork), answers-only toolset and gate, no MCP server, one turn; provider-adapters §11.1                                                                     | `88e257a` | pnpm check ✓: test 2,044/2,044 (claude-code 309)  |
| 2026-10-16 | Server: chat route → follow-up turn on an ended lead; linked session id; `followUp` on the run detail; flagged messages; Stop; restart; 4 restart/stop tests updated to ADR-0020 | `330bd63` | pnpm check ✓: test 2,054/2,054 (server 409)       |
| 2026-10-16 | Rebased on `main` (`94519a3`, R-J web merged); handoff notes and completion report; status `review`                                                                              | (this)    | pnpm check ✓: test 2,068/2,068                    |

## Handoff notes

### Decisions made (within the spec)

- **Where the follow-up state lives: in the engine** (the option ADR-0020's consequences prefer).
  `packages/orchestrator/src/follow-up.ts` has the commands `followUpChat`, `followUpEvent`,
  `stopFollowUp` and the pure `followUpView`. They run on a `Draft` but **skip `reconcile`**, so
  no command can move the run or an agent: a COMPLETED run stays COMPLETED, and the lead's agent
  record (status, `endedAt`, budget) stays as it ended. The state is `RunState.followUp`
  (`{ sessionGone, turn }`), **in memory only** like the ledger: nothing is persisted, no
  migration, no second `lead` record. A restart forgets it, so an interrupted turn just ends
  (`recoverAfterRestart` also clears it) and nothing relaunches. The engine does not know the
  session id or whether managed agents are on; the server passes those as `FollowUpFacts`.
- **When chat becomes a follow-up:** when the run's lead is not live (any reason: stage start,
  completion, Stop, Stop all, budget denial, timeout, failure, restart), whatever the run status.
  While the lead is live (`QUEUED` included, e.g. waiting for the planner), chat is unchanged.
  The planner is never resumed.
- **Effects:** `start-follow-up { agentRunId, resumeSessionId, prompt, model?, agent? }` and
  `abort-follow-up`. `prompt` is `FOLLOW_UP_PREFACE` + the owner's message; only the owner's
  message is stored. `model`/`agent` are the lead stage's (`stageModelFor`/`stageAgentFor`), so
  the server applies the same model precedence and agent file as for the lead (ADR-0019 §6, as
  ADR-0020 §4 asks); never skills.
- **"Running" also covers the old lead process winding down** (its handle still in the run's
  handles): resuming then would put one session in two processes (research §7).
- **Budget:** each turn gets `followUpBudgetTokens(run.budget)` = the run's per-agent budget (a
  ticket run takes it from the project's `defaultBudgetTokensPerAgent` when it starts), else
  `DEFAULT_AGENT_BUDGET_TOKENS`. Usage counts against the turn's own ledger (dedup by message id,
  max output), never a message the run's ledger already holds, never `total_cost_usd`; at the
  limit the turn is aborted once (`budget-overshoot` log, `follow-up-over-budget` diagnostic).
  The lead's own `budget.used` is not changed by follow-ups (after a restart the run ledger is
  empty, so recomputing it would have lowered it). Token pages are unaffected: they count from
  the transcript, where the resumed session's messages land under the lead's session link.
- **Session gone:** a turn that ends in `error` before the session answered (no usage, no reply)
  marks `sessionGone` until restart. An error after an answer, a budget abort or a Stop does not.
  A start that fails in our own code (no project, `adapter.start` throws) ends the turn as
  cancelled, not gone. **No `getSessionInfo` pre-check:** the SDK returns `undefined` also for a
  session "with no extractable summary", which would wrongly report a session as gone, and it
  reads the session store from the server process.
- **Follow-up flag on messages, derived (no column):** while the lead is ended, only a follow-up
  turn stores messages, and it starts with the owner's message. So `ChatMessageDto.followUp` is
  true for messages stored strictly after the lead's `endedAt`, from the first owner message after
  that (a late reply of the ending lead is not marked). Limit: within the latest page of 100
  messages. The chat route's response is marked directly.
- **Stop:** `POST /runs/:id/agents/<lead>/stop` on an ended lead with a turn under way ends the
  turn (`stopFollowUp`). Stop all and the run timeout abort a turn too (`stopEverything`).
- **Adapter:** answers-only by options (`tools` Read/Grep/Glob narrowed by the agent file,
  `disallowedTools` read-only list + `Agent`/`Task`, `mcpServers: {}`, no plugin) and a gate that
  allows only those tools inside `cwd`; `resume`, `forkSession: false`; one turn
  (`specKeepsInputOpen`), `send()` rejects with `ManagedFollowUpSendError`. A tool use that still
  reaches the server is denied (`FOLLOW_UP_READ_ONLY_MESSAGE`, `follow-up-tool-denied`).

### New error codes (web)

`409 follow_up_running` (a turn is under way) and `409 follow_up_unavailable` (no session, session
gone, managed off; the message says which). The web shows the message only (R-J web handoff).
Notices: every follow-up step publishes `runs-changed` (and `chat-message` for stored lines) with
the run id, which the web refetches on.

### Behaviour change in existing tests

ADR-0020 amends ADR-0013 §7 for this owner action: a chat message on a run whose lead ended now
resumes the lead instead of `409 run_not_active` / `run_cancelling`. Updated:
`tests/control/restart.test.ts`, `tests/control/routes.test.ts` (Stop all),
`tests/verification/control/restart.test.ts` (P3-F) and
`tests/verification/workspace/restart.test.ts` (P4-H). Each still checks that the restart itself
relaunched nothing; the follow-up agent is started by the owner's message and checked to resume
the lead's session.

### Proposed doc text (coordinator)

- README "Status" (once R-V confirms with a real run): "On a ticket whose lead finished, your
  message brings the lead back from its saved conversation for one read-only answer; new code
  work needs a new run with a plan you approve."
- `docs/redesign/STATUS.md` R-J row: backend `wp/r-j-follow-up` in review.
- `docs/orchestration-lifecycle.md` (coordinator-owned if shared): note that follow-up turns never
  change run or agent status and are not part of the transition tables.

### For R-V (real run, owner consent)

Check that `resume` keeps the session id and the conversation, that the init message reports the
same id, that the resumed stream carries only new messages, the failure shape for a missing
session (error result vs throw, with or without `init`), that the follow-up lead cannot edit or
run commands, and that the transcript tailer attributes the new messages to the lead.

## Completion report — R-J (backend)

1. **Summary:** An owner chat message on a run whose lead has ended now resumes the lead's saved
   Claude Code session (SDK `resume`, no fork, project root) for one answers-only turn. The run
   and agent statuses never change, one turn runs at a time, and nothing is ever relaunched
   automatically. `RunDetailDto.followUp` says whether the chat can be continued and why not, and
   follow-up messages are flagged.
2. **Files changed:**
   - created: `packages/orchestrator/src/follow-up.ts`, `packages/orchestrator/tests/follow-up.test.ts`,
     `packages/adapters/claude-code/tests/managed/follow-up.test.ts`,
     `packages/server/tests/control/follow-up.test.ts`,
     `packages/server/tests/tokens/follow-up-usage.test.ts`, this file
   - modified: `packages/orchestrator/src/{state,draft,commands,errors,index}.ts`,
     `packages/adapters/claude-code/src/index.ts`,
     `packages/adapters/claude-code/src/managed/{adapter,permissions,index}.ts`,
     `packages/server/src/control/{service,mappers,errors}.ts`,
     `packages/server/tests/control/{restart,routes}.test.ts`,
     `packages/server/tests/verification/control/restart.test.ts`,
     `packages/server/tests/verification/workspace/restart.test.ts`, `docs/provider-adapters.md`
3. **Commands run and results:** `pnpm check` after the rebase on `94519a3`: format ✓, lint ✓,
   typecheck ✓, test 2,068/2,068 ✓ (core 249, demo 12, orchestrator 451, adapter 309, db 168,
   web 470, server 409), build ✓. Once, under full-suite load, the existing
   `tests/board/flow.test.ts` allowlist test failed on timing and passed 3/3 alone and in every
   later full run (not touched by this WP). Web e2e not run (no web change).
4. **Acceptance criteria:**
   - resume id and cwd passed, no fork: met (adapter `resumes the saved session…`; server
     `resumes the lead session in the project root…`);
   - read-only tools, no MCP control tools, `allowedTools` never set: met (adapter options and
     gate tests; server: no `leadTools`, no skills);
   - input closes after one turn: met (adapter `one turn`);
   - status unchanged: met (engine `statuses` checks for COMPLETED, REVIEW, RUNNING, NEEDS_REVIEW;
     server `shape` checks);
   - refused while a turn runs: met (engine and server, `409 follow_up_running`);
   - no session id refused/flagged: met (`no-session`); managed-off: met (service with
     `enabled: false`);
   - session-gone after a resume error, error-result and throw paths: met (engine; server with an
     error `finished` and with a stream that throws; adapter maps both to `finished: error`);
   - no relaunch on restart: met (engine `recoverAfterRestart`; server restart test);
   - chat stored with `followUp: true`, no tool text, no preface: met (server test reads the
     table);
   - live-lead chat unchanged: met (engine and server tests);
   - usage not double counted: met (engine turn ledger dedup and replay; pipeline test through the
     tokens route with a replayed message).
5. **Assumptions:** see "Decisions made" (budget source, session-gone rule, derived message flag,
   no pre-check).
6. **Contract or shared-file changes needed:** none.
7. **Known gaps / follow-ups:** the follow-up state is in memory, so `session-gone` is forgotten on
   restart (the next try finds it again); the message flag covers the latest 100 messages; real
   SDK behaviour is for R-V.
8. **Next recommended task:** merge `wp/r-j-follow-up`, then R-V's consented real run for R-I and
   R-J.
