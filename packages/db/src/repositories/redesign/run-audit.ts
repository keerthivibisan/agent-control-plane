import {
  ApprovalModeSchema,
  ChangeReviewerModeSchema,
  ProjectAgentSetupSchema,
  ProjectApprovalsSchema,
  ProjectWorkflowSchema,
  ReworkRoundsSchema,
  TicketBranchNameSchema,
  WorkflowGraphSchema,
  WorkflowNodeIdSchema,
  type ApprovalMode,
  type ChangeReviewerMode,
  type CompileContext,
  type ProjectApprovals,
  type ProjectWorkflow,
  type WorkflowGraph,
  type WorkflowNodeId,
} from '@acp/core';
import { DbError } from '../../errors.js';
import type { RepositoryContext } from '../../internal/context.js';
import { parseInput, parseStored, parseStoredJson, type Parser } from '../../internal/validate.js';
import { literalParser, nullable } from '../orchestration/shared.js';

/**
 * The 0004 columns on Phase 3 tables (docs/redesign/README.md §7): who decided an approval, a
 * run's snapshot (its limits, and for a ticket run its workflow), and an agent run's workflow
 * stage. They live here rather than in the
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

/**
 * What `orchestration_runs.limits` holds (R-G Part 2): the limits at start, plus the workflow the
 * run was created with (the engine's `RunState.workflow`, ADR-0019) and whether its next stage
 * waits for the owner's Continue after a restart (`RunState.stagesHeld`). Kept in the 0004 column
 * rather than a new one, as the coordinator decided; the JSON is checked as a whole.
 */
export interface StoredRunSnapshot extends StoredRunLimits {
  workflow?: ProjectWorkflow;
  stagesHeld?: true;
  /**
   * ADR-0021 §1: the approval mode and command allowlist the run snapshotted at start (the
   * engine's `RunState.approvalPolicy`). Absent for runs before it.
   */
  approvals?: ProjectApprovals;
  /**
   * ADR-0021 §3: the run's review loop (the engine's `RunState.integration`). Absent for runs
   * before it, which keep the legacy flow.
   */
  integration?: StoredRunIntegration;
  /**
   * ADR-0022: the run's plan that Full auto approved automatically (`TicketPlan.decidedBy`
   * `auto`). Absent when the owner decided the plan, and for runs before it.
   */
  autoApprovedPlanId?: string;
  /**
   * ADR-0023: the workflow graph the run follows (the engine's `RunState.graph`), snapshotted at
   * start, and the context it compiles with (`RunState.graphContext`). Always together. Absent for
   * runs before it, which compile their version 1 `workflow` migrated.
   */
  graph?: WorkflowGraph;
  graphContext?: CompileContext;
}

/** The review loop settings the run snapshotted, plus whether the lead has handed over. */
export interface StoredRunIntegration {
  reviewer: ChangeReviewerMode;
  maxReworkRounds: number;
  handedOver: boolean;
  /** The ticket's key (`WEB-12`), which names the ticket branch. */
  ticketKey: string;
  /** The ticket branch once created (`acp/WEB-12` or `-r<n>`); null before. */
  ticketBranch: string | null;
}

function parseIntegration(value: unknown): StoredRunIntegration | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const { reviewer, maxReworkRounds, handedOver, ticketKey, ticketBranch, ...extra } =
    value as Record<string, unknown>;
  if (Object.keys(extra).length > 0) return null;
  const r = ChangeReviewerModeSchema.safeParse(reviewer);
  const m = ReworkRoundsSchema.safeParse(maxReworkRounds);
  if (!r.success || !m.success || typeof handedOver !== 'boolean') return null;
  // The key must give a valid ticket branch name, as the engine requires.
  if (
    typeof ticketKey !== 'string' ||
    !TicketBranchNameSchema.safeParse(`acp/${ticketKey}`).success
  ) {
    return null;
  }
  const branch = ticketBranch === null ? null : TicketBranchNameSchema.safeParse(ticketBranch);
  if (branch !== null && !branch.success) return null;
  return {
    reviewer: r.data,
    maxReworkRounds: m.data,
    handedOver,
    ticketKey,
    ticketBranch: branch === null ? null : branch.data,
  };
}

const fail = (message: string) => ({ success: false as const, error: new Error(message) });

/** At most the ticket's and the run's mode (README WG-0 refinements 5 and 7). */
const MAX_APPROVAL_CEILINGS = 2;
const HelperLimitSchema = ProjectAgentSetupSchema.shape.maxConcurrentHelpers;

/**
 * A graph run's compile context (`CompileContext`), each field checked with core's schema and no
 * other key allowed. The optional overrides are left out, never stored as undefined.
 */
function parseGraphContext(value: unknown): CompileContext | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const {
    projectMode,
    approvalCeilings,
    reviewer,
    maxReworkRounds,
    maxConcurrentHelpers,
    ...extra
  } = value as Record<string, unknown>;
  if (Object.keys(extra).length > 0) return null;
  const mode = ApprovalModeSchema.safeParse(projectMode);
  const helpers = HelperLimitSchema.safeParse(maxConcurrentHelpers);
  if (!mode.success || !helpers.success) return null;
  if (!Array.isArray(approvalCeilings) || approvalCeilings.length > MAX_APPROVAL_CEILINGS) {
    return null;
  }
  const ceilings: ApprovalMode[] = [];
  for (const ceiling of approvalCeilings) {
    const parsed = ApprovalModeSchema.safeParse(ceiling);
    if (!parsed.success) return null;
    ceilings.push(parsed.data);
  }
  const context: CompileContext = {
    projectMode: mode.data,
    approvalCeilings: ceilings,
    maxConcurrentHelpers: helpers.data,
  };
  if (reviewer !== undefined) {
    const parsed = ChangeReviewerModeSchema.safeParse(reviewer);
    if (!parsed.success) return null;
    context.reviewer = parsed.data;
  }
  if (maxReworkRounds !== undefined) {
    const parsed = ReworkRoundsSchema.safeParse(maxReworkRounds);
    if (!parsed.success) return null;
    context.maxReworkRounds = parsed.data;
  }
  return context;
}

export const StoredRunSnapshotParser: Parser<StoredRunSnapshot> = {
  safeParse(value: unknown) {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      return fail('expected an object');
    }
    const {
      workflow,
      stagesHeld,
      approvals,
      integration,
      autoApprovedPlanId,
      graph,
      graphContext,
      ...rest
    } = value as Record<string, unknown>;
    const limits = StoredRunLimitsSchema.safeParse(rest);
    if (!limits.success) return fail('invalid limits');
    const snapshot: StoredRunSnapshot = { ...limits.data };
    if (workflow !== undefined) {
      const parsed = ProjectWorkflowSchema.safeParse(workflow);
      if (!parsed.success) return fail('invalid workflow');
      snapshot.workflow = parsed.data;
    }
    if (stagesHeld !== undefined) {
      if (stagesHeld !== true) return fail('stagesHeld must be true when present');
      snapshot.stagesHeld = true;
    }
    if (approvals !== undefined) {
      const parsed = ProjectApprovalsSchema.safeParse(approvals);
      if (!parsed.success) return fail('invalid approvals');
      snapshot.approvals = parsed.data;
    }
    if (integration !== undefined) {
      const parsed = parseIntegration(integration);
      if (parsed === null) return fail('invalid integration');
      snapshot.integration = parsed;
    }
    if (autoApprovedPlanId !== undefined) {
      if (
        typeof autoApprovedPlanId !== 'string' ||
        autoApprovedPlanId.length === 0 ||
        autoApprovedPlanId.length > 100
      ) {
        return fail('invalid autoApprovedPlanId');
      }
      snapshot.autoApprovedPlanId = autoApprovedPlanId;
    }
    if (graph !== undefined || graphContext !== undefined) {
      // The program is compiled from both, so one without the other is not a graph run.
      const parsedGraph = WorkflowGraphSchema.safeParse(graph);
      if (!parsedGraph.success) return fail('invalid graph');
      const context = parseGraphContext(graphContext);
      if (context === null) return fail('invalid graphContext');
      // The engine compiles the pool with the run's own helper limit (`createRun` checks it too).
      if (context.maxConcurrentHelpers !== snapshot.maxConcurrentHelpers) {
        return fail("graphContext's helper limit is not the run's");
      }
      snapshot.graph = parsedGraph.data;
      snapshot.graphContext = context;
    }
    return { success: true as const, data: snapshot };
  },
};
// ADR-0023: a node id of the run's workflow graph (version 1 stage ids are node ids too).
const StageParser = nullable(WorkflowNodeIdSchema);

export interface RunAuditRepository {
  /** `not_found` for an unknown approval. Null clears it (pending, or closed by the engine). */
  setApprovalDecidedBy(approvalId: string, decidedBy: ApprovalDecider | null): void;
  /** Approval id → decider, for every approval of the run (null when not stored). */
  approvalDecidersForRun(runId: string): Map<string, ApprovalDecider | null>;
  /** `not_found` for an unknown run. */
  setRunSnapshot(runId: string, snapshot: StoredRunSnapshot | null): void;
  /** Null when the run has no snapshot (Phase 3/4 rows: the engine's defaults apply). */
  getRunSnapshot(runId: string): StoredRunSnapshot | null;
  /** `not_found` for an unknown agent run. */
  setAgentStage(agentRunId: string, stage: WorkflowNodeId | null): void;
  /** Agent run id → stage, for every agent of the run (null for Phase 3/4 agents). */
  agentStagesForRun(runId: string): Map<string, WorkflowNodeId | null>;
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
    setRunSnapshot(runId, snapshot) {
      const value =
        snapshot === null
          ? null
          : JSON.stringify(parseInput(StoredRunSnapshotParser, snapshot, 'run snapshot'));
      updated(setLimits.run(value, runId).changes, 'run');
    },
    getRunSnapshot(runId) {
      const row = limitsOf.get(runId) as { limits: string | null } | undefined;
      if (row === undefined || row.limits === null) return null;
      return parseStoredJson(StoredRunSnapshotParser, row.limits, 'orchestration_runs', 'limits');
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
