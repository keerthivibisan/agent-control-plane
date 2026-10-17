import { z } from 'zod';
import { IsoTimestampSchema } from '../domain/time.js';
import { AgentRoleKindSchema } from '../orchestration/orchestration.js';
import {
  AgentToolNameSchema,
  MAX_AGENT_BYTES,
  MAX_SKILL_BYTES,
  MAX_SKILL_DESCRIPTION,
  PlannerModeSchema,
  ProjectWorkflowSchema,
  SkillNameSchema,
  WorkflowStageIdSchema,
} from '../workspace/workflow.js';
import { RepoRelativePathSchema } from '../workspace/workspace.js';
import { ReportedCostUsdDtoSchema, UsageTotalsDtoSchema } from './dto.js';
import { ProjectAgentSetupDtoSchema } from './workspace.js';

/**
 * HTTP contracts for the project-first redesign (docs/redesign/README.md §4, §6). Mutations need
 * the `X-ACP-CSRF` header (ADR-0013).
 */

const count = z.number().int().nonnegative();

// ---------------------------------------------------------------- workflow

/** GET/PUT `/api/projects/:id/workflow`. Limits and allowlist come from the setup (one source). */
export const ProjectWorkflowDtoSchema = z.object({
  workflow: ProjectWorkflowSchema,
  setup: ProjectAgentSetupDtoSchema,
  /** Project skills, so the page can offer them per stage and flag a mapped skill that is gone. */
  skills: z.array(SkillNameSchema),
});
export type ProjectWorkflowDto = z.infer<typeof ProjectWorkflowDtoSchema>;

/** PUT body: the whole stage configuration (the server sets `projectId` and `updatedAt`). */
export const UpdateWorkflowRequestSchema = z.object({
  plannerMode: PlannerModeSchema,
  stages: ProjectWorkflowSchema.shape.stages,
});
export type UpdateWorkflowRequest = z.infer<typeof UpdateWorkflowRequestSchema>;

/** A stage's live state on a ticket's current run (the ticket page's workflow graph). */
export const WorkflowStageStateSchema = z.enum([
  'off',
  'waiting',
  'active',
  'needs-you',
  'done',
  'failed',
  'skipped',
]);
export type WorkflowStageState = z.infer<typeof WorkflowStageStateSchema>;
export const RunWorkflowDtoSchema = z.object({
  runId: z.string().min(1),
  stages: z.array(
    z.object({
      stage: WorkflowStageIdSchema,
      state: WorkflowStageStateSchema,
      /** Agent runs that belong to this stage (ids into `RunDetailDto.agents`). */
      agentRunIds: z.array(z.string().min(1)),
    }),
  ),
  /**
   * ADR-0021: how many changes are in each part of the review loop, for the graph's review stage.
   * Absent for runs without the loop.
   */
  review: z
    .object({
      /** `sealing` or `ready`. */
      waiting: count,
      /** `reviewing` or `decision`. */
      inReview: count,
      rework: count,
      needsOwner: count,
      merged: count,
      discarded: count,
      noChanges: count,
      /** Rework rounds used across all changes (the "rework ×n" edge). */
      reworkRounds: count,
    })
    .optional(),
});
export type RunWorkflowDto = z.infer<typeof RunWorkflowDtoSchema>;

// ---------------------------------------------------------------- skills

export const SkillSummaryDtoSchema = z.object({
  name: SkillNameSchema,
  /** From the SKILL.md front matter; empty when missing (the page says so). */
  description: z.string().max(MAX_SKILL_DESCRIPTION),
  /** Repo-relative, e.g. `.claude/skills/code-review/SKILL.md`. */
  path: RepoRelativePathSchema,
  usedBy: z.array(WorkflowStageIdSchema),
  sizeBytes: count,
  /** Last commit that touched the file; null when it was never committed. */
  lastCommittedAt: IsoTimestampSchema.nullable(),
  /** The file differs from HEAD or is untracked (`git status`). */
  uncommitted: z.boolean(),
  /** Front matter is missing or its `name` differs from the folder name. */
  problems: z.array(z.string().min(1)),
});
export type SkillSummaryDto = z.infer<typeof SkillSummaryDtoSchema>;

export const SkillDetailDtoSchema = SkillSummaryDtoSchema.extend({
  /** The Markdown body after the front matter. The owner's own file, not conversation content. */
  instructions: z.string().max(MAX_SKILL_BYTES),
});
export type SkillDetailDto = z.infer<typeof SkillDetailDtoSchema>;

/** POST `/api/projects/:id/skills` (create) and PUT `…/skills/:name` (replace). */
export const SkillWriteRequestSchema = z.object({
  name: SkillNameSchema,
  description: z.string().trim().min(1).max(MAX_SKILL_DESCRIPTION),
  instructions: z.string().max(MAX_SKILL_BYTES),
});
export type SkillWriteRequest = z.infer<typeof SkillWriteRequestSchema>;

/** POST `…/skills/:name/commit`: commits only that skill's folder on the current branch. */
export const SkillCommitResultDtoSchema = z.object({
  name: SkillNameSchema,
  commit: z.string().regex(/^[0-9a-f]{7,40}$/),
  branch: z.string().min(1),
});
export type SkillCommitResultDto = z.infer<typeof SkillCommitResultDtoSchema>;

// ---------------------------------------------------------------- agent definitions

/** A project agent definition, `.claude/agents/<name>.md` (ADR-0018, amended 2026-10-16). */
export const AgentDefinitionSummaryDtoSchema = z.object({
  name: SkillNameSchema,
  description: z.string().max(MAX_SKILL_DESCRIPTION),
  path: RepoRelativePathSchema,
  /** The front matter `tools` list; null means the agent inherits every tool (Claude Code default). */
  tools: z.array(AgentToolNameSchema).nullable(),
  model: z.string().min(1).max(100).nullable(),
  sizeBytes: count,
  lastCommittedAt: IsoTimestampSchema.nullable(),
  uncommitted: z.boolean(),
  problems: z.array(z.string().min(1)),
});
export type AgentDefinitionSummaryDto = z.infer<typeof AgentDefinitionSummaryDtoSchema>;

export const AgentDefinitionDetailDtoSchema = AgentDefinitionSummaryDtoSchema.extend({
  /** The Markdown body after the front matter (the agent's instructions). The owner's own file. */
  instructions: z.string().max(MAX_AGENT_BYTES),
});
export type AgentDefinitionDetailDto = z.infer<typeof AgentDefinitionDetailDtoSchema>;

/** POST `/api/projects/:id/agents` (create) and PUT `…/agents/:name` (replace). */
export const AgentDefinitionWriteRequestSchema = z.object({
  name: SkillNameSchema,
  description: z.string().trim().min(1).max(MAX_SKILL_DESCRIPTION),
  tools: z.array(AgentToolNameSchema).max(50).nullable(),
  model: z.string().trim().min(1).max(100).nullable(),
  instructions: z.string().max(MAX_AGENT_BYTES),
});
export type AgentDefinitionWriteRequest = z.infer<typeof AgentDefinitionWriteRequestSchema>;

/** POST `…/agents/:name/commit`: commits only that file on the current branch. */
export const AgentDefinitionCommitResultDtoSchema = SkillCommitResultDtoSchema;
export type AgentDefinitionCommitResultDto = z.infer<typeof AgentDefinitionCommitResultDtoSchema>;

// ---------------------------------------------------------------- tokens

/**
 * New work vs cache reuse, from the same deduplicated usage (usage-accounting §5–6). Each figure is
 * derived and null when every contributing category is unavailable (never 0).
 */
export const TokenHeadlineDtoSchema = z.object({
  /** input + output. */
  newWork: count.nullable(),
  /** newWork + cache write + cache read. */
  totalProcessed: count.nullable(),
  /** cacheRead / totalProcessed, 0..1. */
  cacheReuseShare: z.number().min(0).max(1).nullable(),
  provenance: z.literal('derived'),
});
export type TokenHeadlineDto = z.infer<typeof TokenHeadlineDtoSchema>;

const UsageRowBase = { usage: UsageTotalsDtoSchema, headline: TokenHeadlineDtoSchema };

/** GET `/api/projects/:id/tokens?from&to`. All groups sum DIRECT usage (no double counting). */
export const ProjectTokensDtoSchema = z.object({
  projectId: z.string().min(1),
  range: z.object({ from: IsoTimestampSchema.nullable(), to: IsoTimestampSchema.nullable() }),
  sessions: z.object({ total: count, withUsage: count }),
  runs: count,
  ticketsWithRuns: count,
  totals: UsageTotalsDtoSchema,
  headline: TokenHeadlineDtoSchema,
  byDay: z.array(z.object({ day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), ...UsageRowBase })),
  bySession: z.array(
    z.object({
      sessionId: z.string().min(1),
      title: z.string().min(1).nullable(),
      /** Provider-reported, per session, never summed (ADR-0014). */
      latestEstimatedCost: ReportedCostUsdDtoSchema.nullable(),
      ...UsageRowBase,
    }),
  ),
  byTicket: z.array(
    z.object({
      ticketId: z.string().min(1),
      key: z.string().min(1),
      title: z.string().min(1),
      ...UsageRowBase,
    }),
  ),
  /** `external`: sessions started outside the app (not an agent run). */
  byRole: z.array(
    z.object({ role: z.union([AgentRoleKindSchema, z.literal('external')]), ...UsageRowBase }),
  ),
  byModel: z.array(z.object({ model: z.string().min(1), ...UsageRowBase })),
});
export type ProjectTokensDto = z.infer<typeof ProjectTokensDtoSchema>;
