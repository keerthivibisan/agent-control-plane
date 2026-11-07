import { isFollowUp } from '@acp/core';
import type { ApprovalMode, ManagedAgentSpec } from '@acp/core';

/** Codex's thread sandbox (`SandboxMode`, CLI 0.166.0). ACP never uses `danger-full-access`. */
export type CodexSandboxMode = 'read-only' | 'workspace-write';
/** Codex's approval policy (`AskForApproval`); ACP never uses the `granular` form. */
export type CodexApprovalPolicy = 'untrusted' | 'on-request' | 'never';

/** The turn's `SandboxPolicy` for a writing agent (the only form ACP sends). */
export interface WorkspaceWritePolicy {
  type: 'workspaceWrite';
  writableRoots: string[];
  networkAccess: false;
  excludeTmpdirEnvVar: true;
  excludeSlashTmp: true;
}

export interface CodexModes {
  sandbox: CodexSandboxMode;
  approvalPolicy: CodexApprovalPolicy;
  /** Set exactly when `sandbox` is `workspace-write`. */
  sandboxPolicy: WorkspaceWritePolicy | null;
}

/**
 * How an agent's role and approval mode become Codex's sandbox and approval policy (ADR-0031 §6):
 *
 * | Agent                                   | Sandbox           | Approval policy |
 * | --------------------------------------- | ----------------- | --------------- |
 * | lead, planner, reviewer, any follow-up  | `read-only`       | `never`         |
 * | worker or tester, `manual` (or absent)  | `read-only`       | `on-request`    |
 * | worker or tester, `auto-edits`          | `workspace-write` | `untrusted`     |
 * | worker or tester, `auto`                | `workspace-write` | `on-request`    |
 * | worker or tester, Full auto (`fullAuto`)| `workspace-write` | `never`         |
 *
 * - Reading roles get `never`: a write simply fails and no escalation can be asked for, which
 *   matches the read-only toolset Claude gives them.
 * - `manual`: every write is a sandbox escalation, which Codex asks about first
 *   (`item/commandExecution/requestApproval`), and the server's gate decides it (CX-1 result 6).
 *   An approved escalation runs outside the sandbox, so the git guard screens it first.
 * - `auto-edits`: edits in the worktree go through; commands outside Codex's trusted read-only
 *   set ask.
 * - `auto`: commands run in the sandbox without asking; only an escalation asks.
 * - Full auto needs `spec.fullAuto` (its temp folder); an `approvalMode` of `full-auto` without it
 *   is read as `auto`, the next tighter row, never as unprotected.
 *
 * Every `workspace-write` turn carries an explicit policy: writable roots are the worktree and the
 * run's temp folder only, without network, and with /tmp and $TMPDIR excluded. Codex's default
 * policy leaves those writable, and a repository there could have its refs moved (CX-1 result 8).
 */
export function codexModes(
  spec: Pick<
    ManagedAgentSpec,
    'kind' | 'cwd' | 'followUp' | 'approvalMode' | 'fullAuto' | 'sandbox'
  >,
): CodexModes {
  const writes = (spec.kind === 'worker' || spec.kind === 'tester') && !isFollowUp(spec);
  if (!writes) return { sandbox: 'read-only', approvalPolicy: 'never', sandboxPolicy: null };
  const mode = effectiveMode(spec);
  if (mode === 'manual') {
    return { sandbox: 'read-only', approvalPolicy: 'on-request', sandboxPolicy: null };
  }
  const approvalPolicy: CodexApprovalPolicy =
    mode === 'auto-edits' ? 'untrusted' : mode === 'auto' ? 'on-request' : 'never';
  return { sandbox: 'workspace-write', approvalPolicy, sandboxPolicy: writePolicy(spec) };
}

function effectiveMode(spec: Pick<ManagedAgentSpec, 'approvalMode' | 'fullAuto'>): ApprovalMode {
  if (spec.fullAuto !== undefined) return 'full-auto';
  const mode = spec.approvalMode ?? 'manual';
  return mode === 'full-auto' ? 'auto' : mode;
}

/** The run's temp folder of a Full auto or tightened agent, if any. */
export function tempDirOf(spec: Pick<ManagedAgentSpec, 'fullAuto' | 'sandbox'>): string | null {
  return spec.fullAuto?.tempDir ?? spec.sandbox?.tempDir ?? null;
}

function writePolicy(
  spec: Pick<ManagedAgentSpec, 'cwd' | 'fullAuto' | 'sandbox'>,
): WorkspaceWritePolicy {
  const tempDir = tempDirOf(spec);
  return {
    type: 'workspaceWrite',
    writableRoots: tempDir === null ? [spec.cwd] : [spec.cwd, tempDir],
    networkAccess: false,
    excludeTmpdirEnvVar: true,
    excludeSlashTmp: true,
  };
}
