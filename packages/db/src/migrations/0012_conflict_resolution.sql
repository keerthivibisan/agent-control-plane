-- 0012_conflict_resolution: one "update from target / resolve conflicts" operation on a run's
-- ticket branch (ADR-0030, docs/conflict-resolution/README.md, CR-B).
--
-- Conventions (as in 0001-0011):
--   * Additive only: one new table; no existing table changes.
--   * The pinned commits, the state and the policy fingerprint are columns, so a unique index can
--     keep one active operation per run and promotion can compare and swap; everything else is the
--     operation record (core's ConflictResolutionRecordSchema), validated in Zod on every read and
--     write. SQL checks only shapes and lengths.
--   * No conversation content (ADR-0009): commits, states, file names, check ids and short
--     owner-facing reasons only. No diff, no file content, no prompt.
--   * Never edit this file after it ships: add a new migration instead.

CREATE TABLE conflict_resolutions (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('preparing', 'resolving', 'verifying', 'awaiting-owner',
    'delivering', 'completed', 'failed', 'cancelled', 'interrupted')),
  ticket_commit TEXT NOT NULL CHECK (length(ticket_commit) BETWEEN 7 AND 64),
  target_commit TEXT NOT NULL CHECK (length(target_commit) BETWEEN 7 AND 64),
  candidate_commit TEXT CHECK (candidate_commit IS NULL OR length(candidate_commit) BETWEEN 7 AND 64),
  policy_fingerprint TEXT NOT NULL CHECK (length(policy_fingerprint) BETWEEN 1 AND 64),
  record TEXT NOT NULL CHECK (json_valid(record) AND length(record) <= 65536),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (project_id, run_id) REFERENCES orchestration_runs (project_id, id) ON DELETE CASCADE
) STRICT;

-- At most one active operation per run: a second start, from the owner or the app, is refused.
CREATE UNIQUE INDEX conflict_resolutions_active ON conflict_resolutions (run_id)
  WHERE state IN ('preparing', 'resolving', 'verifying', 'awaiting-owner', 'delivering');
CREATE INDEX conflict_resolutions_run ON conflict_resolutions (run_id, created_at);
