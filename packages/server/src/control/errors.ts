import type { Refusal, RefusalCode } from '@acp/orchestrator';
import { HttpError } from '../errors.js';
import type { WorkspaceError, WorkspaceErrorCode } from '../workspace/index.js';

/**
 * Engine refusals and workspace refusals are expected outcomes (ADR-0013): the owner asked for
 * something the policy forbids or git refused. They become `ErrorDto`s with the engine's or the
 * workspace manager's machine code in snake_case, and its message, which never contains chat text.
 */

const REFUSAL_STATUS: Readonly<Record<RefusalCode, number>> = {
  'project-not-registered': 409,
  'too-many-agents': 409,
  'depth-exceeded': 409,
  'run-cancelling': 409,
  'run-not-active': 409,
  'over-budget': 409,
  'invalid-input': 400,
  'unknown-tool': 400,
  'not-lead': 403,
  'unknown-agent': 404,
  'agent-not-live': 409,
  'workers-still-running': 409,
  'approval-not-found': 404,
  'approval-not-pending': 409,
  'review-not-allowed': 409,
  'illegal-transition': 409,
  'duplicate-id': 409,
  'plan-not-approved': 409,
  'plan-not-found': 404,
  'plan-not-pending': 409,
  'follow-up-unavailable': 409,
  'follow-up-running': 409,
};

const snake = (code: string): string => code.replaceAll('-', '_');

export function refusalError(refusal: Refusal): HttpError {
  return new HttpError(REFUSAL_STATUS[refusal.code], snake(refusal.code), refusal.message);
}

/** Every workspace error is a refusal the owner can act on (clean the tree, switch back, ...). */
const WORKSPACE_STATUS: Partial<Record<WorkspaceErrorCode, number>> = {
  'git-failed': 500,
};

export function workspaceError(error: WorkspaceError): HttpError {
  return new HttpError(WORKSPACE_STATUS[error.code] ?? 409, snake(error.code), error.message);
}

export const managedDisabled = (): HttpError =>
  new HttpError(
    404,
    'managed_disabled',
    'Managed agents are turned off on this server (demo mode or ACP_MANAGED=off)',
  );
