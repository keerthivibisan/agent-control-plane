import type { TicketBranchDto } from '@acp/core/api';
import type { ApiError } from '../../lib/api';
import { MERGE_PR_COPY, type BranchActionErrorCode, type MergeMethodKey } from '../../lib/copy';
import { pullRequestErrorText } from './code-host';

/**
 * Pure rules for the owner's last two steps on a ticket branch (G-G, ADR-0025 §9): the merge
 * method remembered per project, where a finished branch still exists (so Delete branch is
 * offered only when there is something to delete), and every refusal in plain words.
 */

export const MERGE_METHODS: readonly MergeMethodKey[] = ['merge', 'squash', 'rebase'];

const isMethod = (v: unknown): v is MergeMethodKey =>
  typeof v === 'string' && (MERGE_METHODS as readonly string[]).includes(v);

/** The browser key for a project's last merge method (a convenience only, never required). */
export const mergeMethodKey = (projectId: string) => `acp.merge-method.${projectId}`;

/** Storage that may be missing or throw (a private window, blocked site data). */
export type MethodStorage = Pick<Storage, 'getItem' | 'setItem'> | null | undefined;

function browserStorage(): MethodStorage {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

/** The project's last merge method; "Create a merge commit" when none (or storage fails). */
export function readMergeMethod(
  projectId: string,
  storage: MethodStorage = browserStorage(),
): MergeMethodKey {
  try {
    const v = storage?.getItem(mergeMethodKey(projectId));
    return isMethod(v) ? v : 'merge';
  } catch {
    return 'merge';
  }
}

export function saveMergeMethod(
  projectId: string,
  method: MergeMethodKey,
  storage: MethodStorage = browserStorage(),
): void {
  try {
    storage?.setItem(mergeMethodKey(projectId), method);
  } catch {
    // A remembered choice is a convenience: the page works the same without it.
  }
}

export type BranchWhere = 'both' | 'origin' | 'local';

/**
 * Where a finished ticket branch still exists, from what the server read from git
 * (`localExists`, `pullRequest.headOnOrigin`); null when it is gone, still open, or unknown (a
 * server before G-G sends neither, and nothing is offered on a guess).
 */
export function branchStillExists(branch: BranchPresence): BranchWhere | null {
  if (!isFinished(branch)) return null;
  const local = branch.localExists === true;
  const origin = branch.pullRequest?.headOnOrigin === true;
  if (local && origin) return 'both';
  if (origin) return 'origin';
  if (local) return 'local';
  return null;
}

type BranchPresence = Pick<TicketBranchDto, 'state' | 'localExists' | 'pullRequest'>;

/** Merged (here or on GitHub) or discarded: the server's own rule for Delete branch. */
function isFinished(branch: BranchPresence): boolean {
  return branch.state !== 'open' || branch.pullRequest?.state === 'merged';
}

/**
 * Whether git said a finished branch is gone: not in the project folder (known, not absent) and
 * not on origin as far as the app knows.
 */
export function branchGone(branch: BranchPresence): boolean {
  return (
    isFinished(branch) && branch.localExists === false && branch.pullRequest?.headOnOrigin !== true
  );
}

const CODES = Object.keys(MERGE_PR_COPY.errors) as readonly string[];

function isBranchActionCode(code: string | null): code is BranchActionErrorCode {
  return code !== null && CODES.includes(code);
}

/**
 * A failed merge or delete in plain words; null for an error without a known code. These
 * codes carry the app's own sentence with the specifics (which pull request, which branch, why),
 * never git's or gh's words, so it is shown as it comes; the copy is the fallback. A merge that
 * timed out says it may or may not be merged (the server's sentence).
 */
export function branchActionErrorText(error: ApiError): string | null {
  if (error.kind !== 'http') return null;
  if (isBranchActionCode(error.code) || error.code === 'timeout') {
    const own = error.message.trim();
    if (own !== '') return own;
    return isBranchActionCode(error.code) ? MERGE_PR_COPY.errors[error.code] : null;
  }
  return pullRequestErrorText(error);
}
