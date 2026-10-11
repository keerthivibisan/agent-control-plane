/**
 * Why the workspace manager refused or failed. Refusals (`base-dirty`, `base-moved`, ...) are
 * expected outcomes the panel explains to the owner; P3-D maps them to an ErrorDto (ADR-0013 §5).
 */
export type WorkspaceErrorCode =
  /** A run or agent id is not a safe single path segment. */
  | 'invalid-id'
  /** A workspace record does not match the paths and branch this manager would have created. */
  | 'invalid-workspace'
  | 'not-a-git-repo'
  /** The project has no branch checked out, so there is nothing to merge back into. */
  | 'detached-head'
  | 'no-commits'
  | 'workspace-exists'
  /** The project's working tree has uncommitted changes to tracked files. */
  | 'base-dirty'
  /** The project no longer has the base branch checked out. */
  | 'base-branch-changed'
  /** The base branch gained commits that the agent's branch does not contain. */
  | 'base-moved'
  /** The agent's worktree is no longer on its own branch. */
  | 'workspace-branch-changed'
  /** Integrating the moved base into the agent's branch conflicted; nothing was changed. */
  | 'merge-conflict'
  /** Git refused the fast-forward in the project (e.g. an untracked file would be overwritten). */
  | 'merge-failed'
  | 'git-failed';

export class WorkspaceError extends Error {
  override readonly name = 'WorkspaceError';
  constructor(
    readonly code: WorkspaceErrorCode,
    message: string,
  ) {
    super(message);
  }
}

/**
 * A git command exited with an error. `stderr` is kept for diagnosis by the caller but must never
 * be logged: it can quote file paths and contents (AGENTS.md §6).
 */
export class GitCommandError extends Error {
  override readonly name = 'GitCommandError';
  constructor(
    readonly subcommand: string,
    readonly exitCode: number | null,
    readonly stderr: string,
  ) {
    super(`git ${subcommand} failed (exit ${exitCode ?? 'unknown'})`);
  }
}
