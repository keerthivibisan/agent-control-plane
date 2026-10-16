import { HttpError } from '../errors.js';

/**
 * Typed refusals of the Skills API (ADR-0018). Messages never quote file contents or paths outside
 * the repo-relative skill path.
 */
export type SkillErrorCode =
  | 'invalid_request'
  | 'not_found'
  | 'conflict'
  | 'skill_in_use'
  | 'agent_in_use'
  | 'unsafe_path'
  | 'too_large'
  | 'staged_changes'
  | 'nothing_to_commit'
  | 'detached_head'
  | 'not_a_git_repo'
  | 'git_failed';

const STATUS: Record<SkillErrorCode, number> = {
  invalid_request: 400,
  not_found: 404,
  conflict: 409,
  skill_in_use: 409,
  agent_in_use: 409,
  unsafe_path: 400,
  too_large: 413,
  staged_changes: 409,
  nothing_to_commit: 409,
  detached_head: 409,
  not_a_git_repo: 409,
  git_failed: 500,
};

export function skillError(code: SkillErrorCode, message: string): HttpError {
  return new HttpError(STATUS[code], code, message);
}
