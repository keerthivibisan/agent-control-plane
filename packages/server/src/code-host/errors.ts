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
  | 'branch_create_failed';

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
} as const;
