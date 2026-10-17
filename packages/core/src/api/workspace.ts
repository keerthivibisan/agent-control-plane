import { z } from 'zod';
import { AbsolutePathSchema } from '../domain/project.js';
import { IsoTimestampSchema } from '../domain/time.js';
import { TokenCountsSchema } from '../usage/usage.js';
import { ChangeReviewerModeSchema, ReworkRoundsSchema } from '../workspace/workflow.js';
import {
  ApprovalModeSchema,
  CheckRunSchema,
  HarnessStatusSchema,
  ProjectAgentSetupSchema,
  ProjectAllowlistSchema,
  ProjectApprovalsSchema,
  ProjectKeySchema,
  RepoRelativePathSchema,
  TicketCommentSchema,
  TicketLabelSchema,
  TicketPlanSchema,
  TicketPrioritySchema,
  TicketSchema,
  TicketStageSchema,
  TicketTypeSchema,
  HARD_MAX_DEPTH,
  HARD_MAX_HELPERS,
  MAX_CONTEXT_FILES,
} from '../workspace/workspace.js';
import { ProjectDtoSchema, ReportedCostUsdDtoSchema } from './dto.js';
import { RunDetailDtoSchema, RunSummaryDtoSchema } from './orchestration.js';

/**
 * HTTP contracts for the Phase 4 Agent Workspace (docs/phase-4/README.md §6.3). Mutations need the
 * `X-ACP-CSRF` header (ADR-0013).
 */

const count = z.number().int().nonnegative();

export const ProjectAgentSetupDtoSchema = ProjectAgentSetupSchema;
export type ProjectAgentSetupDto = z.infer<typeof ProjectAgentSetupDtoSchema>;
export const HarnessStatusDtoSchema = HarnessStatusSchema;
export type HarnessStatusDto = z.infer<typeof HarnessStatusDtoSchema>;
export const CheckRunDtoSchema = CheckRunSchema;
export type CheckRunDto = z.infer<typeof CheckRunDtoSchema>;
export const TicketDtoSchema = TicketSchema.extend({ stage: TicketStageSchema });
export type TicketDto = z.infer<typeof TicketDtoSchema>;
export const TicketCommentDtoSchema = TicketCommentSchema;
export type TicketCommentDto = z.infer<typeof TicketCommentDtoSchema>;
export const TicketPlanDtoSchema = TicketPlanSchema;
export type TicketPlanDto = z.infer<typeof TicketPlanDtoSchema>;

/** A board card: the ticket plus what its current run is doing. */
export const TicketCardDtoSchema = TicketDtoSchema.extend({
  /** Helpers currently working (not counting the lead). */
  activeHelpers: count,
  /** Budget tokens used by the current run's agents (ADR-0014), or null with no run. */
  budgetTokensUsed: count.nullable(),
  /** Pending approvals and plan reviews waiting for the owner. */
  needsYou: count,
  /** Latest provider-reported cost of the current run, never summed across runs (estimated). */
  latestEstimatedCost: ReportedCostUsdDtoSchema.nullable(),
  lastActivityAt: IsoTimestampSchema.nullable(),
  lastRunOutcome: z.enum(['failed', 'stopped']).nullable(),
});
export type TicketCardDto = z.infer<typeof TicketCardDtoSchema>;

export const BoardDtoSchema = z.object({
  project: ProjectDtoSchema,
  projectKey: ProjectKeySchema,
  harness: HarnessStatusDtoSchema,
  stats: z.object({
    /** Last 7 days, by token type; never added into one number. */
    tokensLast7Days: TokenCountsSchema,
    runningRuns: count,
    needsYou: count,
  }),
  columns: z.array(z.object({ stage: TicketStageSchema, tickets: z.array(TicketCardDtoSchema) })),
});
export type BoardDto = z.infer<typeof BoardDtoSchema>;

export const TicketDetailDtoSchema = z.object({
  ticket: TicketDtoSchema,
  /** All runs of the ticket, newest first. */
  runs: z.array(RunSummaryDtoSchema),
  currentRun: RunDetailDtoSchema.nullable(),
  plans: z.array(TicketPlanDtoSchema),
  comments: z.array(TicketCommentDtoSchema),
  checks: z.array(CheckRunDtoSchema),
});
export type TicketDetailDto = z.infer<typeof TicketDetailDtoSchema>;

/** Files offered in the context picker (repo-relative, with size). */
export const ContextCandidateDtoSchema = z.object({
  path: RepoRelativePathSchema,
  sizeBytes: count,
  suggested: z.boolean(),
});
export type ContextCandidateDto = z.infer<typeof ContextCandidateDtoSchema>;

// ---------------------------------------------------------------- requests

export const CreateRepoProjectRequestSchema = z.object({
  parentDir: AbsolutePathSchema,
  name: z
    .string()
    .regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/, 'letters, digits, dots, dashes and underscores'),
  readme: z.string().max(20_000).optional(),
});
export const UpdateProjectSetupRequestSchema = z.object({
  projectKey: ProjectKeySchema,
  maxConcurrentHelpers: z.number().int().min(1).max(HARD_MAX_HELPERS),
  maxDepth: z.number().int().min(1).max(HARD_MAX_DEPTH),
  defaultBudgetTokensPerAgent: z.number().int().positive(),
  model: z.string().min(1).max(100).nullable(),
  allowlist: ProjectAllowlistSchema,
  /** ADR-0021. Absent: the stored approvals are kept (or, for an older setup, still none). */
  approvals: ProjectApprovalsSchema.optional(),
  contextFiles: z.array(RepoRelativePathSchema).max(MAX_CONTEXT_FILES),
});
/**
 * POST `/api/tickets/:id/start` body (ADR-0021 §1, §3). Each field overrides the project's setting
 * for this run only; the run snapshots the result. An empty or missing body uses the project's.
 */
export const StartTicketRequestSchema = z.object({
  approvalMode: ApprovalModeSchema.optional(),
  reviewer: ChangeReviewerModeSchema.optional(),
  maxReworkRounds: ReworkRoundsSchema.optional(),
});
export type StartTicketRequest = z.infer<typeof StartTicketRequestSchema>;
export const CreateTicketRequestSchema = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().max(20_000).default(''),
  type: TicketTypeSchema.default('feature'),
  priority: TicketPrioritySchema.default('medium'),
  labels: z.array(TicketLabelSchema).max(10).default([]),
});
export const UpdateTicketRequestSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    description: z.string().max(20_000),
    type: TicketTypeSchema,
    priority: TicketPrioritySchema,
    labels: z.array(TicketLabelSchema).max(10),
  })
  .partial();
export const MoveTicketRequestSchema = z.object({
  status: z.enum(['BACKLOG', 'READY', 'CANCELLED']),
});
export const TicketCommentRequestSchema = z.object({ body: z.string().trim().min(1).max(8000) });
export const PlanDecisionRequestSchema = z
  .object({
    decision: z.enum(['approve', 'request-changes']),
    comment: z.string().trim().min(1).max(8000).optional(),
  })
  .refine((r) => r.decision !== 'request-changes' || r.comment !== undefined, {
    message: 'say what should change',
    path: ['comment'],
  });
