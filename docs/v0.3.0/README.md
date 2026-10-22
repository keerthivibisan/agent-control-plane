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
