-- 0001_observability: Phase 1 session observability schema (docs/domain-model.md §3).
--
-- Conventions:
--   * Internal ids are TEXT UUIDs (crypto.randomUUID), except events.id, which is a monotonic
--     INTEGER (AUTOINCREMENT: never reused, even after purges) and doubles as the SSE event id.
--   * Timestamps are UTC ISO-8601 TEXT ending in 'Z' (normalized by the repositories), so text
--     comparison orders them correctly.
--   * Token counts are nullable: NULL means unavailable and is never written as 0.
--   * Enum-like columns (provider, kind, provenance, ...) are validated with Zod in TypeScript, on
--     write and on read. They have no CHECK constraints because SQLite cannot alter a CHECK without
--     rebuilding the table.
--   * JSON columns carry json_valid() checks; their shape is validated with Zod on read.
--   * No Phase 3 tables here (tasks, runs, approvals, ...); they arrive in later migrations.
--   * Never edit this file after it ships: add a new migration instead.

CREATE TABLE projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  -- realpath-normalized by the server before insert.
  root_path TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  provider_session_id TEXT NOT NULL,
  -- '' for top-level sessions (SessionKey.providerAgentId = null) so the unique key works.
  provider_agent_id TEXT NOT NULL DEFAULT '',
  -- Unregistering a project detaches its sessions; it never deletes history.
  project_id TEXT REFERENCES projects (id) ON DELETE SET NULL,
  origin TEXT NOT NULL,
  -- Evidence columns. Status is derived from these on read; it is never stored.
  launch_cwd TEXT,
  git_branch TEXT,
  entrypoint TEXT,
  provider_version TEXT,
  title TEXT,
  agent_type TEXT,
  description TEXT,
  first_seen_at TEXT NOT NULL,
  last_observed_at TEXT NOT NULL,
  last_event_at TEXT,
  ended_at TEXT,
  end_reason TEXT,
  last_attention_at TEXT,
  -- Allowlisted keys only; no conversation content (ADR-0009).
  metadata TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(metadata) AND json_type(metadata) = 'object'),
  UNIQUE (provider, provider_session_id, provider_agent_id)
) STRICT;

CREATE INDEX sessions_project_last_event ON sessions (project_id, last_event_at);
-- Keyset order of the session list: (last_event_at DESC NULLS LAST, id).
CREATE INDEX sessions_activity_order ON sessions (COALESCE(last_event_at, ''), id);

CREATE TABLE session_edges (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  parent_session_id TEXT NOT NULL REFERENCES sessions (id) ON DELETE CASCADE,
  child_session_id TEXT NOT NULL REFERENCES sessions (id) ON DELETE CASCADE,
  provenance TEXT NOT NULL,
  -- JSON array of SessionEdgeEvidence, at least one entry; only ever grows.
  evidence TEXT NOT NULL CHECK (json_valid(evidence) AND json_type(evidence) = 'array'),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (parent_session_id <> child_session_id),
  -- A child has at most one parent per edge kind.
  UNIQUE (kind, child_session_id)
) STRICT;

CREATE INDEX session_edges_parent ON session_edges (parent_session_id, kind);

-- Evidence naming a different parent for an existing (kind, child) edge. The edge is not changed.
CREATE TABLE edge_conflicts (
  id TEXT PRIMARY KEY,
  edge_id TEXT NOT NULL REFERENCES session_edges (id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  child_session_id TEXT NOT NULL REFERENCES sessions (id) ON DELETE CASCADE,
  existing_parent_session_id TEXT NOT NULL REFERENCES sessions (id) ON DELETE CASCADE,
  conflicting_parent_session_id TEXT NOT NULL REFERENCES sessions (id) ON DELETE CASCADE,
  provenance TEXT NOT NULL,
  evidence TEXT NOT NULL CHECK (json_valid(evidence) AND json_type(evidence) = 'array'),
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  UNIQUE (kind, child_session_id, conflicting_parent_session_id)
) STRICT;

CREATE INDEX edge_conflicts_edge ON edge_conflicts (edge_id);

-- Append-only normalized events (NormalizedEventSchema). Never updated.
CREATE TABLE events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  schema_version INTEGER NOT NULL,
  provider TEXT NOT NULL,
  event_type TEXT NOT NULL,
  dedup_key TEXT NOT NULL UNIQUE,
  source_event_id TEXT,
  provider_session_id TEXT,
  provider_agent_id TEXT,
  session_id TEXT REFERENCES sessions (id) ON DELETE CASCADE,
  project_id TEXT REFERENCES projects (id) ON DELETE SET NULL,
  occurred_at TEXT,
  observed_at TEXT NOT NULL,
  provenance TEXT NOT NULL,
  channel TEXT NOT NULL,
  provider_version TEXT,
  source_path TEXT,
  source_offset INTEGER CHECK (source_offset >= 0),
  hook_event TEXT,
  -- Typed per event_type; contains no conversation content (ADR-0009).
  payload TEXT NOT NULL CHECK (json_valid(payload) AND json_type(payload) = 'object')
) STRICT;

CREATE INDEX events_session_occurred ON events (session_id, occurred_at);
CREATE INDEX events_observed ON events (observed_at);

-- One row per usage.reported event, stored as received (usage-accounting §5).
CREATE TABLE usage_observations (
  event_id INTEGER PRIMARY KEY REFERENCES events (id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  message_id TEXT NOT NULL,
  session_id TEXT NOT NULL REFERENCES sessions (id) ON DELETE CASCADE,
  occurred_at TEXT,
  request_id TEXT,
  model TEXT,
  input_tokens INTEGER CHECK (input_tokens >= 0),
  output_tokens INTEGER CHECK (output_tokens >= 0),
  cache_creation_tokens INTEGER CHECK (cache_creation_tokens >= 0),
  cache_read_tokens INTEGER CHECK (cache_read_tokens >= 0)
) STRICT;

CREATE INDEX usage_observations_message ON usage_observations (provider, message_id);
CREATE INDEX usage_observations_session ON usage_observations (session_id);

-- Projection: one row per (provider, message_id), recomputed from observations by the pipeline.
CREATE TABLE usage_records (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  message_id TEXT NOT NULL,
  -- Attributed session (earliest occurrence).
  session_id TEXT NOT NULL REFERENCES sessions (id) ON DELETE CASCADE,
  -- The observation whose categories were selected (max output).
  selected_event_id INTEGER REFERENCES events (id) ON DELETE SET NULL,
  -- occurred_at of the attributed (earliest) observation; used for per-day grouping.
  occurred_at TEXT,
  request_id TEXT,
  model TEXT,
  input_tokens INTEGER CHECK (input_tokens >= 0),
  output_tokens INTEGER CHECK (output_tokens >= 0),
  cache_creation_tokens INTEGER CHECK (cache_creation_tokens >= 0),
  cache_read_tokens INTEGER CHECK (cache_read_tokens >= 0),
  observation_count INTEGER NOT NULL CHECK (observation_count >= 1),
  conflict INTEGER NOT NULL CHECK (conflict IN (0, 1)),
  -- The earliest occurredAt was tied across different sessions (fork copies), so the session was
  -- chosen by the lexical tie-break and the true origin is unknown (usage-accounting §5.2).
  attribution_ambiguous INTEGER NOT NULL DEFAULT 0 CHECK (attribution_ambiguous IN (0, 1)),
  source TEXT NOT NULL,
  provenance TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (provider, message_id)
) STRICT;

CREATE INDEX usage_records_session ON usage_records (session_id);
CREATE INDEX usage_records_model ON usage_records (model);

-- Provider-reported running totals (usage.snapshot). Stored and displayed, never summed.
CREATE TABLE usage_snapshots (
  event_id INTEGER PRIMARY KEY REFERENCES events (id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  session_id TEXT NOT NULL REFERENCES sessions (id) ON DELETE CASCADE,
  occurred_at TEXT,
  observed_at TEXT NOT NULL,
  scope TEXT NOT NULL,
  by_model TEXT NOT NULL CHECK (json_valid(by_model) AND json_type(by_model) = 'object'),
  -- Always estimated provenance; NULL when not reported.
  reported_cost_usd REAL CHECK (reported_cost_usd >= 0)
) STRICT;

CREATE INDEX usage_snapshots_session ON usage_snapshots (session_id, occurred_at);

-- Restart-safe read position per source file; written in the same transaction as its events.
CREATE TABLE ingestion_checkpoints (
  source_path TEXT PRIMARY KEY,
  file_identity TEXT NOT NULL,
  size_bytes INTEGER NOT NULL CHECK (size_bytes >= 0),
  mtime_ms REAL NOT NULL,
  byte_offset INTEGER NOT NULL CHECK (byte_offset >= 0),
  head_hash TEXT NOT NULL,
  parse_errors INTEGER NOT NULL DEFAULT 0 CHECK (parse_errors >= 0),
  updated_at TEXT NOT NULL
) STRICT;
