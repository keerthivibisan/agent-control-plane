# 01 · Engine and authorization

## Responsibilities

| Layer                    | Owns                                                                                                          | Does not establish                                         |
| ------------------------ | ------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| Web UI                   | Project policy, tickets, workflow editing, owner decisions, status presentation                               | Authority merely because a button is visible               |
| Routes / server services | Boundary validation, persistence, workspace preparation, checks, provider handles and Git/GitHub I/O          | A model decision as permission                             |
| Pure engine              | Current state, policy checks, run/node capacity, budgets, attempt bounds, reconciliation and declared effects | Filesystem, SDK processes or network calls                 |
| Database                 | Validated records, run state, session links, operations and evidence                                          | Git/database atomicity or an executing process             |
| Provider adapter         | SDK options, scoped tools, permission bridge, session continuation, event normalization                       | Arbitrary orchestration or cross-provider memory           |
| Harness                  | Trusted setup/check definitions and commit-specific outcomes                                                  | Proof of all possible behavior or a replacement for review |

## Command → state → effect → event

A command applies to the current run state. `applyCommand` creates a draft, invokes the command,
refuses invalid work without launching it, then reconciles accepted changes. Reconciliation can
schedule ready review/final stages and other effects. The pure engine returns state plus effects.

The server commits the transition before performing effects, so a failed database commit cannot
silently launch an unrecorded agent through that path. It then prepares workspaces, calls the SDK
adapter and feeds events back into the engine. Persist-before-effect is not an exactly-once
transaction covering SQLite, Git, an OS process and GitHub; restart and uncertain delivery need
explicit reconciliation.

## Example: the lead requests a helper

`start_agent` names a role, task and optional configured helper node. The engine checks the caller,
run phase, approved work/branch readiness, effective node, helper capability, capacity, nesting,
budget and attempt rules. The server creates the editing worktree from the recorded ticket tip,
records it, runs trusted setup, assembles context/profile/skills/attachments, then calls the adapter.
Setup failure is reported before the agent's model query starts.

The lead does not spawn an OS process. Some agents are scheduled by engine rules: the initial
planning role, change reviewers and configured final stages. Resolvers use a dedicated operation;
they do not enter the ordinary helper integration loop.

## Layered authorization examples

| Request                                    | Decision path                                                                                       |
| ------------------------------------------ | --------------------------------------------------------------------------------------------------- |
| Helper while plan is unapproved            | Engine refuses launch; full-auto is still subject to run policy                                     |
| More helpers than configured capacity      | Engine refuses the request; no assumption of a queued launch                                        |
| Reviewer asks to edit or execute a command | Role toolset and permission gate deny it                                                            |
| Helper executes merge/rebase/push          | Branch guards deny branch/history mutation; server owns Git                                         |
| Agent profile names extra tools            | The profile narrows role tools; it cannot grant new authority                                       |
| Ordinary change integration                | Lead request plus server checks, guarded integration and configured evidence gates                  |
| Conflict candidate promotion               | Server verifies pinned candidate/target/policy and compare-and-swap conditions                      |
| Publish after repair                       | Independent delivery delegation and allowed target; resolution alone does not authorize publication |

## Isolation and recovery

The lead/planner are read-only in the owner's project; editing helpers/testers have their own
worktrees. Reviewers inspect the relevant prepared checkout. Skills are scoped by explicit mapping;
`settingSources: []` prevents repository/user Claude settings loading through that path.

Budget stops are soft and event-driven: in-flight work may overshoot. Restart recovery does not
silently relaunch working agents. Ended-lead follow-up is answers-only; it is not a way to resume
editing an arbitrary old ticket. ADR-0029 proposes a separate owner-triggered restart-rework path;
do not document it as implemented solely because its draft exists.

## Source map

- `packages/orchestrator/src/commands.ts`: `applyCommand`, `createRun`, `agentEvent`.
- `packages/orchestrator/src/policy.ts`, `program.ts`, `draft.ts`, `step-attempts.ts`.
- `packages/server/src/control/service.ts`: `apply`, `perform`, `startAgent`, `launch`, `leadTool`.
- `packages/adapters/claude-code/src/managed/adapter.ts`: `buildOptions`, `startAgent`.
- `packages/adapters/claude-code/src/managed/permissions.ts`, `branch-guard.ts`.
- `packages/server/src/workspace/manager.ts`; ADR-0013, ADR-0021, ADR-0022, ADR-0030.
