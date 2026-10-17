import { mkdir, readdir, realpath, rm, rmdir } from 'node:fs/promises';
import { isAbsolute, join, relative } from 'node:path';
import { errorFields, silentLogger, type Logger } from '../logger.js';
import {
  GitCommandError,
  SAFE_GIT_CONFIG,
  WorkspaceError,
  createGitRunner,
  isSafeId,
  type GitRunner,
} from '../workspace/index.js';

/**
 * The reviewer's temporary checkout (ADR-0019; the "Run checks now" mechanism of ADR-0017 §3):
 * the project's committed HEAD (its main branch, where helpers' changes were merged) checked out
 * into a **detached** worktree under `<dataDir>/review-checkouts/<runId>/<agentRunId>`. The
 * reviewer reads it, read-only; it is removed when the reviewer ends, and on start for any a crash
 * left behind. The owner's working tree is never used. Git calls use the workspace module's runner
 * and safety config (argv only, no hooks, no fsmonitor, no submodules).
 */

export interface ReviewCheckout {
  runId: string;
  agentRunId: string;
  /** Top of the project's repository; the checkout is registered there. */
  repoRoot: string;
  /** The checkout itself. */
  path: string;
  /** Where the reviewer works: the checkout plus the project's subfolder inside its repository. */
  cwd: string;
  /** The commit checked out. */
  commit: string;
}

export interface ReviewCheckouts {
  /**
   * `commit` (ADR-0021): a change reviewer's checkout of one sealed change, or the final reviewer's
   * of the ticket branch tip; absent, the project's HEAD (ADR-0019, before the review loop).
   */
  create(
    projectRoot: string,
    runId: string,
    agentRunId: string,
    commit?: string,
  ): Promise<ReviewCheckout>;
  remove(checkout: ReviewCheckout): Promise<void>;
  /** On start: removes every checkout under the folder (no reviewer survives a restart). */
  cleanupOrphans(): Promise<number>;
  /** The folder all checkouts live in (managed paths are never offered as new projects). */
  readonly dir: string;
}

export interface ReviewCheckoutsDeps {
  dataDir: string;
  git?: GitRunner;
  logger?: Logger;
}

const DIR_NAME = 'review-checkouts';
const COMMIT = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/;

export function createReviewCheckouts(deps: ReviewCheckoutsDeps): ReviewCheckouts {
  if (!isAbsolute(deps.dataDir)) {
    throw new WorkspaceError('invalid-workspace', 'dataDir must be an absolute path');
  }
  const git = deps.git ?? createGitRunner();
  const logger = deps.logger ?? silentLogger;
  const dir = join(deps.dataDir, DIR_NAME);

  const run = (args: readonly string[], cwd: string) => git([...SAFE_GIT_CONFIG, ...args], { cwd });
  async function probe(args: readonly string[], cwd: string): Promise<string | null> {
    try {
      return (await run(args, cwd)).stdout.trim();
    } catch (error) {
      if (error instanceof GitCommandError) return null;
      throw error;
    }
  }

  async function root(): Promise<string> {
    await mkdir(dir, { recursive: true });
    return realpath(dir);
  }

  /** Only ever a path two levels under `<dataDir>/review-checkouts` (built or enumerated here). */
  async function removePath(repoRoot: string | null, path: string): Promise<void> {
    if (repoRoot !== null) {
      try {
        await run(['worktree', 'remove', '--force', '--force', path], repoRoot);
      } catch (error) {
        logger.log('warn', 'review checkout remove failed', errorFields(error));
      }
    }
    await rm(path, { recursive: true, force: true });
    if (repoRoot !== null) await probe(['worktree', 'prune'], repoRoot);
  }

  async function removeRunDirIfEmpty(runDir: string): Promise<void> {
    try {
      await rmdir(runDir);
    } catch (error) {
      const code = (error as { code?: unknown }).code;
      if (code !== 'ENOENT' && code !== 'ENOTEMPTY' && code !== 'EEXIST') throw error;
    }
  }

  return {
    dir,

    async create(projectRoot, runId, agentRunId, wanted) {
      if (wanted !== undefined && !COMMIT.test(wanted)) {
        throw new WorkspaceError('invalid-workspace', 'Not a full commit id for a review checkout');
      }
      if (!isSafeId(runId) || !isSafeId(agentRunId)) {
        throw new WorkspaceError('invalid-id', 'Unsafe run or agent id for a review checkout');
      }
      let project: string;
      try {
        project = await realpath(projectRoot);
      } catch {
        throw new WorkspaceError('not-a-git-repo', 'The project folder does not exist');
      }
      const top = await probe(['rev-parse', '--show-toplevel'], project);
      if (top === null || top === '') {
        throw new WorkspaceError('not-a-git-repo', 'The project is not inside a git repository');
      }
      const repoRoot = await realpath(top);
      const commit = await probe(
        ['rev-parse', '--verify', '--quiet', `${wanted ?? 'HEAD'}^{commit}`],
        repoRoot,
      );
      if (commit === null || !COMMIT.test(commit) || (wanted !== undefined && commit !== wanted)) {
        throw new WorkspaceError(
          'no-commits',
          wanted === undefined ? 'The project has no commits yet' : 'The commit to review is gone',
        );
      }
      const runDir = join(await root(), runId);
      await mkdir(runDir, { recursive: true });
      const path = join(runDir, agentRunId);
      try {
        await run(['worktree', 'add', '--quiet', '--detach', path, commit], repoRoot);
      } catch (error) {
        await removePath(repoRoot, path);
        throw new WorkspaceError(
          'git-failed',
          `Could not prepare the reviewer's checkout (${errorFields(error).errorName})`,
        );
      }
      const subdir = relative(repoRoot, project);
      return {
        runId,
        agentRunId,
        repoRoot,
        path,
        cwd: subdir === '' ? path : join(path, subdir),
        commit,
      };
    },

    async remove(checkout) {
      await removePath(checkout.repoRoot, checkout.path);
      await removeRunDirIfEmpty(join(await root(), checkout.runId));
    },

    async cleanupOrphans() {
      const base = await root();
      let removed = 0;
      for (const runEntry of await readdir(base, { withFileTypes: true })) {
        if (!runEntry.isDirectory() || !isSafeId(runEntry.name)) continue;
        const runDir = join(base, runEntry.name);
        for (const entry of await readdir(runDir, { withFileTypes: true })) {
          if (!entry.isDirectory() || !isSafeId(entry.name)) continue;
          const path = join(runDir, entry.name);
          // Ask git only when the folder is the top of a worktree; otherwise git would search
          // parent folders and could answer for an unrelated repository.
          const top = await probe(['rev-parse', '--show-toplevel'], path);
          const isCheckout =
            top !== null && top !== '' && (await realpath(top).catch(() => null)) === path;
          // Git commands run in the repository's own git folder, which the checkout names.
          const common = isCheckout
            ? await probe(['rev-parse', '--path-format=absolute', '--git-common-dir'], path)
            : null;
          const repoRoot =
            common !== null && common !== '' ? await realpath(common).catch(() => null) : null;
          try {
            await removePath(repoRoot, path);
            removed++;
          } catch (error) {
            logger.log('warn', 'review checkout cleanup failed', errorFields(error));
          }
        }
        await removeRunDirIfEmpty(runDir);
      }
      return removed;
    },
  };
}
