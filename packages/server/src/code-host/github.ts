import { GitBranchNameSchema } from '@acp/core';
import { GitHubOwnerSchema, type CodeHostProvider, type PullRequestState } from '@acp/core/api';
import { z } from 'zod';
import { CodeHostError, MESSAGES } from './errors.js';
import { repoSlug, type RemoteRepo } from './remote.js';
import type { CliResult, CliRunner } from './runner.js';

/**
 * One code host's CLI behind a small interface (ADR-0025 §1): GitHub through `gh` now, GitLab
 * through `glab` later. Every call is an argument array with `--flag=value` for text, so a title
 * or a branch can never be read as another option; the repository is always passed as
 * `owner/name` from `origin`, so the CLI never picks another remote.
 */

/** A pull request as the host reports it. */
export interface PullRequestInfo {
  number: number;
  url: string;
  state: PullRequestState;
  baseBranch: string;
  headBranch: string;
  /** When it was merged; null while open or when closed unmerged. */
  mergedAt: string | null;
  /** The commit the merge made on the base branch, when the host says. */
  mergeCommit: string | null;
}

export interface CreatePullRequestInput {
  base: string;
  head: string;
  title: string;
  /** A file holding the body (written by the service, removed after the call). */
  bodyFile: string;
  draft: boolean;
}

export interface CodeHostCli {
  readonly provider: CodeHostProvider;
  /** E.g. `gh`. */
  readonly cliName: string;
  /** By exit code only; output is never read. */
  installed(cwd: string): Promise<boolean>;
  /** Logged in to the provider's host (`github.com`), by exit code only; output is never read. */
  loggedIn(cwd: string): Promise<boolean>;
  /** The repository's default branch; null when the host cannot tell. */
  defaultBranch(cwd: string, remote: RemoteRepo): Promise<string | null>;
  /** Open pull requests whose head is `head` (in this repository). */
  openForHead(cwd: string, remote: RemoteRepo, head: string): Promise<PullRequestInfo[]>;
  /** Creates the pull request; returns its number. */
  create(cwd: string, remote: RemoteRepo, input: CreatePullRequestInput): Promise<number>;
  view(cwd: string, remote: RemoteRepo, number: number): Promise<PullRequestInfo>;
  /** The logged-in account's name (`gh api user`), checked as a GitHub owner (ADR-0025 §7). */
  login(cwd: string): Promise<string>;
  /**
   * `gh repo create <target> --private|--public` (ADR-0025 §7): never `--source`, `--push` or
   * `--clone`, so nothing local is touched. Its output is not read; the exit code decides.
   */
  createRepository(cwd: string, target: string, visibility: 'private' | 'public'): Promise<void>;
}

/** Time limits per command (ms): short checks, longer for calls that write on the host. */
export const GH_TIMEOUTS = {
  version: 10_000,
  auth: 15_000,
  user: 15_000,
  repo: 20_000,
  list: 30_000,
  create: 60_000,
  view: 30_000,
} as const;

const Commit = z.string().regex(/^[0-9a-f]{7,64}$/);
const PullUrl = z.string().url().max(500).startsWith('https://');
const State = z
  .string()
  .transform((s) => s.toLowerCase())
  .pipe(z.enum(['open', 'merged', 'closed']));

const RepoViewSchema = z.object({
  defaultBranchRef: z.object({ name: z.string() }).nullable().optional(),
});
const PullListSchema = z
  .array(
    z.object({
      number: z.number().int().positive(),
      url: PullUrl,
      state: State,
      baseRefName: GitBranchNameSchema,
      headRefName: GitBranchNameSchema,
    }),
  )
  .max(100);
const PullViewSchema = z.object({
  number: z.number().int().positive(),
  url: PullUrl,
  state: State,
  baseRefName: GitBranchNameSchema,
  headRefName: GitBranchNameSchema,
  mergedAt: z.string().nullable().optional(),
  mergeCommit: z.object({ oid: z.string() }).nullable().optional(),
});

function failed(result: CliResult, what: string): CodeHostError {
  if (result.notFound) return new CodeHostError('gh-not-installed', MESSAGES.notInstalled);
  if (result.timedOut) {
    return new CodeHostError('timeout', `GitHub did not answer in time (${what}); try again`);
  }
  const exit = result.exitCode === null ? 'no exit code' : `exit ${result.exitCode}`;
  return new CodeHostError(
    'gh-failed',
    `The GitHub CLI could not ${what} (${exit}); check gh in a terminal and try again`,
  );
}

function parseJson<T>(schema: z.ZodType<T>, stdout: string, what: string): T {
  let value: unknown;
  try {
    value = JSON.parse(stdout);
  } catch {
    throw new CodeHostError('gh-failed', `The GitHub CLI gave an unreadable answer (${what})`);
  }
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new CodeHostError('gh-failed', `The GitHub CLI gave an unexpected answer (${what})`);
  }
  return parsed.data;
}

function toInfo(pr: z.infer<typeof PullViewSchema>): PullRequestInfo {
  const oid = pr.mergeCommit?.oid;
  return {
    number: pr.number,
    url: pr.url,
    state: pr.state,
    baseBranch: pr.baseRefName,
    headBranch: pr.headRefName,
    mergedAt: pr.mergedAt ?? null,
    mergeCommit: oid !== undefined && Commit.safeParse(oid).success ? oid : null,
  };
}

export function createGitHubCli(run: CliRunner, command = 'gh'): CodeHostCli {
  const repoArg = (remote: RemoteRepo) => `--repo=${repoSlug(remote)}`;

  return {
    provider: 'github',
    cliName: 'gh',

    async installed(cwd) {
      const r = await run(command, ['--version'], { cwd, timeoutMs: GH_TIMEOUTS.version });
      return r.exitCode === 0;
    },

    async loggedIn(cwd) {
      // `ssh.github.com` and `www.github.com` remotes are github.com accounts too.
      const r = await run(command, ['auth', 'status', '--hostname=github.com'], {
        cwd,
        timeoutMs: GH_TIMEOUTS.auth,
      });
      return r.exitCode === 0;
    },

    async defaultBranch(cwd, remote) {
      const r = await run(command, ['repo', 'view', repoSlug(remote), '--json=defaultBranchRef'], {
        cwd,
        timeoutMs: GH_TIMEOUTS.repo,
        maxOutputBytes: 64 * 1024,
      });
      if (r.exitCode !== 0) return null;
      try {
        const name = parseJson(RepoViewSchema, r.stdout, 'repo view').defaultBranchRef?.name;
        return name !== undefined && GitBranchNameSchema.safeParse(name).success ? name : null;
      } catch {
        return null;
      }
    },

    async openForHead(cwd, remote, head) {
      const r = await run(
        command,
        [
          'pr',
          'list',
          repoArg(remote),
          `--head=${head}`,
          '--state=open',
          '--limit=20',
          '--json=number,url,state,baseRefName,headRefName',
        ],
        { cwd, timeoutMs: GH_TIMEOUTS.list, maxOutputBytes: 256 * 1024 },
      );
      if (r.exitCode !== 0) throw failed(r, 'list pull requests');
      return parseJson(PullListSchema, r.stdout, 'pr list')
        .filter((pr) => pr.headRefName === head)
        .map((pr) => ({
          number: pr.number,
          url: pr.url,
          state: pr.state,
          baseBranch: pr.baseRefName,
          headBranch: pr.headRefName,
          mergedAt: null,
          mergeCommit: null,
        }));
    },

    async create(cwd, remote, input) {
      const r = await run(
        command,
        [
          'pr',
          'create',
          repoArg(remote),
          `--base=${input.base}`,
          `--head=${input.head}`,
          `--title=${input.title}`,
          `--body-file=${input.bodyFile}`,
          ...(input.draft ? ['--draft'] : []),
        ],
        { cwd, timeoutMs: GH_TIMEOUTS.create, maxOutputBytes: 64 * 1024 },
      );
      if (r.exitCode !== 0) throw failed(r, 'open the pull request');
      // `gh pr create` prints the new pull request's URL; only its number is taken from it.
      const slug = repoSlug(remote).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const match = new RegExp(`/${slug}/pull/([1-9][0-9]{0,9})\\b`, 'i').exec(r.stdout);
      if (match?.[1] === undefined) {
        throw new CodeHostError(
          'gh-failed',
          'The GitHub CLI did not say which pull request it opened',
        );
      }
      return Number(match[1]);
    },

    async view(cwd, remote, number) {
      const r = await run(
        command,
        [
          'pr',
          'view',
          String(number),
          repoArg(remote),
          '--json=number,url,state,baseRefName,headRefName,mergedAt,mergeCommit',
        ],
        { cwd, timeoutMs: GH_TIMEOUTS.view, maxOutputBytes: 64 * 1024 },
      );
      if (r.exitCode !== 0) throw failed(r, 'read the pull request');
      const pr = toInfo(parseJson(PullViewSchema, r.stdout, 'pr view'));
      if (pr.number !== number) {
        throw new CodeHostError('gh-failed', 'The GitHub CLI answered for another pull request');
      }
      return pr;
    },

    async login(cwd) {
      const r = await run(command, ['api', '--hostname=github.com', 'user', '--jq=.login'], {
        cwd,
        timeoutMs: GH_TIMEOUTS.user,
        maxOutputBytes: 4 * 1024,
      });
      if (r.exitCode !== 0) throw failed(r, 'read your GitHub account name');
      const login = GitHubOwnerSchema.safeParse(r.stdout.trim());
      if (!login.success) {
        throw new CodeHostError('gh-failed', 'The GitHub CLI gave an unexpected account name');
      }
      return login.data;
    },

    async createRepository(cwd, target, visibility) {
      const r = await run(command, ['repo', 'create', target, `--${visibility}`], {
        cwd,
        timeoutMs: GH_TIMEOUTS.create,
        maxOutputBytes: 64 * 1024,
      });
      if (r.exitCode === 0) return;
      if (r.notFound) throw new CodeHostError('code_host_not_ready', MESSAGES.createNotInstalled);
      if (r.timedOut) {
        throw new CodeHostError(
          'timeout',
          'GitHub did not answer in time, so the repository may or may not exist now. Look on GitHub: if it is there, connect it as an existing repository.',
        );
      }
      // gh's own words (stdout or stderr) are never shown: one plain sentence instead.
      throw new CodeHostError('repository_create_failed', MESSAGES.createFailed);
    },
  };
}
