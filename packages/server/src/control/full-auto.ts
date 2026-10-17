import { mkdir, readdir, realpath, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { FullAutoSpec } from '@acp/core';
import { isSafeId } from '../workspace/index.js';

/**
 * Full auto's server side (ADR-0022): the per-run temporary folder a sandboxed helper may write,
 * and the paths its sandboxed commands may not read. Both are absolute and come from the server's
 * configuration (the user's home, the app's data folder, Claude's config folder), never from a run
 * or an agent.
 */

/** Folders under the user's home that hold credentials (owner decision 2026-10-17). */
export const HOME_SECRET_DIRS: readonly string[] = [
  '.ssh',
  '.aws',
  '.gnupg',
  '.config/gh',
  '.netrc',
  '.docker',
  '.kube',
  '.claude',
];

/** `<dataDir>/sandbox-tmp/<runId>`: one folder per run, removed when the run ends. */
export const SANDBOX_TMP_DIR = 'sandbox-tmp';

export interface FullAutoPathsDeps {
  homeDir: string;
  dataDir: string;
  /** Claude Code's config folder when it is not `~/.claude` (`CLAUDE_CONFIG_DIR`). */
  claudeDir?: string;
}

export interface FullAutoPaths {
  /**
   * The sandbox paths of one Full auto agent of the run: the run's temp folder, created on first
   * use (mode 0700) and resolved through symlinks, and the deny-read list.
   */
  specFor(runId: string): Promise<FullAutoSpec>;
  /** Removes the run's temp folder (the run ended). Idempotent. */
  remove(runId: string): Promise<void>;
  /** On start: no agent is live, so every run's temp folder is removed. Returns how many. */
  cleanupAll(): Promise<number>;
}

/**
 * The deny-read list: the home secret folders, the app's data folder and Claude's config folder,
 * each as given and, when it exists and differs, as resolved through symlinks (macOS `/var` is
 * `/private/var`), so the sandbox matches either spelling.
 */
export async function fullAutoDenyRead(deps: FullAutoPathsDeps): Promise<string[]> {
  const given = [
    ...HOME_SECRET_DIRS.map((d) => resolve(deps.homeDir, d)),
    resolve(deps.dataDir),
    ...(deps.claudeDir !== undefined ? [resolve(deps.claudeDir)] : []),
  ];
  const out: string[] = [];
  for (const path of given) {
    if (!out.includes(path)) out.push(path);
    const real = await realpath(path).catch(() => null);
    if (real !== null && !out.includes(real)) out.push(real);
  }
  return out;
}

export function createFullAutoPaths(deps: FullAutoPathsDeps): FullAutoPaths {
  const root = join(resolve(deps.dataDir), SANDBOX_TMP_DIR);
  let denyRead: Promise<string[]> | undefined;

  function dirOf(runId: string): string {
    if (!isSafeId(runId)) throw new Error('unsafe run id for the sandbox temp folder');
    return join(root, runId);
  }

  return {
    async specFor(runId) {
      const dir = dirOf(runId);
      await mkdir(dir, { recursive: true, mode: 0o700 });
      const tempDir = await realpath(dir);
      denyRead ??= fullAutoDenyRead(deps);
      return { tempDir, denyRead: await denyRead };
    },

    async remove(runId) {
      await rm(dirOf(runId), { recursive: true, force: true });
    },

    async cleanupAll() {
      let entries;
      try {
        entries = await readdir(root, { withFileTypes: true });
      } catch (error) {
        if ((error as { code?: unknown }).code === 'ENOENT') return 0;
        throw error;
      }
      let removed = 0;
      for (const entry of entries) {
        // Anything this module would not have created is left alone.
        if (!entry.isDirectory() || !isSafeId(entry.name)) continue;
        await rm(join(root, entry.name), { recursive: true, force: true });
        removed++;
      }
      return removed;
    },
  };
}

/** What a Full auto helper or tester is told when something still reaches the gate. */
export const FULL_AUTO_DENIED_MESSAGE =
  "Full auto: Claude Code's auto mode did not approve this action, and the owner is not asked during this run. Do it another way inside your folder, or leave it out and say so in your summary; the owner reviews everything at the final merge.";
