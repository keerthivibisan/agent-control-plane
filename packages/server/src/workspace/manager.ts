import { mkdir, readdir, realpath, rm, rmdir, stat } from 'node:fs/promises';
import { isAbsolute, join, relative, sep } from 'node:path';
import { z } from 'zod';
import { errorFields, silentLogger, type Logger } from '../logger.js';
import { changedFiles, type ChangedFile } from './diff.js';
import { GitCommandError, WorkspaceError } from './errors.js';
import { createGitRunner, type GitRunner } from './git.js';
import { assertSafeId, branchFor, isSafeId } from './ids.js';

/**
 * Git worktrees for managed workers (ADR-0013 §2, §5; orchestration-lifecycle §0).
 *
 * - Each worker gets `<dataDir>/worktrees/<run>/<agent>` on branch `acp/<run>/<agent>`, created
 *   from the project's current HEAD. The owner's working tree is never written by an agent.
 * - `changes` shows what the agent changed (committed or not) against the commit it started from.
 * - `merge` runs only on the owner's click. It fast-forwards the project's base branch, and only
 *   when the project's tree is clean and still on that branch; anything else is a typed refusal.
 * - Every git call disables hooks and fsmonitor, so a repository file can never make git start
 *   another program.
 */

export interface Workspace {
  runId: string;
  agentId: string;
  /** Top level of the project's git repository; merges land here. */
  repoRoot: string;
  /** The worktree checkout. */
  path: string;
  /** Where the agent works: the worktree plus the project's subdirectory inside its repository. */
  cwd: string;
  branch: string;
  /** The branch the project had checked out at creation; merges go back into it. */
  baseBranch: string;
  /** The commit the worktree started from; reviews diff against it. */
  baseCommit: string;
}

/** For P3-D: a workspace read back from the database is parsed and re-checked before use. */
export const WorkspaceSchema = z.object({
  runId: z.string(),
  agentId: z.string(),
  repoRoot: z.string().min(1),
  path: z.string().min(1),
  cwd: z.string().min(1),
  branch: z.string().min(1),
  baseBranch: z.string().min(1),
  baseCommit: z.string().regex(/^[0-9a-f]{40}(?:[0-9a-f]{24})?$/),
});

export interface WorkspaceChanges {
  files: ChangedFile[];
  /** Unified diff against `baseCommit`, cut at a line boundary when over the size cap. */
  diff: string;
  diffTruncated: boolean;
}

export type MergeResult =
  | {
      outcome: 'merged';
      /** The base branch's new head (the agent's branch tip). */
      commit: string;
      previousBaseCommit: string;
      /** True when the moved base was first merged into the agent's branch (opt-in). */
      integratedMovedBase: boolean;
    }
  | { outcome: 'no-changes' };

export interface MergeOptions {
  /**
   * When the base branch gained commits since the worktree was created, merge them into the
   * agent's branch inside its worktree first (never in the owner's tree), then fast-forward. Off
   * by default: the owner reviewed a diff against the old base, so a moved base is refused.
   */
  integrateMovedBase?: boolean;
  /** Short role name for the commit message, e.g. "API builder". Control characters are removed. */
  role?: string;
}

export interface CleanupResult {
  removed: { runId: string; agentId: string }[];
  kept: number;
  failed: number;
}

export interface WorkspaceManager {
  create(projectRoot: string, runId: string, agentId: string): Promise<Workspace>;
  changes(ws: Workspace, options?: { maxDiffBytes?: number }): Promise<WorkspaceChanges>;
  merge(ws: Workspace, options?: MergeOptions): Promise<MergeResult>;
  /** Removes the worktree and its branch. Idempotent; also used to release a merged workspace. */
  discard(ws: Workspace): Promise<void>;
  /**
   * On start: removes worktrees under the data dir that are not in `keep` (the workspaces the
   * database still references, including NEEDS_REVIEW ones, whose work must stay reviewable).
   */
  cleanupOrphans(keep: Iterable<{ runId: string; agentId: string }>): Promise<CleanupResult>;
}

export interface WorkspaceManagerDeps {
  dataDir: string;
  git?: GitRunner;
  logger?: Logger;
}

export const DEFAULT_MAX_DIFF_BYTES = 512 * 1024;

/** Prepended to every git call: no hooks, no fsmonitor command, no submodule recursion. */
export const SAFE_GIT_CONFIG: readonly string[] = [
  '-c',
  'core.hooksPath=/dev/null',
  '-c',
  'core.fsmonitor=false',
  '-c',
  'submodule.recurse=false',
];

/** Commits the manager makes are attributed to the app, so they never need the owner's identity. */
const COMMIT_CONFIG: readonly string[] = [
  '-c',
  'user.name=Agent Control Plane',
  '-c',
  'user.email=agent-control-plane@localhost',
  '-c',
  'commit.gpgsign=false',
];

export function createWorkspaceManager(deps: WorkspaceManagerDeps): WorkspaceManager {
  const git = deps.git ?? createGitRunner();
  const logger = deps.logger ?? silentLogger;
  if (!isAbsolute(deps.dataDir)) {
    throw new WorkspaceError('invalid-workspace', 'dataDir must be an absolute path');
  }

  let rootPromise: Promise<string> | undefined;
  /** `<dataDir>/worktrees`, created on first use and resolved through symlinks (macOS /private). */
  function worktreesRoot(): Promise<string> {
    rootPromise ??= (async () => {
      const root = join(deps.dataDir, 'worktrees');
      await mkdir(root, { recursive: true });
      return realpath(root);
    })();
    return rootPromise;
  }

  async function run(args: readonly string[], cwd: string, maxOutputBytes?: number) {
    return git([...SAFE_GIT_CONFIG, ...args], {
      cwd,
      ...(maxOutputBytes === undefined ? {} : { maxOutputBytes }),
    });
  }

  async function out(args: readonly string[], cwd: string): Promise<string> {
    return (await run(args, cwd)).stdout;
  }

  /** Stdout, or null when git exits non-zero (expected for `--verify --quiet` style probes). */
  async function probe(args: readonly string[], cwd: string): Promise<string | null> {
    try {
      return (await run(args, cwd)).stdout.trim();
    } catch (error) {
      if (error instanceof GitCommandError) return null;
      throw error;
    }
  }

  /** For commands whose exit code is the answer (`--is-ancestor`, `diff --quiet`): 0 → true. */
  async function test(args: readonly string[], cwd: string): Promise<boolean> {
    try {
      await run(args, cwd);
      return true;
    } catch (error) {
      if (error instanceof GitCommandError && error.exitCode === 1) return false;
      throw error;
    }
  }

  async function validate(ws: Workspace): Promise<Workspace> {
    const parsed = WorkspaceSchema.safeParse(ws);
    if (!parsed.success) throw new WorkspaceError('invalid-workspace', 'Malformed workspace');
    const w = parsed.data;
    assertSafeId(w.runId, 'runId');
    assertSafeId(w.agentId, 'agentId');
    const root = await worktreesRoot();
    // A record from the database is only trusted if it names exactly what `create` would have
    // made, so a tampered row can never point `discard` at another directory or branch.
    const ok =
      isAbsolute(w.repoRoot) &&
      w.path === join(root, w.runId, w.agentId) &&
      w.branch === branchFor(w.runId, w.agentId) &&
      (w.cwd === w.path || w.cwd.startsWith(w.path + sep)) &&
      !relative(w.path, w.cwd).split(sep).includes('..') &&
      !w.baseBranch.startsWith('-');
    if (!ok) throw new WorkspaceError('invalid-workspace', 'Workspace does not match its ids');
    return w;
  }

  async function requireWorktree(w: Workspace): Promise<void> {
    if (!(await exists(w.path))) {
      throw new WorkspaceError('invalid-workspace', 'The worktree no longer exists');
    }
    const head = await probe(['symbolic-ref', '--quiet', 'HEAD'], w.path);
    if (head !== `refs/heads/${w.branch}`) {
      throw new WorkspaceError(
        'workspace-branch-changed',
        `The agent's worktree is no longer on ${w.branch}`,
      );
    }
  }

  /** Stages everything in the agent's worktree, so new files show up in the review too. */
  async function stageAll(w: Workspace): Promise<void> {
    await run(['add', '--all'], w.path);
  }

  async function removeIfEmpty(dir: string): Promise<void> {
    try {
      await rmdir(dir);
    } catch {
      // Not empty or already gone: both are fine.
    }
  }

  async function removeWorktree(repoCwd: string | null, path: string): Promise<void> {
    if (repoCwd !== null) {
      try {
        await run(['worktree', 'remove', '--force', '--force', path], repoCwd);
      } catch (error) {
        logger.log('warn', 'workspace.worktree_remove_failed', errorFields(error));
      }
    }
    // Only ever a path under the worktrees root (validated or enumerated by the caller).
    if (await exists(path)) await rm(path, { recursive: true, force: true });
    if (repoCwd !== null) await probe(['worktree', 'prune'], repoCwd);
  }

  async function deleteBranch(repoCwd: string, branch: string): Promise<void> {
    if (
      (await probe(['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`], repoCwd)) !== null
    ) {
      await run(['branch', '-D', branch], repoCwd);
    }
  }

  return {
    async create(projectRoot, runId, agentId) {
      assertSafeId(runId, 'runId');
      assertSafeId(agentId, 'agentId');
      if (!isAbsolute(projectRoot)) {
        throw new WorkspaceError('not-a-git-repo', 'The project root must be an absolute path');
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
      const subdir = relative(repoRoot, project);
      const baseBranch = await probe(['symbolic-ref', '--quiet', '--short', 'HEAD'], repoRoot);
      if (baseBranch === null || baseBranch === '') {
        throw new WorkspaceError('detached-head', 'The project has no branch checked out');
      }
      const baseCommit = await probe(
        ['rev-parse', '--verify', '--quiet', 'HEAD^{commit}'],
        repoRoot,
      );
      if (baseCommit === null || baseCommit === '') {
        throw new WorkspaceError('no-commits', 'The project has no commits yet');
      }

      const root = await worktreesRoot();
      const runDir = join(root, runId);
      const path = join(runDir, agentId);
      const branch = branchFor(runId, agentId);
      if (await exists(path)) {
        throw new WorkspaceError('workspace-exists', 'A workspace for this agent already exists');
      }
      if (
        (await probe(['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`], repoRoot)) !==
        null
      ) {
        throw new WorkspaceError('workspace-exists', `Branch ${branch} already exists`);
      }
      await mkdir(runDir, { recursive: true });
      try {
        await run(['worktree', 'add', '--quiet', '-b', branch, path, baseCommit], repoRoot);
      } catch (error) {
        await removeIfEmpty(runDir);
        throw new WorkspaceError(
          'git-failed',
          `Could not create the worktree (${errorName(error)})`,
        );
      }
      return {
        runId,
        agentId,
        repoRoot,
        path,
        cwd: subdir === '' ? path : join(path, subdir),
        branch,
        baseBranch,
        baseCommit,
      };
    },

    async changes(ws, options = {}) {
      const w = await validate(ws);
      await requireWorktree(w);
      await stageAll(w);
      const base = ['diff', '--cached', '-M', '--no-color', '--no-ext-diff', '--no-textconv'];
      const nameStatus = await out([...base, '-z', '--name-status', w.baseCommit, '--'], w.path);
      const numstat = await out([...base, '-z', '--numstat', w.baseCommit, '--'], w.path);
      const diff = await run(
        [...base, w.baseCommit, '--'],
        w.path,
        options.maxDiffBytes ?? DEFAULT_MAX_DIFF_BYTES,
      );
      return {
        files: changedFiles(nameStatus, numstat),
        diff: diff.stdout,
        diffTruncated: diff.truncated,
      };
    },

    async merge(ws, options = {}) {
      const w = await validate(ws);
      await requireWorktree(w);

      // 1. The owner's tree: clean (tracked files) and still on the base branch.
      const dirty = await out(
        ['status', '--porcelain=v1', '-z', '--untracked-files=no'],
        w.repoRoot,
      );
      if (dirty !== '') {
        throw new WorkspaceError(
          'base-dirty',
          'The project has uncommitted changes; commit or stash them, then merge again',
        );
      }
      const current = await probe(['symbolic-ref', '--quiet', '--short', 'HEAD'], w.repoRoot);
      if (current !== w.baseBranch) {
        throw new WorkspaceError(
          'base-branch-changed',
          `The project is no longer on ${w.baseBranch}; switch back to it to merge`,
        );
      }

      // 2. The agent's pending edits become one commit on its branch.
      await stageAll(w);
      if (!(await test(['diff', '--cached', '--quiet', 'HEAD', '--'], w.path))) {
        await run(
          [
            ...COMMIT_CONFIG,
            'commit',
            '--quiet',
            '--no-verify',
            '-m',
            commitMessage(w, options.role),
          ],
          w.path,
        );
      }
      let tip = (await out(['rev-parse', '--verify', 'HEAD^{commit}'], w.path)).trim();
      if (await test(['diff', '--quiet', w.baseCommit, tip, '--'], w.path)) {
        return { outcome: 'no-changes' };
      }

      // 3. The base must not have moved past the agent's branch (unless integration is asked for).
      const baseHead = (
        await out(['rev-parse', '--verify', `refs/heads/${w.baseBranch}^{commit}`], w.repoRoot)
      ).trim();
      let integratedMovedBase = false;
      if (!(await test(['merge-base', '--is-ancestor', baseHead, tip], w.repoRoot))) {
        if (options.integrateMovedBase !== true) {
          throw new WorkspaceError(
            'base-moved',
            `${w.baseBranch} has new commits since this agent started; review again before merging`,
          );
        }
        try {
          await run(
            [
              ...COMMIT_CONFIG,
              'merge',
              '--quiet',
              '--no-edit',
              '--no-ff',
              '-m',
              `Merge ${w.baseBranch} into ${w.branch}`,
              baseHead,
            ],
            w.path,
          );
        } catch {
          await probe(['merge', '--abort'], w.path);
          throw new WorkspaceError(
            'merge-conflict',
            `The agent's changes conflict with new commits on ${w.baseBranch}`,
          );
        }
        tip = (await out(['rev-parse', '--verify', 'HEAD^{commit}'], w.path)).trim();
        integratedMovedBase = true;
      }

      // 4. Fast-forward only: git itself refuses to overwrite anything in the owner's tree.
      try {
        await run(['merge', '--quiet', '--ff-only', tip], w.repoRoot);
      } catch (error) {
        throw new WorkspaceError('merge-failed', `Git refused the merge (${errorName(error)})`);
      }
      return { outcome: 'merged', commit: tip, previousBaseCommit: baseHead, integratedMovedBase };
    },

    async discard(ws) {
      const w = await validate(ws);
      const repoCwd = (await exists(w.repoRoot)) ? w.repoRoot : null;
      await removeWorktree(repoCwd, w.path);
      if (repoCwd !== null) await deleteBranch(repoCwd, w.branch);
      await removeIfEmpty(join(await worktreesRoot(), w.runId));
    },

    async cleanupOrphans(keep) {
      const keepSet = new Set<string>();
      for (const k of keep) keepSet.add(`${k.runId}/${k.agentId}`);
      const root = await worktreesRoot();
      const result: CleanupResult = { removed: [], kept: 0, failed: 0 };
      for (const runEntry of await readdir(root, { withFileTypes: true })) {
        // Anything this manager would not have created is left alone.
        if (!runEntry.isDirectory() || !isSafeId(runEntry.name)) continue;
        const runId = runEntry.name;
        const runDir = join(root, runId);
        for (const agentEntry of await readdir(runDir, { withFileTypes: true })) {
          if (!agentEntry.isDirectory() || !isSafeId(agentEntry.name)) continue;
          const agentId = agentEntry.name;
          if (keepSet.has(`${runId}/${agentId}`)) {
            result.kept++;
            continue;
          }
          try {
            await removeOrphan(join(runDir, agentId), branchFor(runId, agentId));
            result.removed.push({ runId, agentId });
          } catch (error) {
            result.failed++;
            logger.log('warn', 'workspace.orphan_cleanup_failed', errorFields(error));
          }
        }
        await removeIfEmpty(runDir);
      }
      return result;
    },
  };

  async function removeOrphan(path: string, branch: string): Promise<void> {
    // Only treat the directory as a worktree if git says it is the top of one. Otherwise git would
    // search parent directories and could answer for an unrelated repository.
    const top = await probe(['rev-parse', '--show-toplevel'], path);
    const isWorktree = top !== null && top !== '' && (await realpath(top)) === path;
    const common = isWorktree
      ? await probe(['rev-parse', '--path-format=absolute', '--git-common-dir'], path)
      : null;
    await removeWorktree(common, path);
    if (common !== null) await deleteBranch(common, branch);
  }
}

function commitMessage(w: Workspace, role: string | undefined): string {
  // Control characters (newlines included) would forge extra message lines; replace them.
  const clean = Array.from(role ?? '', (ch) => {
    const code = ch.charCodeAt(0);
    return code < 0x20 || code === 0x7f ? ' ' : ch;
  })
    .join('')
    .trim()
    .slice(0, 60);
  const who = clean ? `"${clean}"` : 'agent';
  return `Changes by ${who} (run ${w.runId}, agent ${w.agentId})`;
}

function errorName(error: unknown): string {
  return error instanceof GitCommandError ? error.message : errorFields(error).errorName;
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}
