-- 0015_agent_tool_counts: content-free tool-call counts per agent run (ADR-0034, CM-2).
--
-- Conventions (as in 0001-0014):
--   * Additive only: one nullable column on `agent_runs`. NULL means no tool call was counted
--     (every agent stored before 0015, and agents that used no tool); never read as zero counts.
--   * The value is JSON `{ read, search, edit, shell, code_map, other }` of non-negative integers,
--     checked in Zod (core's ToolUseCountsSchema) on every read and write.
--   * No conversation content (ADR-0009): counts by category only, never tool names or input.
--   * Never edit this file after it ships: add a new migration instead.

ALTER TABLE agent_runs ADD COLUMN tool_counts TEXT;
