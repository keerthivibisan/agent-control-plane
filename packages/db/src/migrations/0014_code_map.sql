-- 0014_code_map: the project code map (ADR-0034, CM-1).
--
-- Conventions (as in 0001-0013):
--   * Additive only: three new tables, no change to existing ones.
--   * `code_map_blobs` caches the path-independent parse result of one git blob per project
--     (core's CodeMapBlob, JSON validated in Zod on every read): language, size, line count,
--     top-level symbol names with lines, import specifiers, and a content-based skip reason.
--     Identical content is parsed once across commits and worktrees. `indexer_version` lets a
--     newer indexer re-parse older rows.
--   * `code_map_manifests` holds one row per built (or failed) commit; `counts` is core's
--     CodeMapCounts as JSON. Status and error code are checked in Zod (CodeMapErrorCode); here only
--     their lengths. The repository keeps the newest 5 ready manifests and the newest failure per
--     project, and deletes blobs no kept manifest uses.
--   * `code_map_entries` maps a manifest's paths to blob SHAs; `data` holds the per-manifest part
--     (resolved import paths, aligned with the blob's imports, and a path-based skip reason).
--   * Deleting a project deletes its map (ADR-0034 §6): every table cascades from `projects`.
--   * No source text, comments, string literals other than import specifiers, or conversation
--     content (ADR-0009).
--   * Never edit this file after it ships: add a new migration instead.

CREATE TABLE code_map_blobs (
  project_id TEXT NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  blob_sha TEXT NOT NULL
    CHECK (length(blob_sha) IN (40, 64) AND blob_sha NOT GLOB '*[^0-9a-f]*'),
  indexer_version INTEGER NOT NULL CHECK (indexer_version >= 1),
  data TEXT NOT NULL,
  PRIMARY KEY (project_id, blob_sha)
) STRICT;

CREATE TABLE code_map_manifests (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  commit_sha TEXT NOT NULL
    CHECK (length(commit_sha) IN (40, 64) AND commit_sha NOT GLOB '*[^0-9a-f]*'),
  built_at TEXT NOT NULL,
  indexer_version INTEGER NOT NULL CHECK (indexer_version >= 1),
  -- NULL for a failed build.
  counts TEXT,
  status TEXT NOT NULL CHECK (status IN ('ready', 'failed')),
  error TEXT CHECK (error IS NULL OR length(error) BETWEEN 1 AND 40),
  CHECK ((status = 'ready') = (counts IS NOT NULL AND error IS NULL)),
  UNIQUE (project_id, commit_sha)
) STRICT;

CREATE INDEX code_map_manifests_project ON code_map_manifests (project_id, built_at);

CREATE TABLE code_map_entries (
  manifest_id TEXT NOT NULL REFERENCES code_map_manifests (id) ON DELETE CASCADE,
  path TEXT NOT NULL CHECK (length(path) BETWEEN 1 AND 1024),
  blob_sha TEXT NOT NULL
    CHECK (length(blob_sha) IN (40, 64) AND blob_sha NOT GLOB '*[^0-9a-f]*'),
  size_bytes INTEGER NOT NULL CHECK (size_bytes >= 0),
  data TEXT NOT NULL,
  PRIMARY KEY (manifest_id, path)
) STRICT;

CREATE INDEX code_map_entries_blob ON code_map_entries (blob_sha);
