import { realpath } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import type { AgentRoleKind, HarnessCheck, ProjectAllowlist } from '@acp/core';
import { evaluateAllowlist, type AllowlistTarget, type AllowlistVerdict } from '@acp/orchestrator';
import type { Workspace } from '../workspace/index.js';

/**
 * The server half of the project allowlist (ADR-0013 amendment). The engine's
 * `evaluateAllowlist` is pure; here the paths it needs are resolved on disk first (P4-A handoff:
 * realpath **before** evaluating), so a symlink inside the worktree can never point an
 * auto-approved edit outside it. Anything that cannot be resolved asks the owner.
 */

export interface AllowlistContext {
  allowlist: ProjectAllowlist;
  /**
   * The harness checks read from the **project's checkout**, never from the agent's worktree: a
   * manifest the agent edited is code under review and must not widen what runs unasked.
   */
  checks: readonly Pick<HarnessCheck, 'id' | 'argv'>[];
}

export interface AllowlistVerdictInput {
  target: AllowlistTarget;
  context: AllowlistContext;
  /** The helper's own worktree; null when it has none (then edits ask). */
  workspace: Pick<Workspace, 'path' | 'cwd'> | null;
  /** The asking agent's real role (ADR-0019: the tester is covered like a helper). Default worker. */
  agentKind?: AgentRoleKind;
}

/**
 * The real path of an edit target: the file itself when it exists, else the real path of its
 * existing parent folder plus the new file's name. A relative path is taken from the agent's cwd.
 * Null when neither exists or the name is not a plain file name.
 */
export async function resolveEditTarget(path: string, cwd: string): Promise<string | null> {
  if (path.includes('\0')) return null;
  const absolute = isAbsolute(path) ? path : resolve(cwd, path);
  try {
    return await realpath(absolute);
  } catch {
    // A new file: resolve the folder it would be created in.
  }
  const name = basename(absolute);
  if (name === '' || name === '.' || name === '..') return null;
  try {
    return join(await realpath(dirname(absolute)), name);
  } catch {
    return null;
  }
}

async function realOrNull(path: string): Promise<string | null> {
  try {
    return await realpath(path);
  } catch {
    return null;
  }
}

/** Resolves what the engine needs and asks it for a verdict (helpers and the tester). */
export async function allowlistVerdict(input: AllowlistVerdictInput): Promise<AllowlistVerdict> {
  const { target, context, workspace } = input;
  const worktreeRoot = workspace === null ? null : await realOrNull(workspace.path);
  const resolvedPath =
    target.kind === 'edit' && workspace !== null
      ? await resolveEditTarget(target.path, workspace.cwd)
      : null;
  return evaluateAllowlist({
    allowlist: context.allowlist,
    agentKind: input.agentKind ?? 'worker',
    target,
    resolvedPath,
    worktreeRoot,
    checks: context.checks,
  });
}
