import { ProjectAgentSetupSchema, WorkflowStageIdSchema, type WorkflowStageId } from '@acp/core';
import { DbError } from '../../errors.js';
import type { RepositoryContext } from '../../internal/context.js';
import { parseInput, parseStored, parseStoredJson } from '../../internal/validate.js';
import { literalParser, nullable } from '../orchestration/shared.js';

/**
 * The 0004 columns on Phase 3 tables (docs/redesign/README.md §7): who decided an approval, a
 * run's limits snapshot, and an agent run's workflow stage. They live here rather than in the
 * orchestration repositories so the Phase 3 code stays as it shipped; the server's run store
 * writes them in the same transaction as the rows they belong to.
 */

/** ApprovalDto.decidedBy. Core defines it only in the HTTP contract, so the list is closed here. */
export const APPROVAL_DECIDERS = ['owner', 'allowlist', 'timeout'] as const;
export type ApprovalDecider = (typeof APPROVAL_DECIDERS)[number];
const DeciderParser = nullable(literalParser(APPROVAL_DECIDERS));

/** The run's agent-tree limits at start (the engine's RunLimits), bounded like the setup's. */
export const StoredRunLimitsSchema = ProjectAgentSetupSchema.pick({
  maxConcurrentHelpers: true,
  maxDepth: true,
}).strict();
export interface StoredRunLimits {
  maxConcurrentHelpers: number;
  maxDepth: number;
}
const StageParser = nullable(WorkflowStageIdSchema);

export interface RunAuditRepository {
  /** `not_found` for an unknown approval. Null clears it (pending, or closed by the engine). */
  setApprovalDecidedBy(approvalId: string, decidedBy: ApprovalDecider | null): void;
  /** Approval id → decider, for every approval of the run (null when not stored). */
  approvalDecidersForRun(runId: string): Map<string, ApprovalDecider | null>;
  /** `not_found` for an unknown run. */
  setRunLimits(runId: string, limits: StoredRunLimits | null): void;
  /** Null when the run has no snapshot (Phase 3/4 rows: the engine's defaults apply). */
  getRunLimits(runId: string): StoredRunLimits | null;
  /** `not_found` for an unknown agent run. */
  setAgentStage(agentRunId: string, stage: WorkflowStageId | null): void;
  /** Agent run id → stage, for every agent of the run (null for Phase 3/4 agents). */
  agentStagesForRun(runId: string): Map<string, WorkflowStageId | null>;
}

export function createRunAuditRepository(ctx: RepositoryContext): RunAuditRepository {
  const c = ctx.connection;
  const setDecider = c.prepare('UPDATE approvals SET decided_by = ? WHERE id = ?');
  const deciders = c.prepare('SELECT id, decided_by FROM approvals WHERE run_id = ?');
  const setLimits = c.prepare('UPDATE orchestration_runs SET limits = ? WHERE id = ?');
  const limitsOf = c.prepare('SELECT limits FROM orchestration_runs WHERE id = ?');
  const setStage = c.prepare('UPDATE agent_runs SET stage = ? WHERE id = ?');
  const stages = c.prepare('SELECT id, stage FROM agent_runs WHERE run_id = ?');

  function updated(changes: number, what: string): void {
    if (changes === 0) throw new DbError('not_found', `${what} not found`);
  }

  return {
    setApprovalDecidedBy(approvalId, decidedBy) {
      const value = parseInput(DeciderParser, decidedBy, 'approval decidedBy');
      updated(setDecider.run(value, approvalId).changes, 'approval');
    },
    approvalDecidersForRun(runId) {
      const rows = deciders.all(runId) as { id: string; decided_by: string | null }[];
      return new Map(
        rows.map((r) => [
          r.id,
          parseStored(DeciderParser, r.decided_by, 'approvals', 'decided_by'),
        ]),
      );
    },
    setRunLimits(runId, limits) {
      const value =
        limits === null
          ? null
          : JSON.stringify(parseInput(StoredRunLimitsSchema, limits, 'run limits'));
      updated(setLimits.run(value, runId).changes, 'run');
    },
    getRunLimits(runId) {
      const row = limitsOf.get(runId) as { limits: string | null } | undefined;
      if (row === undefined || row.limits === null) return null;
      return parseStoredJson(StoredRunLimitsSchema, row.limits, 'orchestration_runs', 'limits');
    },
    setAgentStage(agentRunId, stage) {
      const value = parseInput(StageParser, stage, 'agent run stage');
      updated(setStage.run(value, agentRunId).changes, 'agent run');
    },
    agentStagesForRun(runId) {
      const rows = stages.all(runId) as { id: string; stage: string | null }[];
      return new Map(
        rows.map((r) => [r.id, parseStored(StageParser, r.stage, 'agent_runs', 'stage')]),
      );
    },
  };
}
