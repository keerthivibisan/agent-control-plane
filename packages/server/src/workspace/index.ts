export {
  DEFAULT_MAX_DIFF_BYTES,
  SAFE_GIT_CONFIG,
  WorkspaceSchema,
  createWorkspaceManager,
} from './manager.js';
export type {
  CleanupResult,
  MergeOptions,
  MergeResult,
  Workspace,
  WorkspaceChanges,
  WorkspaceManager,
  WorkspaceManagerDeps,
} from './manager.js';
export { createGitRunner } from './git.js';
export type { ExecFileFn, ExecFileOptions, GitResult, GitRunOptions, GitRunner } from './git.js';
export { GitCommandError, WorkspaceError } from './errors.js';
export type { WorkspaceErrorCode } from './errors.js';
export type { ChangedFile } from './diff.js';
export { isSafeId } from './ids.js';
