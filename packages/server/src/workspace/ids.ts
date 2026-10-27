import { WorkspaceError } from './errors.js';

/**
 * Run and agent ids become a directory name and a branch-name component, so they must be a single
 * safe segment: no separators, no dots (`..`, `.lock`), no leading dash (git option injection), no
 * whitespace or control characters. UUIDs pass.
 */
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

export function isSafeId(id: unknown): id is string {
  return typeof id === 'string' && SAFE_ID.test(id);
}

export function assertSafeId(
  id: unknown,
  what: 'runId' | 'agentId' | 'operationId',
): asserts id is string {
  if (!isSafeId(id)) {
    throw new WorkspaceError(
      'invalid-id',
      `${what} must be 1-64 letters, digits, "-" or "_", starting with a letter or digit`,
    );
  }
}

export const branchFor = (runId: string, agentId: string): string => `acp/${runId}/${agentId}`;
