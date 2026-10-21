# Resume here: v0.2.0 editable workflow graphs

> **2026-10-21: RELEASE READY.** `release/0.2.0` at `8d66d45` (`chore(release): v0.2.0`) holds
> everything.
>
> - **Checks:** 4,598 tests and e2e 72/72.
> - **Verification:** the data-copy and rollback checks and the four real runs all passed.
> - **The owner's remaining steps:**
>   1. push `release/0.2.0`;
>   2. open the PR to `main` in GitHub, using the text in
>      `<repo>/.claude/worktrees/wg-coord/.acp-data/pr-v0.2.0.md`;
>   3. run CI on the branch by hand;
>   4. merge;
>   5. create the GitHub release with tag `v0.2.0` on `main` (notes in `.acp-data/release-notes-v0.2.0.md`).
> - **Everything below is history.**

> Paused by the owner on 2026-10-20 (evening). This page is self-contained: read it first, then
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

## 2. Branch and worktree rules (owner decisions, 2026-10-18 to 2026-10-20)

- **Never touch `main`.** No commit, merge, reset or checkout of it, and no git write commands in
  the owner's checkout `~/Desktop/agent-control-plane`, which stays on `main` and runs the
  released v0.1.0 app on ports 7420 and 5173.
- **One release branch holds everything:** `wp/*` → `release/0.2.0` → a **PR in GitHub** to `main`,
  which the owner raises and merges there. Push only when the owner asks.
- **Coordinator merges** happen in the coordinator worktree
  `<repo>/.claude/worktrees/wg-coord`, which has `release/0.2.0` checked out. Use
  `git -C <path> merge --ff-only <branch>` there, never a `cd` chain, and never `reset --hard` in a
  fallback (the cause of the 2026-10-18 incident).
- **Agents start the v0.1.0 way:** the Agent tool with `isolation: "worktree"`. Claude Code makes
  the worktree and its working directory; the agent then runs `git switch -c <wp-branch> <base>`.
  Hand-made worktrees (`git worktree add` beside the repo or under `.claude/worktrees/`) made every
  agent action look "elsewhere", and the owner got constant permission prompts.
- **No `cd` in agent commands.** A compound command starting with `cd` always prompts. Use paths,
  `git -C` and `pnpm --filter`, and prefer the Read, Grep and Glob tools for reading.
- **Autonomy:** the owner wants finished results, not questions. Decide implementation details and
  record them. Ask only for real `claude` runs (batched once), anything on `main`, and pushes.

## 3. Where everything is (2026-10-20 evening)

| What                   | Where                                                                                               | State                                                                                         |
| ---------------------- | --------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| All merged v0.2.0 work | `release/0.2.0` (head `e76cfff`+), checked out in `<repo>/.claude/worktrees/wg-coord`               | WG-0, A, B, C, D, E, docs and `start.sh` merged; `pnpm check` 4,009 tests; full e2e 71/71     |
| `main`                 | the owner's checkout                                                                                | `b6a1f27` (v0.1.0), untouched                                                                 |
| **WG-V part 1**        | branch `wp/wg-v-finish` in the isolated worktree `<repo>/.claude/worktrees/agent-a28663b1c2345cdce` | **paused**; see its `docs/workflow-graph/wp/WG-V.md` "Resume here" on that branch             |
| Old WG-V branch        | `wp/wg-v-verify` in `<repo>/.claude/worktrees/wg-v`                                                 | superseded by `wp/wg-v-finish` (same commits, rebased). Remove the worktree after WG-V merges |
| Older v0.1.0 worktrees | `<repo>/.claude/worktrees/agent-*` (about 36)                                                       | cleanup offered, not yet approved                                                             |

### Done since the plan was approved

- **WG-0:** the graph contract and ADR-0023.
- **WG-A:** the validator, `canConnect`, the compiler, the v1 migration, templates, and the
  generators and mutants.
- **WG-B:** the program-driven engine and simulator; 267 golden v1 traces stay identical.
- **WG-C:** the server, db and adapter; per-agent modes; the sandbox for a tightened Full auto block
  (contract `ManagedAgentSpec.sandbox`); the API fuzz; scenarios a, b and c.
- **WG-D:** the graph editor and the wizard template step, against the real endpoints.
- **WG-E:** the live run graph, run options "at most" with "No limit", direct rework on change
  cards, and "Used by" blocks.
- **Docs:** README landing page, `BUILD.md`, `START.md`, ADR-0001 "why TypeScript", and
  `start.sh`.
- **WG-V so far,** on `wp/wg-v-finish`:
  - engine fix F1 (a reloaded run's graph keeps its change reviewers; they had shown as
    "skipped");
  - the upgrade test from v0.1.0;
  - the data-copy check script in progress;
  - the real-run driver not started (see the agent's "Resume here").

## 4. What is left, in order

1. **Finish WG-V part 1** on `wp/wg-v-finish`, in worktree
   `<repo>/.claude/worktrees/agent-a28663b1c2345cdce`. The last commit is `a3a6632` (its progress
   file: paused). On top of `release/0.2.0` it has engine fix F1 and the upgrade test.
   - **Uncommitted, not yet through `pnpm check`,** all in
     `packages/server/tests/verification/workflow-graph/`:
     - `data-copy-check.ts` and its test (the test passes 2/2);
     - `v010-readers.ts`, which now reads rows one at a time so a large data copy can't run out of
       memory;
     - `real-run/scenarios.ts`, `flow.ts`, `drive.ts` and `drive.test.ts`: the real-run driver; it
       typechecks but has not been run yet.
   - **Next:**
     1. run `pnpm --filter @acp/server exec vitest run
tests/verification/workflow-graph/real-run` (four `--dry-run` scenarios plus the refusal
        checks) and fix what fails;
     2. run `npm_config_workspace_concurrency=1 pnpm check`, then commit task 2 and task 3
        separately;
     3. add the real-run commands, durations and token estimates to WG-V.md (RL-V used about
        54–65k budget tokens for a two-helper run);
     4. rebase if needed, run the full e2e (ports 7731/7741, 71 tests), set status `review` and
        write the report.
   - **Its decisions:**
     - scenario (b) uses a Full auto pool tightened to Auto edits, which is where "a tightened
       block keeps the sandbox" is checked;
     - in the mixed scenario, the owner allows only the Manual helper's own edits;
     - a dry run sends each agent start through the real adapter with a stub, so the reported
       permission mode and sandbox are the adapter's own.
   - **To resume:** start an agent with `isolation: "worktree"` that runs `git switch
wp/wg-v-finish` (first remove or reuse the paused worktree, since a branch can only be checked
     out once), or reuse the paused worktree directly. Agents must not use `cd`.
2. **Coordinator:** review, then merge into `release/0.2.0` (`--ff-only` in `wg-coord`).
3. **Run the data-copy check** (the owner consented): Step 4b item 4 below, using the exact command
   in WG-V.md.
4. **Run the rollback check** (Step 4b item 5).
5. **Ask the owner ONCE** for the four real runs (a, b, c, mixed), with time and token estimates
   from WG-V.md. Run them, and write `docs/research/wg-v-real-run-<date>.md`.
6. **Remove the v1 endpoints and DTOs** (Step 4).
7. **Release prep** (Step 5): the README workflow-graph section and screenshots, CHANGELOG
   `[0.2.0]`, version bumps, the PR title and description. Then the owner tests on separate ports
   and raises and merges the PR in GitHub.
8. **Before release, check in the real app:** the Start dialog screenshot showed a blank band at the
   top; and the ⌘K palette is not covered by the unsaved-changes guard (known gap).

Steps 4–5 below keep the detail from the plan.

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

### Step 4b: the no-regression gate (owner request 2026-10-20: "make sure we don't break anything")

All of these must pass before the release MR:

1. **Golden traces:** the 267 v0.1.0 engine traces stay identical. They are in the orchestrator
   suite, so `pnpm check` covers them.
2. **Every merge:** the full `pnpm check` and the full e2e on free ports, with no exceptions.
3. **Upgrade test (automated, WG-V):**
   - a temp database in v0.1.0 shape: projects with a stored v1 workflow (every planner and
     reviewer setting), the default workflow, finished v1 runs with snapshots, tickets with their
     own run options, and plans;
   - the new server must load it all;
   - each project's `GET /workflow-graph` must answer `stored: 'v1'` or `'default'` with zero error
     issues;
   - old run pages (`/api/runs/:id`, `/workflow-graph` migrated) must load;
   - a new ticket must start (fake adapter).
4. **The owner's data, on a copy. The owner consented in chat on 2026-10-20.**
   - Take the copy with SQLite's online backup (`.backup`) of `~/.agent-control-plane/acp.sqlite`
     into the scratchpad.
   - Start the new build on it with `ACP_DATA_DIR=<copy>`, free ports, and `ACP_CLAUDE_DIR` set to an
     empty temp folder, so nothing under `~/.claude` is read.
   - Check that every project's workflow graph loads with no errors, and that tickets, runs and run
     pages answer 200.
   - Report only counts and pass/fail. No ticket text, plans or names go into the output or the
     repo.
   - Start no runs. Delete the copy afterwards.
   - Run it after WG-C and WG-D merge.
5. **Rollback:** v0.1.0 (`main`) still opens the same copied data after the new build used it (no
   migration means nothing changed shape).
6. **Real runs,** consented each time (Step 4).
7. **Owner testing:** the owner tests the release branch on separate ports before merging the MR.

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
5. **Merge:** the work is already on `release/0.2.0` (in a worktree, never
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
