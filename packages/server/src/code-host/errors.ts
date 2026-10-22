import { HttpError } from '../errors.js';

/**
 * Why pushing or a pull request did not happen (ADR-0025). Plain codes and messages written by
 * the app; never the CLI's or git's own output, which may quote a token, a user or a path.
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
  | 'gh-failed';

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
};

/**
 * The `ErrorDto`. Unlike other refusals (snake_case, control/errors.ts), the code is exactly one
 * of the seven names above, as the web (G-B) and the plan expect them.
 */
export function codeHostHttpError(error: CodeHostError): HttpError {
  return new HttpError(STATUS[error.code], error.code, error.message);
}

export const MESSAGES = {
  noRemote: 'The project has no GitHub remote named origin, so it cannot open pull requests',
  notInstalled: 'Install the GitHub CLI (gh) to push and open pull requests from the app',
  notLoggedIn: 'Log in to GitHub in a terminal with gh auth login, then try again',
} as const;
