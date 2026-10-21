# S-C

> Progress file for S-C. Only its agent edits it. Plan: [../README.md](../README.md).

| Field    | Value                                                                                  |
| -------- | -------------------------------------------------------------------------------------- |
| Status   | paused (2026-10-21, owner pause)                                                       |
| Branch   | `wp/s-c-human-comment`, from `release/0.3.0` `f277c72`                                 |
| Worktree | `/Users/grootan/Desktop/agent-control-plane/.claude/worktrees/agent-a0f8d98453fef2751` |

Owner feedback (2026-10-21): "The comments are like what each phase did; we don't need that. We
need a proper comment like humans write: we explored this, we added this feature and tested this,
developed this."

## Resume here

All the code is written and is **uncommitted** in the worktree. The one full `pnpm check` that ran
failed at lint: 2 `no-unnecessary-type-assertion` errors in
`packages/web/tests/features/run-summary.test.tsx`. Both are fixed now
(`getByTestId<HTMLDetailsElement>(…)`), and ESLint and Prettier pass on that file, but the full
check has not run again since. Code is never committed on a failed check, so nothing went in.

Uncommitted (all S-C work, waiting for a green check):

- `packages/orchestrator/src/plan.ts` (`HANDOVER_NOTE_LINE`),
  `packages/orchestrator/tests/handover-summary.test.ts`, and the two golden snapshot files under
  `packages/orchestrator/tests/graph-correctness/__snapshots__/` (255 snapshots updated);
- `packages/server/src/control/run-summary.ts`, `packages/server/tests/control/run-summary.test.ts`,
  `packages/server/tests/board/run-summary.test.ts`;
- `packages/web/src/features/ticket/{run-summary.ts,RunSummary.tsx}`, `packages/web/src/lib/copy.ts`,
  `packages/web/tests/features/{run-summary.test.tsx,run-summary-logic.test.ts}`,
  `packages/web/e2e/session-names.spec.ts`, `packages/web/DESIGN.md`;
- `docs/decisions/0024-session-names-and-run-summaries.md` (§3 amendment line), `docs/security.md`,
  `docs/architecture.md`.

Next steps:

1. `npm_config_workspace_concurrency=1 pnpm check` (format and lint passed before the fix; the
   tests had not run in the full gate yet. Run alone, the orchestrator suite passed 2300/2300, the
   server's run-summary tests 20/20 and 10/10, and the web's 9/9 and 11/11).
2. When it is green, commit in four parts: orchestrator (brief and snapshots), server, web
   (including e2e), and docs, each with the real `Checks:` line.
3. Run the full web e2e:
   `ACP_E2E_PORT=7831 ACP_E2E_CONTROL_PORT=7841 pnpm --filter @acp/web test:e2e`. The two
   run-summary tests in `session-names.spec.ts` are new and have not run yet.
4. Fill in the work log, set the status to `review`, and send the §9 report.

## Tasks

- [x] The lead's brief asks for the note like a teammate's ticket update, with one short example
      (`HANDOVER_NOTE_LINE`, orchestrator `plan.ts`); the 1,500-character cap is unchanged.
- [x] Golden traces: proved that only the prompt text changed, then updated them.
- [x] The comment body (server `control/run-summary.ts`): `Run summary`, the note (or one plain
      sentence), then `Details:` with the facts as short sentences.
- [x] The web card (`features/ticket/RunSummary.tsx`, `run-summary.ts`): "Lead · Run summary",
      the note as comment text, the details behind a "Details" disclosure; older summaries as
      before.
- [x] Tests (server, orchestrator, web, e2e), docs, ADR-0024 §3 amendment line (written).
- [ ] Full `pnpm check` green after the lint fix, then the commits.
- [ ] Full web e2e run.

## Work log

| Date       | What                                                | Commit  | Checks      |
| ---------- | --------------------------------------------------- | ------- | ----------- |
| 2026-10-21 | Lead brief: the human-style note; golden traces     | not yet | uncommitted |
| 2026-10-21 | Server: the comment layout and the details wording  | not yet | uncommitted |
| 2026-10-21 | Web: the card reads like a comment; e2e             | not yet | uncommitted |
| 2026-10-21 | Docs: ADR-0024 §3 amendment, security, architecture | not yet | uncommitted |

## Decisions and findings

- **The prompt line** grew from 165 to 611 characters (+446), about 110 more input tokens per
  review-loop run (the brief is sent once per run). Most of it is the owner's example; the rest is
  the order (explored or understood → built or changed → tested or checked → not done, risky or
  left for later) and "No code, file dumps or step-by-step log." The hand-over prompts' "(with your
  summary)" and "with an updated summary" stay as they were.
- **Golden traces.** Before the change all 2,300 orchestrator tests passed on the old snapshots.
  With only `HANDOVER_NOTE_LINE` changed, exactly 255 snapshots failed (golden-v1 and
  golden-templates). After `-u`, every changed snapshot line is either a lead prompt or brief line
  (`start-agent … kind="lead" prompt=…`, `send-to-agent … text="The owner approved plan…"`,
  `"Plan v1 was approved automatically (Full…"`) or a whole-trace digest, and each of the 79
  changed text hashes grew by exactly 446 characters, the length difference of the line. Nothing
  else in any trace moved.
- **Whose words.** The comment's author is `app`, so the plain text says which words are the
  lead's: a `From the lead:` line before the note. The web hides it and says "Lead · Run summary"
  instead. It also tells the web, without guessing from sentences, whether there is a note.
- **Finding the details.** The web splits at the _last_ `Details:` line: the facts never contain
  one (every fact line starts with `- `), while a lead's note might.
- **The ticket key line** (`WEB-12: the lead handed the work over.`) is gone: the comment sits on
  the ticket, and the note or the plain sentence says how the run ended.
- **No-note sentences:** "The lead handed the work over without a note.", "The run failed before
  the work was handed over.", "The run was stopped before the work was handed over.", "The run
  timed out before the work was handed over.", "The lead failed before handing the work over.",
  "The lead was stopped before handing the work over.", "The lead ended without handing the work
  over.", and for legacy runs "The agents finished, and their changes are waiting for your
  review." or "The run finished with nothing to review."
- **Details wording.** One sentence per fact: the plan ("Plan v2 was approved with 2 steps:
  Frontend helper and Helpers."), one per change ("Merged 1 change from Helpers: 2 files, 18 lines
  added; the check passed."; "Discarded …", "… is still in review", "… is back in rework", "… is
  waiting for your decision", "… finished with no changes", "There is no change from …"; "; it
  failed" when the agent itself ended badly), the ticket branch ("… has 1 change merged and is
  waiting for your merge; checks passed on the tip (2)." — the S-A2 wording kept), and the budget
  tokens ("Budget tokens used: 12,400 by the lead, 48,000 by 2 helpers and 9,100 by 2
  reviewers."). Checks read "the check passed", "both checks passed", "all 3 checks passed", or
  "1 of 3 checks passed (failed: Unit tests; not run: Lint)". Lines are left out when git could not
  tell, and "0 removed" is not said.
- **Unchanged:** the merge line, the triggers, idempotence (one summary per handover, facts-only
  once per run), the 8,000-character cap (later change lines give way to a count; the note stays
  whole), and S-B's recognition by the first line.
- **Web.** The disclosure is the shared native `Details` component (keyboard: Tab, then Enter or
  Space). `data-layout` on the card says `comment` (S-C) or `sections` (older).
- **Untrusted content.** No instructions aimed at agents were found in the files read.

## Example comment bodies (synthetic)

With a note:

```text
Run summary

From the lead:
Explored the settings code and found the theme is set in theme-store.ts. Added a dark mode switch on the Settings page. Tested it with three unit tests; all checks pass. Not done: the print view still uses the light colours.

Details:
- Plan v2 was approved with 2 steps: Frontend helper and Helpers.
- Merged 1 change from Frontend helper: 3 files, 42 lines added and 5 removed; both checks passed; 2 rework rounds, asked for by the lead (1) and the reviewer (1).
- Discarded 1 change from Helpers: 1 file; 1 of 3 checks passed (failed: Unit tests; not run: Lint).
- The ticket branch acp/WEB-12 (from main) has 1 change merged and is waiting for your merge; checks passed on the tip (2).
- Budget tokens used: 12,400 by the lead, 48,000 by 2 helpers and 9,100 by 2 reviewers.
```

Without a note (a run that failed while planning):

```text
Run summary

The run failed before the work was handed over.

Details:
- No helpers were started.
- Budget tokens used: 0 by the lead.
```
