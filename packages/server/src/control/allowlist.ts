import { lstat, realpath } from 'node:fs/promises';
import { dirname, isAbsolute, join, sep } from 'node:path';
import type { AgentRoleKind, HarnessCheck, ProjectAllowlist, ProjectApprovals } from '@acp/core';
import { evaluateAllowlist, type AllowlistTarget, type AllowlistVerdict } from '@acp/orchestrator';
import type { Workspace } from '../workspace/index.js';

/**
 * The server half of the project allowlist (ADR-0013 amendment). The engine's
 * `evaluateAllowlist` is pure; here the paths it needs are resolved on disk first (P4-A handoff:
 * realpath **before** evaluating), so a symlink inside the worktree can never point an
 * auto-approved edit outside it. Anything that cannot be resolved asks the owner.
 */

export interface AllowlistContext {
  /** The legacy project allowlist (runs without an approval policy). */
  allowlist?: ProjectAllowlist;
  /**
   * ADR-0021: the run's snapshotted approval mode and command allowlist. When present it decides
   * (the engine checks the rule against it again and records it).
   */
  policy?: ProjectApprovals;
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
 * The real path of an edit target. A relative path is taken from the agent's cwd.
 *
 * - An existing file resolves to its own real path.
 * - A new file resolves through its **nearest existing ancestor**: that folder's real path plus
 *   the segments still to be created (RL-F: a helper writing `src/slug.mjs` into a worktree with
 *   no `src/` yet must not be asked). Each segment still to be created must be a plain name: an
 *   empty, `.` or `..` segment is refused, since its meaning depends on folders that do not exist.
 * - Something that exists but cannot be resolved (a dangling symlink, a loop, no permission) is
 *   refused: writing through a dangling symlink creates its target, wherever that is.
 *
 * The path is not normalized lexically first: `link/..` must mean what the OS makes of it (the
 * parent of the link's target), not the folder that holds the link.
 * Null when it cannot be resolved; the caller then asks the owner.
 */
export async function resolveEditTarget(path: string, cwd: string): Promise<string | null> {
  if (path === '' || path.includes('\0') || cwd.includes('\0')) return null;
  const absolute = isAbsolute(path) ? path : `${cwd.endsWith(sep) ? cwd : cwd + sep}${path}`;
  const missing: string[] = [];
  let current = absolute;
  for (;;) {
    const found = await resolveExisting(current);
    if (found === null) return null;
    if (found !== 'missing') return join(found.real, ...missing);
    const parent = dirname(current);
    if (parent === current) return null;
    // The raw text below the parent, not `basename`: that drops trailing separators, and a
    // trailing or doubled separator must be refused like an empty segment.
    const segment = current.slice(parent.length).replace(/^\//, '');
    if (!isPlainSegment(segment)) return null;
    missing.unshift(segment);
    current = parent;
  }
}

function isPlainSegment(segment: string): boolean {
  return segment !== '' && segment !== '.' && segment !== '..' && !segment.includes('/');
}

/**
 * The real path; `missing` only when nothing at all is there (not even a dangling link); null
 * when something is there that cannot be resolved.
 */
async function resolveExisting(path: string): Promise<{ real: string } | 'missing' | null> {
  try {
    return { real: await realpath(path) };
  } catch (error) {
    if (errorCode(error) !== 'ENOENT') return null;
  }
  try {
    await lstat(path);
    return null;
  } catch (error) {
    return errorCode(error) === 'ENOENT' ? 'missing' : null;
  }
}

function errorCode(error: unknown): unknown {
  return typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined;
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
    ...(context.policy !== undefined && { policy: context.policy }),
    ...(context.allowlist !== undefined && { allowlist: context.allowlist }),
    agentKind: input.agentKind ?? 'worker',
    target,
    resolvedPath,
    worktreeRoot,
    checks: context.checks,
  });
}
