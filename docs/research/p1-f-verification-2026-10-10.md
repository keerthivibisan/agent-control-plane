# P1-F verification, part 1 (no real data) — 2026-10-10

Branch `wp/p1-f-verify`. Everything here ran against **synthetic fixtures**
(`test-fixtures/claude-code/`), generated synthetic data roots in temp directories, and the
**demo** server. No file under the real `~/.claude` was read. F2 (real-data run) and F4 (live new
session) are still pending and need the user's consent.

## F1: independent reference recomputation

`scripts/reference-usage.ts` recomputes usage straight from allowlisted transcript JSONL with its
own implementation of usage-accounting §5 and §6. It imports only Node built-ins, never `@acp/core`
or the adapter. It prints aggregates only: ids from file names, model names, counts, token totals.

```bash
node scripts/reference-usage.ts --claude-dir <dir> --root <abs path> [--root ...]
```

Node 22.21 runs the file directly through type stripping. `node --import tsx` does not work from
the repo root because `tsx` is not a root dependency. There is deliberately no default
`--claude-dir`: pointing it at real data has to be an explicit choice.

**Result.** For every fixture scenario (01–16, plus 07 v1 and v2) and for a generated root that
mixes every rule, the per-session and per-model totals (records, four categories,
`recordsWithUnavailable`, ambiguous count) equal the database built by the live-mode stack
(`createClaudeCodeAdapter` → `createPipeline` → SQLite → `createQueries`, with `/home/user/project`
registered). They also equal `/api/sessions` from a live-mode `startServer`.

As a sanity check, replacing the reference's max-output selection with first-wins makes 3 tests
fail, so the comparison does detect a wrong rule.

**Differences between the two implementations that the fixtures do not exercise:**

- **Duplicate `uuid` with different content in one file.** The adapter keys a line by its `uuid`,
  so a second line with the same `uuid` is dropped at record level (first wins). The reference
  treats it as one more observation (max output wins). If real data has such lines, F2 will show a
  difference.
- **Equal output and equal timestamp, but different non-output categories.** The DB breaks the tie
  by event row id (ingestion order). The reference breaks it by sorted file path, then line order.
  These can differ across files.
- **First `cwd` beyond 64 KiB.** The adapter peeks at most 64 KiB for the first `cwd`. The
  reference scans the whole file.

## F3: recovery

All of these ran over every scenario plus the generated root:

- **Checkpoint wipe.** Deleting all checkpoints and re-running re-reads the files and changes
  nothing: totals, all table counts, edges with evidence, session evidence columns, and the set of
  dedup keys are identical.
- **Restart mid-ingest.** With 200-byte chunks, ingestion stopped after the first committed batch,
  the DB was closed and reopened, and a fresh adapter continued. The result is identical to one
  uninterrupted run, with no duplicate dedup keys.
- **Restart after every batch.** With 128-byte chunks and a restart after each batch, ingestion
  still converges to the same state.

## F5: Playwright e2e (demo mode)

Run with `pnpm --filter @acp/web test:e2e`. It builds the UI and starts the server with
`ACP_MODE=demo` on 127.0.0.1:7431, using a temp `ACP_DATA_DIR`.

**Result:** 7/7 passed on 3 consecutive runs from the worktree path, on Chromium headless shell 156
(Playwright 1.64.0).

The specs compare what the UI shows with the API; no expected values are hardcoded. This e2e is not
part of `pnpm check`.

**Bug found and fixed on main (430223d).** The SPA fallback used `res.sendFile(<absolute path>)`.
When the checkout path contained a dot-directory (for example `.claude/worktrees/`), every page
load returned 500.

## Acceptance checks added (F6 evidence)

`packages/server/tests/verification/acceptance.test.ts` covers:

- **Subagent meta.** Meta creates a `subagent` edge with `subagent-metadata` evidence (scenario
  03). Missing meta creates no edge (scenario 04).
- **Hooks.** Hook payloads (scenario 13) add events but no usage observation or record.
- **Denied files.** Only the allowlisted transcript is read when the denied files of scenario 14
  are present.
- **No writes.** Ingestion leaves the sha256 and mtime of every file in the data root unchanged,
  `settings.json` included.

## Still open

- **F2:** real-data comparison with F1 and with `cost-state` (Q3).
- **F4:** live session observation and the active → stale transition.
- **Logs are redacted:** not verified by P1-F.
- **CI is green:** the branch has not been pushed, so CI has not run.
