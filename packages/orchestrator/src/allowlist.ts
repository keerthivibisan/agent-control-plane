import { z } from 'zod';
import {
  BARE_COMMAND_PATTERN,
  CommandPatternSchema,
  FORBIDDEN_ALLOWLIST_COMMANDS,
  GIT_READ_ONLY_SUBCOMMANDS,
  isForbiddenGitOption,
  isSafeCommandToken,
} from '@acp/core';
import type {
  AgentRoleKind,
  AllowRule,
  ApprovalMode,
  CommandPattern,
  HarnessCheck,
  ProjectAllowlist,
  ProjectApprovals,
} from '@acp/core';
import { hasReviewableChange } from './stages.js';

/**
 * Pre-approved safe actions: the per-project allowlist (ADR-0013 amendment) and, from ADR-0021,
 * the run's approval mode and command allowlist. Pure: the server resolves real paths (realpath,
 * so symlinks cannot escape) and reads the harness manifest, then asks this module for a verdict
 * and passes it to `requestPermission`, which checks it again against the run's mode. Everything
 * not allowed here still asks the owner. The rules fail closed: anything unusual is "ask".
 */

export const EDIT_TOOL_NAMES = ['Edit', 'Write', 'MultiEdit', 'NotebookEdit'] as const;

/** What a tool call would touch, extracted from its raw input. */
export type AllowlistTarget =
  | { kind: 'edit'; toolName: (typeof EDIT_TOOL_NAMES)[number]; path: string }
  | { kind: 'bash'; command: string };

const FilePathInput = z.object({ file_path: z.string().min(1) });
const NotebookInput = z.object({ notebook_path: z.string().min(1) });
const BashInput = z.object({
  command: z.string().min(1),
  run_in_background: z.boolean().optional(),
});

/**
 * Reads the target of an Edit/Write/MultiEdit/NotebookEdit (its path) or Bash (its command) call.
 * Null for every other tool and for input that does not parse; those always ask the owner. The
 * returned path is as the agent wrote it: the server must realpath it before `evaluateAllowlist`.
 */
export function allowlistTarget(toolName: string, input: unknown): AllowlistTarget | null {
  switch (toolName) {
    case 'Edit':
    case 'Write':
    case 'MultiEdit': {
      const parsed = FilePathInput.safeParse(input);
      return parsed.success ? { kind: 'edit', toolName, path: parsed.data.file_path } : null;
    }
    case 'NotebookEdit': {
      const parsed = NotebookInput.safeParse(input);
      return parsed.success ? { kind: 'edit', toolName, path: parsed.data.notebook_path } : null;
    }
    case 'Bash': {
      const parsed = BashInput.safeParse(input);
      // A background command is not a check run the owner can follow; ask.
      if (!parsed.success || parsed.data.run_in_background === true) return null;
      return { kind: 'bash', command: parsed.data.command };
    }
    default:
      return null;
  }
}

/** Directories inside a worktree that are never auto-approved: git internals and Claude config. */
const PROTECTED_SEGMENTS: ReadonlySet<string> = new Set(['.git', '.claude']);

/** An absolute POSIX path with no `.`/`..`/empty segments, no backslash and no NUL. */
function normalizedSegments(path: string): string[] | null {
  if (!path.startsWith('/') || path.includes('\\') || path.includes('\0')) return null;
  const trimmed = path.length > 1 && path.endsWith('/') ? path.slice(0, -1) : path;
  const segments = trimmed.split('/').slice(1);
  if (trimmed === '/') return [];
  if (segments.some((s) => s === '' || s === '.' || s === '..')) return null;
  return segments;
}

/**
 * True when `path` lies strictly inside `root`. Both must already be real (symlink-free) absolute
 * paths; anything not in normal form is rejected rather than normalised here.
 */
export function isPathInside(path: string, root: string): boolean {
  const p = normalizedSegments(path);
  const r = normalizedSegments(root);
  if (p === null || r === null || r.length === 0 || p.length <= r.length) return false;
  return r.every((seg, i) => p[i] === seg);
}

/** Characters a check token may hold so that joining by spaces is exact and shell-inert. */
const SAFE_TOKEN = /^[A-Za-z0-9._/:=@+%,-]+$/;
const BARE_COMMAND = /^[a-z0-9][a-z0-9._-]*$/;

/**
 * The exact command line that runs a check: argv joined by single spaces. Null when any token
 * would need quoting or holds a shell metacharacter; such a check is never auto-approved.
 */
export function checkCommandLine(argv: readonly string[]): string | null {
  if (argv.length === 0 || !BARE_COMMAND.test(argv[0] ?? '')) return null;
  return argv.every((t) => SAFE_TOKEN.test(t)) ? argv.join(' ') : null;
}

/** Why an action ran without asking; the same strings as core's `AllowRule` (ADR-0021). */
export type AllowlistRule = AllowRule;

export type AllowlistVerdict =
  | { allowed: true; rule: AllowlistRule; checkId?: string; pattern?: CommandPattern }
  | { allowed: false; reason: string };

/**
 * Which rules each approval mode allows (ADR-0021 §1): manual none, auto-edits the edit and
 * harness-check rules, auto those plus the command allowlist.
 */
export function ruleAllowedByMode(mode: ApprovalMode, rule: AllowRule): boolean {
  switch (mode) {
    case 'manual':
      return false;
    case 'auto-edits':
      return rule === 'edit-in-own-worktree' || rule === 'run-harness-check';
    case 'auto':
      return true;
  }
}

/** The whole command: safe tokens separated by single spaces, nothing else (ADR-0021 §2). */
const WHOLE_COMMAND = /^[A-Za-z0-9._/:=@+%,-]+( [A-Za-z0-9._/:=@+%,-]+)*$/;
/** Longer commands are never matched; no allowlist entry needs one. */
const MAX_COMMAND_CHARS = 4096;

/**
 * The first allowlist pattern the actual command matches, or null (ADR-0021 §2). The command must
 * be safe tokens joined by single spaces (no quotes, `$`, `;`, `|`, `&`, redirects, globs,
 * newlines or tabs), argv[0] a bare command name that is not forbidden, every token free of
 * absolute paths and `..`, and a `git` call read-only with no forbidden option. Patterns are
 * re-validated here, so a stored pattern that no longer passes the schema never matches.
 * `run_in_background` calls never get this far (`allowlistTarget` returns null for them).
 */
export function matchCommandAllowlist(
  command: string,
  patterns: readonly CommandPattern[],
): CommandPattern | null {
  if (command.length > MAX_COMMAND_CHARS || !WHOLE_COMMAND.test(command)) return null;
  const argv = command.split(' ');
  const [name, sub] = argv;
  if (name === undefined || !BARE_COMMAND_PATTERN.test(name)) return null;
  if (FORBIDDEN_ALLOWLIST_COMMANDS.includes(name)) return null;
  if (!argv.every(isSafeCommandToken)) return null;
  if (name === 'git') {
    if (sub === undefined || !GIT_READ_ONLY_SUBCOMMANDS.includes(sub)) return null;
    if (argv.some(isForbiddenGitOption)) return null;
  }
  for (const pattern of patterns) {
    if (!CommandPatternSchema.safeParse(pattern).success) continue;
    const words = pattern.argv;
    const sameStart = words.every((w, i) => argv[i] === w);
    if (!sameStart) continue;
    if (pattern.match === 'exact' ? argv.length === words.length : argv.length >= words.length) {
      return pattern;
    }
  }
  return null;
}

export interface AllowlistInput {
  /**
   * The run's approval policy (ADR-0021), snapshotted at its start. When present it decides and
   * `allowlist` is ignored: manual asks for everything; auto-edits allows edits in the agent's own
   * worktree and exact harness checks; auto adds the command allowlist.
   */
  policy?: ProjectApprovals;
  /** The legacy project allowlist (runs without a policy). Neither present: everything asks. */
  allowlist?: ProjectAllowlist;
  /**
   * Only helpers are covered (README §4.1 step 3), and the tester, whose allowlist is the
   * helpers' (ADR-0019); the lead always asks, and the planner and reviewer never edit.
   */
  agentKind: AgentRoleKind;
  /** From `allowlistTarget`; null asks. */
  target: AllowlistTarget | null;
  /**
   * For an edit: the realpath of the target (for a new file, the realpath of its existing parent
   * plus the file name). Null when it could not be resolved, which asks.
   */
  resolvedPath: string | null;
  /** Realpath of the agent's own worktree; null when it has none, which asks. */
  worktreeRoot: string | null;
  /** The harness manifest's checks; empty when the harness is not valid. */
  checks: readonly Pick<HarnessCheck, 'id' | 'argv'>[];
}

const ask = (reason: string): AllowlistVerdict => ({ allowed: false, reason });

/** What each source allows: the legacy switches, or the rules of the run's mode. */
function allows(input: AllowlistInput): {
  edits: boolean;
  checks: boolean;
  commands: readonly CommandPattern[] | null;
} {
  const { policy, allowlist } = input;
  if (policy !== undefined) {
    return {
      edits: ruleAllowedByMode(policy.mode, 'edit-in-own-worktree'),
      checks: ruleAllowedByMode(policy.mode, 'run-harness-check'),
      commands: ruleAllowedByMode(policy.mode, 'command-allowlist') ? policy.commands : null,
    };
  }
  return {
    edits: allowlist?.editInOwnWorktree === true,
    checks: allowlist?.runHarnessChecks === true,
    commands: null,
  };
}

/**
 * Decides whether the run's approval policy (ADR-0021), or for older runs the project allowlist
 * (ADR-0013 amendment), pre-approves one tool call.
 */
export function evaluateAllowlist(input: AllowlistInput): AllowlistVerdict {
  const { target } = input;
  const allowed = allows(input);
  if (!hasReviewableChange(input.agentKind)) {
    return ask(
      input.agentKind === 'lead'
        ? 'The lead agent always asks.'
        : 'Only helpers and the tester are covered by the allowlist.',
    );
  }
  if (target === null) return ask('This action is not covered by the allowlist.');

  if (target.kind === 'edit') {
    if (!allowed.edits) return ask('Edits are not pre-approved in this project.');
    const { resolvedPath, worktreeRoot } = input;
    if (resolvedPath === null || worktreeRoot === null) {
      return ask('The file location could not be checked.');
    }
    if (!isPathInside(resolvedPath, worktreeRoot)) {
      return ask("The file is outside the agent's own copy.");
    }
    const inner = (normalizedSegments(resolvedPath) ?? []).slice(
      (normalizedSegments(worktreeRoot) ?? []).length,
    );
    if (inner.some((seg) => PROTECTED_SEGMENTS.has(seg))) {
      return ask('Git and Claude settings files always need the owner.');
    }
    return { allowed: true, rule: 'edit-in-own-worktree' };
  }

  if (allowed.checks) {
    for (const check of input.checks) {
      const line = checkCommandLine(check.argv);
      if (line !== null && line === target.command) {
        return { allowed: true, rule: 'run-harness-check', checkId: check.id };
      }
    }
  }
  if (allowed.commands !== null) {
    const pattern = matchCommandAllowlist(target.command, allowed.commands);
    if (pattern !== null) return { allowed: true, rule: 'command-allowlist', pattern };
    return ask("The command is not exactly one of this project's checks or allowed commands.");
  }
  if (!allowed.checks) return ask('Checks are not pre-approved in this project.');
  return ask("The command is not exactly one of this project's checks.");
}
