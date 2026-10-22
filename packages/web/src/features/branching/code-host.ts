import type { CodeHostStatusDto, PullRequestDto, TicketDto } from '@acp/core/api';
import type { ApiError } from '../../lib/api';
import {
  PULL_REQUEST_COPY,
  type CodeHostProblemKey,
  type PullRequestErrorCode,
} from '../../lib/copy';

/**
 * Pure rules for GitHub (ADR-0025): what the code host status means for the owner, why Push &
 * open PR is off, the pull request's default title and every error in plain words.
 */

export type CodeHostReadiness =
  { kind: 'ready'; repo: string } | { kind: 'problem'; problem: CodeHostProblemKey };

/**
 * Connected only with a GitHub remote, the CLI installed and signed in. Otherwise the first
 * thing to fix: the remote, then the CLI, then the sign-in.
 */
export function codeHostReadiness(status: CodeHostStatusDto): CodeHostReadiness {
  if (status.provider === null || status.repo === null) {
    return { kind: 'problem', problem: 'no-remote' };
  }
  if (!status.cli.installed) return { kind: 'problem', problem: 'no-cli' };
  if (status.cli.loggedIn !== true) return { kind: 'problem', problem: 'not-logged-in' };
  return { kind: 'ready', repo: status.repo };
}

/** Why Push & open PR is off, or null when it can be used. */
export function pushBlockedReason(
  status: CodeHostStatusDto | undefined,
  error: ApiError | null,
): string | null {
  if (status === undefined) {
    return error === null ? PULL_REQUEST_COPY.blocked.checking : PULL_REQUEST_COPY.blocked.unknown;
  }
  const r = codeHostReadiness(status);
  return r.kind === 'ready' ? null : PULL_REQUEST_COPY.blocked[r.problem];
}

export const MAX_PR_TITLE = 200;

/** `<KEY>: <title>`, cut to the 200 characters GitHub's title may have here. */
export function defaultPullRequestTitle(ticket: Pick<TicketDto, 'key' | 'title'>): string {
  return `${ticket.key}: ${ticket.title.trim()}`.slice(0, MAX_PR_TITLE);
}

export function pullRequestTitleError(title: string): string | undefined {
  const t = title.trim();
  if (t === '') return PULL_REQUEST_COPY.titleMissing;
  if (t.length > MAX_PR_TITLE) return PULL_REQUEST_COPY.titleTooLong;
  return undefined;
}

const ERROR_CODES = Object.keys(PULL_REQUEST_COPY.errors) as readonly string[];

function isPullRequestErrorCode(code: string | null): code is PullRequestErrorCode {
  return code !== null && ERROR_CODES.includes(code);
}

/** A failed push, pull request or refresh in plain words; null for an error without a known code. */
export function pullRequestErrorText(error: ApiError): string | null {
  if (error.kind !== 'http' || !isPullRequestErrorCode(error.code)) return null;
  return PULL_REQUEST_COPY.errors[error.code];
}

/** Merged is final; an open one can be merged and a closed one reopened on GitHub. */
export function canRefresh(pr: Pick<PullRequestDto, 'state'>): boolean {
  return pr.state !== 'merged';
}
