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
});
export type ChatMessageDto = z.infer<typeof ChatMessageDtoSchema>;

export const RunSummaryDtoSchema = z.object({
  id: z.string().min(1),
  projectId: z.string().min(1),
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
});
export type RunDetailDto = z.infer<typeof RunDetailDtoSchema>;

export const ChangedFileDtoSchema = z.object({
  path: z.string().min(1),
  status: z.enum(['added', 'modified', 'deleted', 'renamed']),
  additions: count.nullable(),
  deletions: count.nullable(),
});

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
export const ReviewActionRequestSchema = z.object({
  agentRunId: z.string().min(1),
  action: z.enum(['merge', 'discard']),
});
