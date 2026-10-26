import { HttpError } from '../errors.js';

/**
 * Why pushing, a pull request or connecting a project did not happen (ADR-0025). Plain codes and
 * messages written by the app; never the CLI's or git's own output, which may quote a token, a
 * user or a path.
 */
export type CodeHostErrorCode =
  /** The host's CLI (`gh`) is not on the PATH. */
  | 'gh-not-installed'
  /** `gh auth status` says the owner is not logged in to the host. */
  | 'gh-not-logged-in'
  /** `origin` is missing, or not a GitHub repository. */
  | 'no-github-remote'
  /** `git push` was refused (no access, or `origin` has commits the branch lacks; never forced). */
  | 'push-rejected'
  /** An open pull request for the ticket branch already targets another branch. */
  | 'pr-exists-elsewhere'
  /** The CLI or git did not finish within its time limit. */
  | 'timeout'
  /** The CLI failed otherwise, or answered with something the app does not recognise. */
  | 'gh-failed'
  // Connecting a project from Settings (ADR-0025 §7, G-E): snake_case, as the plan names them.
  /** The project already has a remote named `origin`; the app never changes or removes one. */
  | 'origin_exists'
  /** Creating needs `gh` installed and logged in (by exit code). */
  | 'code_host_not_ready'
  /** What the owner typed is not a GitHub repository (`parseGitHubRepository`). */
  | 'invalid_repository'
  /** `gh repo create` exited non-zero: the name is taken or not allowed, or GitHub said no. */
  | 'repository_create_failed'
  /** `git remote add origin` failed (after the repository was created, when creating). */
  | 'remote_add_failed'
  /** "Push now" with the project folder not on a branch. */
  | 'detached_head'
  /** The project folder is not a git repository, so it cannot have an `origin`. */
  | 'not_a_git_repository'
  // Creating branches from the app (ADR-0025 §8, G-F): snake_case, as the contract names them.
  /** A local branch of that name exists; the app never moves it. */
  | 'branch_exists'
  /** The branch to start from is not a local branch of the project. */
  | 'base_branch_missing'
  /** "Also push" without an `origin` remote (checked before the branch is created). */
  | 'no_origin'
  /** `git check-ref-format --branch` refuses the name. */
  | 'invalid_branch_name'
  /** `git branch` failed otherwise (e.g. `feature` exists and the name is `feature/x`). */
  | 'branch_create_failed'
  // Merging a pull request and deleting the ticket branch (ADR-0025 §9, G-G): snake_case.
  /** The repository does not allow the chosen merge method (GitHub's settings). */
  | 'merge_method_not_allowed'
  /** GitHub would not merge it now: conflicts, required reviews or checks, a draft, behind. */
  | 'pull_request_not_mergeable'
  /** `gh pr merge` failed otherwise. */
  | 'merge_failed'
  /** The branch is the checkout's current branch (or checked out in another worktree). */
  | 'branch_checked_out'
  /** The branch is the ticket's target or the project's base or default target. */
  | 'branch_protected'
  /** Deleting the branch on origin or in the project failed. */
  | 'branch_delete_failed';

export class CodeHostError extends Error {
  override readonly name = 'CodeHostError';
  constructor(
    readonly code: CodeHostErrorCode,
    message: string,
  ) {
    super(message);
  }
}

const STATUS: Readonly<Record<CodeHostErrorCode, number>> = {
  'gh-not-installed': 409,
  'gh-not-logged-in': 409,
  'no-github-remote': 409,
  'push-rejected': 409,
  'pr-exists-elsewhere': 409,
  timeout: 504,
  'gh-failed': 502,
  origin_exists: 409,
  code_host_not_ready: 409,
  invalid_repository: 422,
  repository_create_failed: 422,
  remote_add_failed: 500,
  detached_head: 409,
  not_a_git_repository: 409,
  branch_exists: 409,
  base_branch_missing: 404,
  no_origin: 409,
  invalid_branch_name: 422,
  branch_create_failed: 409,
  merge_method_not_allowed: 409,
  pull_request_not_mergeable: 409,
  merge_failed: 502,
  branch_checked_out: 409,
  branch_protected: 409,
  branch_delete_failed: 409,
};

/**
 * The `ErrorDto`. Unlike other refusals (snake_case, control/errors.ts), the pull request codes
 * keep the seven kebab-case names the web (G-B) expects; the G-E codes are snake_case.
 */
export function codeHostHttpError(error: CodeHostError): HttpError {
  return new HttpError(STATUS[error.code], error.code, error.message);
}

export const MESSAGES = {
  noRemote: 'The project has no GitHub remote named origin, so it cannot open pull requests',
  notInstalled: 'Install the GitHub CLI (gh) to push and open pull requests from the app',
  notLoggedIn: 'Log in to GitHub in a terminal with gh auth login, then try again',
  originExists:
    'This project already has a remote named origin. The app never changes or removes a remote.',
  createNotInstalled: 'Install the GitHub CLI (gh), then check again to create a repository.',
  createNotLoggedIn: 'Run gh auth login in a terminal, then check again to create a repository.',
  invalidRepository:
    'That is not a GitHub repository. Use owner/name, https://github.com/owner/name or git@github.com:owner/name.git.',
  createFailed:
    'GitHub refused to create the repository: it may already exist, or the name is not allowed.',
  detachedHead:
    'The project folder is not on a branch, so there is nothing to push. Switch to a branch, or create the repository without pushing.',
  oddBranch:
    'The project folder’s branch has a name the app does not push. Push it yourself, or create the repository without pushing.',
  notGitRepository: 'The project folder is not a git repository, so it cannot have an origin.',
  remoteAddFailed:
    'The app could not set the repository as origin. Check that you can write to the project folder, then try again.',
  // F-2: the owner's pushes go to origin's own address only (code-host/push-target.ts).
  originAddressUnusable:
    'Origin’s address is not one the app pushes to (an https, ssh or git address of a repository, or a local folder), so nothing was pushed.',
  pushRewrite:
    'The project’s git config rewrites origin’s address for pushes only (url.<address>.pushInsteadOf), so the app does not push: a push would not go where origin is fetched from. Remove that setting, then try again.',
  // G-F (ADR-0025 §8).
  branchExists: (name: string) =>
    `The project already has a branch named ${name}. The app never moves an existing branch.`,
  baseBranchMissing: (from: string) =>
    `The project has no local branch named ${from} to start from.`,
  noOrigin:
    'The project has no remote named origin, so the branch cannot be pushed. Create it without pushing, or connect GitHub first.',
  invalidBranchName: (name: string) => `Git does not accept ${name} as a branch name.`,
  branchCreateFailed: (name: string) =>
    `Git could not create ${name}. A branch whose name is part of it (or starts with it and a /) may already exist.`,
  createdNotPushed: (name: string) =>
    `The app created ${name} in the project, but pushing it to origin did not work.`,
  // G-G (ADR-0025 §9).
  mergeNotReady:
    'Merging needs the GitHub CLI installed and signed in: run gh auth login in a terminal, then try again.',
  mergeTimeout: (n: number) =>
    `GitHub did not answer in time, so pull request #${n} may or may not be merged now. Press Refresh to see.`,
  methodNotAllowed: (method: string) =>
    `This repository does not allow ${method} on GitHub. Choose another way to merge, or change it in the repository's settings.`,
  notMergeableConflicts: (n: number) =>
    `Pull request #${n} has conflicts with its target on GitHub. Resolve them there, then try again.`,
  notMergeableBlocked: (n: number) =>
    `GitHub will not merge pull request #${n} yet: it needs the required reviews or passing required checks first.`,
  notMergeableBehind: (n: number) =>
    `Pull request #${n} is behind its target and the repository requires it to be up to date. Update it on GitHub, then try again.`,
  notMergeableDraft: (n: number) =>
    `Pull request #${n} is a draft. Mark it ready for review on GitHub, then try again.`,
  notMergeableClosed: (n: number) =>
    `Pull request #${n} is closed on GitHub, so it cannot be merged. Press Refresh to see its state.`,
  mergeFailed: (n: number) =>
    `GitHub did not merge pull request #${n}. Look at it on GitHub, then try again or merge it there.`,
  branchCheckedOut: (name: string) =>
    `${name} is the branch the project folder is on, so the app will not delete it. Switch to another branch first.`,
  branchCheckedOutElsewhere: (name: string) =>
    `${name} is checked out in another worktree, so git will not delete it. Remove that worktree or switch it to another branch first.`,
  branchProtected: (name: string) =>
    `${name} is the ticket's target or the project's base branch; the app never deletes it.`,
  remoteUnreadable: (name: string) =>
    `The app could not reach origin to check for ${name}, so nothing was deleted. Check your connection and access, then try again.`,
  remoteDeleteFailed: (name: string) =>
    `Git could not delete ${name} on origin: check your access, or whether the branch is protected on GitHub. Nothing was deleted in the project folder.`,
  remoteDeleteTimeout: (name: string) =>
    `Deleting ${name} on origin did not finish in time, so it may or may not be gone there. Nothing was deleted in the project folder; try again.`,
  localDeleteFailed: (name: string, remoteDone: boolean) =>
    `${remoteDone ? `Deleted ${name} on origin, but git` : 'Git'} could not delete ${name} in the project folder. Try again, or run git branch -D ${name} there.`,
} as const;
