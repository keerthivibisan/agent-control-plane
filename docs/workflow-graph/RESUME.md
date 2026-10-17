# Resume here: v0.2.0 editable workflow graphs

> Paused by the owner on 2026-10-18. This page is self-contained: read it first, then
> [STATUS.md](STATUS.md) (the log), [README.md](README.md) (the plan, with its binding "WG-0
> refinements" at the end) and [ADR-0023](../decisions/0023-editable-workflow-graphs.md). The rules
> are in `AGENTS.md` and `CLAUDE.md`.

## 1. What we are building

Each project draws its own agents and review flow as a graph of rule-checked blocks: planner, lead,
helper pool, named helpers, change and final reviewers, tester, plus fixed steps (ticket, plan
approval, checks, ticket branch, your merge, done). Each block that edits has its own approval
mode; ticket and run settings can only make a block more careful. It covers three review styles:

- (a) the lead reviews and merges;
- (b) a review agent sends its findings to the lead, who decides;
- (c) the reviewer sends changes back to the helper itself, then the lead merges.

The owner still merges the ticket branch into `main` once. Templates ("Lead only", "Today's setup",
"Reviewer ↔ helper loop") are offered, or the owner builds a graph from scratch.

## 2. Branch rules (owner decisions, 2026-10-18)

- **Never touch `main`**: no commit, merge, reset or checkout of it, and no git write commands in
  the owner's checkout `~/Desktop/agent-control-plane` (it stays on `main` and runs the released
  app on ports 7420 and 5173).
- Flow: `wp/wg-*` → `feature/workflow-graph` → `release/0.2.0` (from `main` `b6a1f27`) → **MR in
  GitHub** to `main`, which the owner raises and merges there.
- Merge only in the coordinator worktree `~/Desktop/acp-wg-coord` (it has `feature/workflow-graph`
  checked out), always with `git -C <path> merge --ff-only <branch>`. Never chain a `cd` after a
  step that can fail, and never put `reset --hard` in a fallback (that caused the 2026-10-18
  incident where local `main` moved; the owner reset it).
- Push only when the owner asks.

## 3. Where everything is

| What                                                   | Where                                                | State                                                            |
| ------------------------------------------------------ | ---------------------------------------------------- | ---------------------------------------------------------------- |
| Integration branch for this feature                    | `feature/workflow-graph` in `~/Desktop/acp-wg-coord` | head `d38ce0e`+ (see `git log`); `pnpm check` green, 3,909 tests |
| Release branch                                         | `release/0.2.0`                                      | at `b6a1f27` (= `main`); the feature merges here at the end      |
| WG-0 contract, ADR-0023                                | merged                                               | done                                                             |
| WG-A core logic (validate, compile, …)                 | merged; worktree `~/Desktop/acp-wg-a` can be removed | done                                                             |
| WG-B engine and simulator                              | merged; worktree `~/Desktop/acp-wg-b` can be removed | done                                                             |
| Docs (README, BUILD.md, START.md, ADR-0001 TypeScript) | merged                                               | done                                                             |
| **WG-C** server, db, adapter                           | `wp/wg-c-server` in `~/Desktop/acp-wg-c`             | **paused**: see §4                                               |
| **WG-D** graph editor (web)                            | `wp/wg-d-editor` in `~/Desktop/acp-wg-d` (`cf2424f`) | **review, held**: see §4                                         |
| **WG-E** live run graph (web)                          | `wp/wg-e-live` in `~/Desktop/acp-wg-e`               | **paused**: see §4                                               |
| WG-V verification and real runs                        | not started                                          | after C, D and E                                                 |

Each WP's own progress file is `docs/workflow-graph/wp/WG-<X>.md` **on its branch** (the copy on
the feature branch is older until it merges). Its "Resume here" section is the agent's own
account.

## 4. What is left, in order

### Step 1: finish WG-C (server, db, adapter)

Committed on `wp/wg-c-server` (on top of the feature branch at `c0a1a49`):

- `2b7b064` db: graphs in `project_workflow` (v1 or v2) and in the run snapshot;
- `8eeb914` server: `GET`/`PUT /api/projects/:id/workflow-graph`, `POST …/validate`, "used by"
  and delete guards from the graph;
- `38407f6` server: ticket runs on graphs (validate → 409 `workflow_invalid`, ceilings,
  `graphContext`, snapshot), approvals per agent;
- `b7caf02` adapter: launch protection per agent (auto mode plus sandbox; sandbox with `default`
  for a tightened Full auto block; never auto for lead, planner or reviewers).

Not committed when paused (in the worktree): `packages/server/tests/workflow/graph-fuzz.test.ts`
(the API fuzz) and `packages/server/tests/board/graph-scenarios.test.ts` (scenarios a, b, c end to
end). Then: docs (`security.md`, `architecture.md`), status `review`, `pnpm check`, and the full
e2e on free ports.

**To resume:** continue in the same worktree and branch (never restart). Read the WG-C progress
file's "Resume here", finish tasks 6–8, then the coordinator reviews and merges with `--ff-only`
(rebase on the feature branch first; only docs commits were added there since).

**Review points for the coordinator:**

- the run's `approvalPolicy.mode` snapshot must be the tightened mode (the engine's fallback for an
  editing agent without a block);
- the lead and reviewers are never covered by any mode, and the lead never approves;
- a tightened Full auto block keeps the sandbox, but with `permissionMode: 'default'`;
- no new SQL migration (ADR-0023 §9);
- e2e stays green.

### Step 2: merge WG-D (graph editor), held until WG-C

Branch `wp/wg-d-editor` (`cf2424f`) is reviewed and its screenshots checked. It was held because,
against a real server, the page would fail to load until WG-C serves `/workflow-graph`.

**To resume:** after WG-C merges, resume the WG-D agent (or start one) to:

1. rebase `wp/wg-d-editor` on the feature branch (conflict risk: `lib/copy.ts` and `lib/api.ts`,
   both additive, and the one `copy.ts` decider line WG-B added);
2. update the three e2e specs that still drive the old Workflow page: `e2e/review-loop.spec.ts`
   ("Change Helpers"), `e2e/workspace.spec.ts` (`wf-node-plan`) and `e2e/review-loop-live.spec.ts`
   ("Change Review & merge"). The approvals now live in the "Project defaults" card, and stage
   settings are block settings;
3. run the editor against the real endpoints, `pnpm check` and the full e2e.

Then merge.

### Step 3: finish WG-E (live run graph, "at most" wording)

Committed on `wp/wg-e-live`: `56b2619`, with the live run graph on the ticket page, run options
read as a limit, the review agent's direct rework on change cards, and "Used by" blocks on Skills &
Agents. When paused, it had uncommitted e2e and polish changes (see its progress file).

**To resume:** continue in the same worktree; finish the e2e (scenario (c) fixture, screenshots),
`pnpm check` and full e2e. It falls back to the version 1 view when the server answers 404/409, so
it can merge before or after WG-D. It also edits `e2e/review-loop*.spec.ts`, as WG-D will, so merge
one and rebase the other carefully.

### Step 4: WG-V verification

- **e2e per template**, against the real server: draw a graph, save, start a ticket, follow the
  live graph.
- **Remove the version 1 endpoints and DTOs** once nothing uses them: `GET`/`PUT
/api/projects/:id/workflow`, `RunWorkflowDto`, `UpdateWorkflowRequest`, web `updateWorkflow`,
  `isWorkflowPath`. That is refinement 9.
- **Consented real runs**, asking the owner in chat before EACH one (they use the owner's Claude
  account): scenario (a), (b), (c), and one mixed-mode run (a Manual named helper, a Full auto
  pool, an Auto edits tester). Check each agent's `permissionMode` and sandbox from `system/init`,
  the owner prompts per mode, and the final merge. Write a research note
  `docs/research/wg-v-real-run-<date>.md`, as for RL-V.

### Step 5: release 0.2.0

1. **README:**
   - add the workflow-graph section at `<!-- v0.2.0: workflow graph section added at release -->`;
   - re-run the screenshot spec (`ACP_README_SHOTS=1 ACP_E2E_PORT=<free> pnpm --filter @acp/web
test:e2e -c e2e/readme-screenshots.config.ts`) so the Workflow shot shows the editor, and add
     an editor shot;
   - bump the version badge.
2. **Stale docs:** refresh the headers of `docs/roadmap.md` and `docs/architecture.md`.
3. **CHANGELOG `[0.2.0]`:** written for users, in Keep a Changelog 2.0.0 style with nested
   bullets and no internal terms. Mention the changed behaviour: a ticket can no longer choose a
   looser mode than its block.
4. **Versions:** bump them in the package manifests (coordinator) and set the `[0.2.0]` date and
   compare links.
5. **Merge:** merge `feature/workflow-graph` into `release/0.2.0` (`--ff-only`, in a worktree, never
   in the owner's checkout).
6. **For the owner:**
   - push `release/0.2.0` and open the MR to `main` in GitHub (the owner pushes, or asks the
     coordinator to; `gh` was logged in as an account without repo access as of 2026-10-17);
   - CI runs automatically only on pushes to `main`, so trigger it by hand on `release/0.2.0`
     before merging (or add a `pull_request` trigger if the owner wants one);
   - after the owner merges in GitHub, tag `v0.2.0` and create the GitHub release from notes in
     `.acp-data/release-notes-v0.2.0.md` (git-ignored).
7. **Restart the owner's app:** after `main` moves, restart it on the new code. Ask first, and back
   up `~/.agent-control-plane/acp.sqlite` if a migration applies (none is expected for 0.2.0).

## 5. How correctness is proved (owner question, answered in the plan)

The plan's "Graph correctness" section has six layers:

1. a run simulator over the real engine, with invariants checked on every step (including that
   every run finishes);
2. bounded exploration of every script per graph;
3. generated valid graphs, plus single-mutation graphs that must be refused with a specific code,
   with the editor, validator, compiler and server agreeing;
4. exhaustive small graphs (soundness, completeness, no dead rules);
5. golden traces: 267 version 1 traces recorded before the engine change, still identical;
6. consented real runs.

Layers 1–5 are done in core and the engine. WG-C adds the API fuzz; WG-V adds the real runs.

## 6. Environment notes

- **Toolchain:** Node 22.21.1 and pnpm 10.26.1. Before pnpm, run `export
PATH=<scratchpad>/bin:$HOME/.nvm/versions/node/v22.21.1/bin:$PATH`. If the scratchpad shim is
  gone, recreate it with `mkdir -p <scratchpad>/bin && ln -sf /usr/local/bin/pnpm
<scratchpad>/bin/pnpm`, or use any pnpm 10.26.
- **Ports:** never 7420 or 5173 for tests (the owner's app). The e2e suite takes `ACP_E2E_PORT` and
  `ACP_E2E_CONTROL_PORT`; use free ones (e.g. 7731/7741).
- **Load:** with several agents running full suites, server tests can time out. Re-run before
  treating a timeout as a bug.
- **Untouchable:** never read `~/.claude` (sessions, settings, history); never edit Claude Code
  settings; no real `claude` or SDK run without the owner's consent in chat at that time.
- **Leftover worktrees:** about 36 older ones from v0.1.0 remain under
  `.claude/worktrees/`. Cleanup was offered and not yet approved; keep `wp/rl-v-verify` (locked)
  until the owner decides.
