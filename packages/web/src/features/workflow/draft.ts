import { HARD_MAX_DEPTH, approvalsOf, type ApprovalMode, type CommandPattern } from '@acp/core';
import { UpdateProjectSetupRequestSchema, type ProjectAgentSetupDto } from '@acp/core/api';
import type { ApiError, UpdateProjectSetupRequest } from '../../lib/api';
import { PROJECT_SETUP_COPY, WORKFLOW_COPY } from '../../lib/copy';
import { parseTokens } from '../project-setup/setup-form';
import { sameApprovals } from '../review-loop/logic';

/**
 * Pure draft logic for the Workflow page's project defaults: the helper limits and the approval
 * mode as typed ↔ the setup PUT body (PUT …/setup, their one source). The workflow itself is the
 * graph editor's (`editor/state.ts`). The core request schema still runs afterwards as the single
 * authority.
 */

export interface LimitsDraft {
  maxConcurrentHelpers: number;
  maxDepth: 1 | 2;
  /** As typed, e.g. "500,000". */
  budget: string;
  /** The approval mode and Auto's command list (ADR-0021 §1–2). */
  approvalMode: ApprovalMode;
  commands: readonly CommandPattern[];
}

export type DraftErrors = { budget?: string; helpers?: string };

export function limitsDraft(setup: ProjectAgentSetupDto): LimitsDraft {
  return {
    maxConcurrentHelpers: setup.maxConcurrentHelpers,
    maxDepth: setup.maxDepth >= HARD_MAX_DEPTH ? 2 : 1,
    budget: setup.defaultBudgetTokensPerAgent.toLocaleString('en-US'),
    approvalMode: approvalsOf(setup).mode,
    commands: approvalsOf(setup).commands,
  };
}

export type Checked<T> = { ok: true; request: T } | { ok: false; errors: DraftErrors };

/**
 * The whole setup PUT body: the saved setup with the page's limits and approvals in it. With
 * `approvals` the legacy `allowlist` is left out (optional since RL-V; the server keeps it in step
 * with the mode for runs from before ADR-0021). A setup saved before ADR-0021 whose approvals the
 * owner did not touch is sent as it was (its allowlist, no `approvals`), so a limits-only save
 * never changes how its runs ask.
 */
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
  const approvals = { mode: draft.approvalMode, commands: [...draft.commands] };
  const keepLegacy = setup.approvals === undefined && sameApprovals(approvals, approvalsOf(setup));
  const parsed = UpdateProjectSetupRequestSchema.safeParse({
    projectKey: setup.projectKey,
    maxConcurrentHelpers: draft.maxConcurrentHelpers,
    maxDepth: draft.maxDepth,
    defaultBudgetTokensPerAgent: budget,
    model: setup.model,
    ...(keepLegacy ? { allowlist: setup.allowlist } : { approvals }),
    contextFiles: [...setup.contextFiles],
  });
  if (!parsed.success) return { ok: false, errors: { helpers: WORKFLOW_COPY.refusals.invalid } };
  return { ok: true, request: parsed.data };
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
    sameApprovals(
      { mode: a.approvalMode, commands: [...a.commands] },
      { mode: b.approvalMode, commands: [...b.commands] },
    )
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
