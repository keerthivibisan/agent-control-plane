import { randomUUID } from 'node:crypto';
import { mkdir, readdir, realpath, rm, stat } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import type { CheckRun, HarnessStatus, SetupRun } from '@acp/core';
import { errorFields, silentLogger, type Logger } from '../logger.js';
import {
  GitCommandError,
  SAFE_GIT_CONFIG,
  createGitRunner,
  isSafeId,
  type GitRunner,
} from '../workspace/index.js';
import { HarnessError } from './errors.js';
import { readHarness } from './manifest.js';
import { realDirectory } from './paths.js';
import { checksNotRun, type CheckRunner } from './runner.js';

/**
 * "Run checks now" on the main branch (README §5.4, ADR-0017 §3). The owner's working tree is
 * never used: the project's committed HEAD is checked out into a temporary **detached** worktree
 * under `<dataDir>/harness-checks/<id>`, the manifest is read from that commit, the checks run
 * there, and the worktree is removed afterwards, whatever happened. Git calls use the workspace
 * manager's runner and safety config (no hooks, no fsmonitor, no submodules).
 *
 * ADR-0027 §1: the manifest's setup steps run in that checkout first; when one does not pass,
 * every check is recorded as not run, with the reason.
 */

export interface MainChecksDeps {
  dataDir: string;
  runner: CheckRunner;
  git?: GitRunner;
  now?: () => Date;
  newId?: () => string;
  logger?: Logger;
}

export interface RunOnMainInput {
  /** The registered project folder (may be a subfolder of its repository). */
  projectRoot: string;
  projectId: string;
  signal?: AbortSignal;
  onResult?: (result: CheckRun) => void;
  /** ADR-0027 §2: the project's "Setup may use the network" switch (absent: off). */
  setupNetwork?: boolean;
  /** Called as each setup step finishes. */
  onSetupResult?: (result: SetupRun) => void;
}

export interface MainChecksResult {
  /** Harness status of the commit that was checked. */
  status: HarnessStatus;
  /** The commit the checks ran on. */
  commit: string;
  /** Empty when the manifest at that commit is missing or invalid. */
  results: CheckRun[];
  /** ADR-0027: the setup steps tried before the checks, in order (empty without any). */
  setupRuns: SetupRun[];
}

export interface MainChecks {
  run(input: RunOnMainInput): Promise<MainChecksResult>;
  /** On start: removes temporary checkouts a crash left behind. Returns how many were removed. */
  cleanupOrphans(): Promise<number>;
}

const DIR_NAME = 'harness-checks';

export function createMainChecks(deps: MainChecksDeps): MainChecks {
  if (!isAbsolute(deps.dataDir)) {
    throw new HarnessError('invalid-root', 'dataDir must be an absolute path');
  }
  const git = deps.git ?? createGitRunner();
  const newId = deps.newId ?? randomUUID;
  const logger = deps.logger ?? silentLogger;

  const run = (args: readonly string[], cwd: string) => git([...SAFE_GIT_CONFIG, ...args], { cwd });
  async function probe(args: readonly string[], cwd: string): Promise<string | null> {
    try {
      return (await run(args, cwd)).stdout.trim();
    } catch (error) {
      if (error instanceof GitCommandError) return null;
      throw error;
    }
  }

  async function checksRoot(): Promise<string> {
    const dir = join(deps.dataDir, DIR_NAME);
    await mkdir(dir, { recursive: true });
    return realpath(dir);
  }

  async function removeCheckout(repoCwd: string | null, path: string): Promise<void> {
    if (repoCwd !== null) {
      try {
        await run(['worktree', 'remove', '--force', '--force', path], repoCwd);
      } catch (error) {
        logger.log('warn', 'harness.worktree_remove_failed', errorFields(error));
      }
    }
    // Only ever a path directly under `<dataDir>/harness-checks` (built or enumerated here).
    await rm(path, { recursive: true, force: true });
    if (repoCwd !== null) await probe(['worktree', 'prune'], repoCwd);
  }

  return {
    async run(input) {
      const project = await realDirectory(input.projectRoot);
      const top = await probe(['rev-parse', '--show-toplevel'], project);
      if (top === null || top === '') {
        throw new HarnessError('not-a-git-repo', 'The project is not inside a git repository');
      }
      const repoRoot = await realpath(top);
      const commit = await probe(['rev-parse', '--verify', '--quiet', 'HEAD^{commit}'], repoRoot);
      if (commit === null || !/^[0-9a-f]{40}(?:[0-9a-f]{24})?$/.test(commit)) {
        throw new HarnessError('no-commits', 'The project has no commits yet');
      }

      const id = newId();
      if (!isSafeId(id)) throw new HarnessError('git-failed', 'Unsafe temporary checkout id');
      const path = join(await checksRoot(), id);
      try {
        await run(['worktree', 'add', '--quiet', '--detach', path, commit], repoRoot);
      } catch (error) {
        await removeCheckout(repoRoot, path);
        throw new HarnessError(
          'git-failed',
          `Could not prepare a temporary checkout of the main branch (${errorFields(error).errorName})`,
        );
      }
      try {
        const harness = await readHarness(path, deps.now ? { now: deps.now } : {});
        if (harness.manifest === null) {
          return { status: harness.status, commit, results: [], setupRuns: [] };
        }
        const steps = harness.manifest.setup ?? [];
        const setupRuns =
          steps.length === 0
            ? []
            : await deps.runner.runSetup({
                root: path,
                steps,
                networkAllowed: input.setupNetwork === true,
                projectId: input.projectId,
                runId: null,
                agentRunId: null,
                commit,
                ...(input.signal ? { signal: input.signal } : {}),
                ...(input.onSetupResult ? { onResult: input.onSetupResult } : {}),
              });
        const failedStep = setupRuns.find((r) => r.status !== 'passed');
        if (failedStep !== undefined) {
          const results = checksNotRun(
            {
              checks: harness.manifest.checks,
              projectId: input.projectId,
              runId: null,
              agentRunId: null,
            },
            failedStep,
            deps.now,
            newId,
          );
          for (const r of results) input.onResult?.(r);
          return { status: harness.status, commit, results, setupRuns };
        }
        const results = await deps.runner.run({
          root: path,
          checks: harness.manifest.checks,
          projectId: input.projectId,
          runId: null,
          agentRunId: null,
          ...(input.signal ? { signal: input.signal } : {}),
          ...(input.onResult ? { onResult: input.onResult } : {}),
        });
        return { status: harness.status, commit, results, setupRuns };
      } finally {
        await removeCheckout(repoRoot, path);
      }
    },

    async cleanupOrphans() {
      const root = await checksRoot();
      let removed = 0;
      for (const entry of await readdir(root, { withFileTypes: true })) {
        // Anything this module would not have created is left alone.
        if (!entry.isDirectory() || !isSafeId(entry.name)) continue;
        const path = join(root, entry.name);
        try {
          // Ask git about the checkout only if it is the top of a worktree; otherwise git would
          // search parent folders and could answer for an unrelated repository.
          const top = await probe(['rev-parse', '--show-toplevel'], path);
          const isCheckout = top !== null && top !== '' && (await realpath(top)) === path;
          const common = isCheckout
            ? await probe(['rev-parse', '--path-format=absolute', '--git-common-dir'], path)
            : null;
          await removeCheckout(common !== null && (await exists(common)) ? common : null, path);
          removed++;
        } catch (error) {
          logger.log('warn', 'harness.orphan_cleanup_failed', errorFields(error));
        }
      }
      return removed;
    },
  };
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}
