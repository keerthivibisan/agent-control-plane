import { randomUUID } from 'node:crypto';
import { mkdir, readdir, realpath, rm, rmdir, stat } from 'node:fs/promises';
import { isAbsolute, join, relative, sep } from 'node:path';
import { TicketBranchNameSchema, ticketBranchName } from '@acp/core';
import { z } from 'zod';
import { errorFields, silentLogger, type Logger } from '../logger.js';
import { changedFiles, parseNumstat, type ChangedFile } from './diff.js';
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
 * - ADR-0021 (review loop): a run's ticket branch `acp/<KEY>` is created from the base branch tip;
 *   helpers start from its tip; a helper's change is sealed (committed), integrated with the tip in
 *   the helper's own worktree, and the ticket branch is moved to it only by compare-and-swap, never
 *   while checked out. The owner merges the ticket branch into the base branch once, as a
 *   fast-forward of a clean tree on that branch.
 * - Git operations are serialized per worktree and per repository (U-V: concurrent `git add` in one
 *   worktree collided on its index). A worktree's lock is always taken before its repository's.
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

/** ADR-0021: where a new worktree starts instead of the project's HEAD. */
export interface CreateOptions {
  /** The ticket branch and its tip commit: the worktree starts there and reviews diff against it. */
  from?: { branch: string; commit: string };
}

/** A run's ticket branch in the project's repository (ADR-0021 §4). */
export interface TicketBranchRef {
  /** The registered project folder (may be a subfolder of its repository). */
  projectRoot: string;
  /** `acp/<KEY>` or `acp/<KEY>-r<n>` (core's `TicketBranchNameSchema`). */
  branch: string;
}

export interface CreatedTicketBranch {
  branch: string;
  /** The branch the project had checked out; the owner's final merge goes into it. */
  baseBranch: string;
  /** Its commit at creation; the ticket branch starts there. */
  baseCommit: string;
}

export interface SealResult {
  /** False when the helper's branch has no difference from where it started. */
  changed: boolean;
  /** The helper branch's tip after sealing. */
  headCommit: string;
  /** Files that differ from where it started. */
  changedFiles: number;
}

export type IntegrateResult =
  /** The tip was merged into the helper's branch (or was already in it); `commit` is the result. */
  | { outcome: 'integrated'; commit: string }
  /** Everything the helper changed is already on the ticket branch. */
  | { outcome: 'no-changes'; commit: string };

export interface TicketBranchReview extends WorkspaceChanges {
  /** The ticket branch's current tip. */
  tip: string;
  /** The base branch's current head. */
  baseHead: string;
  /** The base branch gained commits the tip lacks: a fast-forward is not possible. */
  baseMoved: boolean;
}

export interface TicketMergeResult {
  /** The base branch's new head (the ticket branch tip). */
  commit: string;
  previousBaseCommit: string;
  /** False when the merged ticket branch could not be deleted afterwards (it is fully merged). */
  branchDeleted: boolean;
}

/** A temporary detached checkout of one commit (checks on the ticket branch tip). */
export interface CommitCheckout {
  runId: string;
  repoRoot: string;
  path: string;
  /** The checkout plus the project's subfolder inside its repository. */
  cwd: string;
  commit: string;
}

export interface CleanupResult {
  removed: { runId: string; agentId: string }[];
  kept: number;
  failed: number;
}

export interface WorkspaceManager {
  create(
    projectRoot: string,
    runId: string,
    agentId: string,
    options?: CreateOptions,
  ): Promise<Workspace>;
  changes(ws: Workspace, options?: { maxDiffBytes?: number }): Promise<WorkspaceChanges>;
  merge(ws: Workspace, options?: MergeOptions): Promise<MergeResult>;
  /** Removes the worktree and its branch. Idempotent; also used to release a merged workspace. */
  discard(ws: Workspace): Promise<void>;
  /**
   * On start: removes worktrees under the data dir that are not in `keep` (the workspaces the
   * database still references, including NEEDS_REVIEW ones, whose work must stay reviewable).
   */
  cleanupOrphans(keep: Iterable<{ runId: string; agentId: string }>): Promise<CleanupResult>;

  // ------------------------------------------------------------- ADR-0021 ticket branch

  /**
   * Creates `acp/<KEY>` (or the first free `acp/<KEY>-r<n>`) at the project's current HEAD, with
   * `branch --no-track`. A name that exists in the repository, or that `isTaken` reports (an open
   * ticket branch the database knows), is skipped.
   */
  createTicketBranch(
    projectRoot: string,
    ticketKey: string,
    isTaken?: (branch: string) => boolean,
  ): Promise<CreatedTicketBranch>;
  /** The ticket branch's current tip, or null when the branch does not exist. */
  ticketBranchTip(ref: TicketBranchRef): Promise<string | null>;
  /**
   * The helper branch's tip when its worktree has nothing unsealed (tracked or untracked), else
   * null: checks recorded for a commit must have run on exactly that commit.
   */
  sealedHead(ws: Workspace): Promise<string | null>;
  /** Commits the helper's pending edits (one commit, attributed to the app) and reports the change. */
  seal(ws: Workspace, options?: { role?: string }): Promise<SealResult>;
  /**
   * Merges the ticket branch tip into the sealed helper branch (`merge --no-ff`, in the helper's
   * own worktree). A conflict is aborted and refused with `merge-conflict` and the file names.
   */
  integrate(ws: Workspace, ticketTip: string): Promise<IntegrateResult>;
  /** The helper's committed change relative to `against` (`against...HEAD`), for reviews. */
  changeDiff(
    ws: Workspace,
    against: string,
    options?: { maxDiffBytes?: number },
  ): Promise<WorkspaceChanges>;
  /**
   * Moves the ticket branch from `expected` to `next` by compare-and-swap (`update-ref`), only when
   * `next` contains `expected` and the branch is not checked out in any worktree.
   */
  advanceTicketBranch(ref: TicketBranchRef, expected: string, next: string): Promise<void>;
  /** The combined change `base...tip` the owner merges, and whether the base moved. */
  reviewTicketBranch(
    ref: TicketBranchRef & { baseBranch: string },
    options?: { maxDiffBytes?: number },
  ): Promise<TicketBranchReview>;
  /**
   * The owner's single merge (ADR-0021 §4): the project's tree must be clean and on `baseBranch`,
   * the ticket branch at `expectedTip`, and the base not moved; then `merge --ff-only` and
   * `branch -d`.
   */
  mergeTicketBranch(
    ref: TicketBranchRef & { baseBranch: string },
    expectedTip: string,
  ): Promise<TicketMergeResult>;
  /**
   * "Update from main": merges the base branch head into the ticket branch tip in a temporary
   * worktree (never the owner's tree), then moves the ticket branch by compare-and-swap.
   */
  updateTicketFromBase(
    ref: TicketBranchRef & { baseBranch: string; runId: string },
    expectedTip: string,
  ): Promise<{ headCommit: string; baseHead: string }>;
  /** Deletes the ticket branch (`branch -D`). Only for a branch the database records as the run's. */
  discardTicketBranch(ref: TicketBranchRef): Promise<void>;
  /** A temporary detached checkout of `commit` under `<dataDir>/ticket-checkouts/<runId>/`. */
  checkoutCommit(projectRoot: string, runId: string, commit: string): Promise<CommitCheckout>;
  removeCheckout(checkout: CommitCheckout): Promise<void>;
  /** On start: removes every temporary commit checkout (none survives a restart). */
  cleanupCheckouts(): Promise<number>;
  /**
   * ADR-0024 §3, the run summary: the files and lines one sealed change brought, read from the
   * project's repository (no worktree needed). When `headCommit` is the merge the review loop made
   * of the ticket tip into the helper's branch, the change is what that merge adds to the tip (its
   * second parent); otherwise it is `baseCommit..headCommit`. Line counts leave binary files out
   * (null when every changed file is binary). Null when git cannot tell (a commit is gone).
   */
  lineCounts(
    projectRoot: string,
    baseCommit: string,
    headCommit: string,
  ): Promise<LineCounts | null>;
}

export interface LineCounts {
  files: number;
  additions: number | null;
  deletions: number | null;
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
export const COMMIT_CONFIG: readonly string[] = [
  '-c',
  'user.name=Agent Control Plane',
  '-c',
  'user.email=agent-control-plane@localhost',
  '-c',
  'commit.gpgsign=false',
];

/** A full commit id, as `rev-parse` prints it. */
const FULL_COMMIT = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/;
const CHECKOUTS_DIR = 'ticket-checkouts';
/** The most conflicting file names kept on a refusal (core's `ChangeReviewDto.conflictFiles`). */
const MAX_CONFLICT_FILES = 100;
const DIFF_BASE = ['diff', '-M', '--no-color', '--no-ext-diff', '--no-textconv'] as const;

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

  /**
   * One git operation at a time per key (a worktree path or a repository root): concurrent calls
   * on one worktree collided on its index (U-V). Each call waits for the previous one, whatever
   * its outcome, and the queue entry is dropped when it is the last.
   */
  const queues = new Map<string, Promise<unknown>>();
  function serial<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const previous = queues.get(key) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(fn);
    queues.set(key, next);
    void next
      .catch(() => undefined)
      .finally(() => {
        if (queues.get(key) === next) queues.delete(key);
      });
    return next;
  }
  const worktreeKey = (path: string) => `worktree:${path}`;
  const repoKey = (repoRoot: string) => `repo:${repoRoot}`;

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

  /** The repository top and the project's subfolder inside it. */
  async function repoOf(projectRoot: string): Promise<{ repoRoot: string; subdir: string }> {
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
    return { repoRoot, subdir: relative(repoRoot, project) };
  }

  function assertBranchName(branch: string): void {
    if (!TicketBranchNameSchema.safeParse(branch).success) {
      throw new WorkspaceError('invalid-ticket-branch', 'Not a ticket branch name');
    }
  }

  function assertCommit(commit: string, what: string): void {
    if (!FULL_COMMIT.test(commit)) {
      throw new WorkspaceError('invalid-ticket-branch', `${what} is not a full commit id`);
    }
  }

  async function refTip(repoRoot: string, branch: string): Promise<string | null> {
    const tip = await probe(
      ['rev-parse', '--verify', '--quiet', `refs/heads/${branch}^{commit}`],
      repoRoot,
    );
    return tip === null || tip === '' ? null : tip;
  }

  async function requireTip(repoRoot: string, branch: string, expected: string): Promise<void> {
    const tip = await refTip(repoRoot, branch);
    if (tip === null) {
      throw new WorkspaceError('ticket-branch-missing', `${branch} no longer exists`);
    }
    if (tip !== expected) {
      throw new WorkspaceError(
        'ticket-branch-moved',
        `${branch} is not at the commit the control plane recorded; it was changed outside the app`,
      );
    }
  }

  async function isCheckedOut(repoRoot: string, branch: string): Promise<boolean> {
    const list = await out(['worktree', 'list', '--porcelain', '-z'], repoRoot);
    return list.split('\0').includes(`branch refs/heads/${branch}`);
  }

  /** Names of unmerged files in `cwd` (a merge in progress), at most MAX_CONFLICT_FILES. */
  async function conflictNames(cwd: string): Promise<string[]> {
    const names = await probe(['diff', '--name-only', '--diff-filter=U', '-z'], cwd);
    return (names ?? '')
      .split('\0')
      .filter((n) => n !== '')
      .slice(0, MAX_CONFLICT_FILES);
  }

  /**
   * `merge --no-ff <commit>` in `cwd` with the app's identity; on any failure the merge is aborted
   * and refused as `merge-conflict` with the conflicting file names.
   */
  async function mergeOrAbort(cwd: string, commit: string, message: string): Promise<void> {
    try {
      await run(
        [...COMMIT_CONFIG, 'merge', '--quiet', '--no-edit', '--no-ff', '-m', message, commit],
        cwd,
      );
    } catch {
      const files = await conflictNames(cwd);
      await probe(['merge', '--abort'], cwd);
      throw new WorkspaceError(
        'merge-conflict',
        files.length > 0
          ? `The changes conflict with the ticket branch in ${files.length} file(s)`
          : 'Git could not merge the changes',
        files,
      );
    }
  }

  async function diffRange(
    cwd: string,
    range: string,
    maxDiffBytes: number,
  ): Promise<WorkspaceChanges> {
    const nameStatus = await out([...DIFF_BASE, '-z', '--name-status', range, '--'], cwd);
    const numstat = await out([...DIFF_BASE, '-z', '--numstat', range, '--'], cwd);
    const diff = await run([...DIFF_BASE, range, '--'], cwd, maxDiffBytes);
    return {
      files: changedFiles(nameStatus, numstat),
      diff: diff.stdout,
      diffTruncated: diff.truncated,
    };
  }

  let checkoutsPromise: Promise<string> | undefined;
  function checkoutsRoot(): Promise<string> {
    checkoutsPromise ??= (async () => {
      const root = join(deps.dataDir, CHECKOUTS_DIR);
      await mkdir(root, { recursive: true });
      return realpath(root);
    })();
    return checkoutsPromise;
  }

  async function addCheckout(
    repoRoot: string,
    subdir: string,
    runId: string,
    commit: string,
  ): Promise<CommitCheckout> {
    assertSafeId(runId, 'runId');
    const runDir = join(await checkoutsRoot(), runId);
    await mkdir(runDir, { recursive: true });
    const path = join(runDir, randomUUID());
    try {
      await run(['worktree', 'add', '--quiet', '--detach', path, commit], repoRoot);
    } catch (error) {
      await removeWorktree(repoRoot, path);
      await removeIfEmpty(runDir);
      throw new WorkspaceError(
        'git-failed',
        `Could not prepare a temporary checkout (${errorName(error)})`,
      );
    }
    return { runId, repoRoot, path, cwd: subdir === '' ? path : join(path, subdir), commit };
  }

  async function dropCheckout(checkout: CommitCheckout): Promise<void> {
    const runDir = join(await checkoutsRoot(), checkout.runId);
    // Only ever a folder this manager made: `<dataDir>/ticket-checkouts/<run>/<uuid>`.
    const rel = relative(runDir, checkout.path);
    if (!isSafeId(checkout.runId) || rel === '' || rel.includes(sep) || rel.startsWith('.')) {
      throw new WorkspaceError('invalid-workspace', 'Not a temporary checkout');
    }
    const repoCwd = (await exists(checkout.repoRoot)) ? checkout.repoRoot : null;
    await removeWorktree(repoCwd, checkout.path);
    await removeIfEmpty(runDir);
  }

  return {
    async create(projectRoot, runId, agentId, options = {}) {
      assertSafeId(runId, 'runId');
      assertSafeId(agentId, 'agentId');
      const { repoRoot, subdir } = await repoOf(projectRoot);
      return serial(repoKey(repoRoot), () =>
        createIn(repoRoot, subdir, runId, agentId, options.from),
      );
    },

    async changes(ws, options = {}) {
      const w = await validate(ws);
      return serial(worktreeKey(w.path), () => changesOf(w, options.maxDiffBytes));
    },

    async merge(ws, options = {}) {
      const w = await validate(ws);
      return serial(worktreeKey(w.path), () =>
        serial(repoKey(w.repoRoot), () => mergeIn(w, options)),
      );
    },

    async discard(ws) {
      const w = await validate(ws);
      const repoCwd = (await exists(w.repoRoot)) ? w.repoRoot : null;
      await serial(worktreeKey(w.path), async () => {
        const remove = async () => {
          await removeWorktree(repoCwd, w.path);
          if (repoCwd !== null) await deleteBranch(repoCwd, w.branch);
        };
        await (repoCwd === null ? remove() : serial(repoKey(repoCwd), remove));
      });
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

    async createTicketBranch(projectRoot, ticketKey, isTaken = () => false) {
      const { repoRoot } = await repoOf(projectRoot);
      return serial(repoKey(repoRoot), async () => {
        const baseBranch = await probe(['symbolic-ref', '--quiet', '--short', 'HEAD'], repoRoot);
        if (baseBranch === null || baseBranch === '' || baseBranch.startsWith('-')) {
          throw new WorkspaceError('detached-head', 'The project has no branch checked out');
        }
        const baseCommit = await probe(
          ['rev-parse', '--verify', '--quiet', 'HEAD^{commit}'],
          repoRoot,
        );
        if (baseCommit === null || !FULL_COMMIT.test(baseCommit)) {
          throw new WorkspaceError('no-commits', 'The project has no commits yet');
        }
        for (let attempt = 0; attempt < 100; attempt++) {
          let branch: string;
          try {
            branch = ticketBranchName(ticketKey, attempt);
          } catch {
            throw new WorkspaceError(
              'invalid-ticket-branch',
              'The ticket key gives no branch name',
            );
          }
          // A name in use (any branch, or an open ticket branch of another run) is never reused.
          if (isTaken(branch) || (await refTip(repoRoot, branch)) !== null) continue;
          try {
            await run(['branch', '--no-track', branch, baseCommit], repoRoot);
          } catch (error) {
            throw new WorkspaceError(
              'git-failed',
              `Could not create the ticket branch (${errorName(error)})`,
            );
          }
          return { branch, baseBranch, baseCommit };
        }
        throw new WorkspaceError('ticket-branch-exists', 'No free ticket branch name was found');
      });
    },

    async ticketBranchTip(ref) {
      assertBranchName(ref.branch);
      const { repoRoot } = await repoOf(ref.projectRoot);
      return refTip(repoRoot, ref.branch);
    },

    async sealedHead(ws) {
      const w = await validate(ws);
      return serial(worktreeKey(w.path), async () => {
        await requireWorktree(w);
        // Untracked files too (`--untracked-files=all`): they would be part of a later seal.
        const pending = await out(
          ['status', '--porcelain=v1', '-z', '--untracked-files=all'],
          w.path,
        );
        if (pending !== '') return null;
        return (await out(['rev-parse', '--verify', 'HEAD^{commit}'], w.path)).trim();
      });
    },

    async seal(ws, options = {}) {
      const w = await validate(ws);
      return serial(worktreeKey(w.path), async () => {
        await requireWorktree(w);
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
        const headCommit = (await out(['rev-parse', '--verify', 'HEAD^{commit}'], w.path)).trim();
        const names = await out(
          [...DIFF_BASE, '-z', '--name-only', w.baseCommit, headCommit, '--'],
          w.path,
        );
        const changedFiles = names.split('\0').filter((n) => n !== '').length;
        return { changed: changedFiles > 0, headCommit, changedFiles };
      });
    },

    async lineCounts(projectRoot, baseCommit, headCommit) {
      if (!FULL_COMMIT.test(baseCommit) || !FULL_COMMIT.test(headCommit)) return null;
      try {
        const { repoRoot } = await repoOf(projectRoot);
        const parents = (await out(['rev-list', '--parents', '-n', '1', headCommit], repoRoot))
          .trim()
          .split(' ');
        const tip = parents.length === 3 ? parents[2] : undefined;
        const fromTip =
          tip !== undefined &&
          (await test(['merge-base', '--is-ancestor', baseCommit, tip], repoRoot));
        const from = fromTip && tip !== undefined ? tip : baseCommit;
        const numstat = await out(
          [...DIFF_BASE, '-z', '--numstat', from, headCommit, '--'],
          repoRoot,
        );
        const counts = [...parseNumstat(numstat).values()];
        const text = counts.filter((c) => c.additions !== null && c.deletions !== null);
        const sum = (pick: (c: (typeof counts)[number]) => number | null) =>
          text.length === 0 ? null : text.reduce((n, c) => n + (pick(c) ?? 0), 0);
        return {
          files: counts.length,
          additions: sum((c) => c.additions),
          deletions: sum((c) => c.deletions),
        };
      } catch {
        // A commit the summary names is gone (or the project moved): the lines are unknown.
        return null;
      }
    },

    async integrate(ws, ticketTip) {
      const w = await validate(ws);
      assertCommit(ticketTip, 'The ticket branch tip');
      return serial(worktreeKey(w.path), async () => {
        await requireWorktree(w);
        // Integration happens on a sealed change only: no edit may slip in unreviewed.
        await stageAll(w);
        if (!(await test(['diff', '--cached', '--quiet', 'HEAD', '--'], w.path))) {
          throw new WorkspaceError(
            'workspace-unsealed',
            "The helper's copy has changes that were not sealed; seal it first",
          );
        }
        const known = await probe(
          ['rev-parse', '--verify', '--quiet', `${ticketTip}^{commit}`],
          w.path,
        );
        if (known !== ticketTip) {
          throw new WorkspaceError('ticket-branch-missing', 'The ticket branch tip is unknown');
        }
        let head = (await out(['rev-parse', '--verify', 'HEAD^{commit}'], w.path)).trim();
        // Everything on the helper's branch is already on the ticket branch.
        if (await test(['merge-base', '--is-ancestor', head, ticketTip], w.path)) {
          return { outcome: 'no-changes', commit: ticketTip };
        }
        if (!(await test(['merge-base', '--is-ancestor', ticketTip, head], w.path))) {
          await mergeOrAbort(w.path, ticketTip, `Merge the ticket branch into ${w.branch}`);
          head = (await out(['rev-parse', '--verify', 'HEAD^{commit}'], w.path)).trim();
        }
        if (await test(['diff', '--quiet', ticketTip, head, '--'], w.path)) {
          return { outcome: 'no-changes', commit: head };
        }
        return { outcome: 'integrated', commit: head };
      });
    },

    async changeDiff(ws, against, options = {}) {
      const w = await validate(ws);
      assertCommit(against, 'The commit to compare with');
      return serial(worktreeKey(w.path), async () => {
        await requireWorktree(w);
        return diffRange(
          w.path,
          `${against}...HEAD`,
          options.maxDiffBytes ?? DEFAULT_MAX_DIFF_BYTES,
        );
      });
    },

    async advanceTicketBranch(ref, expected, next) {
      assertBranchName(ref.branch);
      assertCommit(expected, 'The expected tip');
      assertCommit(next, 'The new tip');
      const { repoRoot } = await repoOf(ref.projectRoot);
      await serial(repoKey(repoRoot), () => advanceIn(repoRoot, ref.branch, expected, next));
    },

    async reviewTicketBranch(ref, options = {}) {
      assertBranchName(ref.branch);
      const { repoRoot } = await repoOf(ref.projectRoot);
      return serial(repoKey(repoRoot), async () => {
        const tip = await refTip(repoRoot, ref.branch);
        if (tip === null) {
          throw new WorkspaceError('ticket-branch-missing', `${ref.branch} no longer exists`);
        }
        const baseHead = await refTip(repoRoot, ref.baseBranch);
        if (baseHead === null) {
          throw new WorkspaceError('base-branch-changed', `${ref.baseBranch} no longer exists`);
        }
        const changes = await diffRange(
          repoRoot,
          `${baseHead}...${tip}`,
          options.maxDiffBytes ?? DEFAULT_MAX_DIFF_BYTES,
        );
        const baseMoved = !(await test(['merge-base', '--is-ancestor', baseHead, tip], repoRoot));
        return { ...changes, tip, baseHead, baseMoved };
      });
    },

    async mergeTicketBranch(ref, expectedTip) {
      assertBranchName(ref.branch);
      assertCommit(expectedTip, 'The ticket branch tip');
      if (ref.baseBranch.startsWith('-')) {
        throw new WorkspaceError('base-branch-changed', 'Not a branch name');
      }
      const { repoRoot } = await repoOf(ref.projectRoot);
      return serial(repoKey(repoRoot), async () => {
        const dirty = await out(
          ['status', '--porcelain=v1', '-z', '--untracked-files=no'],
          repoRoot,
        );
        if (dirty !== '') {
          throw new WorkspaceError(
            'base-dirty',
            'The project has uncommitted changes; commit or stash them, then merge again',
          );
        }
        const current = await probe(['symbolic-ref', '--quiet', '--short', 'HEAD'], repoRoot);
        if (current !== ref.baseBranch) {
          throw new WorkspaceError(
            'base-branch-changed',
            `The project is no longer on ${ref.baseBranch}; switch back to it to merge`,
          );
        }
        await requireTip(repoRoot, ref.branch, expectedTip);
        const baseHead = (
          await out(['rev-parse', '--verify', `refs/heads/${ref.baseBranch}^{commit}`], repoRoot)
        ).trim();
        if (!(await test(['merge-base', '--is-ancestor', baseHead, expectedTip], repoRoot))) {
          throw new WorkspaceError(
            'base-moved',
            `${ref.baseBranch} has new commits since the ticket branch was made; update it from ${ref.baseBranch} first`,
          );
        }
        // Fast-forward only: git itself refuses to overwrite anything in the owner's tree.
        try {
          await run(['merge', '--quiet', '--ff-only', expectedTip], repoRoot);
        } catch (error) {
          throw new WorkspaceError('merge-failed', `Git refused the merge (${errorName(error)})`);
        }
        let branchDeleted = true;
        try {
          await run(['branch', '-d', ref.branch], repoRoot);
        } catch (error) {
          branchDeleted = false;
          logger.log('warn', 'workspace.ticket_branch_delete_failed', errorFields(error));
        }
        return { commit: expectedTip, previousBaseCommit: baseHead, branchDeleted };
      });
    },

    async updateTicketFromBase(ref, expectedTip) {
      assertBranchName(ref.branch);
      assertCommit(expectedTip, 'The ticket branch tip');
      const { repoRoot, subdir } = await repoOf(ref.projectRoot);
      return serial(repoKey(repoRoot), async () => {
        await requireTip(repoRoot, ref.branch, expectedTip);
        const baseHead = await refTip(repoRoot, ref.baseBranch);
        if (baseHead === null) {
          throw new WorkspaceError('base-branch-changed', `${ref.baseBranch} no longer exists`);
        }
        if (await test(['merge-base', '--is-ancestor', baseHead, expectedTip], repoRoot)) {
          return { headCommit: expectedTip, baseHead };
        }
        // In a temporary detached checkout of the tip, never the owner's tree.
        const checkout = await addCheckout(repoRoot, subdir, ref.runId, expectedTip);
        let headCommit: string;
        try {
          await mergeOrAbort(checkout.path, baseHead, `Merge ${ref.baseBranch} into ${ref.branch}`);
          headCommit = (
            await out(['rev-parse', '--verify', 'HEAD^{commit}'], checkout.path)
          ).trim();
        } finally {
          await dropCheckout(checkout).catch((error: unknown) => {
            logger.log('warn', 'workspace.checkout_remove_failed', errorFields(error));
          });
        }
        await advanceIn(repoRoot, ref.branch, expectedTip, headCommit);
        return { headCommit, baseHead };
      });
    },

    async discardTicketBranch(ref) {
      assertBranchName(ref.branch);
      const { repoRoot } = await repoOf(ref.projectRoot);
      await serial(repoKey(repoRoot), async () => {
        if ((await refTip(repoRoot, ref.branch)) === null) return;
        if (await isCheckedOut(repoRoot, ref.branch)) {
          throw new WorkspaceError(
            'ticket-branch-checked-out',
            `${ref.branch} is checked out; switch away from it to discard it`,
          );
        }
        await run(['branch', '-D', ref.branch], repoRoot);
      });
    },

    async checkoutCommit(projectRoot, runId, commit) {
      assertCommit(commit, 'The commit');
      const { repoRoot, subdir } = await repoOf(projectRoot);
      return serial(repoKey(repoRoot), () => addCheckout(repoRoot, subdir, runId, commit));
    },

    async removeCheckout(checkout) {
      const remove = () => dropCheckout(checkout);
      await ((await exists(checkout.repoRoot))
        ? serial(repoKey(checkout.repoRoot), remove)
        : remove());
    },

    async cleanupCheckouts() {
      const root = await checkoutsRoot();
      let removed = 0;
      for (const runEntry of await readdir(root, { withFileTypes: true })) {
        if (!runEntry.isDirectory() || !isSafeId(runEntry.name)) continue;
        const runDir = join(root, runEntry.name);
        for (const entry of await readdir(runDir, { withFileTypes: true })) {
          if (!entry.isDirectory()) continue;
          const path = join(runDir, entry.name);
          try {
            // Ask git only when the folder is the top of a worktree (see removeOrphan).
            const top = await probe(['rev-parse', '--show-toplevel'], path);
            const isCheckout = top !== null && top !== '' && (await realpath(top)) === path;
            const common = isCheckout
              ? await probe(['rev-parse', '--path-format=absolute', '--git-common-dir'], path)
              : null;
            await removeWorktree(common, path);
            removed++;
          } catch (error) {
            logger.log('warn', 'workspace.checkout_cleanup_failed', errorFields(error));
          }
        }
        await removeIfEmpty(runDir);
      }
      return removed;
    },
  };

  /** The compare-and-swap move of a ticket branch; the caller holds the repository's lock. */
  async function advanceIn(
    repoRoot: string,
    branch: string,
    expected: string,
    next: string,
  ): Promise<void> {
    await requireTip(repoRoot, branch, expected);
    if (!(await test(['merge-base', '--is-ancestor', expected, next], repoRoot))) {
      throw new WorkspaceError(
        'not-fast-forward',
        'The change does not contain the ticket branch tip, so it was not moved',
      );
    }
    if (await isCheckedOut(repoRoot, branch)) {
      throw new WorkspaceError(
        'ticket-branch-checked-out',
        `${branch} is checked out in a worktree; the control plane does not move it`,
      );
    }
    try {
      await run(
        ['update-ref', '-m', 'acp: advance ticket branch', `refs/heads/${branch}`, next, expected],
        repoRoot,
      );
    } catch {
      // Someone moved it between the check and the swap: the swap itself refused.
      throw new WorkspaceError('ticket-branch-moved', `${branch} changed while it was being moved`);
    }
  }

  async function createIn(
    repoRoot: string,
    subdir: string,
    runId: string,
    agentId: string,
    from: CreateOptions['from'],
  ): Promise<Workspace> {
    let baseBranch: string | null;
    let baseCommit: string | null;
    if (from === undefined) {
      baseBranch = await probe(['symbolic-ref', '--quiet', '--short', 'HEAD'], repoRoot);
      if (baseBranch === null || baseBranch === '') {
        throw new WorkspaceError('detached-head', 'The project has no branch checked out');
      }
      baseCommit = await probe(['rev-parse', '--verify', '--quiet', 'HEAD^{commit}'], repoRoot);
      if (baseCommit === null || baseCommit === '') {
        throw new WorkspaceError('no-commits', 'The project has no commits yet');
      }
    } else {
      // ADR-0021: a helper of a review-loop run starts from the ticket branch tip.
      assertBranchName(from.branch);
      assertCommit(from.commit, 'The start commit');
      if ((await refTip(repoRoot, from.branch)) === null) {
        throw new WorkspaceError('ticket-branch-missing', `${from.branch} no longer exists`);
      }
      const known = await probe(
        ['rev-parse', '--verify', '--quiet', `${from.commit}^{commit}`],
        repoRoot,
      );
      if (known !== from.commit) {
        throw new WorkspaceError('invalid-ticket-branch', 'The start commit is not in the project');
      }
      baseBranch = from.branch;
      baseCommit = from.commit;
    }

    const root = await worktreesRoot();
    const runDir = join(root, runId);
    const path = join(runDir, agentId);
    const branch = branchFor(runId, agentId);
    if (await exists(path)) {
      throw new WorkspaceError('workspace-exists', 'A workspace for this agent already exists');
    }
    if (
      (await probe(['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`], repoRoot)) !== null
    ) {
      throw new WorkspaceError('workspace-exists', `Branch ${branch} already exists`);
    }
    await mkdir(runDir, { recursive: true });
    try {
      await run(['worktree', 'add', '--quiet', '-b', branch, path, baseCommit], repoRoot);
    } catch (error) {
      await removeIfEmpty(runDir);
      throw new WorkspaceError('git-failed', `Could not create the worktree (${errorName(error)})`);
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
  }

  async function changesOf(
    w: Workspace,
    maxDiffBytes: number | undefined,
  ): Promise<WorkspaceChanges> {
    await requireWorktree(w);
    await stageAll(w);
    const base = ['diff', '--cached', '-M', '--no-color', '--no-ext-diff', '--no-textconv'];
    const nameStatus = await out([...base, '-z', '--name-status', w.baseCommit, '--'], w.path);
    const numstat = await out([...base, '-z', '--numstat', w.baseCommit, '--'], w.path);
    const diff = await run(
      [...base, w.baseCommit, '--'],
      w.path,
      maxDiffBytes ?? DEFAULT_MAX_DIFF_BYTES,
    );
    return {
      files: changedFiles(nameStatus, numstat),
      diff: diff.stdout,
      diffTruncated: diff.truncated,
    };
  }

  async function mergeIn(w: Workspace, options: MergeOptions): Promise<MergeResult> {
    await requireWorktree(w);

    // 1. The owner's tree: clean (tracked files) and still on the base branch.
    const dirty = await out(['status', '--porcelain=v1', '-z', '--untracked-files=no'], w.repoRoot);
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
  }

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
