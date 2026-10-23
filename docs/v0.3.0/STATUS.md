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
