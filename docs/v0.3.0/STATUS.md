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
