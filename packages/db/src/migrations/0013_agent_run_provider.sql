-- 0013_agent_run_provider: the provider that runs each managed agent (ADR-0031 §1, CX-2).
--
-- Conventions (as in 0001-0012):
--   * Additive only: one column on `agent_runs` with a default. Rows stored before 0013 were all
--     run by Claude Code, so the default states what happened rather than guessing.
--   * The value is checked in Zod (core's ManagedProviderIdSchema) on every read and write. No SQL
--     CHECK: SQLite cannot change one without rebuilding the table, and a later provider would
--     need that.
--   * No conversation content (ADR-0009): a provider id.
--   * Never edit this file after it ships: add a new migration instead.

ALTER TABLE agent_runs ADD COLUMN provider TEXT NOT NULL DEFAULT 'claude-code';
