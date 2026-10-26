import {
  GitHubOwnerSchema,
  GitHubRepoNameSchema,
  parseGitHubRepository,
  type CodeHostStatusDto,
  type ProjectDto,
  type PullRequestDto,
  type TicketDto,
} from '@acp/core/api';
import type { ApiError, CreateRepositoryRequest } from '../../lib/api';
import {
  CODE_HOST_CONNECT_COPY,
  PULL_REQUEST_COPY,
  type CodeHostConnectErrorCode,
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

/**
 * A failed push, pull request or refresh in plain words; null for an error without a known code.
 * A push to an open pull request (`pushAgain`) words its refusal for that case: the app pushes
 * only a fast-forward, so a refused push means GitHub's branch has commits the app lacks.
 */
export function pullRequestErrorText(
  error: ApiError,
  { pushAgain = false }: { pushAgain?: boolean } = {},
): string | null {
  if (error.kind !== 'http' || !isPullRequestErrorCode(error.code)) return null;
  if (pushAgain && error.code === 'push-rejected') return PULL_REQUEST_COPY.pushNewRejected;
  return PULL_REQUEST_COPY.errors[error.code];
}

/**
 * Whether the ticket branch has commits its open pull request hasn't got: the branch's tip
 * differs from the commit the app last pushed. Unknown (`pushedCommit` absent or null, from a
 * server before it) is not "new": nothing is offered on a guess.
 */
export function hasNewCommits(branch: {
  headCommit: string;
  pullRequest?: Pick<PullRequestDto, 'state' | 'pushedCommit'> | null | undefined;
}): boolean {
  const pr = branch.pullRequest ?? null;
  if (pr === null || pr.state !== 'open') return false;
  const pushed = pr.pushedCommit ?? null;
  return pushed !== null && pushed !== branch.headCommit;
}

/** Merged is final; an open one can be merged and a closed one reopened on GitHub. */
export function canRefresh(pr: Pick<PullRequestDto, 'state'>): boolean {
  return pr.state !== 'merged';
}

// --- Connecting a project from Settings (G-E, ADR-0025 §7) ---------------------------------------

/**
 * What the Settings card offers: install the CLI, sign in, connect (create or link a repository),
 * or the connection. The CLI comes first, as creating needs it; then the sign-in; then origin.
 */
export type ConnectStep = 'install' | 'login' | 'connect' | 'ready';

export function connectStep(status: CodeHostStatusDto): ConnectStep {
  if (!status.cli.installed) return 'install';
  if (status.cli.loggedIn !== true) return 'login';
  if (status.provider === null || status.repo === null) return 'connect';
  return 'ready';
}

/** `https://github.com/<owner>/<name>` for a status's `owner/name`; null when it isn't one. */
export function gitHubRepoUrl(repo: string): string | null {
  const parsed = parseGitHubRepository(repo);
  return parsed === null || `${parsed.owner}/${parsed.name}` !== repo
    ? null
    : `https://github.com/${parsed.owner}/${parsed.name}`;
}

/**
 * The default repository name: the project folder's name, made into a GitHub name (other
 * characters become `-`, no leading or trailing `-` or `.`, no `.git` ending, at most 100). Empty
 * when nothing usable is left, so the owner types one.
 */
export function defaultRepoName(project: Pick<ProjectDto, 'name' | 'rootPath'>): string {
  const folder = project.rootPath.split(/[\\/]/).filter(Boolean).at(-1) ?? project.name;
  let name = folder
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/\.git$/i, '');
  name = name.replace(/^[-.]+|[-.]+$/g, '').slice(0, 100);
  name = name.replace(/[-.]+$/g, '');
  return GitHubRepoNameSchema.safeParse(name).success ? name : '';
}

export interface CreateRepoDraft {
  name: string;
  owner: string;
  visibility: 'private' | 'public';
  push: boolean;
}

export interface CreateRepoCheck {
  errors: { name?: string; owner?: string };
  /** The request to send; null while a field needs a fix. */
  request: CreateRepositoryRequest | null;
}

/** Checks the Create form with the core schemas, as typed. */
export function checkCreateRepo(draft: CreateRepoDraft): CreateRepoCheck {
  const E = CODE_HOST_CONNECT_COPY.create.errors;
  const name = draft.name.trim();
  const owner = draft.owner.trim();
  const errors: CreateRepoCheck['errors'] = {};
  if (name === '') errors.name = E.nameMissing;
  else if (!GitHubRepoNameSchema.safeParse(name).success) errors.name = E.name;
  if (owner !== '' && !GitHubOwnerSchema.safeParse(owner).success) errors.owner = E.owner;
  const ok = errors.name === undefined && errors.owner === undefined;
  return {
    errors,
    request: ok
      ? {
          name,
          ...(owner !== '' && { owner }),
          visibility: draft.visibility,
          push: draft.push,
        }
      : null,
  };
}

/** Server sentences the app writes with specifics in them, shown as they come. */
const OWN_SENTENCE_CODES: readonly string[] = [
  'remote_add_failed',
  'detached_head',
  'push-rejected',
  'timeout',
];
const CONNECT_ERROR_CODES = Object.keys(CODE_HOST_CONNECT_COPY.errors) as readonly string[];

function isConnectErrorCode(code: string | null): code is CodeHostConnectErrorCode {
  return code !== null && CONNECT_ERROR_CODES.includes(code);
}

/** A failed create or connect in plain words; null for an error without a known code. */
export function connectErrorText(error: ApiError): string | null {
  if (error.kind !== 'http') return null;
  if (isConnectErrorCode(error.code)) return CODE_HOST_CONNECT_COPY.errors[error.code];
  if (error.code !== null && OWN_SENTENCE_CODES.includes(error.code)) return error.message;
  return null;
}
