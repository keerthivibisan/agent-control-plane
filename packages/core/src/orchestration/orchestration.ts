import { z } from 'zod';
import { IsoTimestampSchema } from '../domain/time.js';

/**
 * Managed orchestration domain (Phase 3; docs/orchestration-lifecycle.md, ADR-0012..0015).
 * These are the persisted shapes; transitions are decided by `@acp/orchestrator`.
 */

/**
 * Run lifecycle for milestone M1 (orchestration-lifecycle §2, trimmed). `REVIEW` means every agent
 * has stopped and the owner is reviewing changes; `COMPLETED` means the owner merged or discarded
 * everything. `NEEDS_REVIEW` is set after a restart interrupted live work, which is never relaunched.
 */
export const RunStatusSchema = z.enum([
  'QUEUED',
  /** Phase 4, plan-first (ADR-0016): the lead is reading the code and preparing `submit_plan`. */
  'PLANNING',
  /** Phase 4: a plan is waiting for the owner's approval or comments. */
  'PLAN_REVIEW',
  'RUNNING',
  'BLOCKED',
  'REVIEW',
  'COMPLETED',
  'FAILED',
  'CANCELLING',
  'CANCELLED',
  'NEEDS_REVIEW',
]);
export type RunStatus = z.infer<typeof RunStatusSchema>;

export const AgentRunStatusSchema = z.enum([
  'QUEUED',
  'STARTING',
  'RUNNING',
  'WAITING_APPROVAL',
  'BLOCKED',
  'SUCCEEDED',
  'FAILED',
  'CANCELLED',
  'TIMED_OUT',
  'NEEDS_REVIEW',
]);
export type AgentRunStatus = z.infer<typeof AgentRunStatusSchema>;

/** `lead` talks with the owner and starts workers; `worker` does one task in its own worktree. */
export const AgentRoleKindSchema = z.enum(['lead', 'worker', 'planner', 'reviewer', 'tester']);
export type AgentRoleKind = z.infer<typeof AgentRoleKindSchema>;

export const ReviewStateSchema = z.enum(['pending', 'merged', 'discarded', 'no-changes']);
export type ReviewState = z.infer<typeof ReviewStateSchema>;

export const ApprovalKindSchema = z.enum(['tool-use', 'budget-raise']);
export type ApprovalKind = z.infer<typeof ApprovalKindSchema>;
export const ApprovalStatusSchema = z.enum(['pending', 'approved', 'denied', 'expired']);
export type ApprovalStatus = z.infer<typeof ApprovalStatusSchema>;

export const RunBudgetSchema = z.object({
  /** Per-agent cap in budget tokens (output + uncached input + cache write; ADR-0014). Soft. */
  maxTokensPerAgent: z.number().int().positive(),
  /**
   * Warn (never stop) when any single agent's provider-reported estimated cost passes this. Costs
   * of different agents are never added up (ADR-0014). Null: no warning.
   */
  softCostUsdPerRun: z.number().positive().nullable(),
});
export type RunBudget = z.infer<typeof RunBudgetSchema>;

export const OrchestrationRunSchema = z.object({
  id: z.string().min(1),
  projectId: z.string().min(1),
  /** The board ticket this run works on (Phase 4, ADR-0016); null for Phase 3 control-panel runs. */
  ticketId: z.string().min(1).nullable().default(null),
  title: z.string().min(1).max(200),
  status: RunStatusSchema,
  budget: RunBudgetSchema,
  createdAt: IsoTimestampSchema,
  updatedAt: IsoTimestampSchema,
  endedAt: IsoTimestampSchema.nullable(),
});
export type OrchestrationRun = z.infer<typeof OrchestrationRunSchema>;

export const AgentRunSchema = z.object({
  id: z.string().min(1),
  runId: z.string().min(1),
  /** Null for the lead agent; the lead's id for workers (depth 1). */
  parentAgentRunId: z.string().min(1).nullable(),
  kind: AgentRoleKindSchema,
  /** Short role name chosen by the lead, e.g. "API builder". */
  role: z.string().min(1).max(60),
  /** The task text given to a worker (owner-facing; ADR-0015). Null for the lead. */
  task: z.string().min(1).max(4000).nullable(),
  status: AgentRunStatusSchema,
  /** The provider session observed for this run, once linked (AgentRunSession). */
  sessionId: z.string().min(1).nullable(),
  budgetTokensUsed: z.number().int().nonnegative(),
  createdAt: IsoTimestampSchema,
  endedAt: IsoTimestampSchema.nullable(),
});
export type AgentRun = z.infer<typeof AgentRunSchema>;

/** Inputs of the lead agent's tools (ADR-0012). The engine validates every call (ADR-0013). */
export const LeadToolInputs = {
  start_agent: z.object({
    role: z.string().min(1).max(60),
    task: z.string().min(1).max(4000),
  }),
  list_agents: z.object({}),
  message_agent: z.object({ agentId: z.string().min(1), text: z.string().min(1).max(4000) }),
  stop_agent: z.object({ agentId: z.string().min(1) }),
  agent_status: z.object({ agentId: z.string().min(1) }),
  request_review: z.object({}),
  /** Plan-first (ADR-0016): the lead's proposed plan; helpers can't start until it is approved. */
  submit_plan: z.object({
    summary: z.string().trim().min(1).max(2000),
    steps: z
      .array(
        z.object({
          title: z.string().trim().min(1).max(120),
          role: z.string().trim().min(1).max(60),
          detail: z.string().max(2000),
        }),
      )
      .min(1)
      .max(12),
  }),
  /**
   * The reviewer's findings (ADR-0019 §2): plain text, stored as a ticket comment by author
   * `reviewer`. Only a reviewer gets this tool; the engine refuses it from anyone else.
   */
  post_review: z.object({ text: z.string().trim().min(1).max(8000) }),
} as const;
export type LeadToolName = keyof typeof LeadToolInputs;
export const LEAD_TOOL_NAMES = Object.keys(LeadToolInputs) as LeadToolName[];
