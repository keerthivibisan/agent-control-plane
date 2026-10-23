# v0.4.0 plan: the harness in the workflow (H series), PLANNED, not started

Coordinator-owned plan. The status is in [STATUS.md](STATUS.md), the decision in
[ADR-0027](../decisions/0027-harness-setup-and-check-blocks.md) (proposed), and the progress files
will be in `wp/H-*.md`, one per WP, each edited only by its agent.

**Owner request (2026-10-23):** "we are not able to introduce harness in orchestration graph, so we
need to plan how are we going to bring in harness", then "write the plan with setup step included".

## What a harness is

The word has two meanings in agent tools.

1. **The agent harness** is everything around the model that makes it an agent: the loop, its tools,
   its instructions, its permissions. Claude Code is one; our orchestration sits on top of it.
2. **The test harness** is everything that checks the agent's work: setup, tests, lint, build. This
   is what ACP's harness is (ADR-0017): "the code and configuration that let AI agents check their
   own work, so changes are validated before merge".

It is a **place where work is validated**, not a playground. An agent only knows its work is done
when something independent says "this passes". Without a harness the owner is the test suite. The
playground idea (running the same task many times with and without a harness to compare agents) is
the later Harness Lab (roadmap Phase 5) and is not part of this plan.

A harness answers four needs:

| Need         | What it means                                          | Today                               |
| ------------ | ------------------------------------------------------ | ----------------------------------- |
| **Setup**    | install dependencies, generate code, prepare test data | missing                             |
| **Feedback** | agents run checks while they work and fix what fails   | yes (helpers may run listed checks) |
| **A gate**   | failing work does not merge                            | yes, one fixed block before merges  |
| **Context**  | how the project builds, tests and is laid out          | partly (context files and notes)    |

## The problem

- **One fixed block.** The workflow graph has a single Checks block, wired only behind the lead's
  merge. It always runs every required check at that one point. The owner cannot choose which checks
  run where (fast lint on each helper's change; slow end-to-end tests once on the finished branch).
- **No failure route.** A failed check reaches the lead only when it tries to merge. It cannot go
  straight back to the helper, and the owner cannot ask to be told.
- **No setup.** A fresh worktree has no dependencies, so checks such as `npm test` fail unless the
  agent installs things itself (and asks the owner for every command).

## What we are building

### 1. The harness file gains setup steps and labels (`.acp/harness.json`, still version 1, additive)

```json
{
  "version": 1,
  "setup": [
    {
      "id": "install",
      "name": "Install dependencies",
      "argv": ["pnpm", "install", "--frozen-lockfile"],
      "timeoutSec": 600,
      "network": true,
      "outputs": ["node_modules"]
    }
  ],
  "checks": [
    {
      "id": "lint",
      "name": "Lint",
      "argv": ["pnpm", "lint"],
      "timeoutSec": 300,
      "required": true,
      "labels": ["fast"]
    },
    {
      "id": "e2e",
      "name": "End-to-end",
      "argv": ["pnpm", "test:e2e"],
      "timeoutSec": 1800,
      "required": true,
      "labels": ["full"]
    }
  ]
}
```

- **Setup steps** (at most 5) are run like checks: an argument list, no shell, a time limit, a
  filtered environment, inside an agent's worktree or a check checkout, **never in the owner's
  checkout**.
- **`network: true`** declares that a step downloads things. The Harness page shows it, and a
  project switch "Setup may use the network" (off by default) must be on for such a step to run.
  The app cannot cut a step off from the network on its own; the declaration and the switch make
  the owner's consent explicit (ADR-0027 §2).
- **`outputs`** are folders the step creates (`node_modules`, `.venv`, `build/`). The app never
  stages them in a helper's change, the same way it never stages attachment copies.
- **Labels** (`fast`, `full`, any slug) let a Checks block pick a group of checks.
- Older files keep working: no setup, no labels, every required check as today.

### 2. When setup runs

- **Before an editing agent starts** (helper or tester), in its new worktree, so the agent can run
  checks itself from its first turn.
- **Before checks run in a fresh checkout** (the ticket branch's tip, or "Run checks now" on main).
- **Not for reading agents** (lead, planner, reviewers): they never run anything.
- **A failed setup** stops that agent from starting. The lead is told which step failed with the
  last lines of its output, and the ticket shows it under Checks. The owner can retry.
- **Each run is recorded** (step, status, time, the last 16 KiB of output, redacted), like a check.

### 3. Checks blocks in the workflow graph

The Checks block becomes configurable and can appear in three places:

| Where                       | Runs on                                       | Today's equivalent           |
| --------------------------- | --------------------------------------------- | ---------------------------- |
| **On a helper's change**    | the sealed change, before its review          | none                         |
| **Before the lead's merge** | the change integrated with the ticket tip     | the one fixed block (kept)   |
| **On the ticket branch**    | the tip after every change, before your merge | the tip checks (now visible) |

Each block has:

- **Which checks:** all required checks (the default), a list of check ids, or labels
  (`fast`, `full`). The editor lists the project's checks to pick from and warns when a name no
  longer exists in the harness file.
- **On failure:**
  - **Back to the helper** (rework with the failing check names and the end of their output, at
    most `maxRounds`, 0–5): the owner's question 1, answered by the coordinator as an option, not
    the default. The lead is told each round, as in the reviewer loop.
  - **The lead decides** (the default): today's behaviour.
  - **Ask me:** the change waits for the owner.
- **Rules** (checked by the editor and the server, as for every graph):
  - at most one block in each place per route;
  - a "back to the helper" link only from a change block to the helper it checks;
  - the block before the lead's merge stays mandatory (one per graph, as today), so no graph can
    merge a change without checks;
  - the owner's final merge keeps requiring the required checks on the tip ("Merge anyway" with a
    reason is unchanged).
- **Old graphs** migrate to one block before the lead's merge, with "all required checks" and "the
  lead decides": exactly today's behaviour.

### 4. Agents and the harness

- An editing agent's brief lists the setup that ran, and the checks it may run (by name and
  command). Running exactly those commands is already pre-approved by the project allowlist.
- A check block's failure note to a helper holds the check's name, its exit, and the last 4 KiB of
  its output (the project's tool output, redacted; never conversation content, ADR-0009).

### 5. Pages

- **Harness page:** the setup steps (with "uses the network" shown), the checks with labels, where
  each check runs in the workflow, "Run setup and checks now" on main, and the last results.
- **Workflow editor:** the Checks block's panel (which checks, on failure, rounds), blocks dropped
  on a helper's route or on the ticket branch, and the problems list for missing check names.
- **Ticket, Checks tab:** results grouped by block (on each change, before merge, on the branch),
  and setup runs above them.

### 6. Out of scope for v0.4.0

- Sharing setup outputs between worktrees (each worktree runs its own setup; package managers'
  global caches make repeats fast). A follow-up can add a cache keyed on lock files.
- Editing `.acp/harness.json` from the Harness page. It stays a reviewed file in the repository,
  changed through a ticket ("Improve the harness" template). A later ADR can allow the app to write
  it on an owner action, as ADR-0018 does for skills.
- Network isolation of setup and check processes (see §1).
- The Harness Lab.

## Work packages

| WP  | What                                                                                                                                                                                                                                      | After |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- |
| H-0 | Coordinator: ADR-0027, contracts: manifest `setup`, `labels`, `outputs`, `network`; the Checks block's config and placements; the check-failure rework edge; DTOs for setup runs and grouped checks; the project switch                   | —     |
| H-A | Core logic: manifest validation, graph validation and compile for check blocks (places, selection, failure routes, migration of old graphs), templates, golden traces                                                                     | H-0   |
| H-B | Server and db: the setup runner (worktrees and check checkouts), `outputs` kept out of staging, running each block at its point, failure routing (rework, lead, owner), setup and grouped check records (migration 0010), the Harness API | H-A   |
| H-C | Engine: change checks before review, the direct rework loop from a check block, the lead's notices, the brief lines                                                                                                                       | H-A   |
| H-D | Web: the Workflow editor's Checks block, the Harness page, the ticket's Checks tab                                                                                                                                                        | H-0   |
| H-V | Full check and e2e once per merge; one consented real run with a setup step and checks on each change and on the branch                                                                                                                   | all   |

**Process:** as for 0.3.0 (agents in isolated worktrees, branches `wp/h-<id>-<slug>` from
`release/0.4.0`, lean verification, the coordinator runs the full check and e2e once per merge,
back up the live database before migration 0010). `release/0.4.0` starts from `release/0.3.0`
once the owner approves this plan.

## Acceptance

- A project with setup and labelled checks runs setup in every helper's and tester's worktree before
  the agent starts, and in every check checkout before its checks.
- A graph with a fast block on each helper's change ("back to the helper", 2 rounds), the block
  before the lead's merge, and a full block on the branch runs each block at its point; a failing
  fast check reworks the helper without the lead deciding; the owner's merge still needs the
  required checks on the tip.
- `outputs` never appear in a change, a commit or the owner's checkout.
- A setup step with `network: true` does not run while the project switch is off, and the ticket
  says why.
- Old harness files and old graphs behave exactly as in 0.3.0 (golden traces).
- No conversation content stored; check and setup output stays the redacted last 16 KiB.
