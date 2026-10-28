import { z } from 'zod';
import { IsoTimestampSchema } from '../domain/time.js';
import { GitCommitSchema } from '../orchestration/orchestration.js';
import { GitBranchNameSchema } from '../workspace/branching.js';
import {
  ChangeClassificationSchema,
  CheckIdSchema,
  MAX_ASSESSMENT_REASON_CHARS,
  ProjectAutomationSchema,
  VerificationAssessmentSchema,
  VerificationRouteSchema,
} from '../workspace/conflict-resolution.js';

/**
 * ADR-0030: one "update from target / resolve conflicts" operation on a run's ticket branch. The
 * record holds commits, states, file names and owner-facing reasons only (ADR-0009): no diff, no
 * file content, no conversation. One operation per run is active at a time (migration 0012).
 */

/** At most this many conflicting or out-of-scope file names are kept. */
export const MAX_RESOLUTION_FILES = 100;
/** Attempts kept on one operation (each resolver turn, each check failure). */
export const MAX_RESOLUTION_ATTEMPT_RECORDS = 10;
const reasonText = z.string().trim().min(1).max(MAX_ASSESSMENT_REASON_CHARS);

export const ResolutionOperationStateSchema = z.enum([
  /** Commits pinned; the server merges the target into a private candidate. */
  'preparing',
  /** The merge conflicted; a resolver helper edits the content in its own worktree. */
  'resolving',
  /** The selected checks run on the candidate commit. */
  'verifying',
  /** The policy gate held the candidate (checks failed or unavailable, stale): the owner decides. */
  'awaiting-owner',
  /** Promoted; the delegated delivery (push, pull request, merge) is under way. */
  'delivering',
  'completed',
  'failed',
  'cancelled',
  /** A restart stopped it; nothing is relaunched or republished by itself (ADR-0013 §7). */
  'interrupted',
]);
export type ResolutionOperationState = z.infer<typeof ResolutionOperationStateSchema>;

/** States that hold the run's single operation slot. */
export const ACTIVE_RESOLUTION_STATES: readonly ResolutionOperationState[] = Object.freeze([
  'preparing',
  'resolving',
  'verifying',
  'awaiting-owner',
  'delivering',
]);

export function isActiveResolutionState(state: ResolutionOperationState): boolean {
  return ACTIVE_RESOLUTION_STATES.includes(state);
}

export const ResolutionAttemptSchema = z.object({
  attempt: z.number().int().min(1),
  /** The resolver helper of this attempt; null for the server's own clean merge. */
  agentRunId: z.string().min(1).nullable(),
  outcome: z.enum([
    'clean',
    'resolved',
    'no-change',
    'blocked',
    'failed',
    'stopped',
    'markers-left',
    'checks-failed',
  ]),
  /** The helper's report (redacted, capped) or the app's reason. */
  note: reasonText.nullable(),
  at: IsoTimestampSchema,
});
export type ResolutionAttempt = z.infer<typeof ResolutionAttemptSchema>;

export const ResolutionDimensionSchema = z.object({
  status: z.enum([
    'preparing',
    'up-to-date',
    'clean',
    'resolving',
    'resolved',
    'failed',
    'cancelled',
  ]),
  reason: reasonText.nullable(),
});

export const VerificationDimensionSchema = z.object({
  status: z.enum([
    'pending',
    'running',
    'passed',
    'failed',
    'skipped-by-policy',
    'unverified-by-policy',
    'unavailable',
    'stale',
  ]),
  route: VerificationRouteSchema.nullable(),
  classification: ChangeClassificationSchema.nullable(),
  /** How many paths the combined change touches (candidate vs target, target update, conflicts). */
  assessedPaths: z.number().int().nonnegative(),
  outsideScope: z.array(z.string().min(1)).max(MAX_RESOLUTION_FILES),
  checkIds: z.array(CheckIdSchema),
  mandatoryCheckIds: z.array(CheckIdSchema),
  omitted: z.array(z.object({ id: CheckIdSchema, reason: z.string().min(1).max(200) })),
  failedChecks: z.array(CheckIdSchema),
  /** The candidate commit the checks ran on, when they ran. */
  checkedCommit: GitCommitSchema.nullable(),
  matchedRule: z.string().min(1).max(300).nullable(),
  reason: reasonText.nullable(),
  assessment: VerificationAssessmentSchema.nullable(),
  /** Delivery limit the route sets (`draft`: only a draft pull request; `none`: hold). */
  deliverAs: z.enum(['normal', 'draft', 'none']).nullable(),
});

export const ReviewDimensionSchema = z.object({
  status: z.enum(['pending-owner', 'owner-approved', 'not-required-by-policy', 'stale']),
  reason: reasonText.nullable(),
});

export const DeliveryDimensionSchema = z.object({
  status: z.enum([
    'not-delegated',
    'waiting',
    'pushing',
    'pr-opened',
    'pr-updated',
    'merging',
    'merged',
    'blocked',
    'unknown',
  ]),
  reason: reasonText.nullable(),
  /** The ticket branch commit delivered (or being delivered); a second delivery of it is refused. */
  commit: GitCommitSchema.nullable(),
  draft: z.boolean(),
});

export const ConflictResolutionRecordSchema = z.object({
  id: z.string().min(1),
  runId: z.string().min(1),
  projectId: z.string().min(1),
  trigger: z.enum(['owner', 'auto']),
  state: ResolutionOperationStateSchema,
  ticketBranch: GitBranchNameSchema,
  targetBranch: GitBranchNameSchema,
  /** The ticket branch tip the operation started from; promotion is compare-and-swap from it. */
  ticketCommit: GitCommitSchema,
  /** The target tip pinned at the start; a different target tip later makes evidence stale. */
  targetCommit: GitCommitSchema,
  mergeBase: GitCommitSchema.nullable(),
  /** The merged result (ticket tip + target), once built; checks and the assessment bind to it. */
  candidateCommit: GitCommitSchema.nullable(),
  conflictFiles: z.array(z.string().min(1)).max(MAX_RESOLUTION_FILES),
  /** The project policy snapshotted at start: later setting changes never widen this operation. */
  policy: ProjectAutomationSchema,
  policyFingerprint: z.string().min(1).max(64),
  maxAttempts: z.number().int().min(1),
  attempts: z.array(ResolutionAttemptSchema).max(MAX_RESOLUTION_ATTEMPT_RECORDS),
  resolverAgentRunId: z.string().min(1).nullable(),
  resolution: ResolutionDimensionSchema,
  verification: VerificationDimensionSchema,
  review: ReviewDimensionSchema,
  delivery: DeliveryDimensionSchema,
  createdAt: IsoTimestampSchema,
  updatedAt: IsoTimestampSchema,
  finishedAt: IsoTimestampSchema.nullable(),
});
export type ConflictResolutionRecord = z.infer<typeof ConflictResolutionRecordSchema>;

export const ConflictResolutionDtoSchema = ConflictResolutionRecordSchema.extend({
  /** Why the operation's evidence no longer matches the repository or policy; null when current. */
  stale: z.string().min(1).max(300).nullable(),
});
export type ConflictResolutionDto = z.infer<typeof ConflictResolutionDtoSchema>;

/** GET `/api/runs/:id/conflict-resolution`. */
export const ConflictResolutionViewDtoSchema = z.object({
  runId: z.string().min(1),
  /** The project's current policy (what a new operation would snapshot). */
  policy: ProjectAutomationSchema,
  /** The target has commits the ticket branch lacks. */
  baseMoved: z.boolean(),
  /** The latest operation of the run (active or finished); null when there was none. */
  operation: ConflictResolutionDtoSchema.nullable(),
  /** Null when the owner can start one now; else the plain reason why not. */
  startBlocked: z.string().min(1).max(300).nullable(),
});
export type ConflictResolutionViewDto = z.infer<typeof ConflictResolutionViewDtoSchema>;

/**
 * POST `/api/runs/:id/conflict-resolution/promote` (CSRF, the owner's click): apply a candidate the
 * gate held. `reason` is required when its checks failed or verification is unavailable; it is kept
 * on the ticket as the owner's comment. Promotion is still compare-and-swap and refused when stale.
 */
export const PromoteResolutionRequestSchema = z.object({
  reason: z.string().trim().min(1).max(500).optional(),
});
export type PromoteResolutionRequest = z.infer<typeof PromoteResolutionRequestSchema>;
