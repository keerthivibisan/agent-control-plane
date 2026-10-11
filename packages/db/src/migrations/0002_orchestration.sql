-- 0002_orchestration: Phase 3 milestone M1 managed orchestration (docs/domain-model.md Phase 3 note,
-- docs/orchestration-lifecycle.md §0, ADR-0013, ADR-0014, ADR-0015).
--
-- Conventions (as in 0001):
--   * Ids are TEXT UUIDs; timestamps are UTC ISO-8601 TEXT ending in 'Z'.
--   * Enum-like columns (status, kind, role, relation, state) are validated with Zod in TypeScript,
--     not with CHECK, so a later milestone can add a value without rebuilding the table.
--   * Structural rules (lengths, ranges, same-run references) are enforced here as well.
--   * Deleting a run removes everything that belongs to it, including the chat (ADR-0015).
--   * Content (ADR-0009, ADR-0015): only the owner <-> lead chat, the worker task text, and the
--     redacted approval summary (max 200 characters) are stored. There is no column for worker
--     conversation content, thinking, tool inputs or outputs, or owner decision messages.
--   * Never edit this file after it ships: add a new migration instead.

CREATE TABLE orchestration_runs (
  id TEXT PRIMARY KEY,
  -- A project with runs cannot be unregistered until its runs are deleted: deleting it silently
  -- would drop the owner's chat and leave worktrees on disk without a record.
  project_id TEXT NOT NULL REFERENCES projects (id) ON DELETE RESTRICT,
  title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
  status TEXT NOT NULL,
  -- RunBudget (ADR-0014): per-agent soft cap in budget tokens, optional run cost warning (estimated).
  max_tokens_per_agent INTEGER NOT NULL CHECK (max_tokens_per_agent > 0),
  soft_cost_usd_per_run REAL CHECK (soft_cost_usd_per_run > 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  ended_at TEXT
) STRICT;

CREATE INDEX orchestration_runs_order ON orchestration_runs (created_at, id);
CREATE INDEX orchestration_runs_project ON orchestration_runs (project_id, created_at);
CREATE INDEX orchestration_runs_status ON orchestration_runs (status);

CREATE TABLE agent_runs (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES orchestration_runs (id) ON DELETE CASCADE,
  -- NULL for the lead; the lead's id for workers (depth 1, checked by the repository). The composite
  -- reference keeps a worker's parent inside the same run.
  parent_agent_run_id TEXT,
  kind TEXT NOT NULL,
  role TEXT NOT NULL CHECK (length(role) BETWEEN 1 AND 60),
  -- The worker's task text from the lead (ADR-0015). NULL for the lead.
  task TEXT CHECK (task IS NULL OR length(task) BETWEEN 1 AND 4000),
  status TEXT NOT NULL,
  -- Budget tokens (ADR-0014), as accounted by the engine; the limit starts at the run's
  -- max_tokens_per_agent and grows when the owner approves a budget raise.
  budget_tokens_used INTEGER NOT NULL DEFAULT 0 CHECK (budget_tokens_used >= 0),
  budget_tokens_limit INTEGER NOT NULL CHECK (budget_tokens_limit > 0),
  created_at TEXT NOT NULL,
  ended_at TEXT,
  UNIQUE (run_id, id),
  FOREIGN KEY (run_id, parent_agent_run_id) REFERENCES agent_runs (run_id, id) ON DELETE CASCADE
) STRICT;

CREATE INDEX agent_runs_run ON agent_runs (run_id, created_at);
CREATE INDEX agent_runs_parent ON agent_runs (parent_agent_run_id);
CREATE INDEX agent_runs_status ON agent_runs (status);
-- Exactly one lead (the agent without a parent) per run.
CREATE UNIQUE INDEX agent_runs_one_lead ON agent_runs (run_id) WHERE parent_agent_run_id IS NULL;

-- Links an agent run to the provider session it started (the `started` event). The observed
-- session row (sessions) is found by (provider, provider_session_id) when it has been ingested, so
-- linking does not wait for the observation pipeline.
CREATE TABLE agent_run_sessions (
  agent_run_id TEXT NOT NULL REFERENCES agent_runs (id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  provider_session_id TEXT NOT NULL CHECK (length(provider_session_id) > 0),
  relation TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (agent_run_id, provider, provider_session_id)
) STRICT;

CREATE INDEX agent_run_sessions_provider_session
  ON agent_run_sessions (provider, provider_session_id);
-- At most one primary session per agent run.
CREATE UNIQUE INDEX agent_run_sessions_one_primary
  ON agent_run_sessions (agent_run_id) WHERE relation = 'primary';

-- Owner decision gates (ADR-0013). Immutable once decided.
CREATE TABLE approvals (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES orchestration_runs (id) ON DELETE CASCADE,
  agent_run_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  tool_name TEXT CHECK (tool_name IS NULL OR length(tool_name) > 0),
  -- Redacted "tool and target" description, max 200 characters (ADR-0013, ADR-0015).
  summary TEXT NOT NULL CHECK (length(summary) BETWEEN 1 AND 200),
  status TEXT NOT NULL,
  requested_at TEXT NOT NULL,
  decided_at TEXT,
  FOREIGN KEY (run_id, agent_run_id) REFERENCES agent_runs (run_id, id) ON DELETE CASCADE
) STRICT;

CREATE INDEX approvals_run ON approvals (run_id, requested_at);
CREATE INDEX approvals_agent_run ON approvals (agent_run_id);
CREATE INDEX approvals_status ON approvals (status, requested_at);

-- Immutable agent outputs. The files live under the data dir; only their relative path and
-- sha256 are stored here.
CREATE TABLE artifacts (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES orchestration_runs (id) ON DELETE CASCADE,
  agent_run_id TEXT,
  kind TEXT NOT NULL,
  -- Relative to the data dir, '/'-separated, without '..' segments (checked by the repository).
  storage_path TEXT NOT NULL UNIQUE CHECK (length(storage_path) > 0),
  sha256 TEXT NOT NULL CHECK (length(sha256) = 64 AND sha256 NOT GLOB '*[^0-9a-f]*'),
  size_bytes INTEGER NOT NULL CHECK (size_bytes >= 0),
  created_at TEXT NOT NULL,
  FOREIGN KEY (run_id, agent_run_id) REFERENCES agent_runs (run_id, id) ON DELETE CASCADE
) STRICT;

CREATE INDEX artifacts_run ON artifacts (run_id, created_at);
CREATE INDEX artifacts_agent_run ON artifacts (agent_run_id);

-- A worker's git worktree (ADR-0013 §2) and its review state (ADR-0013 §5).
CREATE TABLE managed_workspaces (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES orchestration_runs (id) ON DELETE CASCADE,
  agent_run_id TEXT NOT NULL UNIQUE,
  worktree_path TEXT NOT NULL UNIQUE CHECK (length(worktree_path) > 0),
  branch TEXT NOT NULL UNIQUE CHECK (length(branch) > 0),
  base_branch TEXT NOT NULL CHECK (length(base_branch) > 0),
  -- The base branch's commit when the worktree was created; NULL when not recorded.
  base_commit TEXT CHECK (base_commit IS NULL OR length(base_commit) BETWEEN 7 AND 64),
  -- 'active' while the worktree exists on disk, 'removed' after merge, discard, or cleanup.
  state TEXT NOT NULL,
  review_state TEXT NOT NULL,
  -- NULL until the changes were computed.
  changed_files INTEGER CHECK (changed_files >= 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  removed_at TEXT,
  FOREIGN KEY (run_id, agent_run_id) REFERENCES agent_runs (run_id, id) ON DELETE CASCADE
) STRICT;

CREATE INDEX managed_workspaces_run ON managed_workspaces (run_id);
CREATE INDEX managed_workspaces_state ON managed_workspaces (state);

-- The owner <-> lead chat (ADR-0015). `seq` orders messages within a run.
CREATE TABLE orchestrator_messages (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES orchestration_runs (id) ON DELETE CASCADE,
  seq INTEGER NOT NULL CHECK (seq >= 1),
  role TEXT NOT NULL,
  text TEXT NOT NULL CHECK (length(text) > 0),
  created_at TEXT NOT NULL,
  UNIQUE (run_id, seq)
) STRICT;
