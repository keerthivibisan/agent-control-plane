-- 0006_review_loop: approval modes, the review loop and the ticket branch
-- (docs/review-loop/README.md §4, ADR-0021).
--
-- Conventions (as in 0001-0005):
--   * Ids are TEXT UUIDs; timestamps are UTC ISO-8601 TEXT ending in 'Z'.
--   * Enum-like columns (state, reviewer, verdict, decision, decided_by, change_state,
--     allow_rule) are validated with Zod in TypeScript (core's TicketBranchStateSchema,
--     ChangeReviewerKindSchema, ChangeVerdictSchema, ChangeDecisionSchema, ChangeDeciderSchema,
--     ChangeStateSchema, AllowRuleSchema), not with CHECK, so a later change can add a value
--     without rebuilding the table. Their lengths are checked here.
--   * Structural rules (commit ids, counters, same-run references, decided-together columns) are
--     enforced here as well.
--   * Columns are added to existing tables (not tables rebuilt), so 0002/0003 stay untouched.
--     Existing rows get NULL (or 0 for rework_rounds): runs before ADR-0021 have no review loop.
--   * Kept in JSON, no new columns: a project's approvals and command allowlist
--     (`project_setup.setup`), the review stage's settings (`project_workflow.workflow`), and a
--     run's snapshot of both (`orchestration_runs.limits`).
--   * No new stored text (ADR-0009, ADR-0016 as amended by ADR-0021): reviewer findings and the
--     lead's rework and discard notes are ticket comments (0003), referenced by `comment_id`.
--     There is no column for diffs, tool input or output, or thinking.
--   * Never edit this file after it ships: add a new migration instead.

-- Parent key for the same-project reference below: a ticket branch's project is its run's.
-- `id` is the primary key, so this index is unique for every row.
CREATE UNIQUE INDEX orchestration_runs_project_run ON orchestration_runs (project_id, id);

-- The run's ticket branch `acp/<KEY>` (ADR-0021 §4), 1:1 with a ticket run that has the review
-- loop. Helpers' changes are merged into it; the owner merges it into `base_branch` once.
CREATE TABLE ticket_branches (
  run_id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  -- `acp/<KEY>` or `acp/<KEY>-r<n>` (core's TicketBranchNameSchema).
  branch TEXT NOT NULL CHECK (length(branch) BETWEEN 8 AND 60 AND branch GLOB 'acp/*'),
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
  CHECK ((state = 'merged') = (merged_commit IS NOT NULL)),
  -- Deleting the run deletes its ticket branch record (never the git branch itself).
  FOREIGN KEY (project_id, run_id) REFERENCES orchestration_runs (project_id, id) ON DELETE CASCADE
) STRICT;

-- One open ticket branch per name: a second run of the ticket gets `acp/<KEY>-r<n>`.
CREATE UNIQUE INDEX ticket_branches_open_branch ON ticket_branches (branch) WHERE state = 'open';
CREATE INDEX ticket_branches_project ON ticket_branches (project_id, state);

-- One review round of a helper's change and its decision (ADR-0021 §3). Round 0 is the first
-- review; each rework adds a round. Holds no conversation text: the findings or the decider's
-- note are a ticket comment.
CREATE TABLE change_reviews (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES orchestration_runs (id) ON DELETE CASCADE,
  -- The helper or tester whose change this is.
  agent_run_id TEXT NOT NULL,
  round INTEGER NOT NULL CHECK (round >= 0),
  -- agent | lead | owner (ChangeReviewerKindSchema).
  reviewer TEXT NOT NULL CHECK (length(reviewer) BETWEEN 1 AND 20),
  -- The review agent's run when `reviewer` is `agent`; NULL otherwise.
  reviewer_agent_run_id TEXT,
  -- approve | rework (ChangeVerdictSchema); NULL until the review agent submits, and for the
  -- lead or the owner.
  verdict TEXT CHECK (verdict IS NULL OR length(verdict) BETWEEN 1 AND 20),
  -- merge | merge-anyway | rework | discard | ask-owner (ChangeDecisionSchema), by lead | owner
  -- (ChangeDeciderSchema), at decided_at: all three NULL until decided, all three set after.
  decision TEXT CHECK (decision IS NULL OR length(decision) BETWEEN 1 AND 20),
  decided_by TEXT CHECK (decided_by IS NULL OR length(decided_by) BETWEEN 1 AND 20),
  -- The ticket comment with the reviewer's findings or the lead's or owner's note. A deleted
  -- comment leaves the review row.
  comment_id TEXT REFERENCES ticket_comments (id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  decided_at TEXT,
  CHECK ((decision IS NULL) = (decided_by IS NULL) AND (decision IS NULL) = (decided_at IS NULL)),
  CHECK (reviewer_agent_run_id IS NULL OR reviewer_agent_run_id <> agent_run_id),
  -- Both agents belong to this run; deleting the run deletes its reviews (ADR-0015).
  FOREIGN KEY (run_id, agent_run_id) REFERENCES agent_runs (run_id, id) ON DELETE CASCADE,
  FOREIGN KEY (run_id, reviewer_agent_run_id) REFERENCES agent_runs (run_id, id) ON DELETE CASCADE
) STRICT;

CREATE INDEX change_reviews_run ON change_reviews (run_id, created_at);
CREATE INDEX change_reviews_agent_run ON change_reviews (agent_run_id, round);
CREATE INDEX change_reviews_reviewer ON change_reviews (reviewer_agent_run_id);
CREATE INDEX change_reviews_comment ON change_reviews (comment_id);

-- A helper's change in the review loop (ChangeStateSchema). NULL for runs without the loop.
ALTER TABLE managed_workspaces ADD COLUMN change_state TEXT
  CHECK (change_state IS NULL OR length(change_state) BETWEEN 1 AND 20);
-- Rework rounds used on this change (the limit is in the run's snapshot; the owner can grant
-- more, so there is no upper bound here).
ALTER TABLE managed_workspaces ADD COLUMN rework_rounds INTEGER NOT NULL DEFAULT 0
  CHECK (rework_rounds >= 0);
-- The sealed (or integrated) commit of the change; NULL until sealed.
ALTER TABLE managed_workspaces ADD COLUMN head_commit TEXT
  CHECK (head_commit IS NULL
    OR (length(head_commit) BETWEEN 7 AND 64 AND head_commit NOT GLOB '*[^0-9a-f]*'));

-- The commit a check ran on (core's CheckRun.commit). `commit` is an SQL keyword, hence the name.
-- NULL for check runs before 0006.
ALTER TABLE check_runs ADD COLUMN commit_sha TEXT
  CHECK (commit_sha IS NULL
    OR (length(commit_sha) BETWEEN 7 AND 64 AND commit_sha NOT GLOB '*[^0-9a-f]*'));
CREATE INDEX check_runs_commit ON check_runs (run_id, commit_sha);

-- Which rule let an action run without asking (AllowRuleSchema: edit-in-own-worktree |
-- run-harness-check | command-allowlist) when decided_by is `allowlist`. NULL otherwise and for
-- approvals before 0006.
ALTER TABLE approvals ADD COLUMN allow_rule TEXT
  CHECK (allow_rule IS NULL OR length(allow_rule) BETWEEN 1 AND 40);
