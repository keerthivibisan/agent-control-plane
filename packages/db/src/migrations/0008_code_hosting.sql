-- 0008_code_hosting: branching strategies and pull requests (ADR-0025, docs/v0.3.0/README.md
-- Part 2, G-A).
--
-- Conventions (as in 0001-0007):
--   * `tickets.branch_prefs` is a column added to the existing table (0003 stays untouched).
--     Existing tickets get NULL: the branch name and target follow the project, as before.
--     Its JSON object ({name?, target?}) is validated with Zod in TypeScript (core's
--     TicketBranchPrefsSchema); here it must be a JSON object of bounded length.
--   * `ticket_branches` is rebuilt (SQLite cannot drop a CHECK): the `acp/*` name check of 0006
--     goes, because a project's branching strategy or the ticket itself now names the branch
--     (core's TicketBranchNameSchema, a safe git branch name, checked in Zod). Every other column,
--     check, index and foreign key is kept as 0006 made it, and every row is copied unchanged.
--     Nothing references `ticket_branches`, so dropping the old table breaks no foreign key.
--   * The pull request raised for a ticket branch (ADR-0025 §4) is five nullable columns, all set
--     or all NULL. `pr_provider` and `pr_state` are validated with Zod (CodeHostProviderSchema,
--     PullRequestStateSchema), with their lengths checked here, so `gitlab` can come without a
--     rebuild. The URL is the host's own web address of the pull request; no token or user.
--   * No conversation content (ADR-0009): branch names, a number, a URL, a state and a time.
--   * Never edit this file after it ships: add a new migration instead.

ALTER TABLE tickets ADD COLUMN branch_prefs TEXT
  CHECK (branch_prefs IS NULL
    OR (length(branch_prefs) <= 500 AND json_valid(branch_prefs)
      AND json_type(branch_prefs) = 'object'));

CREATE TABLE ticket_branches_0008 (
  run_id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  -- Any safe branch name (core's TicketBranchNameSchema); `acp/<KEY>` for runs before 0.3.0.
  branch TEXT NOT NULL CHECK (length(branch) BETWEEN 1 AND 200),
  -- The ticket's target branch: the ticket branch starts at its tip and is merged into it.
  base_branch TEXT NOT NULL CHECK (length(base_branch) BETWEEN 1 AND 255),
  -- The base branch's commit when the ticket branch was created.
  base_commit TEXT NOT NULL
    CHECK (length(base_commit) BETWEEN 7 AND 64 AND base_commit NOT GLOB '*[^0-9a-f]*'),
  -- The branch tip; moved only by a server-side compare-and-swap after a merged change.
  head_commit TEXT NOT NULL
    CHECK (length(head_commit) BETWEEN 7 AND 64 AND head_commit NOT GLOB '*[^0-9a-f]*'),
  -- open | merged | discarded (TicketBranchStateSchema).
  state TEXT NOT NULL CHECK (length(state) BETWEEN 1 AND 20),
  -- The base branch's commit after the owner's merge; set exactly when the branch is merged.
  merged_commit TEXT
    CHECK (merged_commit IS NULL
      OR (length(merged_commit) BETWEEN 7 AND 64 AND merged_commit NOT GLOB '*[^0-9a-f]*')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  -- github (CodeHostProviderSchema).
  pr_provider TEXT CHECK (pr_provider IS NULL OR length(pr_provider) BETWEEN 1 AND 20),
  pr_number INTEGER CHECK (pr_number IS NULL OR pr_number > 0),
  pr_url TEXT
    CHECK (pr_url IS NULL OR (length(pr_url) BETWEEN 9 AND 500 AND pr_url GLOB 'https://*')),
  -- open | merged | closed (PullRequestStateSchema), as the host last reported it.
  pr_state TEXT CHECK (pr_state IS NULL OR length(pr_state) BETWEEN 1 AND 20),
  -- When the app last read the state from the host (the owner's view or Refresh).
  pr_checked_at TEXT,
  CHECK ((state = 'merged') = (merged_commit IS NOT NULL)),
  -- A pull request is recorded whole or not at all.
  CHECK ((pr_provider IS NULL) = (pr_number IS NULL)
    AND (pr_provider IS NULL) = (pr_url IS NULL)
    AND (pr_provider IS NULL) = (pr_state IS NULL)
    AND (pr_provider IS NULL) = (pr_checked_at IS NULL)),
  -- Deleting the run deletes its ticket branch record (never the git branch itself).
  FOREIGN KEY (project_id, run_id) REFERENCES orchestration_runs (project_id, id) ON DELETE CASCADE
) STRICT;

INSERT INTO ticket_branches_0008 (run_id, project_id, branch, base_branch, base_commit,
    head_commit, state, merged_commit, created_at, updated_at)
  SELECT run_id, project_id, branch, base_branch, base_commit, head_commit, state, merged_commit,
    created_at, updated_at
  FROM ticket_branches;

DROP TABLE ticket_branches;
ALTER TABLE ticket_branches_0008 RENAME TO ticket_branches;

-- As in 0006: one open ticket branch per name (a second run of the ticket gets `-r<n>`).
CREATE UNIQUE INDEX ticket_branches_open_branch ON ticket_branches (branch) WHERE state = 'open';
CREATE INDEX ticket_branches_project ON ticket_branches (project_id, state);
