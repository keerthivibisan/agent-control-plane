# R-V real smoke run — 2026-10-16

With the owner's consent in chat, one real run of the redesigned workflow against Claude Code via the
Agent SDK 0.3.296 (model reported by `system/init`: `claude-opus-5-5`). It used the guarded driver
`packages/server/tests/verification/redesign/real-run/drive.ts` (`ACP_REAL_RUN=1`): a throwaway git
repository and a separate in-process server on an ephemeral 127.0.0.1 port, with
`ACP_MODE=live ACP_MANAGED=on`, a temp `ACP_DATA_DIR` and an empty temp `ACP_CLAUDE_DIR`. The
real `~/.claude` was not read for observation. Aggregates only: no prompt, reply or tool text was
printed or stored by the driver.

## Flow and result

- **Workflow:** a separate planner with the stage skill `plan-small`, then a lead, one helper and
  the merge. Then the final code review, whose stage agent file lists `Read, Bash`, the unit tests,
  and Done. Then one follow-up question to the ended lead.
- **Result:**
  - run `COMPLETED`, ticket `DONE`, every stage `done`;
  - 2 merges (the helper and the tester);
  - no nudge needed for review.
- **Budget tokens:**

  | Agent    | Budget tokens |
  | -------- | ------------- |
  | planner  | 27,190        |
  | lead     | 28,600        |
  | worker   | 26,455        |
  | reviewer | 6,431         |
  | tester   | 6,952         |

  About 95.6k in total, plus the follow-up turn.

- **Reported cost (estimated, never summed):**
  - worker $0.23, reviewer $0.07, tester $0.10;
  - follow-up $0.53, which is cumulative for the lead's session as documented, not the turn's
    own cost;
  - planner and lead: no result message, because the engine ends them.

## What it proves

| Check                                   | Observed                                                                                                                                                                                     |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Skill through the run's plugin          | planner `system/init` lists `acp-skills:plan-small`; the marker word reached the plan summary                                                                                                |
| Stage agent file applied                | reviewer prompt had the agent-file heading (179 bytes appended); the marker word reached its review comment                                                                                  |
| Tools only narrow (reviewer)            | SDK `tools: ['Read']`; `system/init` tools are exactly `Read` and `mcp__acp__post_review` — the file's `Bash` was not added                                                                  |
| Read-only planner                       | no Bash/Edit/Write in its `init` tools; only `submit_plan` used                                                                                                                              |
| Follow-up resume (ADR-0020)             | `resume` = the lead's session id, `forkSession: false`; `init` session id unchanged; `init` tools exactly `Read`, `Grep`, `Glob`; run status and lead record unchanged; the reply was stored |
| No chat or plan text in logs            | 50 log lines, neither the follow-up question nor the plan summary appears                                                                                                                    |
| `settingSources: []`, no `allowedTools` | for every agent                                                                                                                                                                              |

## Finding: roles without a `tools` base set get extra tools

The planner, lead, worker and tester get no SDK `tools` base set, and their `system/init` lists 28–37
tools. These include tools from this Claude Code install that the workflow never needs:

- `CronCreate`, `ScheduleWakeup`, `RemoteTrigger`, `PushNotification`;
- `SendMessage`, `ListAgents`;
- `WebFetch`, `WebSearch`;
- `Artifact*`, `DesignSync`, `Monitor`, `EnterWorktree`;
- `Task` (subagents, including for the read-only planner).

Bundled skills also load (21 names, for example `update-config` and `schedule`) despite
`settingSources: []`. Passing `skills` does not restrict that list. None of these tools was called
in this run: the gate counts show only the expected tools.

Some of these tools may run without asking `canUseTool`. For example, `SendMessage` reaches other
local Claude sessions. The reviewer shows the fix works: with a `tools` base set, `init` held exactly
the listed tools.

**Recommendation (before v0.0.1):**

- Give every role an explicit `tools` base set: the coding built-ins it needs, for example `Read`,
  `Grep`, `Glob`, `Edit`, `Write`, `Bash`, and `Skill` only with a plugin. Leave `Task`/`Agent` and
  the web tools out unless a decision adds them.
- Record the decision in ADR-0019 §6 / ADR-0013.
