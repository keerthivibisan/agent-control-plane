import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GitBranchNameSchema } from '@acp/core';
import type { CodeHostStatusDto } from '@acp/core/api';
import { silentLogger, type Logger } from '../logger.js';
import { GitCommandError, SAFE_GIT_CONFIG, type GitRunner } from '../workspace/index.js';
import { CodeHostError, MESSAGES } from './errors.js';
import { createGitHubCli, type CodeHostCli, type PullRequestInfo } from './github.js';
import { parseRemoteUrl, providerOf, repoSlug, type RemoteRepo } from './remote.js';
import { createCliRunner, type CliRunner } from './runner.js';

/**
 * The code host service (ADR-0025): what the app can do with a project's `origin`, and the
 * owner's push and pull request. Every method runs only when a route calls it on the owner's
 * request; nothing here starts a timer. The app never reads, stores or sends a token: `git push`
 * uses the owner's git credentials and `gh` its own login.
 *
 * - `status`: `origin`'s host and `owner/name` (never the URL), `gh --version` and
 *   `gh auth status` by exit code, and the default branch from `gh repo view` when logged in.
 * - `push`: `git push --set-upstream origin refs/heads/<b>:refs/heads/<b>`; never forced.
 * - `openPullRequest`: links the open pull request for the branch when it targets the same base,
 *   refuses one that targets another base, else pushes and runs `gh pr create`.
 * - `view`: `gh pr view`.
 */

export interface OpenPullRequestInput {
  head: string;
  base: string;
  title: string;
  body: string;
  draft: boolean;
}

export interface CodeHostService {
  status(projectRoot: string): Promise<CodeHostStatusDto>;
  push(projectRoot: string, branch: string): Promise<void>;
  openPullRequest(
    projectRoot: string,
    input: OpenPullRequestInput,
  ): Promise<{ pullRequest: PullRequestInfo; created: boolean }>;
  view(projectRoot: string, number: number): Promise<PullRequestInfo>;
}

export interface CodeHostServiceDeps {
  /** The workspace git runner (argument arrays, `GIT_TERMINAL_PROMPT=0`, a time limit). */
  git: GitRunner;
  /** Runs the host's CLI; tests pass a fake. */
  cli?: CliRunner;
  /** The CLI command (`gh`); tests may pass a fake's absolute path. */
  ghCommand?: string;
  logger?: Logger;
  /** Where the pull request body's temporary file goes; defaults to the OS temp folder. */
  tmpDir?: string;
}

/** GitHub's own limit is 65,536 characters; the body is cut well before it. */
export const MAX_BODY_CHARS = 60_000;

export function createCodeHostService(deps: CodeHostServiceDeps): CodeHostService {
  const logger = deps.logger ?? silentLogger;
  const github: CodeHostCli = createGitHubCli(deps.cli ?? createCliRunner(), deps.ghCommand);

  /** `origin`'s URL as configured (not rewritten by `insteadOf`), parsed; null when absent. */
  async function remoteOf(projectRoot: string): Promise<RemoteRepo | null> {
    try {
      const { stdout } = await deps.git(
        [...SAFE_GIT_CONFIG, 'config', '--get', 'remote.origin.url'],
        { cwd: projectRoot },
      );
      return parseRemoteUrl(stdout.trim());
    } catch (error) {
      if (error instanceof GitCommandError) return null;
      throw error;
    }
  }

  async function requireGitHub(projectRoot: string): Promise<RemoteRepo> {
    const remote = await remoteOf(projectRoot);
    if (remote === null || providerOf(remote) !== 'github') {
      throw new CodeHostError('no-github-remote', MESSAGES.noRemote);
    }
    return remote;
  }

  async function requireCli(projectRoot: string): Promise<void> {
    if (!(await github.installed(projectRoot))) {
      throw new CodeHostError('gh-not-installed', MESSAGES.notInstalled);
    }
    if (!(await github.loggedIn(projectRoot))) {
      throw new CodeHostError('gh-not-logged-in', MESSAGES.notLoggedIn);
    }
  }

  function branch(name: string, what: string): string {
    if (!GitBranchNameSchema.safeParse(name).success) {
      throw new CodeHostError('gh-failed', `The ${what} is not a valid branch name`);
    }
    return name;
  }

  async function push(projectRoot: string, name: string): Promise<void> {
    const b = branch(name, 'ticket branch');
    try {
      await deps.git(
        [
          ...SAFE_GIT_CONFIG,
          '-c',
          'push.recurseSubmodules=no',
          'push',
          '--set-upstream',
          '--no-verify',
          'origin',
          `refs/heads/${b}:refs/heads/${b}`,
        ],
        { cwd: projectRoot },
      );
    } catch (error) {
      if (!(error instanceof GitCommandError)) throw error;
      // Codes only: git's stderr can quote the remote URL and a user (`GitCommandError.stderr`).
      logger.log('info', 'code_host.push_failed', { exitCode: error.exitCode });
      if (error.exitCode === null) {
        throw new CodeHostError('timeout', 'The push to origin did not finish in time; try again');
      }
      throw new CodeHostError(
        'push-rejected',
        `Git refused to push ${b} to origin: check your access to the repository, or whether origin has commits on ${b} that the app does not (it never forces a push)`,
      );
    }
  }

  async function withBodyFile<T>(body: string, fn: (path: string) => Promise<T>): Promise<T> {
    const dir = await mkdtemp(join(deps.tmpDir ?? tmpdir(), 'acp-pr-'));
    try {
      const path = join(dir, 'body.md');
      await writeFile(path, body.slice(0, MAX_BODY_CHARS), { encoding: 'utf8', mode: 0o600 });
      return await fn(path);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }

  return {
    async status(projectRoot) {
      const remote = await remoteOf(projectRoot);
      const provider = remote === null ? null : providerOf(remote);
      const installed = await github.installed(projectRoot);
      const loggedIn = !installed ? null : await github.loggedIn(projectRoot);
      const defaultBranch =
        provider === 'github' && remote !== null && loggedIn === true
          ? await github.defaultBranch(projectRoot, remote)
          : null;
      const problem =
        provider === null
          ? MESSAGES.noRemote
          : !installed
            ? MESSAGES.notInstalled
            : loggedIn !== true
              ? MESSAGES.notLoggedIn
              : null;
      return {
        provider,
        // Only `owner/name` of a supported host: another host's path is not shown either.
        repo: provider === null || remote === null ? null : repoSlug(remote),
        defaultBranch,
        cli: { name: github.cliName, installed, loggedIn },
        problem,
      };
    },

    push,

    async openPullRequest(projectRoot, input) {
      const head = branch(input.head, 'ticket branch');
      const base = branch(input.base, 'target branch');
      const remote = await requireGitHub(projectRoot);
      await requireCli(projectRoot);
      const open = await github.openForHead(projectRoot, remote, head);
      const same = open.find((pr) => pr.baseBranch === base);
      if (same === undefined && open.length > 0) {
        const other = open[0]?.baseBranch ?? 'another branch';
        throw new CodeHostError(
          'pr-exists-elsewhere',
          `Pull request #${open[0]?.number ?? '?'} for ${head} is already open against ${other}; close it or retarget it on GitHub first`,
        );
      }
      // Pushing first also brings an open pull request up to date with the branch.
      await push(projectRoot, head);
      if (same !== undefined) {
        return { pullRequest: await github.view(projectRoot, remote, same.number), created: false };
      }
      const number = await withBodyFile(input.body, (bodyFile) =>
        github.create(projectRoot, remote, {
          base,
          head,
          title: input.title,
          bodyFile,
          draft: input.draft,
        }),
      );
      return { pullRequest: await github.view(projectRoot, remote, number), created: true };
    },

    async view(projectRoot, number) {
      const remote = await requireGitHub(projectRoot);
      await requireCli(projectRoot);
      return github.view(projectRoot, remote, number);
    },
  };
}
