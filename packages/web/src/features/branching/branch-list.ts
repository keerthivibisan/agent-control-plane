import { isSafeBranchName, type BranchStrategy, type TicketBranchPrefs } from '@acp/core';
import type { ProjectBranchesDto } from '@acp/core/api';
import type { ApiError } from '../../lib/api';
import { BRANCHING_COPY, PROJECT_BRANCHES_COPY, type ProjectBranchErrorCode } from '../../lib/copy';

/**
 * Pure rules for a project's local branches (ADR-0025 §8): which exist, where a new one starts
 * by default, the New branch name check and every refusal in plain words.
 */

const C = PROJECT_BRANCHES_COPY;

export function hasBranch(dto: ProjectBranchesDto | undefined, name: string): boolean {
  return dto?.branches.some((b) => b.name === name) ?? false;
}

/**
 * Whether a branch is known to be missing: only when the list was read, is complete, and doesn't
 * have it. A truncated list can't say a branch is missing, so nothing is offered then.
 */
export function isMissing(dto: ProjectBranchesDto | undefined, name: string): boolean {
  if (dto === undefined || dto.truncated) return false;
  return !hasBranch(dto, name);
}

/**
 * Where a new branch starts by default: `preferred` (the strategy's base branch), else the branch
 * the project folder is on, else `main`; each only when it exists locally and is not the new
 * branch itself. Else the first local branch, else null (nothing to start from).
 */
export function defaultBase(
  dto: ProjectBranchesDto,
  preferred: string | undefined,
  name?: string,
): string | null {
  const usable = (b: string | null | undefined): b is string =>
    b !== null && b !== undefined && b !== name && hasBranch(dto, b);
  for (const candidate of [preferred, dto.current, 'main']) {
    if (usable(candidate)) return candidate;
  }
  return dto.branches.find((b) => b.name !== name)?.name ?? null;
}

/**
 * The target a ticket's start needs: the ticket's own target, else the strategy's default target
 * (the order the server uses, ticket-branch-plan.ts). Null: the project folder's branch.
 */
export function startTarget(
  branch: TicketBranchPrefs | undefined,
  strategy: BranchStrategy | undefined,
): string | null {
  return branch?.target ?? strategy?.defaultTargetBranch ?? null;
}

/** The New branch name as typed: the error to show, or undefined when it can be created. */
export function newBranchError(
  name: string,
  dto: ProjectBranchesDto | undefined,
): string | undefined {
  const n = name.trim();
  if (n === '') return C.nameMissing;
  if (!isSafeBranchName(n)) return BRANCHING_COPY.errors.branch;
  if (hasBranch(dto, n)) return C.nameExists;
  return undefined;
}

/** The first 7 characters of a commit, as git shows it. */
export const shortCommit = (commit: string): string => commit.slice(0, 7);

const ERROR_CODES = Object.keys(C.errors) as readonly string[];

function isBranchErrorCode(code: string | null): code is ProjectBranchErrorCode {
  return code !== null && ERROR_CODES.includes(code);
}

/**
 * A failed create in plain words; null for an error without a known code (the caller shows its
 * details). A failed push after the branch was created keeps the server's own sentence, which
 * says the branch exists locally and why the push failed.
 */
export function createBranchErrorText(error: ApiError): string | null {
  if (error.kind !== 'http') return null;
  if (isBranchErrorCode(error.code)) return C.errors[error.code];
  if (
    (error.code === 'push-rejected' ||
      error.code === 'timeout' ||
      error.code === 'branch_create_failed') &&
    error.message.trim() !== ''
  ) {
    return error.message;
  }
  return null;
}

/** Whether a failed Start was refused because its target branch is missing. */
export function isTargetMissing(error: ApiError | null): boolean {
  return error?.kind === 'http' && error.code === 'target_branch_missing';
}

/** ADR-0025 §10: whether a failed Start was refused because its start branch is missing. */
export function isSourceMissing(error: ApiError | null): boolean {
  return error?.kind === 'http' && error.code === 'source_branch_missing';
}

/**
 * The branch a refused Start needs (G-F's fix, G-H generalised): the target for
 * `target_branch_missing`, the start branch for `source_branch_missing` (the ticket's `from`, else
 * the project's), in the server's order. Null for any other error, or when it can't be told.
 */
export function missingStartBranch(
  error: ApiError | null,
  branch: TicketBranchPrefs | undefined,
  strategy: BranchStrategy | undefined,
): string | null {
  if (isTargetMissing(error)) return startTarget(branch, strategy);
  if (isSourceMissing(error)) return branch?.from ?? strategy?.defaultSourceBranch ?? null;
  return null;
}
