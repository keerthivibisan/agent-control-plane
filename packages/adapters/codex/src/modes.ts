import path from 'node:path';
import { isFollowUp } from '@acp/core';
import type { ApprovalMode, ManagedAgentSpec } from '@acp/core';

/** Codex's approval policy (`AskForApproval`); ACP never uses the `granular` form. */
export type CodexApprovalPolicy = 'untrusted' | 'on-request' | 'never';

/** The built-in permission profile an ACP profile extends (Codex permissions, beta). */
export type CodexProfileBase = ':workspace' | ':read-only';
/** One filesystem entry's access. More specific paths override broader ones. */
export type CodexFsAccess = 'read' | 'write' | 'deny';

/** Codex's special filesystem keys for the temp folders (`$TMPDIR` and `/tmp`). */
export const TMPDIR_KEY = ':tmpdir';
export const SLASH_TMP_KEY = ':slash_tmp';

/** The profile ids ACP defines. Fixed words, so they are safe as bare TOML keys. */
export const WRITE_PROFILE_ID = 'acp-write';
export const READ_PROFILE_ID = 'acp-read';

/**
 * One agent's permission profile (CX-1b, docs/research/codex-app-server-2026-11-07.md). Defined at
 * spawn with `-c` (`codexArgs`) and selected by `thread/start`'s `permissions` field, with no
 * legacy `sandbox` field (which would override it).
 */
export interface CodexProfile {
  id: typeof WRITE_PROFILE_ID | typeof READ_PROFILE_ID;
  extends: CodexProfileBase;
  /** Path (absolute, or a `:` special key) to access, in the order the entries are written. */
  filesystem: Record<string, CodexFsAccess>;
}

export interface CodexModes {
  approvalPolicy: CodexApprovalPolicy;
  profile: CodexProfile;
}

/**
 * How an agent's role and approval mode become Codex's permission profile and approval policy
 * (ADR-0031 §6, CX-3b):
 *
 * | Agent                                   | Profile extends | Approval policy |
 * | --------------------------------------- | --------------- | --------------- |
 * | lead, planner, reviewer, researcher,    | `:read-only`    | `never`         |
 * | any follow-up                           |                 |                 |
 * | worker or tester, `manual` (or absent)  | `:read-only`    | `on-request`    |
 * | worker or tester, `auto-edits`          | `:workspace`    | `untrusted`     |
 * | worker or tester, `auto`                | `:workspace`    | `on-request`    |
 * | worker or tester, Full auto (`fullAuto`)| `:workspace`    | `never`         |
 *
 * - Reading roles get `never`: a write simply fails and no escalation can be asked for, which
 *   matches the read-only toolset Claude gives them.
 * - `manual`: every write is an escalation, which Codex asks about first and the server's gate
 *   decides (CX-1 result 6). An approved escalation runs outside the sandbox, so the git guard
 *   screens it first.
 * - Full auto needs `spec.fullAuto` (its temp folder); an `approvalMode` of `full-auto` without it
 *   is read as `auto`, the next tighter row, never as unprotected.
 *
 * The filesystem entries (`profileFilesystem`) deny reads of the server's deny list for every
 * role, which Codex's legacy sandbox could not do.
 */
export function codexModes(
  spec: Pick<
    ManagedAgentSpec,
    | 'kind'
    | 'cwd'
    | 'followUp'
    | 'approvalMode'
    | 'fullAuto'
    | 'sandbox'
    | 'denyRead'
    | 'readOnlyDirs'
  >,
  hostTmpDirs: readonly string[] = [],
): CodexModes {
  const writes = (spec.kind === 'worker' || spec.kind === 'tester') && !isFollowUp(spec);
  const mode = writes ? effectiveMode(spec) : null;
  const base: CodexProfileBase = mode === null || mode === 'manual' ? ':read-only' : ':workspace';
  const approvalPolicy: CodexApprovalPolicy =
    mode === null
      ? 'never'
      : mode === 'manual' || mode === 'auto'
        ? 'on-request'
        : mode === 'auto-edits'
          ? 'untrusted'
          : 'never';
  return {
    approvalPolicy,
    profile: {
      id: base === ':workspace' ? WRITE_PROFILE_ID : READ_PROFILE_ID,
      extends: base,
      filesystem: profileFilesystem(spec, base, hostTmpDirs),
    },
  };
}

function effectiveMode(spec: Pick<ManagedAgentSpec, 'approvalMode' | 'fullAuto'>): ApprovalMode {
  if (spec.fullAuto !== undefined) return 'full-auto';
  const mode = spec.approvalMode ?? 'manual';
  return mode === 'full-auto' ? 'auto' : mode;
}

/**
 * The run's temp folder of a Full auto or tightened agent, if any. Only an editing role (helper or
 * tester) ever gets it (AR-6): the server sets `fullAuto` and `sandbox` for those alone, and a
 * read-only role (planner, researcher, reviewer, lead) that somehow carried one must not gain a
 * writable folder from it, whatever its arrows say (ADR-0037 §1).
 */
export function tempDirOf(
  spec: Pick<ManagedAgentSpec, 'kind' | 'fullAuto' | 'sandbox'>,
): string | null {
  if (!isEditingKind(spec.kind)) return null;
  return spec.fullAuto?.tempDir ?? spec.sandbox?.tempDir ?? null;
}

function isEditingKind(kind: ManagedAgentSpec['kind']): boolean {
  return kind === 'worker' || kind === 'tester';
}

/**
 * The profile's filesystem entries, in this order:
 * 1. `deny`: every path of `spec.denyRead`, `fullAuto.denyRead` and `sandbox.denyRead`;
 * 2. `deny`: `/tmp` (`:slash_tmp`) and the temp folder. Without a run temp folder that is
 *    `:tmpdir`. With one, the agent's `TMPDIR` IS the run temp folder, so `:tmpdir` would name the
 *    folder that must stay writable; the host's temp folders (`hostTmpDirs`) are denied by path
 *    instead. A repository there could otherwise have its refs moved (CX-1 result 8);
 * 3. `read`: the repository's git directories (`gitDirs`, F-1): git status and diff read them,
 *    and only the app writes them;
 * 4. `read`: the read-only folders (`readOnlyDirs`, ADR-0026 §4);
 * 5. the agent's folder: `write` (with its `.git` kept `read`) for a `:workspace` profile, else
 *    `read`. Workers' worktrees and reviewers' checkouts live in the app's data folder, which is
 *    denied, so the folder is re-opened by a more specific entry, as Claude's `allowRead` does;
 * 6. `write`: the run's temp folder, which also lives in the app's data folder. Editing roles
 *    only (`tempDirOf`); any other role is treated as having no temp folder.
 * Codex applies the most specific entry, so 3 to 6 win over a broader deny. On the same exact path
 * the first entry stays, so a deny is never loosened.
 */
export function profileFilesystem(
  spec: Pick<
    ManagedAgentSpec,
    'kind' | 'cwd' | 'fullAuto' | 'sandbox' | 'denyRead' | 'readOnlyDirs'
  >,
  base: CodexProfileBase,
  hostTmpDirs: readonly string[] = [],
): Record<string, CodexFsAccess> {
  const entries: Record<string, CodexFsAccess> = {};
  const add = (key: string, access: CodexFsAccess): void => {
    if (!Object.hasOwn(entries, key)) entries[key] = access;
  };
  const tempDir = tempDirOf(spec);
  for (const denied of [
    ...(spec.denyRead ?? []),
    ...(spec.fullAuto?.denyRead ?? []),
    ...(spec.sandbox?.denyRead ?? []),
  ]) {
    add(denied, 'deny');
  }
  add(SLASH_TMP_KEY, 'deny');
  if (tempDir === null) add(TMPDIR_KEY, 'deny');
  else for (const dir of hostTmpDirs) if (dir !== tempDir) add(dir, 'deny');
  for (const dir of [...(spec.fullAuto?.gitDirs ?? []), ...(spec.sandbox?.gitDirs ?? [])]) {
    add(dir, 'read');
  }
  for (const dir of spec.readOnlyDirs ?? []) add(dir, 'read');
  if (base === ':workspace') {
    add(path.join(spec.cwd, '.git'), 'read');
    add(spec.cwd, 'write');
  } else {
    add(spec.cwd, 'read');
  }
  if (tempDir !== null) add(tempDir, 'write');
  return entries;
}
