# 02 · From ticket to accepted work

## Handoff and execution

1. Start a ready ticket. The board validates project, ticket/run eligibility, effective settings and
   the workflow; creates the run with its snapshot; and commits initial state.
2. The lead or separate planner receives ticket key/title, type, priority and description through
   the ticket prompt builders. Project context, stage instructions, mapped skills, attachments and
   an earlier summary of the same ticket are added through their explicit paths. This is not a
   dump of all tickets, all comments or the entire repository.
3. Planning produces bounded steps and helper choices. The plan gate follows effective approval
   policy; a separate planner is not mandatory. The ticket branch is prepared before work starts.
4. The lead requests scoped helpers. The engine authorizes; the server prepares a worktree and
   setup; the adapter starts a session. Helpers do not inherit the lead's full conversation or one
   another's unmerged edits.
5. On a finished editing turn, ACP seals work and handles change checks/review according to the
   configured graph. A finished process is not proof of acceptance. No-change/blocked results are
   reported; no-change replacements count toward the step's attempt bound on this baseline.
6. The lead integrates accepted changes through server-controlled Git. Required evidence depends
   on configured Checks blocks and the applicable automation route. Compare-and-swap and workspace
   guards protect promotion; isolation does not eliminate conflicts with a moving target.
7. Configured final reviewer/tester stages inspect the combined work. Their completion must not be
   treated as timeless evidence after later edits. Review and executable checks have distinct roles.
8. Finish means delivery through an allowed path: local merge or a PR path with host confirmation.
   A normal discard can finish a run without delivering the requested work; Done alone is not an
   acceptance-quality metric.

## Configurable language, not an arbitrary graph executor

Projects can configure supported agent blocks, review routes, optional Checks blocks, skills,
profiles, model and effort. The graph is schema-validated and compiled into a constrained program;
it is not a general DAG scheduler where every drawn edge runs arbitrary code. A configured helper
block is a template/capability; a live helper is a specific authorized instance.

ADR-0028 makes Checks blocks optional. Where a block exists it runs/gates according to its place
and selection rules. Legacy graphs retain their existing merge gate. With no relevant gate there
may be no executable checks; do not display this as tests passed. The displayed Finish block
combines stored end-of-flow nodes; the storage representation is not a new generic workflow node.

## Roles and communication

| Role     | Normal job                                                      | Important boundary                                                  |
| -------- | --------------------------------------------------------------- | ------------------------------------------------------------------- |
| Planner  | Read relevant code and propose a plan                           | No writes, shell or helper management                               |
| Lead     | Plan/coordinate, inspect, integrate through tools and hand over | Read-only filesystem role; no unrestricted shell                    |
| Helper   | Implement a scoped task in its own worktree                     | Content/index operations within policy; no branch/history authority |
| Reviewer | Inspect relevant change and report findings                     | Read-only; independent findings do not execute tests                |
| Tester   | Add/extend tests for merged behavior in its own worktree        | Its editing result is reviewed like other changes                   |
| Resolver | Repair content in a server-prepared in-progress merge           | No child helpers; own operation budget; server concludes merge      |

The server carries messages between separate provider sessions. A message-tool return currently
acknowledges the engine request, not proven receipt/reading by the target. Structured `report_work`
outcomes now feed the lead's no-change explanation and attempt accounting. Raw worker conversation
is not a shared project memory.

## Source map

`packages/server/src/board/service.ts` (`startTicket`, `runBase`);
`packages/orchestrator/src/plan.ts`; `lead-tools.ts`; `loop.ts`; `stages.ts`;
`packages/core/src/workspace/graph/{validate,compile}.ts`;
`packages/orchestrator/src/report-tool.ts`, `change-commands.ts`, `step-attempts.ts`;
ADR-0023, ADR-0026, ADR-0027, ADR-0028 and ADR-0030.
