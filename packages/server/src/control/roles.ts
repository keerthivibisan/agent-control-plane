import type { AgentRoleKind } from '@acp/core';

/**
 * What the server needs to know about each agent role (ADR-0019). These mirror the engine's
 * `hasReviewableChange` and `countsAsHelper` (orchestrator `stages.ts`), which the package does
 * not export; the server tests pin them to the same behaviour.
 */

/** Roles with a worktree whose change the owner reviews (merge or discard): helpers and the tester. */
export function hasReviewableChange(kind: AgentRoleKind): boolean {
  return kind === 'worker' || kind === 'tester';
}

/** Roles counted as helpers (limit and "helpers live"): helpers, the reviewer and the tester. */
export function countsAsHelper(kind: AgentRoleKind): boolean {
  return kind === 'worker' || kind === 'reviewer' || kind === 'tester';
}

/** Roles that work read-only in the owner's tree or a checkout and never get an edit approved. */
export function isReadOnlyRole(kind: AgentRoleKind): boolean {
  return kind === 'lead' || kind === 'planner' || kind === 'reviewer';
}
