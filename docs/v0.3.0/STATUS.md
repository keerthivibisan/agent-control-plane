# v0.3.0 (S series): status

Coordinator-owned. Plan: [README.md](README.md). Decision:
[ADR-0024](../decisions/0024-session-names-and-run-summaries.md).

| WP  | Title                                      | After    | Status      | Branch        | Merged    |
| --- | ------------------------------------------ | -------- | ----------- | ------------- | --------- |
| S-0 | ADR-0024, contract, docs                   | —        | **done**    | release/0.3.0 | `e9f2d0c` |
| S-A | Titles, managed session DTO, run summaries | S-0      | **done**    |               |           |
| S-B | Web: session names, run summary card       | S-0      | **done**    |               |           |
| S-V | Verification, real run, release prep       | S-A, S-B | not started |               |           |

## Log

- 2026-10-21 The owner approved v0.3.0: session names at start, and a cheap but proper run summary
  comment ("the lead alone can comment what are all done"). `release/0.3.0` was created from
  `release/0.2.0` `259feee`. S-0 started.
- 2026-10-21 S-0 done: ADR-0024 accepted, contract (`app` author, `ManagedAgentSpec.title`,
  `SessionSummaryDto.managed`), plan. 4,601 tests. S-A and S-B started in parallel.
- 2026-10-21 S-B merged (`246b12e`).
  - One naming function, used everywhere sessions are listed or drawn: the managed label with
    "Started by Agent Control Plane", else the Claude title, else "Helper agent: <type>" with its
    description, else "Session on <branch> · <time>". Never "Untitled".
  - `app` comments show as a Run summary card, with the merge line shown small.
  - Coordinator check: 4,633 tests; e2e 75/75.
  - **Proposal accepted, for S-A:** add `managed`, `firstSeenAt`, `gitBranch` and `agentType` to
    `ProjectTokensDto.bySession`, so the Tokens and cost lists can use the same names (today they
    show "Session 1a2b3c4d").
- 2026-10-21 S-A merged (`7c4f5f4`).
  - **Titles:** every managed agent is titled at launch via the SDK `title` option
    (`WEB-12 · Frontend helper`, `… · Change reviewer → Frontend helper`, `Run · Lead`); follow-ups
    keep theirs.
  - `SessionSummaryDto.managed` is filled, and the Tokens rows carry the naming fields.
  - `request_review.summary`, the lead's note.
  - **The run summary comment:** facts from records plus the note, `(updated)` on a later handover,
    facts only on fail or stop, and the merge line after the owner's merge.
  - **Golden traces:** 255 snapshots changed only by the new `handover-summary` effect and the
    longer lead prompts (about 160 characters); checked by the coordinator, with no decision or
    state change.
  - Coordinator check: 4,679 tests; e2e 75/75.
  - **Known gap:** the summary at handover often has no tip checks yet, because they start after
    REVIEW.
- 2026-10-21 **The owner consented to one real run** after S-A merges, to confirm the session titles
  (via the SDK's `getSessionInfo` for that run's own sessions only) and to review the real ticket
  comments.
- 2026-10-21 **Real run passed** (scenario b, about 37k budget tokens).
  - Claude Code recorded each session's title as its custom title, with no AI title:
    `WGVB-1 · Lead`, `WGVB-1 · Helpers`, `WGVB-1 · Change reviewer → Helpers`. The check used the
    SDK `getSessionInfo` scoped to each session's own folder.
  - The ticket got the reviewer's findings, a clear run summary with the lead's four-sentence note,
    and the merge line. See `docs/research/s-v-real-run-2026-10-21.md`. The temp data was deleted.
- 2026-10-21 S-A2 merged (`f147276`).
  - At handover the summary's branch line reads "waiting for your merge", never "open".
  - The merge line gains the tip checks, and says "merged anyway, with a reason" without the
    reason text. The web parses the commit apart from the detail.
  - Coordinator check: 4,683 tests; e2e 75/75.
- 2026-10-21 **Owner feedback on the run summary:** it reads like a per-step report, and should read
  like a human comment ("we explored this, added this feature and tested this").
  - **S-C started** (`wp/s-c-human-comment`): the lead's note becomes the comment, in past tense
    (explored → built → tested → left), with a short example in the prompt.
  - The facts move under a collapsed "Details" section, worded as plain sentences.
  - A run without a note gets one plain sentence.
- 2026-10-21 **Paused by the owner.** To resume:
  1. finish S-C (see its `wp/S-C.md` "Resume here" on its branch);
  2. merge it, then restart the owner's app;
  3. ask the owner for the rest of their 0.3.0 plans ("I have few more plan for the 0.3.0
     release");
  4. rebase `release/0.3.0` onto `main` (0.2.0 is merged in GitHub: `origin/main` `79c312a`);
  5. release prep.
  - **Owner's app:** runs `release/0.3.0` from `.claude/worktrees/v3-coord` (`pnpm dev`, 5173/7420)
    with the real data. Backup before 0.3.0:
    `~/.agent-control-plane/backups/acp-before-0.3.0-20261021-232251.sqlite`. The local `main` is
    still `b6a1f27`; the owner can `git pull --ff-only` to reach `79c312a`.
- 2026-10-21 **S-C paused** (`99c366a` on `wp/s-c-human-comment`, worktree
  `.claude/worktrees/agent-a0f8d98453fef2751`).
  - All the work is written but uncommitted (17 files): it waits for one green
    `npm_config_workspace_concurrency=1 pnpm check`; two lint errors were fixed after the last
    check.
  - Its focused tests pass. The golden traces changed only in the lead prompt hashes (255
    snapshots).
  - **To review on resume:** the lead prompt line grew from 165 to 611 characters (about 110
    tokens each time it is sent). Trim it toward about 300 characters, since the owner asked not to
    spend more tokens.
  - **Next:** the check, four commits, the full e2e, review, merge, then restart the owner's app.
- 2026-10-22 S-C merged (`d0426ff`).
  - The run summary reads as a human comment: "Lead · Run summary" with the lead's past-tense
    teammate-style note, and the facts as plain sentences under a collapsed "Details". Runs without
    a note get one plain sentence.
  - The lead prompt line is 297 characters (165 before), about 30 more input tokens per run.
  - Golden traces: only the prompt hashes changed.
  - Coordinator check: 4,701 tests; e2e 76/76.
- 2026-10-22 **The owner approved part 2 (G series):** GitHub through `gh`, branching strategies,
  the ticket's branch name and target, Push & open PR, and the diff view. G-0 is done: ADR-0025,
  the AGENTS.md rule 8 amendment, the contract, and Shiki 4.5.0. G-A, G-B and G-C started.
- 2026-10-22 G-C merged (`5c1e446`).
  - **The shared diff viewer:** a file list, unified or side-by-side (remembered), Shiki syntax
    colours loaded on demand and bundled (no network), word-level highlights, folded unchanged
    lines, a large-diff guard and the server's cut notice, keyboard support.
  - It is used in the change card and the ticket branch card.
  - Coordinator check: 4,793 tests; e2e 78/78.
  - **Follow-ups:** auto-unified in narrow panels; move the control panel's `ReviewPanel` and the
    ticket's `ChangesTab` onto `DiffSection`.
- 2026-10-22 G-B merged (`07cd88e`), rebased by the coordinator onto G-C.
  - **Conflicts resolved:** both e2e projects kept in `playwright.config.ts`, and the card's
    imports.
  - **What it adds:** branching strategy settings with presets and a live preview; GitHub status in
    settings; a ticket's branch name and target in New ticket and on the ticket page; the
    final-step card ("Merge into <target>" or "Push & open PR", with confirmation, link, state and
    Refresh).
  - Coordinator check: 4,847 tests; e2e 81/81.
  - **Follow-up:** a "Push new commits" button for an open pull request, once G-A's re-push lands.
- 2026-10-22 G-A merged (`6933079`), rebased by the coordinator onto G-B and G-C.
  - **Migration 0008:** `tickets.branch_prefs`, `ticket_branches` rebuilt without the `acp/*`
    check, and the pull request columns with `pr_pushed_commit`.
  - **Branches:** named from the ticket, the strategy or `acp/<KEY>`, and created from the target.
    The target must exist locally (`target_branch_missing`).
  - **The real branch guard:** never the target, `main` or `master`, the strategy's branches,
    origin's default branch, or the checked-out branch.
  - **The local merge into the target:** a clean fast-forward when it is checked out, a CAS ref
    update when it is not, refused in another worktree.
  - **The `gh` CodeHost:** execFile with no shell, no prompts, `GIT_*` cleared, stderr never read,
    explicit refspec and never a force, `--no-verify` (repo hooks don't run).
  - **The pull request:** open or link, push again (fast-forward only), and Refresh to merged marks
    the ticket Done.
  - Coordinator check: 4,899 tests; e2e 81/81.
  - **Follow-ups (web):** parse the "Merged via pull request" line; refresh an open PR when the
    ticket opens; a "Push new commits" button (`pushedCommit` ≠ head); auto-unified diffs in
    narrow panels; move `ReviewPanel` and `ChangesTab` to `DiffSection`. Note `--no-verify` in
    ADR-0025.
- 2026-10-22 G-D merged (`f542167`): the web follow-ups.
  - **Comment lines:** the pull request's comment lines render as system lines.
  - **Refresh:** an open pull request is read once per visit to the ticket, never on a timer or a
    notice.
  - **Push new commits:** offered when `pushedCommit` differs from the head.
  - **Narrow panels:** diffs switch to unified there, and the saved choice is kept.
  - **Old diff views:** `ReviewPanel` and `ChangesTab` now use `DiffSection`; the old `DiffView` is
    removed.
  - **ADR:** ADR-0025 §1 notes `--no-verify`.
  - Coordinator check: 4,917 tests; e2e 86/86.
- 2026-10-22 **Live database migrated to 0008** on the owner's app (`release/0.3.0`), after the
  backup `~/.agent-control-plane/backups/acp-before-0008-20261022-122645.sqlite`. All 5 projects
  load; `gh` is detected as installed and logged in (exit codes only); 1 project has a GitHub
  `origin`.
- **Next:** G-V. A consented real push and pull request needs a throwaway repo from the owner; then
  release prep (rebase onto `main` `79c312a`, CHANGELOG `[0.3.0]`, versions, the PR text).
- 2026-10-22 **The owner asked for a GitHub-like redesign** before testing (part 3, D series; the
  plan is in the README). D-0 (tokens, themes, shell) started, with a design checkpoint before
  D-A, D-B and D-C. The owner's app restarted on `e96473a`.
- 2026-10-22 D-0 merged (`9dc1db5`).
  - **The look:** GitHub-like tokens in light and dark (lime gone, the logo kept), GitHub's diff
    colours, the system fonts (the bundled fonts are no longer loaded), and a dark top bar.
  - **Themes:** a Light/Dark/System menu (top bar and Settings → Appearance), with no flash on
    load.
  - **Restyled:** the Primer-like components, and the sidebar in Project and Workspace sections
    with the toggle at the top left ("Hide sidebar ⌘B").
  - **Contrast:** two dark colours were nudged for 4.5:1.
  - Coordinator check: 4,965 tests; e2e 86/86.
  - **Follow-up:** drop the `@fontsource-variable/{inter,jetbrains-mono}` dependencies
    (coordinator).
  - **Next:** the owner's design checkpoint in the live app; then D-A, D-B and D-C.
- 2026-10-22 The owner approved the look ("go ahead with the review page, ticket page and
  workflow"). D-A (the GitHub "Files changed" review pages with line comments), D-B (the ticket
  page as a PR page) and D-C (a clearer Workflow editor) started in parallel.
  - D-A owns the routes `…/tickets/:ticketId/files` and `…/changes/:agentRunId`.
  - D-B links to them through local helpers, which the coordinator swaps at merge.
- 2026-10-22 **D-A, D-B and D-C merged** (`383b0b6`), checked once on the combined code.
  - **D-A:** the GitHub "Files changed" review pages (file tree, split view, Viewed, line comments
    as a pending review, Review changes through the existing owner endpoints).
  - **D-B:** the ticket page as a PR page (header, tabs, the merge box, sidebar). The coordinator
    swapped D-B's local links for D-A's `href` helpers, and the links now carry `?run=`.
  - **D-C:** the clearer Workflow editor (routing, valid-target highlighting, link chooser, legend,
    grouped Problems).
  - **Coordinator fixes:** 2 e2e specs and 2 vitest assertions followed the tabbed layout and the
    `?run=` links.
  - **Process slip:** commit `6ce9bd3` was merged while 2 web tests still failed (the command did
    not stop on them). Fixed in `383b0b6` after the full check passed (4,958 tests); e2e 93/93
    (91 + the 2 fixed specs).
  - **Lean verification adopted:** agents run targeted tests, and the coordinator runs the full
    check and e2e once per merge.
- 2026-10-22 **Part 4 planned** (C series, README): Comments and Conversation tabs, attachments
  (agents read them), helper and tester notes, the lead's whole-ticket summary, read-only merged
  diffs, and shell polish (sizes, chevron toggle, the header with "ACP" and centred search). Not
  started; waiting for the owner's go. To confirm: the header shows the logo plus "ACP".
- 2026-10-22 **The owner approved part 4** ("ACP is fine, go ahead"): the header shows the logo plus
  "ACP", with the full name as tooltip.
  - C-S (shell) started on `wp/c-s-shell`.
  - **C-0 done** (`cc6d7eb`): ADR-0026 accepted; contracts for comment kinds, attachments and the
    activity timeline. Full check: 4,961 tests.
  - C-A (server, db, engine, adapter) and C-B (web) started in parallel.
- 2026-10-22 **C-S merged** (`8f2738a`): body text 15px, a 56px header (logo and "ACP" on the left,
  the search centred, the project switcher and theme on the right), a 256px sidebar with a chevron
  toggle at its top (‹ open, › rail; ⌘B kept). Coordinator check: 4,962 tests; e2e 94/94. The
  owner's app was restarted on it.
- 2026-10-22 **C-A and C-B merged** (`f67a057`), checked on the combined code.
  - **C-A:** migration 0009 (comment kinds, agent notes, attachments); `report_work` for helpers and
    testers; the lead's whole-ticket summary (`ticket-summary`) apart from the run facts
    (`run-facts`); the activity API; attachment upload, list, content and delete (limits, signature
    checks, `nosniff`, sandbox CSP); read-only copies for agents; read-only merged Files changed
    (410 `diff_unavailable` when git lost the commits).
  - **C-B:** tabs Comments · Agents · Files changed · Checks · Conversation; attachments in the
    description and comments; the summary card; the Conversation timeline with actor filters;
    read-only merged files.
  - **Coordinator fixes:**
    - a helper could delete `.acp-attachments/.gitignore` or stage a copy, and the seal would commit
      it: staging now excludes and unstages the folder, and seal and merge refuse a branch whose
      history touched it (`364e1f7`, 2 tests);
    - the owner-flow e2e follows the real activity API (`f67a057`).
  - **Checks:** format, lint, typecheck, build ✓; tests 435 + 368 + 12 + 228 + 2,307 + 1,090 + 645
    (one timing flake in `flow.test.ts` passed 3/3 on rerun and in the server rerun); e2e 98/99,
    then the fixed `workspace` spec 1/1.
  - **The live database was backed up** before migration 0009
    (`backups/acp-before-0009-20261022-201635.sqlite`, integrity ok); the owner's app was restarted.
  - **Open:** `ManagedAgentSpec.readOnlyDirs?` (proposed by C-A, so the lead reads its copies
    without asking); the per-change `/review` shows an empty list instead of 410 when commits are
    gone; deleting a ticket leaves its attachment files; `TICKET_PAGE_COPY.tabs` is unused.
- 2026-10-22 **Owner request: one Files changed UI.** The ticket tab had a summary table plus a
  separate line-by-line viewer, and the review pages were a third view. **C-D started**
  (`wp/c-d-files`, web only): the tab becomes the GitHub review UI (file tree, unified or split,
  line comments, Review changes), with a "Changes from" picker (all changes, or one helper's
  change). Old review-page links redirect into the tab. After a merge it is read-only with a
  "Merged" label. Also the breadcrumb "Board / <KEY>".
- 2026-10-22 **C-D merged** (`d001c7a`): the ticket's Files changed tab is the GitHub review UI
  (one file list, one diff), with a "Changes from" picker (all changes or one helper's change),
  Open, Merged and Closed labels, read-only after a merge or discard, and the 410 state in the same
  frame. Old review-page links redirect into the tab. The breadcrumb reads "Board / KEY". The stopped
  first agent's WIP was continued and squashed. Coordinator check: 5,103 tests; e2e 101/101.
- 2026-10-22 **Owner decision: reviews go to Conversation, not Comments** (coordinator, `fb31508`,
  `ca22821`, `a9e1d3d`). `TicketCommentRequest.kind?` (`comment` | `review`); a Comment sent from
  Files changed is stored as the owner's `review` and shows as "You reviewed"; every review's link is
  "Open Conversation". Also fixed a race in C-B's upload e2e (`7834326`, 25/25 repeated). Check:
  5,104 tests; e2e 100/101, then the fixed spec 25/25.
- 2026-10-22 **C-V real run passed** (owner consent "yes, run the real test"): scenario b with one
  attachment, about 42k budget tokens, 18/18 assertions (7 new: notes, the ticket summary, run facts
  apart, the timeline, limits, attachments never committed). The helper's note and the lead's
  summary read like a teammate's. See `docs/research/c-v-real-run-2026-10-22.md`; temp data deleted.
  **Gap found:** the lead's read of its attachment copy asks the owner; recommended fix:
  `ManagedAgentSpec.readOnlyDirs?` (C-A's proposal).
- 2026-10-23 **readOnlyDirs fix** (owner: "yes, go ahead with the fix"; `819403f`..`569498a`). The
  lead and the planner get their attachment copies in the run's folder (one per agent; the planner
  had none) and may read there without asking (`ManagedAgentSpec.readOnlyDirs`, reads only).
  ADR-0026 §4 amended. Check: all packages ✓ (the server suite re-run after the machine slept
  mid-check: 647/647); e2e 98/99, the `review-loop-live` timing flake then 3/3 three times.
- 2026-10-23 **Part 5 planned and approved: the harness in the workflow** (H series, ADR-0027
  accepted). The owner asked how the harness fits the graph and for a plan with a setup step, then
  "i think we can have this as part of 0.3.0". Setup steps, labels and outputs in the harness file,
  an owner network switch, configurable Checks blocks (on each change, before the lead's merge, on
  the branch) with failure routes; migration 0010. WPs H-0 (coordinator), H-A core, H-B server and
  db, H-C engine, H-D web, H-V verification. H-0 started.
- 2026-10-23 **H-0 done** (`42bfbab`): contracts for setup steps (network, outputs), check labels,
  `setupNetwork`, check run places and blocks, setup runs, and the Checks block's place, selection
  and failure route (no new edge type: `flow` wires a change block, `rework` sends a failure back).
  Full check: 5,116 tests. Note: a harness file may name any program, `sh` included (ADR-0017's
  accepted risk); the app never runs through a shell, and shells are never allowlisted for agents.
  H-A (core rules) and H-D (web) started in parallel; H-B (server, db) and H-C (engine) after H-A.
- 2026-10-23 **H-A merged** (`0267b96`): Checks block defaults, rules (one merge block, at most one
  branch block, change blocks wired from helpers or testers, failure routes per place, rework links
  for "back to the helper"), `canConnect` agreement, `checksForBlock`, `checkSelectionIssues`
  (warnings only), and `program.checkBlocks`. Old graphs compile unchanged (no golden trace or
  snapshot changed). Coordinator check: 5,158 tests; e2e 101/101. H-B and H-C started.
- 2026-10-23 **H-D merged** (`a96f0d3`), on H-A's real rules: the Workflow editor's Checks block
  panel (place, which checks, on failure, rounds; the merge block cannot be removed), "Checks on a
  change" and "Checks on the branch" in Add block, the Harness page (setup steps, "Setup may use
  the network", labels, where each check runs, "Run setup and checks now", main setup runs), and
  the ticket's Checks tab (setup runs, then checks by place). Selection warnings come from core.
  Coordinator check: 5,184 tests; e2e 103/103. Not done: the ⌘K "Run checks" name. The server
  side (H-B and H-C, one agent on `wp/h-bc-server-engine`) is still running.
- 2026-10-23 **Paused by the owner** ("please hold this, i will let you know when to resume"). The
  H-B/H-C agent was stopped; its work is on `wp/h-bc-server-engine` (worktree
  `.claude/worktrees/agent-a1499a6ae24261504`): `a68b868` migration 0010 (db), `622680e` engine
  (check blocks, setup failures), and a WIP commit with the server part in progress (setup runner,
  blocks, outputs staging; its outputs tests not written; may not compile). To resume: a new agent
  continues on `git switch -c wp/h-bc-2 wp/h-bc-server-engine`, rebases onto `release/0.3.0`
  (`d53dbb2`+), finishes the server part, tests and the `--harness` driver dry run, and squashes the
  WIP. Then: back up the live database before 0010, full check and e2e, merge, restart the app, one
  consented real run.
- 2026-10-23 **Resumed by the owner** ("we can resume now"). A new agent continues H-B/H-C on
  `wp/h-bc-2` from `wp/h-bc-server-engine` (migration 0010, engine, the WIP server part).
- 2026-10-23 **H-B and H-C merged** (`f4ebe72`). Setup runs in each new helper's or tester's
  worktree before it starts and in fresh check checkouts (tip, main), never in the owner's checkout
  or for reading roles; a network step is refused while "Setup may use the network" is off; a failed
  setup stops the agent with the reason and output tail to the lead and the ticket; `outputs` never
  reach a change or commit. Checks blocks run at their places (change before review with failure
  routes helper/lead/owner; the merge block's selection; the branch block on the tip, shown, while
  the owner's merge gates on required checks). Migration 0010. Old graphs' golden traces unchanged.
  Real-run driver `--harness` (dry run passes). Coordinator fix: setup refuses any folder inside the
  project checkout (`f4ebe72`, test). Live database backed up before 0010
  (`backups/acp-before-0010-20261023-161801.sqlite`). Coordinator check: 5,234 tests; e2e 103/103.
- 2026-10-23 **H-V real run passed** (owner consent "yes, run the real test"): scenario a with
  `--harness`, 25,249 budget tokens, 20/20 assertions (setup in the helper's worktree and the tip
  checkout, none for the lead; checks at `change`, `merge` and `branch`; outputs never committed).
  The helper passed the fast check at once, so the failure route was not exercised in the real run
  (covered by tests and the dry run). See `docs/research/h-v-real-run-2026-10-23.md`; temp data
  deleted. **The harness part (part 5) is done.** The owner is running the GitHub push and PR tests.
- 2026-10-23 **G-E started** (owner: "Cant we bring this in our ACP plane project settings UI to
  configure github there"; "yes, build it now in 0.3.0"). The Settings GitHub card guides `gh`
  install and login, and on the owner's click creates a repository on GitHub or connects an
  existing one as `origin`, optionally pushing the current branch. Contract (`CreateRepository`,
  `ConnectRepository`, `parseGitHubRepository`) and ADR-0025 §7 done by the coordinator.
- 2026-10-23 **G-E merged** (`fb9439e`): the Settings GitHub card guides installing `gh` and
  `gh auth login` (the owner's terminal), then creates a repository (`gh repo create`, run outside
  the checkout; the account name read first; `origin` rebuilt from the parsed names; optional push
  of the current branch) or connects an existing one as `origin`. Every refusal runs before GitHub
  is touched; an existing remote is never changed. Coordinator check: 5,289 tests; e2e 105/105.
  Proposed follow-ups: `CodeHostStatusDto.hasOrigin` (a non-GitHub origin) and `currentBranch`
  (to say "Push main now"). Waiting for the owner's UI test.
- 2026-10-23 **G-F started** (owner: "can we also give option to create these branches ... We need
  to create any branch"; seen on "ACPGIT-1 didn't start. The target branch dev does not exist").
  List and create branches (never switching the checkout), optionally push; in Settings, a ticket's
  branch settings and the refusal itself. Contract and ADR-0025 §8 by the coordinator.
- 2026-10-23 **G-F merged** (`403e14b` rebased): list a project's local branches and create any
  branch from the app (`git branch --no-track <name> refs/heads/<from>`, never switching the
  checkout, never moving an existing branch), optionally pushing it. On the Start refusal ("Create
  dev from main", then Start again once), in Settings (Local branches card; "Create it" in the
  strategy form) and in a ticket's target field. The GitHub card says "Push main now". Coordinator
  fixes: the refusal's wording; ADR-0025 §7 and §8 now say pushes use `--set-upstream`.
  **Lint memory fix** (`533a495`): ESLint needed about the default 2 GB heap and crashed twice; the
  lint script now gives it 4 GB. Checks: format ✓ lint ✓ typecheck ✓; tests core 493, adapter 371,
  demo 12, db 235, orchestrator 2,322, web 1,163, server 731 (re-run with 2 workers after timeouts
  under memory pressure on this 8 GB machine) ✓; build ✓; e2e 107/107. Follow-ups: the Create
  action in the "Start with options" dialog, and the branch picker in New ticket.
- 2026-10-23 **G-G and T-A started** (one agent). Owner: "git is working as expected awesome, we
  need branch delete option like merge and delete" (chose a Merge pull request button with merge,
  squash or rebase and Delete branch, plus a Delete branch button), and a ticket badge with the time
  taken and total tokens at the right of the header line ("leave cost for now"). Contracts and
  ADR-0025 §9 by the coordinator.
- 2026-10-24 **Paused by the owner** ("we can hold it as for now and will resume sooner"). The
  G-G/T-A agent was stopped. Its work is on `wp/g-g-merge-totals` (worktree
  `.claude/worktrees/agent-acae7aa5beef0c1fd`): `a7fb761` (db: one ticket's direct usage),
  `74b214e` (server: merge the PR, Delete branch, ticket totals), and a WIP commit with the web
  part started (api.ts and copy.ts additions only; no components; no G-G.md yet). To resume: a new
  agent continues on `git switch -c wp/g-g-2 wp/g-g-merge-totals`, rebases onto `release/0.3.0`,
  checks the server part against the brief, builds the PR box merge/delete UI and the ticket badge,
  writes G-G.md, and squashes the WIP. Then the full check (vitest with fewer workers on this 8 GB
  machine) and e2e, merge, restart the app. Still to do for 0.3.0 after that: small follow-ups
  (the Create action in "Start with options", the branch picker in New ticket, the ⌘K "Run checks"
  name), then release prep.
- 2026-10-24 **Resumed by the owner** ("resume"). A new agent continues G-G and T-A on `wp/g-g-2`
  from `wp/g-g-merge-totals`; the owner's app was restarted on `release/0.3.0`.
- 2026-10-24 **G-G and T-A merged** (`312cd71`). Merge pull request from the ticket (merge, squash
  or rebase; `gh pr merge --repo` run from a temp folder; Delete branch ticked by default), Delete
  branch once merged or discarded (never the base, target or a checked-out branch; GitHub first,
  then the local copy), and the ticket badge ("Took 1h 12m · 1.2M tokens" or "Running 14m", with
  run times and the token split; no cost, per the owner). `finishedAt` is the latest run end (no
  done time is stored). Coordinator: the open-PR note now mentions Merge pull request. Checks: format
  ✓ lint ✓ typecheck ✓; tests 495 + 371 + 12 + 237 + 2,322 + 1,188 + 764 (vitest with 2 workers on
  this 8 GB machine) ✓; build ✓; e2e 110/110. Proposed: a lighter "does the branch still exist"
  read than the branch diff.
- 2026-10-24 **Incident on the owner's ticket ACPGIT-3 (Full auto, sandbox on)**, found through the
  app's API and read-only git. The ticket asked to "checkout a branch from dev"; the lead's
  auto-approved plan told a helper to `git checkout -b <ticket branch> dev` and commit. Both helpers
  switched their worktrees to the ticket branch; one committed `cec7e06`, the next reset the branch
  to dev and committed `8a06973`. The seals failed (branch changed), both changes went to
  needs-owner, and the lead looped. The ticket branch no longer matches the app's record; the
  owner's merge and Push & open PR both refuse (`requireTip`, `verifyTicketBranch`), so nothing
  unreviewed can ship. Open question: why the Full auto sandbox let git write into the repository's
  `.git`. **F-1 started** (`wp/f-1-branch-guard`): deny branch-changing git commands for helpers and
  testers in every mode (hook + rules + sandbox denyWrite on the git dirs), brief and planning
  wording, a clear failure the lead can discard, and an owner "Reset to the last reviewed commit".
- 2026-10-24 **Owner: "tighten our unit test cases so we can identify these type of issues".**
  F-1 also gets a deterministic plan check (a plan step with branch or commit commands is refused).
  **T-1 started** (`wp/t-1-adversarial`, tests only): hostile fake helpers in real temp repos
  (checkout/commit/reset the ticket branch, move dev/main, push, edit .git, stash/rebase, detached
  HEAD, writes outside the worktree, two helpers on one branch, staging outputs), one reusable
  invariant check (ticket branch, base, origin, sealed contents, termination with bounded agent
  starts, an owner action that always makes progress), engine-level failure loops, and an adapter
  table of shell commands. Tests that fail today are marked to flip when F-1 lands.
- 2026-10-24 **G-H planned** (owner: an explicit "checkout from" branch at project and ticket
  level, defaulting to main / the default target). Contract (`defaultSourceBranch`,
  `TicketBranchPrefs.from`, `TicketBranchDto.sourceBranch`) and ADR-0025 §10 by the coordinator.
  The agent starts after F-1 merges (both change ticket branch creation).
- 2026-10-24 **F-1 merged** (`10239df`): helpers and testers never manage branches. A Bash guard
  (default-deny for git beyond reading and file-only changes; aliases, `-c`, `GIT_*`, wrappers,
  `sh -c`, chains and subshells parsed) as a PreToolUse hook, the gate and deny rules, in every
  mode; Full auto's sandbox denies writes to the worktree's git dir and common dir (Claude Code
  0.3.296 adds the common dir to the writable paths by itself; research note); briefs and planning
  wording; `submit_plan` refuses steps with branch or commit commands; a worktree that left its
  branch fails clearly and the lead may discard it; a ticket branch moved outside the app shows on
  the ticket with an owner "Reset to the last reviewed commit" (compare-and-swap). ADR-0021 and
  ADR-0022 amended. Golden traces changed only by the brief text (proved). Coordinator check:
  format ✓ lint ✓ typecheck ✓; tests 498 + 497 + 12 + 237 + 2,378 + 1,192 + 775 ✓; build ✓;
  e2e 110/110. Not yet seen in a real run (needs consent).
- 2026-10-24 **T-1 merged** (`2901a2c`): the adversarial suite (`docs/testing/adversarial.md`).
  Hostile fake helpers in real temp repos, one invariant check (ticket branch, base, origin, sealed
  contents, bounded starts, owner progress, with the F-1 reset), engine failure loops and simulator
  invariants over the templates and generated graphs, and an adapter command table checked against
  F-1's guard. 52 of 63 known gaps flipped to plain tests with F-1; 12 remain as `knownGap` for
  F-2 (they turn red when fixed). Coordinator check: tests 498 + 563 + 12 + 237 + 2,421 + 1,192 +
  809 ✓; build ✓; e2e 110/110. F-2 started.
- 2026-10-24 **Paused by the owner** ("please pause all the stuffs"). Both agents stopped.
  - **F-2** (`wp/f-2-gaps`, worktree `agent-a5e43d45340c0d149`): the 12 gaps closed in 5 commits
    (`1e8e6f5`..`a82b772`; the adversarial suites, orchestrator 2,436 and server 817 passed in the
    agent's run), plus a WIP commit: the harness runner refusing branch-managing checks and setup
    steps (in progress). To resume: a new agent continues on `git switch -c wp/f-2-b wp/f-2-gaps`,
    finishes the runner refusal and its tests, squashes the WIP, rebases; the coordinator applies
    F-2.md's ADR amendments (ADR-0021, ADR-0017/0027, ADR-0025), runs the full check (2 workers)
    and e2e, merges.
  - **V-1** demo video (`wp/v-1-demo-video`): stopped at the start (no commits, one temp file).
    Owner choices: teams + LinkedIn + website; captions + Mac voice; dark 1920×1080; full (~2.5
    min) and short (~1 min) cuts; a draft now, the final on the release code. Restart from the brief.
  - **Then:** G-H ("start from" branch, contract done), release prep (rebase onto main `79c312a`,
    drop the fontsource dependencies, versions, CHANGELOG, README and screenshots, final check,
    PR text and notes in `.acp-data/`; ask the owner who pushes), optional consented real run of
    the branch guard.
- 2026-10-24 **Resumed by the owner** ("please resume"). F-2 continues on `wp/f-2-b` (the harness
  runner refusal); V-1 restarts fresh on `wp/v-1-video`. The owner stopped their app; not restarted.
- 2026-10-24 **F-2 merged** (`a71c965`): no known adversarial gaps left. Bounded helper attempts
  per plan step and run (`attempts-exhausted`); merges blocked by a moved or checked-out ticket
  branch go to the owner at once (no "Try again"); every seal failure is discardable by the lead,
  never mergeable; the owner's pushes go to origin's own address (a planted pushurl is ignored, a
  pushInsteadOf is refused); the guard reads here-strings and here-documents, lives in core and runs
  before the harness-check rule; the app's runner never runs a branch-managing check or setup step.
  ADR-0021, -0017, -0027 and -0025 amended. Coordinator check: tests 531 + 578 + 12 + 237 + 2,436 +
  1,192 + 824 ✓; build ✓; e2e 110/110. Follow-up: checks that run git inside their own scripts are
  not visible to the guard. **G-H started.**
- 2026-10-24 **G-H merged** (`bb10abd`): a ticket branch starts from the ticket's "Start from",
  else the project's "Start ticket branches from", else its target; never switching the checkout;
  a missing source is refused (`source_branch_missing`) with the one-click Create (also in the
  Start with options dialog); the header shows "· from <source>"; New ticket has the branch
  pickers. **Migration 0011** (`ticket_branches.source_branch`, additive): back up the live
  database before the owner's app next starts. Coordinator: the Branches tip wording and an
  ADR-0025 §10 storage note. Check: tests 531 + 578 + 12 + 240 + 2,436 + 1,201 + 837 ✓; build ✓;
  e2e 111/111. Next: release prep; V-1 recording.
- 2026-10-24 **Live database backed up before migration 0011**
  (`backups/acp-before-0011-20261024-225515.sqlite`, at migration 10, integrity ok).
  **Release prep (R-3) started** (`wp/r-3-release`): no rebase needed (`origin/main` 79c312a is the
  merge of release/0.2.0, whose tree release/0.3.0 already contains); versions 0.3.0, drop the
  fontsource dependencies, CHANGELOG [0.3.0] for users, README status and screenshots, PR text and
  release notes in `.acp-data/`, one full check and e2e.
- 2026-10-24 **Pushed `release/0.3.0` to GitHub** (owner: "push to github"), at `2a8401e`, after
  replacing local absolute paths in four progress files. The release-prep commits (R-3) will need
  one more push. `main` untouched; the owner raises the PR in GitHub.
- 2026-10-24 **Release prep paused by the owner** ("we can stop the release prep and work fully on
  the video"). `wp/r-3-release` (worktree `agent-aa43ef27eba10a0a9`) has `da73b8b` (drop the
  fontsource deps), `4cb8fdf` (version 0.3.0) and a WIP commit (CHANGELOG, README, new screenshots,
  release docs; not checked; it had rebased onto the pushed release branch). To resume: finish,
  squash the WIP, full check and e2e, PR text and release notes in `.acp-data/`.
  **V-1 continues**: the video re-scripted around orchestration (skills and agent files, a BDD
  workflow, the harness as the bar, less supervision).
- 2026-10-25 **V-1 draft 2 delivered** (the orchestration story with a BDD setup; full 2:44, short
  1:05; `wp/v-1-video`, commits through `a70d4d7`). The owner approved ("yes go ahead").
  **Release prep resumed** on `wp/r-3-b` from `wp/r-3-release`. Then: merge R-3, merge the video
  script (gated, not in the default e2e), re-record the final cuts on the release code (the footer
  must read 0.3.0, not 0.2.0), ask the owner before pushing again.
- 2026-10-25 **Video paused by the owner** ("okay we pause this for now"). Owner wants for the final:
  use HyperFrames (https://hyperframes.heygen.com/, `hyperframes` npm 0.8.193, Apache-2.0, ~23 MB +
  deps; maybe its own Chrome ~150 MB) to compose a polished cut around the real screen recordings;
  max length 3–3.5 min; add "pick any model per agent" in the workflow editor and the ticket's target
  and start-from branch settings. Not yet approved: the download (ask again; use the CLI only in a
  git-ignored folder, never its Claude Code plugin or skills). Script on `wp/v-1-video` (draft 2).
  Release prep (R-3, `wp/r-3-b`) keeps running unless the owner says otherwise.
- 2026-10-25 **R-3 merged** (`53620b8`): version 0.3.0 everywhere (the footer reads "Server
  0.3.0"), the unused fontsource fonts removed, CHANGELOG [0.3.0] for users, README (status,
  features, test counts) and fresh screenshots on demo data, BUILD, START, roadmap and the v0.3.0
  release section. R-3's check: format ✓ lint ✓ typecheck ✓ build ✓; tests 5,835 ✓; e2e 111/111;
  README screenshots 10/10. PR text and release notes in the coordinator worktree's
  `.acp-data/{pr,release-notes}-v0.3.0.md`. AGENTS.md and HANDOFF.md point at v0.3.0.
  **Release ready.** Waiting for the owner: push `release/0.3.0` again, open the PR, merge, tag.
  The video's final cut waits (HyperFrames download not yet approved).
- 2026-10-25 **Pushed `release/0.3.0` to GitHub at `c02d7ec`** (owner: "can we release now"). The
  owner raises the PR release/0.3.0 → main with `.acp-data/pr-v0.3.0.md`, merges it in GitHub,
  tags v0.3.0 on main and publishes the release from `.acp-data/release-notes-v0.3.0.md`.
- 2026-10-25 **V-1 continued from the owner's terminal session** (its agent stopped on a session
  limit after rendering). Branch `wp/v-1-c` (worktree `agent-a61767e1817a6c203`): drafts 3–6 with
  HyperFrames and the `af_heart` voice; the coordinator committed the draft 6 sync fix (`34aff48`;
  each voice line starts 0.1 s after its action). Cuts (git-ignored):
  `.acp-data/demo-video/hf/acp-intro-full.mp4` 177.0 s and `acp-intro-short.mp4` 60.0 s, sent to the
  owner. The live database is now at migration 11 (the owner started the app on 0.3.0); the BETA
  badge (`f0c09a4`) is on release/0.3.0, not yet pushed.
- 2026-10-25 **Video draft 7 planned, not started** (owner: "still a little boring"; open or end
  with completing tickets by dragging them on the board; the workflow config part is too long;
  plan how to get people's attention). Verified: dragging a Ready ticket to Planning starts its run
  and the card then moves by itself up to In review; the owner merges to Done. Plan: a hook (drag
  3 tickets, sped-up cards gliding, "Zero babysitting") → setup once (skills 8 s, the finished flow
  with highlight pulses ~15 s instead of building it, the harness 6 s) → proof (live agents, a
  finding fixed, checks, side by side) → control (models, modes, branches) → payoff (all Done,
  "Drag. Review. Merge."). Full ~2:00, short ~0:40. Attention: a muted-first 3-second hook,
  music + sound effects, faster pacing, contrast and numbers, formats per channel (16:9, 4:5, a
  15 s loop), a LinkedIn posting plan. Waiting for the owner's choices on music and formats.
