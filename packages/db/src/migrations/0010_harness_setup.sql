-- 0010_harness_setup: setup runs, and where each check ran (ADR-0027, docs/v0.3.0/README.md
-- part 5, H-B).
--
-- Conventions (as in 0001-0009):
--   * Additive only: two nullable columns on `check_runs` and one new table. Rows stored before
--     0010 keep NULL in both columns (core's `CheckRun.place` and `blockNodeId` are then absent).
--   * `check_runs.place` is where the check ran (core's CheckRunPlaceSchema): a Checks block on a
--     helper's change, before the lead's merge, on the ticket branch, or "Run checks now" on main.
--   * `check_runs.block_node_id` is the workflow graph node of the Checks block that ran it (core's
--     WorkflowNodeIdSchema); NULL for main and for rows from before 0010.
--   * `setup_runs` holds one row per setup step run (core's SetupRun): in an editing agent's new
--     worktree (`agent_run_id` set), in a ticket branch check checkout (`run_id` set, no agent),
--     or before "Run checks now" on main (both NULL). Status is checked in Zod (SetupRunStatus);
--     here only its length. The output tail is the redacted last 16 KiB, like a check's.
--   * No conversation content (ADR-0009): only the project's own tool output, redacted.
--   * Never edit this file after it ships: add a new migration instead.

ALTER TABLE check_runs ADD COLUMN place TEXT
  CHECK (place IS NULL OR place IN ('change', 'merge', 'branch', 'main'));
ALTER TABLE check_runs ADD COLUMN block_node_id TEXT
  CHECK (block_node_id IS NULL OR length(block_node_id) BETWEEN 1 AND 40);

CREATE TABLE setup_runs (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  run_id TEXT REFERENCES orchestration_runs (id) ON DELETE CASCADE,
  agent_run_id TEXT,
  step_id TEXT NOT NULL CHECK (length(step_id) BETWEEN 1 AND 40),
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  status TEXT NOT NULL CHECK (length(status) BETWEEN 1 AND 20),
  exit_code INTEGER,
  duration_ms INTEGER NOT NULL CHECK (duration_ms >= 0),
  -- The last <= 16 KiB of combined output, redacted (MAX_CHECK_OUTPUT_BYTES).
  output_tail TEXT NOT NULL CHECK (length(output_tail) <= 16384),
  started_at TEXT NOT NULL,
  -- The commit the worktree or checkout was at; NULL when unknown.
  commit_sha TEXT
    CHECK (commit_sha IS NULL
      OR (length(commit_sha) BETWEEN 7 AND 64 AND commit_sha NOT GLOB '*[^0-9a-f]*')),
  -- An agent's setup always names its run, so the composite reference below is always checked.
  CHECK (agent_run_id IS NULL OR run_id IS NOT NULL),
  FOREIGN KEY (run_id, agent_run_id) REFERENCES agent_runs (run_id, id) ON DELETE CASCADE
) STRICT;

CREATE INDEX setup_runs_run ON setup_runs (run_id, started_at);
CREATE INDEX setup_runs_project_main ON setup_runs (project_id, started_at) WHERE run_id IS NULL;
