import { z } from 'zod';
import { IsoTimestampSchema } from '../domain/time.js';
import {
  AgentRoleKindSchema,
  AgentRunStatusSchema,
  ApprovalKindSchema,
  ApprovalStatusSchema,
  ReviewStateSchema,
  RunBudgetSchema,
  RunStatusSchema,
} from '../orchestration/orchestration.js';

/**
 * HTTP contracts for the control panel (Phase 3, milestone M1). Mutating requests also need the
 * `X-ACP-CSRF` header from `GET /api/control/token` (ADR-0013).
 */

export const CSRF_HEADER = 'X-ACP-CSRF';
export const CsrfTokenDtoSchema = z.object({ token: z.string().min(32) });
export type CsrfTokenDto = z.infer<typeof CsrfTokenDtoSchema>;

const count = z.number().int().nonnegative();

export const AgentRunDtoSchema = z.object({
  id: z.string().min(1),
  runId: z.string().min(1),
  parentAgentRunId: z.string().min(1).nullable(),
  kind: AgentRoleKindSchema,
  role: z.string().min(1),
  task: z.string().min(1).nullable(),
  status: AgentRunStatusSchema,
  /** The observed session, once linked; the family tree and token totals come from it. */
  sessionId: z.string().min(1).nullable(),
  budget: z.object({ used: count, limit: count }),
  /** Latest content-free activity sentence, e.g. "Used tool: Edit". */
  latestActivity: z.string().min(1).nullable(),
  review: z.object({ state: ReviewStateSchema, changedFiles: count.nullable() }).nullable(),
  /** The worker's worktree branch once its workspace exists; null for the lead or before setup. */
  branch: z.string().min(1).nullable(),
  createdAt: IsoTimestampSchema,
  endedAt: IsoTimestampSchema.nullable(),
});
export type AgentRunDto = z.infer<typeof AgentRunDtoSchema>;

export const ApprovalDtoSchema = z.object({
  id: z.string().min(1),
  runId: z.string().min(1),
  agentRunId: z.string().min(1),
  kind: ApprovalKindSchema,
  toolName: z.string().min(1).nullable(),
  /** Short, redacted description for the owner, e.g. "Edit src/app.ts". */
  summary: z.string().min(1).max(200),
  status: ApprovalStatusSchema,
  /** Who decided (Phase 4): the owner, the project allowlist (ADR-0013 amendment) or the timeout. */
  decidedBy: z.enum(['owner', 'allowlist', 'timeout']).nullable().optional(),
  requestedAt: IsoTimestampSchema,
  decidedAt: IsoTimestampSchema.nullable(),
});
export type ApprovalDto = z.infer<typeof ApprovalDtoSchema>;

export const ChatMessageDtoSchema = z.object({
  id: z.string().min(1),
  runId: z.string().min(1),
  role: z.enum(['owner', 'lead']),
  text: z.string().min(1),
  createdAt: IsoTimestampSchema,
  /** True for messages of a follow-up turn after the lead ended (ADR-0020). Absent: false. */
  followUp: z.boolean().optional(),
});
export type ChatMessageDto = z.infer<typeof ChatMessageDtoSchema>;

/** Why the owner cannot continue the chat with an ended lead (ADR-0020 §5). */
export const FollowUpUnavailableReasonSchema = z.enum([
  /** No lead ever started, or it never reported a session id. */
  'no-session',
  /** Claude Code no longer has the saved conversation (aged out or removed), or resume failed. */
  'session-gone',
  /** Managed agents are off in this app. */
  'managed-off',
]);
export type FollowUpUnavailableReason = z.infer<typeof FollowUpUnavailableReasonSchema>;

/**
 * The chat after the lead ended (ADR-0020). Absent while the lead is live (the chat goes to it as
 * usual). `available`: a message resumes the lead for one answers-only turn; `running`: a turn is
 * under way, so the box waits; `unavailable`: see `reason`.
 */
export const RunFollowUpDtoSchema = z.object({
  state: z.enum(['available', 'running', 'unavailable']),
  reason: FollowUpUnavailableReasonSchema.nullable(),
});
export type RunFollowUpDto = z.infer<typeof RunFollowUpDtoSchema>;

export const RunSummaryDtoSchema = z.object({
  id: z.string().min(1),
  projectId: z.string().min(1),
  /** The board ticket this run works on; null for a Phase 3 control-panel run (redesign decision D). */
  ticketId: z.string().min(1).nullable(),
  title: z.string().min(1),
  status: RunStatusSchema,
  agentCount: count,
  pendingApprovals: count,
  createdAt: IsoTimestampSchema,
  updatedAt: IsoTimestampSchema,
  endedAt: IsoTimestampSchema.nullable(),
});
export type RunSummaryDto = z.infer<typeof RunSummaryDtoSchema>;

export const RunDetailDtoSchema = RunSummaryDtoSchema.extend({
  budget: RunBudgetSchema,
  agents: z.array(AgentRunDtoSchema),
  approvals: z.array(ApprovalDtoSchema),
  messages: z.array(ChatMessageDtoSchema),
  followUp: RunFollowUpDtoSchema.optional(),
});
export type RunDetailDto = z.infer<typeof RunDetailDtoSchema>;

export const ChangedFileDtoSchema = z.object({
  path: z.string().min(1),
  status: z.enum(['added', 'modified', 'deleted', 'renamed']),
  additions: count.nullable(),
  deletions: count.nullable(),
});

export type ChangedFileDto = z.infer<typeof ChangedFileDtoSchema>;

export const AgentReviewDtoSchema = z.object({
  agentRunId: z.string().min(1),
  role: z.string().min(1),
  branch: z.string().min(1),
  baseBranch: z.string().min(1),
  state: ReviewStateSchema,
  files: z.array(ChangedFileDtoSchema),
  /** Unified diff of the agent's changes, cut at a size limit (`diffTruncated`). */
  diff: z.string(),
  diffTruncated: z.boolean(),
});
export const ReviewDtoSchema = z.object({
  runId: z.string().min(1),
  agents: z.array(AgentReviewDtoSchema),
});
export type ReviewDto = z.infer<typeof ReviewDtoSchema>;

// Requests (validated by the server).
export const StartRunRequestSchema = z.object({
  projectId: z.string().min(1),
  title: z.string().min(1).max(200).optional(),
  budget: RunBudgetSchema.optional(),
});
export const ChatRequestSchema = z.object({ text: z.string().trim().min(1).max(8000) });
export const ApprovalDecisionRequestSchema = z.object({
  decision: z.enum(['approve', 'deny']),
  message: z.string().max(500).optional(),
});
export const ReviewActionRequestSchema = z
  .object({
    agentRunId: z.string().min(1),
    /** `merge-anyway` (Phase 4): merge although a required harness check failed; needs a reason. */
    action: z.enum(['merge', 'discard', 'merge-anyway']),
    reason: z.string().trim().min(1).max(500).optional(),
  })
  .refine((r) => r.action !== 'merge-anyway' || r.reason !== undefined, {
    message: 'merge-anyway needs a reason',
    path: ['reason'],
  });
