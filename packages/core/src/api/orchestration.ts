import { z } from 'zod';
import { PullRequestDtoSchema } from './code-host.js';
import { IsoTimestampSchema } from '../domain/time.js';
import { GitBranchNameSchema } from '../workspace/branching.js';
import {
  AgentRoleKindSchema,
  AgentRunStatusSchema,
  ApprovalKindSchema,
  ApprovalStatusSchema,
  ChangeDeciderSchema,
  ChangeDecisionSchema,
  ChangeReviewerKindSchema,
  ChangeStateSchema,
  ChangeVerdictSchema,
  GitCommitSchema,
  ReviewStateSchema,
  RunBudgetSchema,
  RunStatusSchema,
  TicketBranchNameSchema,
  TicketBranchStateSchema,
} from '../orchestration/orchestration.js';
import {
  AllowRuleSchema,
  ApprovalModeSchema,
  CheckRunSchema,
  RepoRelativePathSchema,
} from '../workspace/workspace.js';
import { ChangeReviewerModeSchema } from '../workspace/workflow.js';

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
  /**
   * ADR-0021: which rule let an action run without asking, when `decidedBy` is `allowlist`. Null
   * or absent otherwise, and for approvals decided before it.
   */
  allowRule: AllowRuleSchema.nullable().optional(),
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

// ---------------------------------------------------------------- review loop (ADR-0021)

/** One review round of a helper's change and what was decided about it (`change_reviews`). */
export const ChangeReviewRoundDtoSchema = z.object({
  id: z.string().min(1),
  /** 0 for the first review; 1, 2, … after each rework. */
  round: count,
  reviewer: ChangeReviewerKindSchema,
  /** The review agent's run, when `reviewer` is `agent`. */
  reviewerAgentRunId: z.string().min(1).nullable(),
  /** The review agent's verdict; null for the lead or owner, or while the review runs. */
  verdict: ChangeVerdictSchema.nullable(),
  /** Null until decided. */
  decision: ChangeDecisionSchema.nullable(),
  decidedBy: ChangeDeciderSchema.nullable(),
  /** The ticket comment holding the findings or the lead's note (ADR-0021 §6); null when none. */
  commentId: z.string().min(1).nullable(),
  createdAt: IsoTimestampSchema,
  decidedAt: IsoTimestampSchema.nullable(),
});
export type ChangeReviewRoundDto = z.infer<typeof ChangeReviewRoundDtoSchema>;

/** One helper's or tester's change in the review loop (the ticket page's change card). */
export const ChangeReviewDtoSchema = z.object({
  agentRunId: z.string().min(1),
  role: z.string().min(1),
  state: ChangeStateSchema,
  /** Rework rounds used so far, and the run's limit (the owner can grant more). */
  reworkRounds: count,
  maxReworkRounds: count,
  /** The sealed (or integrated) commit; null before the change is sealed. */
  headCommit: GitCommitSchema.nullable(),
  changedFiles: count.nullable(),
  /** The server verified that the owner can resume this change after a restart. */
  canReworkAfterRestart: z.boolean().optional(),
  /** Names of the files that conflicted with the ticket branch on the last merge attempt. */
  conflictFiles: z.array(RepoRelativePathSchema).max(100),
  /** Check runs on `headCommit` only (ADR-0021: checks are stored with their commit). */
  checks: z.array(CheckRunSchema),
  /** Oldest first. */
  reviews: z.array(ChangeReviewRoundDtoSchema),
});
export type ChangeReviewDto = z.infer<typeof ChangeReviewDtoSchema>;

/** The run's ticket branch (ADR-0021 §4, `ticket_branches`). */
export const TicketBranchDtoSchema = z.object({
  runId: z.string().min(1),
  branch: TicketBranchNameSchema,
  baseBranch: z.string().min(1),
  /** The base branch's commit when the ticket branch was created. */
  baseCommit: GitCommitSchema,
  /**
   * ADR-0025 §10: the branch it was created from, when that differs from `baseBranch` (the
   * target). Absent: created from the target, as before it.
   */
  sourceBranch: GitBranchNameSchema.optional(),
  /** The branch tip; it moves only by a server-side compare-and-swap after a merged change. */
  headCommit: GitCommitSchema,
  state: TicketBranchStateSchema,
  /** The base branch's commit after the owner's merge; null until merged. */
  mergedCommit: GitCommitSchema.nullable(),
  /** ADR-0025: the pull request raised for this branch, if any. Absent from servers before it. */
  pullRequest: PullRequestDtoSchema.nullable().optional(),
  /**
   * ADR-0025 §9: whether the ticket branch still exists in the project (`refs/heads`). Absent from
   * servers before it. POST `/api/tickets/:id/branch/delete` (CSRF; the owner's click only)
   * deletes it there and on `origin`, once the branch is merged or discarded.
   */
  localExists: z.boolean().optional(),
  /**
   * F-1: the open branch's tip in the project is not `headCommit` (the last commit the app
   * recorded and reviewed): it was changed outside the app. `tip` is the commit it points at now.
   * Only on `GET /api/runs/:id/ticket-branch`; absent when it matches, for a closed branch, and
   * from servers before F-1. POST `/api/runs/:id/ticket-branch/reset` (CSRF, the owner's click
   * only, `ResetTicketBranchRequest`) moves it back to `headCommit` by compare-and-swap.
   */
  movedOutside: z.object({ tip: GitCommitSchema }).optional(),
  createdAt: IsoTimestampSchema,
  updatedAt: IsoTimestampSchema,
});
export type TicketBranchDto = z.infer<typeof TicketBranchDtoSchema>;

/**
 * F-1: "Reset to the last reviewed commit". `from` is the tip the owner saw
 * (`TicketBranchDto.movedOutside.tip`); the server moves the branch from it to the recorded
 * `headCommit` with `update-ref` (compare-and-swap) and refuses when the branch is checked out in
 * any worktree or moved again meanwhile. No other branch is touched.
 */
export const ResetTicketBranchRequestSchema = z.object({ from: GitCommitSchema });
export type ResetTicketBranchRequest = z.infer<typeof ResetTicketBranchRequestSchema>;

export const RunDetailDtoSchema = RunSummaryDtoSchema.extend({
  budget: RunBudgetSchema,
  agents: z.array(AgentRunDtoSchema),
  approvals: z.array(ApprovalDtoSchema),
  messages: z.array(ChatMessageDtoSchema),
  followUp: RunFollowUpDtoSchema.optional(),
  /** ADR-0021: the approval mode this run snapshotted at start. Absent for runs before it. */
  approvalMode: ApprovalModeSchema.optional(),
  /** ADR-0021: the run's ticket branch; null before plan approval, absent for legacy runs. */
  ticketBranch: TicketBranchDtoSchema.nullable().optional(),
  /** ADR-0021: each helper's change in the review loop, oldest first. Absent for legacy runs. */
  changes: z.array(ChangeReviewDtoSchema).optional(),
  /** ADR-0021: who reviews each change in this run (its snapshot). Absent for legacy runs. */
  reviewer: ChangeReviewerModeSchema.optional(),
  /**
   * ADR-0021: the run's snapshotted rework limit per change (the owner can grant a round past it).
   * Absent for legacy runs.
   */
  maxReworkRounds: count.optional(),
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

/**
 * GET `/api/runs/:id/ticket-branch` (ADR-0021 §4): the combined change `base..tip` for the owner's
 * single merge into the base branch.
 */
export const TicketBranchReviewDtoSchema = z.object({
  runId: z.string().min(1),
  ticketBranch: TicketBranchDtoSchema,
  files: z.array(ChangedFileDtoSchema),
  /** Unified diff `base..tip`, cut at a size limit (`diffTruncated`). */
  diff: z.string(),
  diffTruncated: z.boolean(),
  /** Check runs on the tip commit (a detached temporary checkout). */
  checks: z.array(CheckRunSchema),
  /**
   * The base branch moved since the ticket branch was created, so the tip no longer
   * fast-forwards: the owner can update it from the base first.
   */
  baseMoved: z.boolean(),
});
export type TicketBranchReviewDto = z.infer<typeof TicketBranchReviewDtoSchema>;

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
    /**
     * `merge-anyway` (Phase 4): merge although a required harness check failed; needs a reason.
     * `rework` (ADR-0021 §3): the owner sends the change back to its helper; needs a comment.
     */
    action: z.enum(['merge', 'discard', 'merge-anyway', 'rework']),
    reason: z.string().trim().min(1).max(500).optional(),
    /** What the helper should change (`rework`); stored as a ticket comment by the owner. */
    comment: z.string().trim().min(1).max(4000).optional(),
  })
  .refine((r) => r.action !== 'merge-anyway' || r.reason !== undefined, {
    message: 'merge-anyway needs a reason',
    path: ['reason'],
  })
  .refine((r) => r.action !== 'rework' || r.comment !== undefined, {
    message: 'say what should change',
    path: ['comment'],
  });

/**
 * POST `/api/runs/:id/ticket-branch` (ADR-0021 §4, CSRF); answers the branch afterwards as a
 * `TicketBranchReviewDto` (the same body as the GET). `merge`: fast-forward the base branch to
 * the tip (the owner's tree must be clean and on the base branch); `merge-anyway`: the same with a
 * failed required check, with a reason; `request-changes`: the comment goes to the lead and the run
 * returns to RUNNING; `discard`: delete the ticket branch; `update-from-base`: when `baseMoved`,
 * merge the base into the tip in a temporary worktree and run the checks again.
 */
export const TicketBranchActionRequestSchema = z
  .object({
    action: z.enum(['merge', 'merge-anyway', 'discard', 'request-changes', 'update-from-base']),
    reason: z.string().trim().min(1).max(500).optional(),
    comment: z.string().trim().min(1).max(8000).optional(),
  })
  .refine((r) => r.action !== 'merge-anyway' || r.reason !== undefined, {
    message: 'merge-anyway needs a reason',
    path: ['reason'],
  })
  .refine((r) => r.action !== 'request-changes' || r.comment !== undefined, {
    message: 'say what should change',
    path: ['comment'],
  });
export type TicketBranchActionRequest = z.infer<typeof TicketBranchActionRequestSchema>;
