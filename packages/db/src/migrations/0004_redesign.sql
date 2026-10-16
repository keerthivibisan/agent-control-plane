-- 0004_redesign: project workspace redesign — per-project workflow, agent stages, and the audit
-- fields P4-D kept in memory only (docs/redesign/README.md §6–7, ADR-0019, ADR-0013 amendment).
--
-- Conventions (as in 0001-0003):
--   * Ids are TEXT UUIDs; timestamps are UTC ISO-8601 TEXT ending in 'Z'.
--   * Enum-like columns (stage, decided_by) are validated with Zod in TypeScript, not with CHECK, so
--     a later change can add a value without rebuilding the table.
--   * Columns are added (not tables rebuilt), so 0002/0003 stay untouched. Existing rows get NULL:
--     Phase 3/4 runs have no stage, no stored decider and no stored limits snapshot.
--   * No new stored text: a workflow holds model names and skill names only (ADR-0009, ADR-0016).
--   * Ticket comments with the author `reviewer` (ADR-0019) need no schema change: 0003 validates
--     `ticket_comments.author` in TypeScript (core's TicketCommentAuthorSchema), not with CHECK.
--   * Never edit this file after it ships: add a new migration instead.

-- The project's workflow (1:1 with projects, ADR-0019). `workflow` is the stage configuration
-- (JSON: plannerMode and stages), validated with core's ProjectWorkflowSchema on write and read.
-- No row means the default workflow (`defaultProjectWorkflow()`, the Phase 4 flow).
CREATE TABLE project_workflow (
  project_id TEXT PRIMARY KEY REFERENCES projects (id) ON DELETE CASCADE,
  workflow TEXT NOT NULL CHECK (json_valid(workflow) AND json_type(workflow) = 'object'),
  updated_at TEXT NOT NULL
) STRICT;

-- The workflow stage an agent run belongs to (a WorkflowStageId). NULL for Phase 3/4 runs.
ALTER TABLE agent_runs ADD COLUMN stage TEXT CHECK (stage IS NULL OR length(stage) BETWEEN 1 AND 40);

-- Who decided an approval: owner | allowlist | timeout (ApprovalDto.decidedBy). NULL while pending,
-- when the engine closed it because the agent or run stopped, and for rows decided before 0004.
ALTER TABLE approvals ADD COLUMN decided_by TEXT
  CHECK (decided_by IS NULL OR length(decided_by) BETWEEN 1 AND 20);

-- The run's agent-tree limits at start (JSON: { maxConcurrentHelpers, maxDepth }). NULL means the
-- Phase 3 defaults, as the engine already treats a run without limits.
ALTER TABLE orchestration_runs ADD COLUMN limits TEXT
  CHECK (limits IS NULL OR (json_valid(limits) AND json_type(limits) = 'object'));
