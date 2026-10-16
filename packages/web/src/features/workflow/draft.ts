import { HARD_MAX_DEPTH, type PlannerMode, type SkillName } from '@acp/core';
import {
  UpdateProjectSetupRequestSchema,
  UpdateWorkflowRequestSchema,
  type ProjectAgentSetupDto,
  type ProjectWorkflowDto,
} from '@acp/core/api';
import type { ApiError, UpdateProjectSetupRequest, UpdateWorkflowRequest } from '../../lib/api';
import { PROJECT_SETUP_COPY, WORKFLOW_COPY } from '../../lib/copy';
import { parseTokens } from '../project-setup/setup-form';
import { AGENT_STAGES, type AgentStageId, type SetupShape, type WorkflowShape } from './graph';

/**
 * Pure draft logic for the Workflow page: what the owner changed (as typed) ↔ the two PUT bodies.
 * Stage settings go to PUT …/workflow; helper limits and the allowlist go to PUT …/setup, because
 * the setup is their one source (core `workspace/workflow.ts`). The core request schemas still run
 * afterwards as the single authority.
 */

const MAX_MODEL = 100;

export interface StageDraft {
  /** As typed; empty means the project default. */
  model: string;
  skill: SkillName | null;
  /** The stage's agent file (`.claude/agents/<name>.md`); null is "None" (ADR-0019 §6). */
  agent: SkillName | null;
  /** Only the optional stages can be off; the others stay true. */
  enabled: boolean;
}

export interface WorkflowDraft {
  plannerMode: PlannerMode;
  stages: Record<AgentStageId, StageDraft>;
}

export interface LimitsDraft {
  maxConcurrentHelpers: number;
  maxDepth: 1 | 2;
  /** As typed, e.g. "500,000". */
  budget: string;
  editInOwnWorktree: boolean;
  runHarnessChecks: boolean;
}

export type DraftErrors = Partial<Record<AgentStageId, string>> & { budget?: string };

export function workflowDraft(workflow: ProjectWorkflowDto['workflow']): WorkflowDraft {
  const s = workflow.stages;
  const stage = (
    st: { model: string | null; skill: SkillName | null; agent?: SkillName | null | undefined },
    enabled = true,
  ): StageDraft => ({
    model: st.model ?? '',
    skill: st.skill,
    agent: st.agent ?? null,
    enabled,
  });
  return {
    plannerMode: workflow.plannerMode,
    stages: {
      plan: stage(s.plan),
      orchestrate: stage(s.orchestrate),
      helpers: stage(s.helpers),
      'code-review': stage(s['code-review'], s['code-review'].enabled),
      'unit-tests': stage(s['unit-tests'], s['unit-tests'].enabled),
    },
  };
}

export function limitsDraft(setup: ProjectAgentSetupDto): LimitsDraft {
  return {
    maxConcurrentHelpers: setup.maxConcurrentHelpers,
    maxDepth: setup.maxDepth >= HARD_MAX_DEPTH ? 2 : 1,
    budget: setup.defaultBudgetTokensPerAgent.toLocaleString('en-US'),
    editInOwnWorktree: setup.allowlist.editInOwnWorktree,
    runHarnessChecks: setup.allowlist.runHarnessChecks,
  };
}

function modelOf(raw: string): string | null {
  const m = raw.trim();
  return m === '' ? null : m;
}

/** The draft as the graph shows it: what the page would save. */
export function workflowView(draft: WorkflowDraft): WorkflowShape {
  const s = draft.stages;
  // "None" leaves `agent` out, so a workflow without agent files saves as it always did.
  const agent = (st: StageDraft) => ({
    model: modelOf(st.model),
    skill: st.skill,
    ...(st.agent === null ? {} : { agent: st.agent }),
  });
  return {
    plannerMode: draft.plannerMode,
    stages: {
      plan: agent(s.plan),
      orchestrate: agent(s.orchestrate),
      helpers: agent(s.helpers),
      review: { requireChecks: true },
      'code-review': { ...agent(s['code-review']), enabled: s['code-review'].enabled },
      'unit-tests': { ...agent(s['unit-tests']), enabled: s['unit-tests'].enabled },
    },
  };
}

/** The limits as the graph shows them; a budget that doesn't parse yet keeps the saved one. */
export function setupView(setup: ProjectAgentSetupDto, draft: LimitsDraft): SetupShape {
  return {
    maxConcurrentHelpers: draft.maxConcurrentHelpers,
    maxDepth: draft.maxDepth,
    defaultBudgetTokensPerAgent: parseTokens(draft.budget) ?? setup.defaultBudgetTokensPerAgent,
    model: setup.model,
    allowlist: {
      editInOwnWorktree: draft.editInOwnWorktree,
      runHarnessChecks: draft.runHarnessChecks,
    },
  };
}

export type Checked<T> = { ok: true; request: T } | { ok: false; errors: DraftErrors };

export function workflowRequest(draft: WorkflowDraft): Checked<UpdateWorkflowRequest> {
  const errors: DraftErrors = {};
  for (const id of AGENT_STAGES) {
    if (draft.stages[id].model.trim().length > MAX_MODEL) {
      errors[id] = WORKFLOW_COPY.panel.errors.modelTooLong;
    }
  }
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  const parsed = UpdateWorkflowRequestSchema.safeParse(workflowView(draft));
  // Every rule the schema checks is checked above in words (or can't be typed); a backstop.
  if (!parsed.success) return { ok: false, errors: { plan: WORKFLOW_COPY.refusals.invalid } };
  return { ok: true, request: parsed.data };
}

/** The whole setup PUT body: the saved setup with the page's limits and allowlist in it. */
export function setupRequest(
  setup: ProjectAgentSetupDto,
  draft: LimitsDraft,
): Checked<UpdateProjectSetupRequest> {
  const budget = parseTokens(draft.budget);
  if (budget === null) {
    return {
      ok: false,
      errors: { budget: PROJECT_SETUP_COPY.agents.errors.budget },
    };
  }
  const parsed = UpdateProjectSetupRequestSchema.safeParse({
    projectKey: setup.projectKey,
    maxConcurrentHelpers: draft.maxConcurrentHelpers,
    maxDepth: draft.maxDepth,
    defaultBudgetTokensPerAgent: budget,
    model: setup.model,
    allowlist: {
      editInOwnWorktree: draft.editInOwnWorktree,
      runHarnessChecks: draft.runHarnessChecks,
    },
    contextFiles: [...setup.contextFiles],
  });
  if (!parsed.success) return { ok: false, errors: { helpers: WORKFLOW_COPY.refusals.invalid } };
  return { ok: true, request: parsed.data };
}

function sameStage(a: StageDraft, b: StageDraft): boolean {
  return (
    a.model.trim() === b.model.trim() &&
    a.skill === b.skill &&
    a.agent === b.agent &&
    a.enabled === b.enabled
  );
}

export function sameWorkflow(a: WorkflowDraft, b: WorkflowDraft): boolean {
  return (
    a.plannerMode === b.plannerMode &&
    AGENT_STAGES.every((id) => sameStage(a.stages[id], b.stages[id]))
  );
}

/** "500,000" and "500000" are the same budget; two unparsable ones compare as typed. */
function sameBudget(a: string, b: string): boolean {
  const na = parseTokens(a);
  const nb = parseTokens(b);
  return na === null && nb === null ? a.trim() === b.trim() : na === nb;
}

export function sameLimits(a: LimitsDraft, b: LimitsDraft): boolean {
  return (
    a.maxConcurrentHelpers === b.maxConcurrentHelpers &&
    a.maxDepth === b.maxDepth &&
    sameBudget(a.budget, b.budget) &&
    a.editInOwnWorktree === b.editInOwnWorktree &&
    a.runHarnessChecks === b.runHarnessChecks
  );
}

/** A refused save in plain words; the server's own reason is added for a 400 (what it rejected). */
export function refusalMessage(error: ApiError): string {
  const R = WORKFLOW_COPY.refusals;
  if (error.kind === 'unreachable') return R.unreachable;
  if (error.kind === 'http') {
    if (error.status === 403 || error.code?.startsWith('csrf') === true) return R.csrf;
    if (error.status === 404 || error.code === 'not_found') return R.notFound;
    if (error.status === 409 || error.code === 'conflict') return R.conflict;
    if (error.status === 400 || error.code === 'invalid_request') {
      return `${R.invalid} ${error.message}`;
    }
  }
  return R.generic;
}
