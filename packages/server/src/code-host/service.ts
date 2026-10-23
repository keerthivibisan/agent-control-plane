import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GitBranchNameSchema } from '@acp/core';
import {
  gitHubRemoteUrl,
  parseGitHubRepository,
  type CodeHostStatusDto,
  type CreateBranchRequest,
  type CreateRepositoryRequest,
  type GitHubRepository,
  type ProjectBranchesDto,
  type PullRequestMergeMethod,
} from '@acp/core/api';
import { silentLogger, type Logger } from '../logger.js';
import { GitCommandError, SAFE_GIT_CONFIG, type GitRunner } from '../workspace/index.js';
import { createProjectBranches } from './branches.js';
import { CodeHostError, MESSAGES } from './errors.js';
import { createGitHubCli, type CodeHostCli, type PullRequestInfo } from './github.js';
import { parseRemoteUrl, providerOf, repoSlug, type RemoteRepo } from './remote.js';
import { createCliRunner, type CliRunner } from './runner.js';
import {
  createTicketBranchGit,
  type LocalDeleteOutcome,
  type OriginRead,
  type TicketBranchPresence,
} from './ticket-branch.js';

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
 * - `createRepository` (ADR-0025 §7): `gh repo create`, then `git remote add origin <address>`
 *   and, if asked, the push of the current branch. Only when there is no `origin` yet.
 * - `connectRepository` (ADR-0025 §7): `git remote add origin <address>`; nothing is pushed.
 * - `branches` and `createBranch` (ADR-0025 §8): the project's local branches, and a new one
 *   made with `git branch --no-track` (and, if asked, sent with `push`); see `branches.ts`.
 * - `mergePullRequest` (ADR-0025 §9): `gh pr merge` run outside the checkout; a refusal is
 *   explained from `gh pr view` / `gh repo view` JSON, never from gh's own words.
 * - `ticketBranchPresence`, `deleteTicketBranch`, `deleteLocalBranch` (ADR-0025 §9): where a
 *   finished ticket branch still exists, and deleting it; see `ticket-branch.ts`.
 *
 * The `origin` address is always rebuilt from a checked owner and name (`gitHubRemoteUrl`), never
 * the text the owner typed, and an existing remote is never changed or removed.
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
  /** Creates the repository on GitHub and sets it as `origin`; answers the fresh status. */
  createRepository(projectRoot: string, input: CreateRepositoryRequest): Promise<CodeHostStatusDto>;
  /** Sets an existing GitHub repository (as the owner typed it) as `origin`; nothing is pushed. */
  connectRepository(projectRoot: string, repository: string): Promise<CodeHostStatusDto>;
  /** The project's local branches, read from git now (no fetch). */
  branches(projectRoot: string): Promise<ProjectBranchesDto>;
  /** Creates a local branch without switching the checkout; answers the fresh list. */
  createBranch(projectRoot: string, input: CreateBranchRequest): Promise<ProjectBranchesDto>;
  /** Merges the pull request on GitHub (G-G); resolves once GitHub merged it. */
  mergePullRequest(projectRoot: string, input: MergePullRequestInput): Promise<void>;
  /** Where the ticket branch still exists (G-G); see `OriginRead`. */
  ticketBranchPresence(
    projectRoot: string,
    branch: string,
    read: OriginRead,
  ): Promise<TicketBranchPresence>;
  /** Deletes the ticket branch on origin and in the project (G-G); answers what is left. */
  deleteTicketBranch(
    projectRoot: string,
    branch: string,
    protect: readonly string[],
  ): Promise<TicketBranchPresence>;
  /** The local half of "Delete branch" on a merge: never the checked-out branch; never throws. */
  deleteLocalBranch(projectRoot: string, branch: string): Promise<LocalDeleteOutcome>;
}

export interface MergePullRequestInput {
  number: number;
  method: PullRequestMergeMethod;
  /** GitHub deletes the head branch (`--delete-branch`); the local one is the caller's. */
  deleteBranch: boolean;
}

/** The method's name in GitHub's settings, for a refusal. */
const METHOD_WORDS: Readonly<Record<PullRequestMergeMethod, string>> = {
  merge: 'merge commits',
  squash: 'squash merging',
  rebase: 'rebase merging',
};

export interface CodeHostServiceDeps {
  /** The workspace git runner (argument arrays, `GIT_TERMINAL_PROMPT=0`, a time limit). */
  git: GitRunner;
  /** Runs the host's CLI; tests pass a fake. */
  cli?: CliRunner;
  /** The CLI command (`gh`); tests may pass a fake's absolute path. */
  ghCommand?: string;
  logger?: Logger;
  /**
   * Where the pull request body's temporary file goes, and the folder `gh repo create` and
   * `gh api user` run in (so they never see the project's checkout); the OS temp folder.
   */
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

  /** The project's remote names (`git remote`); refuses a folder that is not a repository. */
  async function remoteNames(projectRoot: string): Promise<string[]> {
    try {
      const { stdout } = await deps.git([...SAFE_GIT_CONFIG, 'remote'], { cwd: projectRoot });
      return stdout
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l !== '');
    } catch (error) {
      if (error instanceof GitCommandError) {
        throw new CodeHostError('not_a_git_repository', MESSAGES.notGitRepository);
      }
      throw error;
    }
  }

  async function requireNoOrigin(projectRoot: string): Promise<void> {
    if ((await remoteNames(projectRoot)).includes('origin')) {
      throw new CodeHostError('origin_exists', MESSAGES.originExists);
    }
  }

  /**
   * The branch to push when the owner asked for it: null when HEAD has no commit yet (nothing to
   * push). A detached HEAD is refused before anything is created.
   */
  async function branchToPush(projectRoot: string): Promise<string | null> {
    let name: string;
    try {
      const { stdout } = await deps.git(
        [...SAFE_GIT_CONFIG, 'symbolic-ref', '--quiet', '--short', 'HEAD'],
        { cwd: projectRoot },
      );
      name = stdout.trim();
    } catch (error) {
      if (error instanceof GitCommandError) {
        throw new CodeHostError('detached_head', MESSAGES.detachedHead);
      }
      throw error;
    }
    if (!GitBranchNameSchema.safeParse(name).success) {
      throw new CodeHostError('detached_head', MESSAGES.oddBranch);
    }
    try {
      await deps.git([...SAFE_GIT_CONFIG, 'rev-parse', '--verify', '--quiet', 'HEAD^{commit}'], {
        cwd: projectRoot,
      });
    } catch (error) {
      if (error instanceof GitCommandError) return null;
      throw error;
    }
    return name;
  }

  /** `git remote add origin <address>`; a failure re-checks for an `origin` added meanwhile. */
  async function addOrigin(
    projectRoot: string,
    repo: GitHubRepository,
    failedMessage: string,
  ): Promise<void> {
    try {
      await deps.git([...SAFE_GIT_CONFIG, 'remote', 'add', 'origin', gitHubRemoteUrl(repo)], {
        cwd: projectRoot,
      });
    } catch (error) {
      if (!(error instanceof GitCommandError)) throw error;
      // The exit code only: git's stderr can quote paths.
      logger.log('info', 'code_host.remote_add_failed', { exitCode: error.exitCode });
      const raced = await remoteNames(projectRoot).then(
        (names) => names.includes('origin'),
        () => false,
      );
      if (raced) throw new CodeHostError('origin_exists', MESSAGES.originExists);
      throw new CodeHostError('remote_add_failed', failedMessage);
    }
  }

  async function status(projectRoot: string): Promise<CodeHostStatusDto> {
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
  }

  const projectBranches = createProjectBranches({ git: deps.git, push, logger });
  const ticketBranches = createTicketBranchGit({ git: deps.git, logger });

  /** Why `gh pr merge` failed, from GitHub's JSON (gh's own words are never read). */
  async function mergeRefusal(
    neutral: string,
    remote: RemoteRepo,
    input: MergePullRequestInput,
  ): Promise<CodeHostError | null> {
    const n = input.number;
    const readiness = await github.mergeReadiness(neutral, remote, n);
    // Merged meanwhile, or gh failed only at deleting the branch after merging: not a refusal.
    if (readiness?.state === 'merged') return null;
    if (readiness?.state === 'closed') {
      return new CodeHostError('pull_request_not_mergeable', MESSAGES.notMergeableClosed(n));
    }
    const methods = await github.mergeMethods(neutral, remote);
    if (methods?.[input.method] === false) {
      return new CodeHostError(
        'merge_method_not_allowed',
        MESSAGES.methodNotAllowed(METHOD_WORDS[input.method]),
      );
    }
    const status = readiness?.mergeStateStatus ?? null;
    if (readiness?.isDraft === true || status === 'DRAFT') {
      return new CodeHostError('pull_request_not_mergeable', MESSAGES.notMergeableDraft(n));
    }
    if (readiness?.mergeable === 'CONFLICTING' || status === 'DIRTY') {
      return new CodeHostError('pull_request_not_mergeable', MESSAGES.notMergeableConflicts(n));
    }
    if (status === 'BEHIND') {
      return new CodeHostError('pull_request_not_mergeable', MESSAGES.notMergeableBehind(n));
    }
    if (status === 'BLOCKED') {
      return new CodeHostError('pull_request_not_mergeable', MESSAGES.notMergeableBlocked(n));
    }
    return new CodeHostError('merge_failed', MESSAGES.mergeFailed(n));
  }

  return {
    status,

    branches: (projectRoot) => projectBranches.list(projectRoot),
    createBranch: (projectRoot, input) => projectBranches.create(projectRoot, input),

    ticketBranchPresence: (projectRoot, branch, read) =>
      ticketBranches.presence(projectRoot, branch, read),
    deleteTicketBranch: (projectRoot, branch, protect) =>
      ticketBranches.remove(projectRoot, branch, protect),
    deleteLocalBranch: (projectRoot, branch) => ticketBranches.removeLocal(projectRoot, branch),

    async mergePullRequest(projectRoot, input) {
      const remote = await requireGitHub(projectRoot);
      // ADR-0025 §9: gh runs outside the checkout, so `gh pr merge` can never switch, pull or
      // delete anything there (with `--repo` it does not touch local branches either).
      const neutral = deps.tmpDir ?? tmpdir();
      if (!(await github.installed(neutral)) || !(await github.loggedIn(neutral))) {
        throw new CodeHostError('code_host_not_ready', MESSAGES.mergeNotReady);
      }
      const r = await github.merge(neutral, remote, input.number, input.method, input.deleteBranch);
      logger.log('info', 'code_host.merge', {
        method: input.method,
        deleteBranch: input.deleteBranch,
        exitCode: r.exitCode,
        timedOut: r.timedOut,
      });
      if (r.exitCode === 0) return;
      if (r.notFound) throw new CodeHostError('code_host_not_ready', MESSAGES.mergeNotReady);
      if (r.timedOut) throw new CodeHostError('timeout', MESSAGES.mergeTimeout(input.number));
      const refusal = await mergeRefusal(neutral, remote, input);
      if (refusal !== null) throw refusal;
    },

    async createRepository(projectRoot, input) {
      await requireNoOrigin(projectRoot);
      // gh runs outside the checkout: `gh repo create` must never see the project's repository.
      const neutral = deps.tmpDir ?? tmpdir();
      if (!(await github.installed(neutral))) {
        throw new CodeHostError('code_host_not_ready', MESSAGES.createNotInstalled);
      }
      if (!(await github.loggedIn(neutral))) {
        throw new CodeHostError('code_host_not_ready', MESSAGES.createNotLoggedIn);
      }
      // Everything that can refuse is asked before the repository exists on GitHub.
      const pushBranch = input.push ? await branchToPush(projectRoot) : null;
      // The new repository's owner and name are what the app sent, or the account name from
      // `gh api user` (checked as an owner); never read from gh's free-form output.
      const owner = input.owner ?? (await github.login(neutral));
      const repo: GitHubRepository = { owner, name: input.name, protocol: 'https' };
      // `<name>` alone creates it in the logged-in account. A name starting with `-` would read
      // as an option, so it goes as `<account>/<name>`, which means the same.
      const target =
        input.owner === undefined && !input.name.startsWith('-')
          ? input.name
          : `${owner}/${input.name}`;
      await github.createRepository(neutral, target, input.visibility);
      logger.log('info', 'code_host.repository_created', {
        visibility: input.visibility,
        push: input.push,
      });
      const slug = `${repo.owner}/${repo.name}`;
      await addOrigin(
        projectRoot,
        repo,
        `GitHub created ${slug}, but the app could not set it as origin. In the project folder, run: git remote add origin ${gitHubRemoteUrl(repo)}`,
      );
      if (pushBranch !== null) {
        try {
          await push(projectRoot, pushBranch);
        } catch (error) {
          if (!(error instanceof CodeHostError)) throw error;
          throw new CodeHostError(
            error.code,
            `GitHub created ${slug} and it is now the project’s origin, but pushing ${pushBranch} did not work. ${error.message}`,
          );
        }
      }
      return status(projectRoot);
    },

    async connectRepository(projectRoot, repository) {
      const repo = parseGitHubRepository(repository);
      if (repo === null) throw new CodeHostError('invalid_repository', MESSAGES.invalidRepository);
      await requireNoOrigin(projectRoot);
      await addOrigin(projectRoot, repo, MESSAGES.remoteAddFailed);
      logger.log('info', 'code_host.repository_connected', { protocol: repo.protocol });
      return status(projectRoot);
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
