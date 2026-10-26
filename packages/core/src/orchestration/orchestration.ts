import { z } from 'zod';
import { IsoTimestampSchema } from '../domain/time.js';
import { WorkflowNodeIdSchema } from '../workspace/node-id.js';
import { GitBranchNameSchema } from '../workspace/branching.js';
import { MAX_AGENT_NOTE_CHARS } from '../workspace/ticket-activity.js';

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
  /**
   * ADR-0021 §3: a helper or tester finished its turn and its change is being sealed, reviewed or
   * decided. No process runs and no budget is spent, but it is not terminal: the lead may send it
   * back for rework (→ STARTING), and it ends once its change is merged, discarded or found empty.
   */
  'AWAITING_REVIEW',
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

// ---------------------------------------------------------------- review loop (ADR-0021)

/**
 * Where one helper's change is in the review loop (ADR-0021 §3), stored in
 * `managed_workspaces.change_state`; null there for runs without the loop (the legacy flow).
 * - `sealing`: the helper finished; its worktree is being committed;
 * - `ready`: sealed, waiting for a reviewer;
 * - `reviewing`: the review agent (or the lead) is reviewing it;
 * - `decision`: reviewed; the lead decides;
 * - `rework`: sent back; the helper is working on it again;
 * - `needs-owner`: the lead asked the owner, or the lead ended before deciding;
 * - `merged`: merged into the ticket branch; `discarded`; `no-changes`: nothing to merge.
 */
export const ChangeStateSchema = z.enum([
  'sealing',
  'ready',
  'reviewing',
  'decision',
  'rework',
  'needs-owner',
  'merged',
  'discarded',
  'no-changes',
]);
export type ChangeState = z.infer<typeof ChangeStateSchema>;
/** Change states after which nothing more happens to the change. */
export const FINAL_CHANGE_STATES: readonly ChangeState[] = Object.freeze([
  'merged',
  'discarded',
  'no-changes',
]);

/** Who reviewed one round of a change (`change_reviews.reviewer`). */
export const ChangeReviewerKindSchema = z.enum(['agent', 'lead', 'owner']);
export type ChangeReviewerKind = z.infer<typeof ChangeReviewerKindSchema>;
/** The review agent's verdict (`submit_review`): advice for the lead, never a gate. */
export const ChangeVerdictSchema = z.enum(['approve', 'rework']);
export type ChangeVerdict = z.infer<typeof ChangeVerdictSchema>;
/** What was decided about one round of a change (`change_reviews.decision`). */
export const ChangeDecisionSchema = z.enum([
  'merge',
  'merge-anyway',
  'rework',
  'discard',
  'ask-owner',
]);
export type ChangeDecision = z.infer<typeof ChangeDecisionSchema>;
/**
 * Who decided (`change_reviews.decided_by`): the lead, or the owner instead of it, or (ADR-0023
 * §4, review route "direct") a change reviewer that sent the change back to its helper itself.
 * A reviewer only ever decides `rework`; merging stays the lead's or the owner's.
 */
export const ChangeDeciderSchema = z.enum(['lead', 'owner', 'reviewer']);
export type ChangeDecider = z.infer<typeof ChangeDeciderSchema>;

/** A full or abbreviated commit id. */
export const GitCommitSchema = z.string().regex(/^[0-9a-f]{7,64}$/, 'a commit id');

/** The run's ticket branch (ADR-0021 §4): `open` until the owner merges or discards it. */
export const TicketBranchStateSchema = z.enum(['open', 'merged', 'discarded']);
export type TicketBranchState = z.infer<typeof TicketBranchStateSchema>;
/**
 * A ticket branch's name. Before ADR-0025 always `acp/<KEY>` (or `acp/<KEY>-r<n>`); now any safe
 * branch name, from the project's branching strategy or the ticket's own name.
 */
export const TicketBranchNameSchema = GitBranchNameSchema;

/**
 * The ticket branch name for `ticketKey` (e.g. `WEB-12`). Attempt 0 is `acp/WEB-12`; the server
 * tries 1, 2, … (`acp/WEB-12-r1`, …) when a branch of that name already exists. Throws on a key or
 * attempt that would not give a valid name.
 */
export function ticketBranchName(ticketKey: string, attempt = 0): string {
  if (!Number.isInteger(attempt) || attempt < 0) throw new RangeError('attempt must be 0 or more');
  // The legacy name (no branching strategy): a ticket key, as before ADR-0025.
  if (!/^[A-Z]{2,6}-[1-9]\d*$/.test(ticketKey)) throw new RangeError('not a ticket key');
  return TicketBranchNameSchema.parse(
    attempt === 0 ? `acp/${ticketKey}` : `acp/${ticketKey}-r${attempt}`,
  );
}

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

/** Most characters in a managed session's title (`ManagedAgentSpec.title`, ADR-0024). */
export const MAX_SESSION_TITLE = 120;

/** Inputs of the lead agent's tools (ADR-0012). The engine validates every call (ADR-0013). */
export const LeadToolInputs = {
  start_agent: z.object({
    role: z.string().min(1).max(60),
    task: z.string().min(1).max(4000),
    /**
     * The helper node of the run's workflow graph to start (ADR-0023 §7), e.g. `frontend`.
     * Without it the engine takes the named helper whose label equals `role` (trimmed, ignoring
     * case), else the helper pool, and otherwise refuses with the list of helper nodes.
     */
    helper: WorkflowNodeIdSchema.optional(),
  }),
  list_agents: z.object({}),
  message_agent: z.object({ agentId: z.string().min(1), text: z.string().min(1).max(4000) }),
  stop_agent: z.object({ agentId: z.string().min(1) }),
  agent_status: z.object({ agentId: z.string().min(1) }),
  /**
   * Hand the run over. Legacy flow: the workers are done and the owner reviews each change. With
   * the review loop (ADR-0021 §3): every change is decided, so the final stages and the owner's
   * single merge of the ticket branch follow.
   */
  request_review: z.object({
    /**
     * ADR-0024 §3 as amended by ADR-0026 §2: the lead's summary of the whole ticket so far, 3 to 6
     * short past-tense sentences like a teammate's comment, no code. Review-loop runs keep it as
     * the lead's `ticket-summary` comment (at most `MAX_TICKET_SUMMARY_CHARS`); the app's facts
     * are a separate `run-facts` comment. Optional: without it there is no new summary.
     */
    summary: z.string().trim().min(1).max(1500).optional(),
  }),
  /** Plan-first (ADR-0016): the lead's proposed plan; helpers can't start until it is approved. */
  submit_plan: z.object({
    summary: z.string().trim().min(1).max(2000),
    steps: z
      .array(
        z.object({
          title: z.string().trim().min(1).max(120),
          role: z.string().trim().min(1).max(60),
          detail: z.string().max(2000),
          /**
           * The helper node that does this step (ADR-0023 §7). Resolved like `start_agent.helper`
           * when the plan is submitted: a step no helper node can take is refused, with the list
           * of helper nodes.
           */
          helper: WorkflowNodeIdSchema.optional(),
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
  // The review loop (ADR-0021 §3): the lead's change tools. `agentId` names the helper whose
  // change it is; the engine checks each call against the change's state.
  /** The change's files, diff (at most 32 KiB) and checks, plus the reviewer's findings. */
  view_change: z.object({ agentId: z.string().min(1) }),
  /**
   * Merge the change into the ticket branch; when the workflow has a Checks block before the merge
   * (ADR-0028 §2), its checks must pass on it first.
   */
  merge_change: z.object({ agentId: z.string().min(1) }),
  /** Send the change back to its helper with what to fix; refused past the round limit. */
  request_rework: z.object({
    agentId: z.string().min(1),
    comments: z.string().trim().min(1).max(4000),
  }),
  /** Drop the change; the reason is stored as a ticket comment. */
  discard_change: z.object({
    agentId: z.string().min(1),
    reason: z.string().trim().min(1).max(500),
  }),
  /** Leave the decision to the owner, with a question for them. */
  ask_owner: z.object({
    agentId: z.string().min(1),
    question: z.string().trim().min(1).max(2000),
  }),
  /**
   * The change reviewer's verdict and findings (ADR-0021 §3). Only a change reviewer gets this
   * tool; the findings are stored as a ticket comment by author `reviewer` and passed to the lead.
   */
  submit_review: z.object({
    verdict: ChangeVerdictSchema,
    findings: z.string().trim().min(1).max(8000),
  }),
  /**
   * ADR-0026 §3: a helper's or tester's "what I did" note, 2 to 4 plain sentences, stored as a
   * ticket comment of kind `agent-note` with its agent run; a later call replaces it. Only `worker`
   * and `tester` get this tool; the engine refuses it from anyone else.
   */
  report_work: z.object({ note: z.string().trim().min(1).max(MAX_AGENT_NOTE_CHARS) }),
} as const;
export type LeadToolName = keyof typeof LeadToolInputs;
export const LEAD_TOOL_NAMES = Object.keys(LeadToolInputs) as LeadToolName[];

/** The lead's change-decision tools (ADR-0021 §3). */
export const CHANGE_DECISION_TOOL_NAMES: readonly LeadToolName[] = Object.freeze([
  'view_change',
  'merge_change',
  'request_rework',
  'discard_change',
  'ask_owner',
]);
/** The change reviewer's one tool (ADR-0021 §3). */
export const CHANGE_REVIEWER_TOOL_NAMES: readonly LeadToolName[] = Object.freeze(['submit_review']);
/**
 * Every tool the review loop added. Until the engine (RL-A) and the adapter (RL-B) wire them, no
 * agent is offered them: the compile-only placeholders there filter with this list.
 */
export const REVIEW_LOOP_TOOL_NAMES: readonly LeadToolName[] = Object.freeze([
  ...CHANGE_DECISION_TOOL_NAMES,
  ...CHANGE_REVIEWER_TOOL_NAMES,
]);

/**
 * Plain words for each control-plane tool, for an agent's "Latest" line (ADR-0021: raw
 * `mcp__acp__*` names were shown). Past tense, and never any of the tool's input.
 */
export const CONTROL_TOOL_LABELS: Readonly<Record<LeadToolName, string>> = Object.freeze({
  start_agent: 'Started a helper',
  list_agents: 'Listed the helpers',
  message_agent: 'Sent a message to a helper',
  stop_agent: 'Stopped a helper',
  agent_status: "Checked a helper's status",
  request_review: 'Handed the work over for review',
  submit_plan: 'Submitted the plan',
  post_review: 'Posted review findings',
  view_change: "Looked at a helper's change",
  merge_change: "Merged a helper's change",
  request_rework: 'Asked a helper to rework its change',
  discard_change: "Discarded a helper's change",
  ask_owner: 'Asked the owner about a change',
  submit_review: 'Submitted a change review',
  report_work: 'Reported its work',
});

function isLeadToolName(name: string): name is LeadToolName {
  return Object.hasOwn(LeadToolInputs, name);
}

/** The label for a control-plane tool's bare name (e.g. `merge_change`); null for any other. */
export function controlToolLabel(name: string): string | null {
  return isLeadToolName(name) ? CONTROL_TOOL_LABELS[name] : null;
}
