import { randomUUID } from 'node:crypto';
import { mkdir, readdir, realpath, rm, rmdir, stat } from 'node:fs/promises';
import { isAbsolute, join, relative, sep } from 'node:path';
import { GitBranchNameSchema, HARNESS_MANIFEST_PATH } from '@acp/core';
import { z } from 'zod';
import { errorFields, silentLogger, type Logger } from '../logger.js';
import { changedFiles, parseNumstat, type ChangedFile } from './diff.js';
import { GitCommandError, WorkspaceError } from './errors.js';
import { AGENT_ATTACHMENTS_DIR } from '../attachments/agent-copies.js';
import { createGitRunner, type GitRunner } from './git.js';
import { assertSafeId, branchFor, isSafeId } from './ids.js';
import { outputPathspecs, readSmallFile, setupOutputsOf } from './setup-outputs.js';
import {
  ALWAYS_PROTECTED,
  legacyTicketBranchPlan,
  type TicketBranchPlan,
} from './ticket-branch-plan.js';

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
 * - ADR-0021 (review loop): a run's ticket branch is created from its target branch's tip;
 *   helpers start from its tip; a helper's change is sealed (committed), integrated with the tip in
 *   the helper's own worktree, and the ticket branch is moved to it only by compare-and-swap, never
 *   while checked out. The owner merges the ticket branch into the target once, as a fast-forward:
 *   of a clean tree when the target is checked out, else of the target's ref by compare-and-swap.
 * - ADR-0025: the ticket branch's name comes from the ticket or the project's branching strategy
 *   (`acp/<KEY>` without one), and its target from the ticket or the strategy (the checked-out
 *   branch without one). §10: it starts at the tip of its source (the ticket's `from`, else the
 *   strategy's default source, else the target), which is only read. Every ticket-branch operation refuses a long-lived branch: the run's
 *   target, `main`, `master`, the strategy's branches, the checked-out branch and `origin`'s
 *   default branch.
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
  /**
   * ADR-0030, a resolver's worktree: after creating it at `from`, merge this commit in without
   * committing (`merge --no-commit --no-ff`), leaving any conflicts in the files for the agent to
   * edit. The server's `seal` then concludes the merge (a two-parent commit).
   */
  mergeTarget?: { commit: string };
}

/** ADR-0030: the private candidate an operation builds before any agent is involved. */
export type CandidateResult =
  /** The target is already in the ticket branch: nothing to update. */
  | { kind: 'up-to-date'; mergeBase: string }
  /** Git merged it cleanly; `candidate` is pinned under `refs/acp/resolutions/<operation>`. */
  | { kind: 'clean'; candidate: string; mergeBase: string }
  /** Git left conflicts in these files (the temporary merge was aborted). */
  | { kind: 'conflict'; files: string[]; mergeBase: string };

/** ADR-0030: what the server's check of a resolver's sealed merge found. */
export interface ResolutionCheck {
  /** The commit contains the pinned target commit (it is a real merge of it). */
  containsTarget: boolean;
  /** Files of the given list that still hold conflict markers at the commit. */
  markerFiles: string[];
}

/**
 * A run's ticket branch in the project's repository (ADR-0021 §4), as the database records it
 * for the run (`ticket_branches`): the manager acts on no other branch.
 */
export interface TicketBranchRef {
  /** The registered project folder (may be a subfolder of its repository). */
  projectRoot: string;
  /** The recorded name (core's `TicketBranchNameSchema`). */
  branch: string;
  /** The recorded target (`base_branch`): created from it, merged into it; never the branch. */
  baseBranch: string;
  /** More long-lived names the branch must not be (the project strategy's; ADR-0025). */
  protectedNames?: readonly string[];
}

export interface CreatedTicketBranch {
  branch: string;
  /** The target branch (ADR-0025) or, without one, the branch the project had checked out. */
  baseBranch: string;
  /** The source's commit at creation (the target's, without a source); the branch starts there. */
  baseCommit: string;
  /** ADR-0025 §10: the branch it started from, only when that is not the target. */
  sourceBranch?: string;
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
  /**
   * True when the target was the checked-out branch (its clean tree was fast-forwarded); false
   * when only its ref moved, by compare-and-swap (ADR-0025).
   */
  movedCheckout: boolean;
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
   * Creates the ticket branch (ADR-0025 §4) with `branch --no-track` at its source's tip (§10: the
   * plan's source, else its target), or at the project's current HEAD when the plan has neither
   * (a ticket key alone is the legacy plan: `acp/<KEY>`). The first free name is taken (`-r<n>`): a name that exists in the repository, or
   * that `isTaken` reports (an open ticket branch the database knows), is skipped. A missing
   * local target is refused (`target-branch-missing`), a missing local source too
   * (`source-branch-missing`), and so is a name that is a long-lived branch.
   */
  createTicketBranch(
    projectRoot: string,
    plan: string | TicketBranchPlan,
    isTaken?: (branch: string) => boolean,
  ): Promise<CreatedTicketBranch>;
  /**
   * Before a run starts (ADR-0025): the plan's target and source exist locally and its first name
   * is not a long-lived branch. Returns the target and the tip the branch would start at (the
   * source's); refuses like `createTicketBranch`.
   */
  checkTicketBranchPlan(
    projectRoot: string,
    plan: TicketBranchPlan,
  ): Promise<{ target: string; commit: string; sourceBranch?: string }>;
  /** The ticket branch's current tip, or null when the branch does not exist. */
  ticketBranchTip(ref: TicketBranchRef): Promise<string | null>;
  /**
   * Before the branch is pushed (ADR-0025): the guard passes and the branch is at `expectedTip`,
   * the tip the app recorded, so nothing changed outside the app is published.
   */
  verifyTicketBranch(ref: TicketBranchRef, expectedTip: string): Promise<void>;
  /**
   * The helper branch's tip when its worktree has nothing unsealed (tracked or untracked), else
   * null: checks recorded for a commit must have run on exactly that commit.
   */
  sealedHead(ws: Workspace): Promise<string | null>;
  /** Commits the helper's pending edits (one commit, attributed to the app) and reports the change. */
  seal(ws: Workspace, options?: { role?: string }): Promise<SealResult>;
  /**
   * F-1: the worktree's git directories, absolute (`--git-dir`, its private folder under the
   * repository's `worktrees/`, and `--git-common-dir`, the repository's `.git`), each also as its
   * real path when that differs. A Full auto helper's sandbox may not write them.
   */
  gitDirs(ws: Workspace): Promise<string[]>;
  /**
   * F-1: when the helper switched its worktree to another branch (`workspace-branch-changed`),
   * detaches that worktree's HEAD where it is (`checkout --detach`: no ref moves, files and index
   * stay), so the other branch is no longer held by it. True when it detached; false when the
   * worktree is gone, already detached or still on its own branch.
   */
  detachForeignBranch(ws: Workspace): Promise<boolean>;
  /**
   * F-1, the owner's "Reset to the last reviewed commit": moves the ticket branch from `from` (the
   * tip the owner saw) back to `recorded` (the app's record) with `update-ref` (compare-and-swap).
   * Refused when the branch is a long-lived one, is checked out in any worktree (stale entries of
   * removed worktrees are pruned first), moved again, or `recorded` is gone. A branch already at
   * `recorded` is left as it is. No other ref is touched.
   */
  resetTicketBranch(ref: TicketBranchRef, recorded: string, from: string): Promise<void>;
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
  /**
   * ADR-0026 §5: the change between two recorded commits (`base...head`), read from the project's
   * repository after its branches are gone (a merged or discarded ticket branch, a merged change).
   * Null when git no longer has either commit. Nothing is stored.
   */
  diffCommits(
    projectRoot: string,
    base: string,
    head: string,
    options?: { maxDiffBytes?: number },
  ): Promise<WorkspaceChanges | null>;
  /** The combined change `base...tip` the owner merges, and whether the base moved. */
  reviewTicketBranch(
    ref: TicketBranchRef & { baseBranch: string },
    options?: { maxDiffBytes?: number },
  ): Promise<TicketBranchReview>;
  /**
   * The owner's single merge (ADR-0021 §4) into the ticket's target (`baseBranch`, ADR-0025): the
   * ticket branch at `expectedTip` and the target not moved past it (a fast-forward only). When
   * the target is checked out in the project, its tree must be clean, and `merge --ff-only`
   * moves it; when it is checked out nowhere, its ref moves by compare-and-swap and no working
   * tree is touched; checked out in another worktree, it is refused. Then the ticket branch is
   * deleted.
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

  // ------------------------------------------------------------- ADR-0030 conflict resolution

  /** A local branch's tip, or null when it does not exist (read only). */
  branchTip(projectRoot: string, branch: string): Promise<string | null>;
  /**
   * Merges `targetTip` into `ticketTip` in a temporary detached checkout (never the owner's tree,
   * never the ticket branch itself). A clean result is pinned by `refs/acp/resolutions/<op>` so it
   * survives the checkout's removal; a conflict is aborted and reported with its file names.
   */
  prepareCandidate(
    ref: TicketBranchRef & { runId: string },
    input: { operationId: string; ticketTip: string; targetTip: string },
  ): Promise<CandidateResult>;
  /** Pins a resolver's sealed merge as the operation's candidate. */
  pinCandidate(projectRoot: string, operationId: string, commit: string): Promise<void>;
  /** Removes an operation's candidate ref (idempotent). */
  dropCandidate(projectRoot: string, operationId: string): Promise<void>;
  /**
   * Every path the combined change touches (ADR-0030 §4): `target..candidate` (what the ticket
   * adds to the new target) and `mergeBase..target` (what the target update brings).
   */
  combinedPaths(
    projectRoot: string,
    input: { mergeBase: string; targetCommit: string; candidateCommit: string },
  ): Promise<string[]>;
  /** Checks a resolver's sealed merge: it contains the target, and no conflict markers remain. */
  checkResolution(
    projectRoot: string,
    input: { commit: string; targetCommit: string; files: readonly string[] },
  ): Promise<ResolutionCheck>;
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

  /** Setup outputs declared by the harness file at a worktree's base commit, by commit. */
  const baseOutputs = new Map<string, readonly string[]>();

  /**
   * ADR-0027 §3: the setup steps' `outputs` (relative to the project folder) as paths from the
   * top of the repository: those the harness file at the worktree's base commit declares, and
   * those of the owner's checkout (whose setup steps are the ones that ran). Never staged.
   */
  async function setupOutputs(w: Workspace): Promise<string[]> {
    const subdir = relative(w.path, w.cwd).split(sep).join('/');
    const prefix = subdir === '' ? '' : `${subdir}/`;
    const key = `${w.repoRoot}\0${w.baseCommit}\0${prefix}`;
    let fromBase = baseOutputs.get(key);
    if (fromBase === undefined) {
      fromBase = setupOutputsOf(
        await probe(['show', `${w.baseCommit}:${prefix}${HARNESS_MANIFEST_PATH}`], w.path),
      );
      baseOutputs.set(key, fromBase);
    }
    const owner = setupOutputsOf(
      await readSmallFile(join(w.repoRoot, ...subdir.split('/'), HARNESS_MANIFEST_PATH)),
    );
    return [...new Set([...fromBase, ...owner])].map((o) => `${prefix}${o}`);
  }

  /**
   * Stages everything in the agent's worktree, so new files show up in the review too, except the
   * owner's attachment copies (ADR-0026 §4) and the setup steps' outputs (ADR-0027 §3). Their own
   * `.gitignore` is not enough: the agent may write in its worktree, so it could delete that file
   * or stage a copy itself. Outputs are unstaged back to HEAD (never removed from the index), so
   * a folder the repository already tracks is left as it was.
   */
  async function stageAll(w: Workspace): Promise<void> {
    const outputs = await setupOutputs(w);
    await run(
      [
        'add',
        '--all',
        '--',
        ':/',
        `:(top,exclude)${AGENT_ATTACHMENTS_DIR}`,
        ...outputPathspecs('', outputs, 'top,exclude'),
      ],
      w.path,
    );
    await run(
      [
        'rm',
        '-r',
        '--cached',
        '--quiet',
        '--ignore-unmatch',
        '--',
        `:(top)${AGENT_ATTACHMENTS_DIR}`,
      ],
      w.path,
    );
    if (outputs.length > 0) {
      await run(['reset', '--quiet', '--', ...outputPathspecs('', outputs, 'top')], w.path);
    }
  }

  /**
   * Refuses a branch where any commit since the agent's start touched the attachment copies or a
   * setup output (the agent committed them itself): removing them later would still leave them in
   * its history.
   */
  async function refuseCommittedCopies(w: Workspace, commit: string): Promise<void> {
    const listed = await out(
      ['rev-list', `${w.baseCommit}..${commit}`, '--', `:(top)${AGENT_ATTACHMENTS_DIR}`],
      w.path,
    );
    if (listed.trim() !== '') {
      throw new WorkspaceError(
        'invalid-workspace',
        `The agent's branch contains ${AGENT_ATTACHMENTS_DIR}; attachments are never committed`,
      );
    }
    const outputs = await setupOutputs(w);
    if (outputs.length === 0) return;
    const touched = await out(
      ['rev-list', `${w.baseCommit}..${commit}`, '--', ...outputPathspecs('', outputs, 'top')],
      w.path,
    );
    if (touched.trim() !== '') {
      throw new WorkspaceError(
        'invalid-workspace',
        "The agent's branch contains a setup step's output folder; setup outputs are never committed",
      );
    }
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

  /**
   * The part of the ticket-branch guard (ADR-0025) that needs no repository: a safe branch name
   * that is not `main`, `master` or one of `reserved` (the run's target, the strategy's branches).
   */
  function assertBranchName(branch: string, reserved: readonly string[] = []): void {
    if (!GitBranchNameSchema.safeParse(branch).success) {
      throw new WorkspaceError('invalid-ticket-branch', 'Not a ticket branch name');
    }
    if (ALWAYS_PROTECTED.includes(branch) || reserved.includes(branch)) {
      throw longLived(branch);
    }
  }

  function longLived(branch: string): WorkspaceError {
    return new WorkspaceError(
      'invalid-ticket-branch',
      `${branch} is a long-lived branch, never a ticket branch; the app does not act on it`,
    );
  }

  const reservedOf = (ref: TicketBranchRef): string[] => [
    ref.baseBranch,
    ...(ref.protectedNames ?? []),
  ];

  /** The branch the project's own checkout is on, or null when detached. */
  async function currentBranch(repoRoot: string): Promise<string | null> {
    const name = await probe(['symbolic-ref', '--quiet', '--short', 'HEAD'], repoRoot);
    return name === null || name === '' ? null : name;
  }

  /**
   * `origin`'s default branch as the repository already knows it (`refs/remotes/origin/HEAD`,
   * set by `git clone`); null when unknown. Local only: never asks the remote.
   */
  async function originDefault(repoRoot: string): Promise<string | null> {
    const ref = await probe(['symbolic-ref', '--quiet', 'refs/remotes/origin/HEAD'], repoRoot);
    const prefix = 'refs/remotes/origin/';
    if (ref === null || !ref.startsWith(prefix)) return null;
    const name = ref.slice(prefix.length);
    return GitBranchNameSchema.safeParse(name).success ? name : null;
  }

  /**
   * The ticket-branch guard (ADR-0025, replacing the `acp/<KEY>`-only rule): the recorded branch
   * is refused when it is the run's target, `main` or `master`, a strategy branch, `origin`'s
   * default branch, or (`checkedOut`, for operations that change it) the project's checked-out
   * branch. The caller holds the repository's lock.
   */
  async function guardTicketBranch(
    repoRoot: string,
    ref: TicketBranchRef,
    options: { checkedOut: boolean },
  ): Promise<void> {
    assertBranchName(ref.branch, reservedOf(ref));
    if ((await originDefault(repoRoot)) === ref.branch) throw longLived(ref.branch);
    if (options.checkedOut && (await currentBranch(repoRoot)) === ref.branch) {
      throw new WorkspaceError(
        'ticket-branch-checked-out',
        `${ref.branch} is checked out in the project; switch away from it first`,
      );
    }
  }

  /**
   * Where a new ticket branch starts (ADR-0025 §4, §10): the target must exist locally (no fetch:
   * the app never reaches the remote for this), or the checked-out branch stands for it; the
   * branch starts at the source's tip when the plan names another branch, else the target's.
   * Only refs are read: the checkout is never switched.
   */
  async function startOf(
    repoRoot: string,
    plan: TicketBranchPlan,
  ): Promise<{ baseBranch: string; baseCommit: string; sourceBranch?: string }> {
    const target = await targetOf(repoRoot, plan);
    const source = plan.source;
    if (source === null || source === target.baseBranch) return target;
    if (!GitBranchNameSchema.safeParse(source).success) {
      throw new WorkspaceError('invalid-ticket-branch', 'The source is not a valid branch name');
    }
    const tip = await refTip(repoRoot, source);
    if (tip === null || !FULL_COMMIT.test(tip)) {
      throw new WorkspaceError(
        'source-branch-missing',
        `The branch ${source}, which the ticket branch starts from, does not exist in the project yet`,
      );
    }
    return { baseBranch: target.baseBranch, baseCommit: tip, sourceBranch: source };
  }

  /** The plan's target and its tip, or the checked-out branch's without one. */
  async function targetOf(
    repoRoot: string,
    plan: TicketBranchPlan,
  ): Promise<{ baseBranch: string; baseCommit: string }> {
    if (plan.target === null) {
      const baseBranch = await currentBranch(repoRoot);
      if (baseBranch === null || baseBranch.startsWith('-')) {
        throw new WorkspaceError('detached-head', 'The project has no branch checked out');
      }
      const baseCommit = await probe(
        ['rev-parse', '--verify', '--quiet', 'HEAD^{commit}'],
        repoRoot,
      );
      if (baseCommit === null || !FULL_COMMIT.test(baseCommit)) {
        throw new WorkspaceError('no-commits', 'The project has no commits yet');
      }
      return { baseBranch, baseCommit };
    }
    const target = plan.target;
    if (!GitBranchNameSchema.safeParse(target).success) {
      throw new WorkspaceError('invalid-ticket-branch', 'The target is not a valid branch name');
    }
    const tip = await refTip(repoRoot, target);
    if (tip === null || !FULL_COMMIT.test(tip)) {
      throw new WorkspaceError(
        'target-branch-missing',
        `The target branch ${target} does not exist in the project yet`,
      );
    }
    return { baseBranch: target, baseCommit: tip };
  }

  /** Every name a new ticket branch must not take (the caller holds the repository's lock). */
  async function reservedFor(
    repoRoot: string,
    plan: TicketBranchPlan,
    target: string,
  ): Promise<Set<string>> {
    const names = new Set([...ALWAYS_PROTECTED, ...plan.protectedNames, target]);
    // The source is a branch the ticket branch is made from, so it is never the ticket branch.
    if (plan.source !== null) names.add(plan.source);
    const current = await currentBranch(repoRoot);
    if (current !== null) names.add(current);
    const def = await originDefault(repoRoot);
    if (def !== null) names.add(def);
    return names;
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
      const ws = await serial(repoKey(repoRoot), () =>
        createIn(repoRoot, subdir, runId, agentId, options.from),
      );
      if (options.mergeTarget === undefined) return ws;
      assertCommit(options.mergeTarget.commit, 'The target commit');
      const target = options.mergeTarget.commit;
      return serial(worktreeKey(ws.path), async () => {
        try {
          await run(
            [...COMMIT_CONFIG, 'merge', '--quiet', '--no-commit', '--no-ff', target],
            ws.path,
          );
        } catch (error) {
          // Exit 1 with conflicts is the expected case: they stay for the resolver. Anything
          // else (no merge in progress afterwards) is a failure, and the worktree goes.
          const merging = await probe(['rev-parse', '--verify', '--quiet', 'MERGE_HEAD'], ws.path);
          if (merging === null || merging === '') {
            await removeWorktree(repoRoot, ws.path).catch(() => undefined);
            await deleteBranch(repoRoot, ws.branch).catch(() => undefined);
            throw new WorkspaceError(
              'git-failed',
              `Could not prepare the merge for the resolver (${errorName(error)})`,
            );
          }
        }
        return ws;
      });
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

    async createTicketBranch(projectRoot, planInput, isTaken = () => false) {
      const plan = typeof planInput === 'string' ? legacyTicketBranchPlan(planInput) : planInput;
      const { repoRoot } = await repoOf(projectRoot);
      return serial(repoKey(repoRoot), async () => {
        const { baseBranch, baseCommit, sourceBranch } = await startOf(repoRoot, plan);
        const reserved = await reservedFor(repoRoot, plan, baseBranch);
        for (let attempt = 0; attempt < 100; attempt++) {
          const branch = plan.nameFor(attempt);
          // A long-lived branch is refused, not skipped: the ticket's own name is wrong.
          if (reserved.has(branch)) throw longLived(branch);
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
          return {
            branch,
            baseBranch,
            baseCommit,
            ...(sourceBranch !== undefined && { sourceBranch }),
          };
        }
        throw new WorkspaceError('ticket-branch-exists', 'No free ticket branch name was found');
      });
    },

    async checkTicketBranchPlan(projectRoot, plan) {
      const { repoRoot } = await repoOf(projectRoot);
      return serial(repoKey(repoRoot), async () => {
        const { baseBranch, baseCommit, sourceBranch } = await startOf(repoRoot, plan);
        const reserved = await reservedFor(repoRoot, plan, baseBranch);
        const first = plan.nameFor(0);
        if (reserved.has(first)) throw longLived(first);
        return {
          target: baseBranch,
          commit: baseCommit,
          ...(sourceBranch !== undefined && { sourceBranch }),
        };
      });
    },

    async verifyTicketBranch(ref, expectedTip) {
      assertBranchName(ref.branch, reservedOf(ref));
      assertCommit(expectedTip, 'The ticket branch tip');
      const { repoRoot } = await repoOf(ref.projectRoot);
      await serial(repoKey(repoRoot), async () => {
        await guardTicketBranch(repoRoot, ref, { checkedOut: false });
        await requireTip(repoRoot, ref.branch, expectedTip);
      });
    },

    async ticketBranchTip(ref) {
      assertBranchName(ref.branch, reservedOf(ref));
      const { repoRoot } = await repoOf(ref.projectRoot);
      return refTip(repoRoot, ref.branch);
    },

    async sealedHead(ws) {
      const w = await validate(ws);
      return serial(worktreeKey(w.path), async () => {
        await requireWorktree(w);
        // Untracked files too (`--untracked-files=all`): they would be part of a later seal.
        // ADR-0027 §3: setup outputs are never sealed, so they do not count as pending either.
        const outputs = await setupOutputs(w);
        const pending = await out(
          [
            'status',
            '--porcelain=v1',
            '-z',
            '--untracked-files=all',
            ...(outputs.length === 0
              ? []
              : ['--', ':/', ...outputPathspecs('', outputs, 'top,exclude')]),
          ],
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
        // ADR-0030: a resolver's worktree holds a merge in progress; it is concluded even when the
        // result's tree equals HEAD's (a merge commit still records the target as merged).
        const merging = await probe(['rev-parse', '--verify', '--quiet', 'MERGE_HEAD'], w.path);
        const inMerge = merging !== null && merging !== '';
        if (inMerge || !(await test(['diff', '--cached', '--quiet', 'HEAD', '--'], w.path))) {
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
        await refuseCommittedCopies(w, headCommit);
        const names = await out(
          [...DIFF_BASE, '-z', '--name-only', w.baseCommit, headCommit, '--'],
          w.path,
        );
        const changedFiles = names.split('\0').filter((n) => n !== '').length;
        return { changed: changedFiles > 0, headCommit, changedFiles };
      });
    },

    async gitDirs(ws) {
      const w = await validate(ws);
      return serial(worktreeKey(w.path), async () => {
        await requireWorktree(w);
        const raw = (await out(['rev-parse', '--git-dir', '--git-common-dir'], w.path))
          .split('\n')
          .map((l) => l.trim())
          .filter((l) => l !== '');
        if (raw.length !== 2) {
          throw new WorkspaceError('git-failed', 'Git did not say where its folders are');
        }
        const dirs: string[] = [];
        for (const dir of raw) {
          // Relative answers are relative to the worktree folder git ran in.
          const given = isAbsolute(dir) ? dir : join(w.path, dir);
          if (!dirs.includes(given)) dirs.push(given);
          const real = await realpath(given).catch(() => null);
          if (real !== null && !dirs.includes(real)) dirs.push(real);
        }
        return dirs;
      });
    },

    async detachForeignBranch(ws) {
      const w = await validate(ws);
      return serial(worktreeKey(w.path), async () => {
        if (!(await exists(w.path))) return false;
        const head = await probe(['symbolic-ref', '--quiet', 'HEAD'], w.path);
        if (head === null || head === '' || head === `refs/heads/${w.branch}`) return false;
        await run(['checkout', '--quiet', '--detach'], w.path);
        return true;
      });
    },

    async resetTicketBranch(ref, recorded, from) {
      assertBranchName(ref.branch, reservedOf(ref));
      assertCommit(recorded, 'The last reviewed commit');
      assertCommit(from, 'The current tip');
      const { repoRoot } = await repoOf(ref.projectRoot);
      await serial(repoKey(repoRoot), async () => {
        await guardTicketBranch(repoRoot, ref, { checkedOut: true });
        // Worktrees the app already removed leave entries until pruned; they hold nothing.
        await probe(['worktree', 'prune'], repoRoot);
        if (await isCheckedOut(repoRoot, ref.branch)) {
          throw new WorkspaceError(
            'ticket-branch-checked-out',
            `${ref.branch} is checked out in a worktree, so it is not moved; discard the changes whose helpers switched to it first`,
          );
        }
        const tip = await refTip(repoRoot, ref.branch);
        if (tip === null) {
          throw new WorkspaceError('ticket-branch-missing', `${ref.branch} no longer exists`);
        }
        if (tip === recorded) return;
        if (tip !== from) {
          throw new WorkspaceError(
            'ticket-branch-moved',
            `${ref.branch} changed again since you looked; look at it once more`,
          );
        }
        if ((await probe(['cat-file', '-e', `${recorded}^{commit}`], repoRoot)) === null) {
          throw new WorkspaceError(
            'git-failed',
            'The last reviewed commit is no longer in the repository',
          );
        }
        try {
          await run(['update-ref', `refs/heads/${ref.branch}`, recorded, from], repoRoot);
        } catch {
          throw new WorkspaceError(
            'ticket-branch-moved',
            `${ref.branch} changed again since you looked; look at it once more`,
          );
        }
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
      assertBranchName(ref.branch, reservedOf(ref));
      assertCommit(expected, 'The expected tip');
      assertCommit(next, 'The new tip');
      const { repoRoot } = await repoOf(ref.projectRoot);
      await serial(repoKey(repoRoot), async () => {
        await guardTicketBranch(repoRoot, ref, { checkedOut: true });
        await advanceIn(repoRoot, ref.branch, expected, next);
      });
    },

    async diffCommits(projectRoot, base, head, options = {}) {
      assertCommit(base, 'The base commit');
      assertCommit(head, 'The head commit');
      const { repoRoot } = await repoOf(projectRoot);
      return serial(repoKey(repoRoot), async () => {
        for (const commit of [base, head]) {
          const known = await test(
            ['rev-parse', '--verify', '--quiet', `${commit}^{commit}`],
            repoRoot,
          );
          if (!known) return null;
        }
        return diffRange(
          repoRoot,
          `${base}...${head}`,
          options.maxDiffBytes ?? DEFAULT_MAX_DIFF_BYTES,
        );
      });
    },

    async reviewTicketBranch(ref, options = {}) {
      assertBranchName(ref.branch, reservedOf(ref));
      const { repoRoot } = await repoOf(ref.projectRoot);
      return serial(repoKey(repoRoot), async () => {
        await guardTicketBranch(repoRoot, ref, { checkedOut: false });
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
      assertBranchName(ref.branch, reservedOf(ref));
      assertCommit(expectedTip, 'The ticket branch tip');
      if (ref.baseBranch.startsWith('-')) {
        throw new WorkspaceError('base-branch-changed', 'Not a branch name');
      }
      const { repoRoot } = await repoOf(ref.projectRoot);
      return serial(repoKey(repoRoot), async () => {
        await guardTicketBranch(repoRoot, ref, { checkedOut: true });
        const target = ref.baseBranch;
        // ADR-0025: the owner's tree is touched only when it is on the target (as before).
        const onTarget = (await currentBranch(repoRoot)) === target;
        if (!onTarget && (await isCheckedOut(repoRoot, target))) {
          throw new WorkspaceError(
            'target-checked-out',
            `${target} is checked out in another worktree; merge it there or switch that worktree away`,
          );
        }
        if (onTarget) {
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
        }
        await requireTip(repoRoot, ref.branch, expectedTip);
        const baseHead = await refTip(repoRoot, target);
        if (baseHead === null) {
          throw new WorkspaceError('base-branch-changed', `${target} no longer exists`);
        }
        if (!(await test(['merge-base', '--is-ancestor', baseHead, expectedTip], repoRoot))) {
          throw new WorkspaceError(
            'base-moved',
            `${target} has new commits since the ticket branch was made; update it from ${target} first`,
          );
        }
        if (onTarget) {
          // Fast-forward only: git itself refuses to overwrite anything in the owner's tree.
          try {
            await run(['merge', '--quiet', '--ff-only', expectedTip], repoRoot);
          } catch (error) {
            throw new WorkspaceError('merge-failed', `Git refused the merge (${errorName(error)})`);
          }
        } else {
          // Checked out nowhere: move the ref from the head just read, never anything else.
          try {
            await run(
              [
                'update-ref',
                '-m',
                'acp: merge ticket branch',
                `refs/heads/${target}`,
                expectedTip,
                baseHead,
              ],
              repoRoot,
            );
          } catch {
            throw new WorkspaceError('base-moved', `${target} changed while it was being merged`);
          }
        }
        let branchDeleted = true;
        try {
          // Fully merged now (the target is at its tip). `-d` compares with the checked-out
          // branch, so a target that is not checked out needs `-D`, after the tip is re-checked.
          await requireTip(repoRoot, ref.branch, expectedTip);
          await run(['branch', onTarget ? '-d' : '-D', ref.branch], repoRoot);
        } catch (error) {
          branchDeleted = false;
          logger.log('warn', 'workspace.ticket_branch_delete_failed', errorFields(error));
        }
        return {
          commit: expectedTip,
          previousBaseCommit: baseHead,
          branchDeleted,
          movedCheckout: onTarget,
        };
      });
    },

    async updateTicketFromBase(ref, expectedTip) {
      assertBranchName(ref.branch, reservedOf(ref));
      assertCommit(expectedTip, 'The ticket branch tip');
      const { repoRoot, subdir } = await repoOf(ref.projectRoot);
      return serial(repoKey(repoRoot), async () => {
        await guardTicketBranch(repoRoot, ref, { checkedOut: true });
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
      assertBranchName(ref.branch, reservedOf(ref));
      const { repoRoot } = await repoOf(ref.projectRoot);
      await serial(repoKey(repoRoot), async () => {
        if ((await refTip(repoRoot, ref.branch)) === null) return;
        await guardTicketBranch(repoRoot, ref, { checkedOut: true });
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

    async branchTip(projectRoot, branch) {
      // Any branch, the long-lived target included: this only reads its tip.
      if (!GitBranchNameSchema.safeParse(branch).success) {
        throw new WorkspaceError('invalid-ticket-branch', 'Not a branch name');
      }
      const { repoRoot } = await repoOf(projectRoot);
      return refTip(repoRoot, branch);
    },

    async prepareCandidate(ref, input) {
      assertBranchName(ref.branch, reservedOf(ref));
      assertCommit(input.ticketTip, 'The ticket branch tip');
      assertCommit(input.targetTip, 'The target tip');
      assertSafeId(input.operationId, 'operationId');
      const { repoRoot, subdir } = await repoOf(ref.projectRoot);
      return serial(repoKey(repoRoot), async () => {
        await guardTicketBranch(repoRoot, ref, { checkedOut: true });
        await requireTip(repoRoot, ref.branch, input.ticketTip);
        const mergeBase = (
          await out(['merge-base', input.ticketTip, input.targetTip], repoRoot)
        ).trim();
        if (
          await test(['merge-base', '--is-ancestor', input.targetTip, input.ticketTip], repoRoot)
        ) {
          return { kind: 'up-to-date', mergeBase };
        }
        const checkout = await addCheckout(repoRoot, subdir, ref.runId, input.ticketTip);
        try {
          try {
            await run(
              [
                ...COMMIT_CONFIG,
                'merge',
                '--quiet',
                '--no-edit',
                '--no-ff',
                '-m',
                `Merge ${ref.baseBranch} into ${ref.branch}`,
                input.targetTip,
              ],
              checkout.path,
            );
          } catch {
            const files = await conflictNames(checkout.path);
            await probe(['merge', '--abort'], checkout.path);
            if (files.length === 0) {
              throw new WorkspaceError('git-failed', 'Git could not merge the target');
            }
            return { kind: 'conflict', files, mergeBase };
          }
          const candidate = (
            await out(['rev-parse', '--verify', 'HEAD^{commit}'], checkout.path)
          ).trim();
          await pinIn(repoRoot, input.operationId, candidate);
          return { kind: 'clean', candidate, mergeBase };
        } finally {
          await dropCheckout(checkout).catch((error: unknown) => {
            logger.log('warn', 'workspace.checkout_remove_failed', errorFields(error));
          });
        }
      });
    },

    async pinCandidate(projectRoot, operationId, commit) {
      assertSafeId(operationId, 'operationId');
      assertCommit(commit, 'The candidate');
      const { repoRoot } = await repoOf(projectRoot);
      await serial(repoKey(repoRoot), () => pinIn(repoRoot, operationId, commit));
    },

    async dropCandidate(projectRoot, operationId) {
      assertSafeId(operationId, 'operationId');
      const { repoRoot } = await repoOf(projectRoot);
      await serial(repoKey(repoRoot), async () => {
        await probe(['update-ref', '-d', candidateRef(operationId)], repoRoot);
      });
    },

    async combinedPaths(projectRoot, input) {
      assertCommit(input.mergeBase, 'The merge base');
      assertCommit(input.targetCommit, 'The target commit');
      assertCommit(input.candidateCommit, 'The candidate');
      const { repoRoot } = await repoOf(projectRoot);
      const names = async (from: string, to: string) =>
        (await out([...DIFF_BASE, '-z', '--name-only', from, to, '--'], repoRoot))
          .split('\0')
          .filter((n) => n !== '');
      const ticket = await names(input.targetCommit, input.candidateCommit);
      const target = await names(input.mergeBase, input.targetCommit);
      return [...new Set([...ticket, ...target])];
    },

    async checkResolution(projectRoot, input) {
      assertCommit(input.commit, 'The resolved commit');
      assertCommit(input.targetCommit, 'The target commit');
      const { repoRoot } = await repoOf(projectRoot);
      const containsTarget = await test(
        ['merge-base', '--is-ancestor', input.targetCommit, input.commit],
        repoRoot,
      );
      const files = input.files.filter((f) => f !== '' && !f.startsWith('-'));
      if (files.length === 0) return { containsTarget, markerFiles: [] };
      // `git grep` exits 1 when nothing matches. Lines that are exactly a marker, as git writes
      // them (`<<<<<<< ours`, `=======`, `>>>>>>> theirs`); never the file content itself.
      const found = await probe(
        [
          'grep',
          '-l',
          '-E',
          '-e',
          '^(<<<<<<<|>>>>>>>)( .*)?$',
          '-e',
          '^=======$',
          input.commit,
          '--',
          ...files,
        ],
        repoRoot,
      );
      const markerFiles = (found ?? '')
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l !== '')
        .map((l) => (l.startsWith(`${input.commit}:`) ? l.slice(input.commit.length + 1) : l));
      return { containsTarget, markerFiles };
    },
  };

  function candidateRef(operationId: string): string {
    return `refs/acp/resolutions/${operationId}`;
  }

  /** Pins a candidate so it survives its temporary checkout; the caller holds the repo's lock. */
  async function pinIn(repoRoot: string, operationId: string, commit: string): Promise<void> {
    await run(
      ['update-ref', '-m', 'acp: resolution candidate', candidateRef(operationId), commit],
      repoRoot,
    );
  }

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
    await refuseCommittedCopies(w, tip);
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
