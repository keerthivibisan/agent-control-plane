-- Content-free recovery evidence; separate from older versions' strict run snapshots.
CREATE TABLE run_recovery (
  run_id TEXT PRIMARY KEY REFERENCES orchestration_runs(id) ON DELETE CASCADE,
  record TEXT NOT NULL CHECK (json_valid(record))
) STRICT;
