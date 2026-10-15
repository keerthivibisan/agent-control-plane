# Phase 4 status (coordinator-maintained)

> Only the coordinator edits this file, when a WP is merged or a wave starts. Agents record their
> progress in `docs/phase-4/wp/<WP>.md` (README §9).

| WP   | Title                                                        | Depends           | Status                                       | Branch                  | Merged                 |
| ---- | ------------------------------------------------------------ | ----------------- | -------------------------------------------- | ----------------------- | ---------------------- |
| P4-0 | [Contracts, ADRs and core logic](wp/P4-0.md)                 | owner approval    | **done**                                     | `wp/p4-0-contracts`     | 2026-10-13 (`8c05f68`) |
| P4-I | [Adapter: context, nested helpers, submit_plan](wp/P4-I.md)  | P4-0              | **done**                                     | `wp/p4-i-adapter`       | 2026-10-15 (`3cf7066`) |
| P4-B | [Database: migration 0003 and repositories](wp/P4-B.md)      | P4-0              | **done**                                     | `wp/p4-b-db`            | 2026-10-16 (`1f55b92`) |
| P4-A | [Engine: plan phase, limits, depth 2, allowlist](wp/P4-A.md) | P4-0              | **done**                                     | `wp/p4-a-engine`        | 2026-10-16 (`b4ab73b`) |
| P4-C | [Harness: manifest, context files, check runner](wp/P4-C.md) | P4-0              | **done**                                     | `wp/p4-c-harness`       | 2026-10-16 (`c0a5ea0`) |
| P4-E | [Board UI](wp/P4-E.md)                                       | P4-0              | **done**                                     | `wp/p4-e-board`         | 2026-10-16 (`5044b73`) |
| P4-F | [Project wizard and settings UI](wp/P4-F.md)                 | P4-0              | **review: verified, ready to merge**         | `wp/p4-f-project-setup` | —                      |
| P4-G | [Ticket page UI](wp/P4-G.md)                                 | P4-0 (DTOs); P4-D | **in-progress** (paused by the owner)        | `wp/p4-g-ticket`        | —                      |
| P4-D | [Server wiring](wp/P4-D.md)                                  | P4-A, B, C, I     | todo: **unblocked**, all dependencies merged | `wp/p4-d-server`        | —                      |
| P4-H | [Verification](wp/P4-H.md)                                   | P4-D, E, F, G     | todo                                         | `wp/p4-h-verify`        | —                      |

## Live state (2026-10-16, the owner paused work; git is the source of truth)

`main` is at `5044b73` and green (P4-I, B, A, C and E merged). Nothing is pushed to a remote.

| WP   | Branch                  | Head       | State                                                                                                                                                         | What is left                                                                                                           |
| ---- | ----------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| P4-F | `wp/p4-f-project-setup` | `d46845b`  | Rebased on `main` (5044b73); the coordinator fixed the rebase conflicts in `copy.ts`/`api.ts`. `pnpm check` ✓ (all 7 packages) and e2e 11/11 ✓ on 2026-10-16. | Coordinator: `git merge --ff-only wp/p4-f-project-setup` on `main`, then update this table. See "Open decisions".      |
| P4-G | `wp/p4-g-ticket`        | see branch | Ticket page (`feat(web): add the ticket page`) committed; the agent was asked to checkpoint and stop. Read `git show wp/p4-g-ticket:docs/phase-4/wp/P4-G.md`. | Finish per its progress file, rebase on `main` (expect conflicts in `lib/copy.ts`, `lib/api.ts`, `router.ts`), review. |
| P4-D | `wp/p4-d-server`        | —          | not started; all dependencies merged                                                                                                                          | Start with the README §10.1 prompt **plus the notes below**                                                            |
| P4-H | `wp/p4-h-verify`        | —          | not started                                                                                                                                                   | After D, F and G. The real smoke run needs the owner's consent at that time                                            |

**Agent worktrees** (on this machine): P4-F `.claude/worktrees/agent-a9d7d236a63ab508e`, P4-G
`…agent-a67043b516f28adae`. Merged WPs' worktrees can be removed. If a worktree is gone, create a
new one from its branch.

### Notes P4-D must take in (collected from the merged WPs' handoff notes)

- **Project setup rows (P4-B):** a ticket needs a `project_setup` row first. Create a default row for
  projects that existed before migration 0003 (lazily on first `GET /setup`, or at startup).
  `GET /api/projects/:id/setup` must answer for a just-created project (P4-F's wizard edits it).
- **Project removal (P4-B):** `projects.remove` throws a foreign-key error when the project has
  tickets or runs. Check `tickets.countForProject` first and answer 409.
- **Harness (P4-C):** read `.acp/harness.json` from the **project's checkout**, not an agent's
  worktree. Use **one shared** check runner. Call `mainChecks.cleanupOrphans()` at startup.
- **Engine (P4-A):** persist plans, limits, `awaitingHelpers` and `decidedBy`. Store the owner's plan
  comments as ticket comments. `realpath` a target **before** `evaluateAllowlist`.
  `canStartHelpers` is true only when the project's `maxDepth` is 2 and the worker is at depth 1.
- **Open from review:** a parent helper (depth 1) is held as `awaitingHelpers` while it has live
  children, but nothing notifies it when a child finishes. P4-D should send it a message (through
  the adapter's input) when a child ends.
- **Web expectations (P4-E, P4-F):** response shapes are the `@acp/core/api` DTOs the web parses
  (`BoardDto`, `TicketDetailDto`, `ProjectAgentSetupDto`, `HarnessStatusDto`, `CheckRunDto`,
  `ContextCandidateDto`). `POST /api/projects/new` refusals: `conflict` (folder exists),
  `invalid_root`/`not_found` (parent missing). Harness POSTs send an empty `{}` body. All mutations
  check CSRF.

### Open decisions (coordinator/owner)

1. **P4-F contract proposal:** add `argv`, `cwd` and `timeoutSec` to `HarnessStatus.checks` so the
   settings card can show each check's command and time limit (diff in P4-F's progress file,
   "Blockers"). Affects P4-C's `harnessStatusOf`. Recommended: accept, as a coordinator commit
   before P4-D starts, so P4-D builds the richer status from the start.
2. **ADR-0017 wording:** the check runner uses `spawn(argv0, args, { shell: false, detached: true })`
   (process group, so a timeout kills child processes), not `execFile`. Amend the ADR text; the
   policy (argv only, no shell, timeouts, output caps) is unchanged.
3. **P4-E behaviour to confirm with the owner:** Done tickets can't be cancelled; starting a ticket
   asks for no confirmation; a ticket with no activity shows "Updated" with its update time.
4. **P4-F links:** `features/project-setup/setup-form.ts` builds `#/board/:id` and `#/tickets/:id`
   by hand. Switch them to `href.board`/`href.ticket` (both on `main` now), in P4-F or as a small
   follow-up.

**Decisions taken during review:**

- Managed agents always get Claude Code's own system prompt, with project context appended. Leaving
  it unset made SDK 0.3.296 send an empty one.
- P4-A's edit to `packages/server/src/control/errors.ts` (3 refusal mappings) was accepted: it is
  needed to compile.
- P4-B's depth-2 change in `agent-runs.ts` was accepted.
- P4-C's `spawn` with a process group instead of `execFile` was accepted (see open decision 2).

**Rebase tip for web WPs:** `lib/copy.ts`, `lib/api.ts` and `router.ts` are append-only sections per
WP. A "keep both" resolution can cut a block in half: after resolving, run Prettier and the web
typecheck, and compare each section with `git show main:<file>`.

**Known flaky test (pre-existing, not Phase 4):** `packages/server/tests/smoke.test.ts` "ingests a
registered project…" sometimes sees a subagent's parent as unknown under heavy load. It reads the
detail before the subagent's meta file batch is ingested. Fix (backlog): make the test wait for the
edge, not just the session count.

**Environment notes:** heavy machine load makes vitest workers time out and the server suite flaky
on timing; rerun before treating a failure as real. nvm's Node 22 can resolve pnpm 8: put a pnpm 10
binary first on `PATH` (e.g. a shim dir linking `/usr/local/bin/pnpm`). Run the e2e on free ports
(`ACP_E2E_PORT=7551 ACP_E2E_CONTROL_PORT=7561 pnpm --filter @acp/web test:e2e`); never use 7420 or
5173 (the owner's live app). Leave the untracked `dummy.txt` in the repo root alone.

## Paste to resume (2026-10-16)

**Coordinator (a new chat in the repo root):**

> You are the Phase 4 coordinator for Agent Control Plane. Follow `CLAUDE.md`, `AGENTS.md` and
> `docs/phase-4/README.md` (§9 progress protocol, §10.2 review loop). Read `docs/phase-4/STATUS.md`
> fully. Then, in order: (1) rebase `wp/p4-f-project-setup` on `main` (docs-only change since), re-run
> `pnpm check` and fast-forward merge it; (2) settle open decisions 1 and 2 as coordinator commits; (3) start P4-D in a new
> worktree on `wp/p4-d-server` with the README §10.1 prompt plus "Notes P4-D must take in";
> (4) resume P4-G from its branch and progress file; (5) review and merge each as it reaches
> `review`, updating this file after every merge. Never push, never use ports 7420/5173, and ask
> the owner before any real Claude run.

**P4-G (resume):** use README §10.1 for P4-G and add: "Your branch `wp/p4-g-ticket` already exists.
Continue from it (worktree `.claude/worktrees/agent-a67043b516f28adae` if present). Read your
progress file's work log first. Rebase on `main` before review."

## If a session was interrupted: how to resume (any chat, any agent)

1. **Find what exists:**

   ```bash
   git branch --list 'wp/p4-*'                                   # claimed WPs
   git worktree list | grep wp/p4                                # where they are checked out
   for b in $(git branch --list 'wp/p4-*' --format='%(refname:short)'); do
     echo "$b: $(git log --oneline main..$b | wc -l) commits"; done
   ```

2. **Read a WP's real progress** on its branch, not on `main`:

   ```bash
   git show wp/p4-<id>-<slug>:docs/phase-4/wp/<WP>.md
   ```

3. **Rescue uncommitted work.** If the WP's worktree still exists, run `git -C <worktree> status`.
   Uncommitted changes there are the last agent's unfinished work. Have the new agent continue
   **in that worktree**: run `pnpm check`, then commit. Don't delete the worktree.
4. **Restart the agent with the WP prompt** (README §10.1), adding: "Your branch `wp/p4-…` already
   exists. Continue from it (worktree `<path>` if present). Read your progress file's work log
   first."
5. **When a WP's file says `review`:** the coordinator runs the review loop (README §10.2), merges,
   and updates this file.
6. **Never** create a second branch for a WP, and never restart a WP whose branch has commits.

**Current wave (2026-10-16):** wave 1 is merged except P4-F (ready). Wave 2 — P4-D (unblocked) and
P4-G (in progress).

**Waves:** P4-0 → (P4-A, P4-B, P4-C, P4-I, P4-E, P4-F in parallel) → P4-D (+ P4-G from P4-0) → P4-H.
