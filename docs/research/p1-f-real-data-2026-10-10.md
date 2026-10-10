# P1-F F2: real-data run — 2026-10-10

With the user's consent in chat, live mode ingested one real project
(`/Users/grootan/Desktop/ftl-rendering-harness`) from `~/.claude`, using a temp data dir. Only the app
and `scripts/reference-usage.ts` read transcripts; only the aggregates below were printed. Claude Code
runtime versions seen: 3.

## Result: exact match with the independent reference (after one fix)

| Measure                                        | API   | Reference |
| ---------------------------------------------- | ----- | --------- |
| Top-level transcripts / subagent transcripts   | 10/33 | 10/33     |
| Sessions with usage, totals equal per category | 39/39 | 39        |
| Models, totals equal                           | 3/3   | 3         |
| Usage records (deduped messages)               | 5,595 | 5,595     |
| Observations read (synthetic excluded: 7)      | —     | 13,476    |

- Complete lines 41,190, unparseable 0, parse errors 0. Ingest took about 16 s.
- Subagents with a known parent (meta evidence): 33/33. Continuation edges: 0.
- 257 usage records are attributed with `attributionAmbiguous` (tied fork/resume copies), counted
  once and flagged, as usage-accounting §5.2 requires.
- Status: all 43 sessions `stale` (no live session during the run); none shown as completed.
- Edge conflicts 0; usage conflicts 0.

**Bug found and fixed (`ae27c9e`).** The first run was 103 records short: two subagents whose own
`cwd` was outside the root were ingested but had no project. They now inherit their parent session's
project.

## Unrecognized record types (counts only; kept as `record.unrecognized`, never interpreted)

attachment 7,860 · last-prompt 2,089 · queue-operation 1,208 · system:stop_hook_summary 410 ·
frame-link 401 · file-history-snapshot 333 · file-history-delta 267 · atis-latch 10 ·
system:compact_boundary 7 · agent-name 6 · mode 5 · artifact-comment-monitor 2 · relocated 2 ·
artifact-autoreact-ledger 1. Total 12,601.

None of these carry usage in the observed data (totals match the reference, which reads only
`assistant` usage). Candidates for explicit "ignored" handling so diagnostics stay meaningful:
`attachment`, `last-prompt`, `queue-operation`, `file-history-*`, `frame-link`.

## Q3: `cost-state` snapshots vs. transcript usage

6 sessions had a snapshot. The snapshot's per-category sums (all models) were compared with the
session's aggregate usage (direct plus subagents):

| Category      | Equal | Snapshot ÷ aggregate (min–max) |
| ------------- | ----- | ------------------------------ |
| input         | 1/6   | 1.000 – 458.161                |
| output        | 0/6   | 1.000 – 1.325                  |
| cacheCreation | 1/6   | 1.000 – 1.156                  |
| cacheRead     | 1/6   | 1.000 – 1.315                  |

The snapshot is never lower than the transcript aggregate. The excess fits usage that never appears
in transcripts (auxiliary requests); the very large input ratio suggests a different input
accounting. Scope stays `unknown`, and snapshots are never summed with records. This is a finding,
not a bug (usage-accounting §8).
