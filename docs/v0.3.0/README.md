# v0.3.0: session names and run summaries (S series)

Coordinator-owned plan. The status is in [STATUS.md](STATUS.md), the decision in
[ADR-0024](../decisions/0024-session-names-and-run-summaries.md), and the progress files in
`wp/S-*.md`, one per WP, each edited only by its agent.

## Working rules (owner decisions, binding)

- **Never touch `main`.** All work is on `release/0.3.0`, and the owner raises and merges the PR
  to `main` in GitHub. `release/0.3.0` started from `release/0.2.0` (`259feee`); once the owner
  merges 0.2.0, rebase it onto `main`.
- **Agents start with the Agent tool's `isolation: "worktree"`** and create their branch with `git
switch -c wp/s-<id>-<slug> release/0.3.0`.
- **No `cd` in agent commands;** use paths, `git -C` and `pnpm --filter`. Coordinator merges
  happen in `<repo>/.claude/worktrees/v3-coord` with `git -C … merge --ff-only`.
- **The owner wants finished, verified results.** Agents decide details and record them.
- **Real `claude` runs only with the owner's consent in chat,** batched.

## What we are building

1. **Session titles at start.** The server builds `ManagedAgentSpec.title` from app data, and the
   adapter passes it to the Agent SDK's `title` option (SDK 0.2.113 or later; this repo uses
   0.3.296). Formats are in ADR-0024 §1; follow-ups keep the resumed title.
2. **Names in the app.**
   - `SessionSummaryDto.managed` names the sessions the app started.
   - Untitled helper agents show their type and description.
   - Other untitled sessions show their branch and start time.
3. **The run summary comment** (author `app`).
   - **At handover:** facts from records plus the lead's optional `request_review.summary`
     (at most 1,500 characters, 3 to 6 sentences).
   - **On a run that ends without a handover:** facts only.
   - **After the owner's merge:** "Merged acp/KEY into main at …".

No migration (ADR-0024 §4).

## Contract (S-0, coordinator, done in its commit)

- `TicketCommentAuthorSchema` gains `app`.
- `ManagedAgentSpec.title?`, with `MAX_SESSION_TITLE = 120` (core `orchestration`).
- `SessionSummaryDto.managed?: { runId, agentRunId, ticketKey | null, kind, label }`.
- **Pre-approved for S-A** (added together with the code that uses it, so the lead never sees a
  field that does nothing): `LeadToolInputs.request_review` gains
  `summary?: string` (trimmed, 1 to 1,500 characters), plus the adapter test that pins the lead
  tool inputs.

## Work packages

| WP  | What                                                                                                                                                                                                                                                                 | Owned paths                                                                                                                 | After                      |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | -------------------------- |
| S-0 | ADR-0024, contract, docs                                                                                                                                                                                                                                             | core contract files above, `docs/v0.3.0/**`, ADR index                                                                      | —                          |
| S-A | Titles built by the server and passed to the SDK by the adapter; `managed` on session DTOs; `request_review.summary` (engine effect, lead brief); the run summary composed by the server; the facts-only summary on runs that end without a handover; the merge line | `packages/{orchestrator,server,adapters/claude-code}/**`, `packages/db/src/repositories/**`, the pre-approved contract edit | S-0                        |
| S-B | Web: session names (managed label, helper and top-level fallbacks) in Sessions and the agent trees; `app` comments rendered as a run summary card; copy                                                                                                              | `packages/web/**`                                                                                                           | S-0 (mocks), then S-A DTOs |
| S-V | Verification: e2e on the real server; a consented real run confirming the title shows; the README, the CHANGELOG `[0.3.0]`, release prep                                                                                                                             | `e2e/**`, `docs/**`, the real-run driver                                                                                    | S-A, S-B                   |

## Acceptance

- **Titles:** every managed agent's SDK `query()` receives a title of the agreed format (adapter
  test with a fake SDK). In a consented real run, Claude Code records it; check how with the least
  reading, for example the app's own session ingestion of the throwaway project.
- **Summary:** a run summary comment after every handover, with facts matching the database and
  the lead's note when given; a facts-only summary on failure or stop; a merge line after the
  owner's merge.
- **Content:** no conversation content in titles or facts, by test.
- **Names in the app:** the Sessions page shows the managed label for app sessions and the
  fallbacks for untitled ones.
- **Checks:** `pnpm check` and the full e2e stay green.

## Part 2: GitHub and branching strategies (G series, ADR-0025)

These are owner decisions from 2026-10-22:

- use the `gh` CLI login (the app never holds a token);
- only the owner's button pushes or opens a pull request;
- the final step is to merge locally **or** push and open a pull request, chosen per ticket;
- syntax highlighting is allowed (Shiki 4.5.0, added in G-0).

### Contract (G-0, done)

- **`workspace/branching.ts`:**
  - `GitBranchNameSchema` and `isSafeBranchName`;
  - `BranchStrategySchema`, with presets `github-flow`, `git-flow` and `custom`, from
    `branchStrategyPreset()`;
  - `BranchTemplateSchema` (`{key}` required, plus `{slug}` and `{type}`);
  - `renderTicketBranchName()` and `branchSlug()`;
  - `TicketBranchPrefsSchema` (`name?`, `target?`) and its patch.
- **`TicketBranchNameSchema`** is now any safe branch name. The old `acp/<KEY>` names still parse.
- **Additive fields:** `ProjectAgentSetup.branching?`, `Ticket.branch?`, create and update ticket
  requests `branch`, `UpdateProjectSetupRequest.branching` (null removes it), and
  `TicketBranchDto.pullRequest?`.
- **`api/code-host.ts`:** `CodeHostStatusDto`, `PullRequestDto` and `OpenPullRequestRequest`.

### Work packages

| WP  | What                                                                                                                                                                                                                                                                                                                                                                                    | Owned paths                                                    | After |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- | ----- |
| G-0 | ADR-0025, the AGENTS.md rule 8 amendment, the contract, Shiki                                                                                                                                                                                                                                                                                                                           | core contract, docs, `packages/web/package.json`, the lockfile | —     |
| G-A | Server and db: migration 0008 (ticket `branch_prefs`; `ticket_branches` rebuilt without the `acp/*` check, plus the pull request columns); strategy and ticket settings read and write; branch naming at plan approval from the target; merge into the target; the `CodeHost` service with `gh` (status, push, create, view); endpoints; tests with a local bare remote and a fake `gh` | `packages/{server,db,orchestrator}/**`, the new migration      | G-0   |
| G-B | Web: the branching strategy in project settings (presets, template preview); the ticket's branch name and target in New ticket and the ticket page; code host status; the final-step card (merge locally, or Push & open PR, with the link, state and Refresh)                                                                                                                          | `packages/web/**` (not the diff viewer)                        | G-0   |
| G-C | Web: the shared diff viewer (file list, unified or split, Shiki, word-level changes, collapsing, large-diff guard) in the change cards and the ticket branch card                                                                                                                                                                                                                       | `packages/web/src/components/diff/**` and where it is used     | G-0   |
| G-V | e2e on the real server; one consented real push and pull request to a throwaway GitHub repo of the owner's; docs; CHANGELOG                                                                                                                                                                                                                                                             | `e2e/**`, docs                                                 | all   |

### Rules for G-A

- **Commands:** never a shell. `git` and `gh` as argument arrays with a time limit,
  `GIT_TERMINAL_PROMPT=0` and `GH_PROMPT_DISABLED=1`.
- **Output:** `gh auth status` and `gh --version` are judged by exit code only. Output is never
  logged; errors map to plain codes.
- **Network in tests:** none. Push to a local bare repository; `gh` is a fake executable, or an
  injected runner, in tests.
- **Migration:** additive. The coordinator backs up the owner's live database before the first
  start on a build with migration 0008.

## Part 3: GitHub-like redesign (D series)

Owner decisions, 2026-10-22: "everything is there but not clear"; the answers were:

- a GitHub-like palette (keep the logo);
- themes Light / Dark / System;
- code review as GitHub's "Files changed", with line comments that go back as rework notes;
- the ticket page and the Workflow editor are the least clear.

| WP  | What                                                                                                                                                                                                                                                                                               | After |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- |
| D-0 | Tokens in GitHub style (light and dark, the diff colours), the system font stack, the Light/Dark/System switch, the shell and shared components restyled, DESIGN.md v3; screenshots for the owner's design checkpoint                                                                              | —     |
| D-A | The review page like GitHub's "Files changed", per change and for the ticket branch: a file tree, side-by-side, Viewed checkboxes, comments on lines as a pending review, and "Request changes" sending the comments as rework text through the existing owner decision endpoints (no new storage) | D-0   |
| D-B | The ticket page like a PR page: a header (title, status, branch → target), tabs Conversation / Agents / Files changed / Checks, and a right sidebar (branch, target, PR, run options, tokens)                                                                                                      | D-0   |
| D-C | Workflow editor clarity in the new style: blocks, links, legend, panel                                                                                                                                                                                                                             | D-0   |
| D-V | e2e, both themes, a final screenshot review with the owner                                                                                                                                                                                                                                         | all   |

## Part 4: Comments, Conversation, attachments, shell polish (C series), done

These are the owner's decisions from 2026-10-22, to go into 0.3.0:

- The ticket page splits into **Comments** (first tab, the "home") and **Conversation** (last tab,
  what happened).
- **Attachments:** the owner adds them; agents can read them.
- **Agent notes:** every helper and tester writes a short "what I did" note.
- **The lead** writes in Comments a summary of what was done on the **whole ticket**.
- **The shell is bigger and clearer:** the sidebar toggle moves into the sidebar as a chevron, and
  the header has the logo plus "ACP" on the left and the search centred.

### Design

- **Tabs:** Comments · Agents · Files changed · Checks · Conversation.
- **Comments:**
  - the key, title and description (with editing), and attachments (on the ticket or a comment);
  - the owner's comments, and the lead's **ticket summary**: one comment for the whole ticket,
    updated by later runs and marked "updated";
  - safe formatting (paragraphs, lists, code, links; no raw HTML).
- **Conversation:** a filterable timeline (by agent):
  - runs and plan versions;
  - each helper's and tester's note;
  - reviewer findings, rework, discard and ask notes, and decisions;
  - the per-run facts (ADR-0024's facts move here);
  - merge and pull request lines.
- **Agent notes:** a small tool for workers and testers, "report what I did", 2–4 sentences, at most
  about 600 characters (about 50–150 tokens per turn). Stored like the lead's summary and the
  reviewer's findings; conversations are still never stored. This amends ADR-0019 §7's tool sets,
  with the tool added to `worker` and `tester` only.
- **Attachments:**
  - stored in the app's data folder, with limits such as 10 MB per file and an allowlist of types
    (images, text and logs, PDF, archives);
  - downloaded from the local server only;
  - images previewed.
  - **Agents** get read-only copies outside the owner's checkout, never committed (for example,
    under the run's data folder or an excluded path in the helper's worktree, chosen by C-A), and
    their brief lists them by name.
- **Merged "Files changed":** read-only after a merge, from the recorded commits (base → merged or
  head). A change whose commits git no longer has shows "no longer available". Diffs are still never
  stored.
- **Shell (C-S):**
  - the sidebar is wider, with roomier items; the header is about 56px tall; body text is about
    15px, with headings scaled;
  - the sidebar toggle is a chevron in the sidebar itself (‹ open, › collapsed), and ⌘B stays;
  - the header has the logo plus "ACP" on the left (the full name as tooltip and accessible name),
    a wide centred search, and the project switcher and theme on the right.

### Work packages

| WP  | What                                                                                                                                                                                                              | After |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- |
| C-0 | ADR-0026 (Comments vs Conversation, the agent notes tool, attachments and agent access, migration 0009), contracts                                                                                                | —     |
| C-A | Server, db and engine: migration 0009 (agent notes, attachments), the notes tool, the activity API, attachment upload and download, attachments for agents, the lead's ticket summary, the read-only merged diffs | C-0   |
| C-B | Web: the tab restructure, Comments with attachments and the summary, the Conversation timeline with filters, read-only merged Files changed                                                                       | C-0   |
| C-S | Web shell: sizes, the sidebar chevron toggle, the header redesign                                                                                                                                                 | —     |
| C-V | The full check and e2e once, plus one consented real run (agent notes, summary, attachments)                                                                                                                      | all   |

**Process:** lean verification (agents run targeted tests; the coordinator runs the full check and
e2e once per merge). Back up the live database before migration 0009. C-A, C-B and C-S can run in
parallel after C-0.

## Part 5: the harness in the workflow (H series, ADR-0027), done

**Owner request (2026-10-23):** "we are not able to introduce harness in orchestration graph, so we
need to plan how are we going to bring in harness", then "write the plan with setup step included",
then "i think we can have this as part of 0.3.0" (the plan approved, in 0.3.0).

### What a harness is

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

### The problem

- **One fixed block.** The workflow graph has a single Checks block, wired only behind the lead's
  merge. It always runs every required check at that one point. The owner cannot choose which checks
  run where (fast lint on each helper's change; slow end-to-end tests once on the finished branch).
- **No failure route.** A failed check reaches the lead only when it tries to merge. It cannot go
  straight back to the helper, and the owner cannot ask to be told.
- **No setup.** A fresh worktree has no dependencies, so checks such as `npm test` fail unless the
  agent installs things itself (and asks the owner for every command).

### What we are building

#### 1. The harness file gains setup steps and labels (`.acp/harness.json`, still version 1, additive)

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

#### 2. When setup runs

- **Before an editing agent starts** (helper or tester), in its new worktree, so the agent can run
  checks itself from its first turn.
- **Before checks run in a fresh checkout** (the ticket branch's tip, or "Run checks now" on main).
- **Not for reading agents** (lead, planner, reviewers): they never run anything.
- **A failed setup** stops that agent from starting. The lead is told which step failed with the
  last lines of its output, and the ticket shows it under Checks. The owner can retry.
- **Each run is recorded** (step, status, time, the last 16 KiB of output, redacted), like a check.

#### 3. Checks blocks in the workflow graph

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

#### 4. Agents and the harness

- An editing agent's brief lists the setup that ran, and the checks it may run (by name and
  command). Running exactly those commands is already pre-approved by the project allowlist.
- A check block's failure note to a helper holds the check's name, its exit, and the last 4 KiB of
  its output (the project's tool output, redacted; never conversation content, ADR-0009).

#### 5. Pages

- **Harness page:** the setup steps (with "uses the network" shown), the checks with labels, where
  each check runs in the workflow, "Run setup and checks now" on main, and the last results.
- **Workflow editor:** the Checks block's panel (which checks, on failure, rounds), blocks dropped
  on a helper's route or on the ticket branch, and the problems list for missing check names.
- **Ticket, Checks tab:** results grouped by block (on each change, before merge, on the branch),
  and setup runs above them.

#### 6. Out of scope for now

- Sharing setup outputs between worktrees (each worktree runs its own setup; package managers'
  global caches make repeats fast). A follow-up can add a cache keyed on lock files.
- Editing `.acp/harness.json` from the Harness page. It stays a reviewed file in the repository,
  changed through a ticket ("Improve the harness" template). A later ADR can allow the app to write
  it on an owner action, as ADR-0018 does for skills.
- Network isolation of setup and check processes (see §1).
- The Harness Lab.

### Work packages

| WP  | What                                                                                                                                                                                                                                      | After |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- |
| H-0 | Coordinator: ADR-0027, contracts: manifest `setup`, `labels`, `outputs`, `network`; the Checks block's config and placements; the check-failure rework edge; DTOs for setup runs and grouped checks; the project switch                   | —     |
| H-A | Core logic: manifest validation, graph validation and compile for check blocks (places, selection, failure routes, migration of old graphs), templates, golden traces                                                                     | H-0   |
| H-B | Server and db: the setup runner (worktrees and check checkouts), `outputs` kept out of staging, running each block at its point, failure routing (rework, lead, owner), setup and grouped check records (migration 0010), the Harness API | H-A   |
| H-C | Engine: change checks before review, the direct rework loop from a check block, the lead's notices, the brief lines                                                                                                                       | H-A   |
| H-D | Web: the Workflow editor's Checks block, the Harness page, the ticket's Checks tab                                                                                                                                                        | H-0   |
| H-V | Full check and e2e once per merge; one consented real run with a setup step and checks on each change and on the branch                                                                                                                   | all   |

**Process:** as for the earlier parts (agents in isolated worktrees, branches `wp/h-<id>-<slug>` from
`release/0.3.0`, lean verification, the coordinator runs the full check and e2e once per merge,
back up the live database before migration 0010).

### Acceptance

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

## Release (R-3)

Release prep is on `wp/r-3-b` (progress in [wp/R-3.md](wp/R-3.md)): every `package.json` at
`0.3.0` (the app's footer reads "Server 0.3.0"), the unused `@fontsource-variable` fonts removed,
the CHANGELOG `[0.3.0] - 2026-10-25` entry, the README and its screenshots (sample data only), and
the PR text and release notes in `.acp-data/` (git-ignored): `pr-v0.3.0.md` and
`release-notes-v0.3.0.md`.

`origin/main` is `79c312a`, the merge of `release/0.2.0`, and `release/0.3.0` already contains its
tree, so no rebase onto `main` is needed.

### Owner steps

1. After the coordinator merges R-3 into `release/0.3.0`, push it:
   `git push origin release/0.3.0`.
2. Optional: run CI on `release/0.3.0` by hand (Actions → CI → Run workflow).
3. Raise the PR `release/0.3.0` → `main` in GitHub, with the title and body from
   `.acp-data/pr-v0.3.0.md`, and merge it there.
4. Restart your app on the new `main`. If it has not yet started on a build with migration 0011,
   back up the live database first (a backup at migration 10 exists from 2026-10-24); 0.2.0 cannot
   open the database afterwards.
5. Tag the merge commit on `main` as `v0.3.0` and create the GitHub release from that tag, with the
   text in `.acp-data/release-notes-v0.3.0.md`.
