import path from 'node:path';
import type { FullAutoSpec, ManagedAgentSpec, ManagedFailureCode } from '@acp/core';
import type { Options, SandboxSettings } from '@anthropic-ai/claude-agent-sdk';

/**
 * Full auto (ADR-0022): a helper or the tester runs in Claude Code's own auto mode (a classifier
 * model reviews risky actions; in-project reads and edits skip it), and every shell command runs
 * in the operating-system sandbox. Checked against SDK 0.3.296 (`Options.permissionMode`,
 * `Options.sandbox`, `SandboxSettings`):
 * - `enabled` + `failIfUnavailable`: the CLI exits with an error result instead of running
 *   commands unsandboxed when the sandbox cannot start;
 * - `allowUnsandboxedCommands: false`: the `dangerouslyDisableSandbox` parameter is ignored, so no
 *   command can retry outside the sandbox;
 * - `autoAllowBashIfSandboxed: false` (it defaults to true): a sandboxed command is still reviewed
 *   by auto mode's classifier, so both layers apply to every command;
 * - `filesystem.allowWrite`: only the agent's own worktree and the run's temp folder;
 *   `filesystem.denyRead`: the server's list (secrets, the app's data folder, Claude's config);
 *   `filesystem.allowRead` re-opens the worktree and the temp folder, which live inside the app's
 *   data folder; `filesystem.denyWrite` keeps commands off the worktree's `.git` (its pointer to
 *   the repository) and `.claude`, as the Auto edits rule does for edits (ADR-0021);
 * - no `network` block: sandboxed network access goes through Claude Code's proxy and auto mode's
 *   classifier decides on new hosts (owner decision 2026-10-17; no hard allowlist).
 * The sandbox covers shell commands only. The built-in Read and Edit tools get path-scoped deny
 * rules (`disallowedTools`) for the deny-read paths that do not contain the agent's own folders, and
 * for the worktree's `.git` and `.claude`; everything else they do is auto mode's to review.
 */

/** True when this spec runs in Full auto: a worker or the tester with `fullAuto`, never a follow-up. */
export function fullAutoOf(spec: ManagedAgentSpec): FullAutoSpec | null {
  if (spec.fullAuto === undefined || spec.followUp !== undefined) return null;
  return spec.kind === 'worker' || spec.kind === 'tester' ? spec.fullAuto : null;
}

/**
 * How one agent's process is protected (ADR-0022, ADR-0023 §5), per agent, never per run:
 * - `autoMode: true`: Claude Code's auto mode plus the OS sandbox (a node whose mode for the run is
 *   Full auto);
 * - `autoMode: false`: the same OS sandbox, deny rules and temp folder, but `permissionMode:
 *   'default'`, so our gate still decides every request by the agent's (tightened) mode: a node
 *   configured as Full auto that a ticket or run tightened keeps its sandbox, since tightening
 *   never removes a protection.
 * Only a worker or the tester is ever protected this way; the lead, the planner, reviewers and
 * follow-up turns always keep `default` with no sandbox.
 */
export interface LaunchProtection {
  autoMode: boolean;
  paths: FullAutoSpec;
}

/**
 * The protection `ManagedAgentSpec` asks for. Today the spec can say only Full auto (`fullAuto`,
 * auto mode plus the sandbox); the sandbox without auto mode needs an additive contract field
 * (proposed in docs/workflow-graph/wp/WG-C.md), which the server does not send until then.
 */
export function launchProtectionOf(spec: ManagedAgentSpec): LaunchProtection | null {
  const fullAuto = fullAutoOf(spec);
  return fullAuto === null ? null : { autoMode: true, paths: fullAuto };
}

/** Folders inside the worktree that commands and edits must not touch (ADR-0021's edit rule). */
const PROTECTED_DIRS: readonly string[] = ['.git', '.claude'];

function protectedPaths(cwd: string): string[] {
  return PROTECTED_DIRS.map((d) => path.join(cwd, d));
}

/** The SDK sandbox block of a Full auto agent (see above). */
export function fullAutoSandbox(cwd: string, fullAuto: FullAutoSpec): SandboxSettings {
  return {
    enabled: true,
    failIfUnavailable: true,
    allowUnsandboxedCommands: false,
    autoAllowBashIfSandboxed: false,
    filesystem: {
      allowWrite: [cwd, fullAuto.tempDir],
      denyWrite: protectedPaths(cwd),
      denyRead: [...fullAuto.denyRead],
      allowRead: [cwd, fullAuto.tempDir],
    },
  };
}

function contains(parent: string, child: string): boolean {
  const rel = path.relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

/**
 * Claude Code permission-rule spelling of an absolute path: `//` followed by the path without its
 * leading slash (a single `/` would be relative to a settings file).
 */
function rulePath(absolute: string): string {
  return `/${absolute}`;
}

/**
 * Deny rules for the built-in file tools (`disallowedTools`, which take precedence over auto mode):
 * - `Read` and `Edit` of every deny-read path that does not hold the agent's own worktree or temp
 *   folder (the app's data folder holds both, so it stays with the sandbox and the classifier);
 * - `Edit` of the worktree's `.git` and `.claude`.
 * `Read` rules cover Grep and Glob as well; `Edit` rules cover every editing tool.
 */
export function fullAutoDenyRules(cwd: string, fullAuto: FullAutoSpec): string[] {
  const rules: string[] = [];
  for (const denied of fullAuto.denyRead) {
    if (contains(denied, cwd) || contains(denied, fullAuto.tempDir)) continue;
    rules.push(`Read(${rulePath(denied)}/**)`, `Edit(${rulePath(denied)}/**)`);
  }
  for (const dir of protectedPaths(cwd)) {
    rules.push(`Edit(${rulePath(dir)})`, `Edit(${rulePath(dir)}/**)`);
  }
  return rules;
}

/**
 * Applies a worker's or tester's protection to its options (ADR-0022, ADR-0023 §5): the sandbox,
 * the file-tool deny rules and `TMPDIR` pointing at the run's temp folder (writable in the
 * sandbox), plus auto mode only when `autoMode`; otherwise the session stays in `default`. Never
 * `bypassPermissions`, never `allowedTools`; `canUseTool` stays. In auto mode the server denies
 * whatever still reaches it without asking the owner; in `default` the server's gate decides as
 * for any agent of that mode.
 */
export function applyProtection(
  options: Options,
  spec: ManagedAgentSpec,
  protection: LaunchProtection,
  env: Readonly<Record<string, string>> | undefined,
): void {
  const paths = protection.paths;
  options.permissionMode = protection.autoMode ? 'auto' : 'default';
  options.sandbox = fullAutoSandbox(spec.cwd, paths);
  options.disallowedTools = [
    ...(options.disallowedTools ?? []),
    ...fullAutoDenyRules(spec.cwd, paths),
  ];
  options.env = { ...(env ?? inheritedEnv()), TMPDIR: paths.tempDir };
}

/** Full auto (ADR-0022): auto mode plus the sandbox. */
export function applyFullAuto(
  options: Options,
  spec: ManagedAgentSpec,
  fullAuto: FullAutoSpec,
  env: Readonly<Record<string, string>> | undefined,
): void {
  applyProtection(options, spec, { autoMode: true, paths: fullAuto }, env);
}

/** The process environment as the SDK would inherit it, without unset entries. */
function inheritedEnv(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined) out[k] = v;
  return out;
}

const SANDBOX_WORDS = /sandbox|bubblewrap|seatbelt/i;
const AUTO_MODE_WORDS = /auto[ -]mode|permission mode/i;

/**
 * Why a Full auto agent's error means its protections were unavailable, from the CLI's error
 * strings (read only to classify; never kept or logged): the sandbox, or auto mode. Null when the
 * text says neither (an ordinary failure).
 */
export function classifyStartupError(texts: readonly string[]): ManagedFailureCode | null {
  if (texts.some((t) => SANDBOX_WORDS.test(t))) return 'sandbox-unavailable';
  if (texts.some((t) => AUTO_MODE_WORDS.test(t))) return 'auto-mode-unavailable';
  return null;
}
