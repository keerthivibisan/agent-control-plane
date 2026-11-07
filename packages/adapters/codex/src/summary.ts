import path from 'node:path';
import { controlToolLabel, redact } from '@acp/core';

/** Approval and activity summaries are capped here (ADR-0013, `PermissionRequest.summary`). */
export const MAX_SUMMARY_LENGTH = 200;

/**
 * Redacts secrets with the core rules (docs/security.md §2.4), collapses whitespace and control
 * characters, trims, and caps the length in code points. Null when nothing is left.
 */
export function cleanFreeText(text: string, maxLength: number): string | null {
  const cleaned = redact(text)
    .replace(/[\p{Cc}\s]+/gu, ' ')
    .trim();
  if (cleaned.length === 0) return null;
  const codePoints = Array.from(cleaned);
  return codePoints.length <= maxLength
    ? cleaned
    : codePoints.slice(0, maxLength).join('').trimEnd();
}

/** `text` cut to at most `maxBytes` UTF-8 bytes, never inside a character. */
export function capUtf8(text: string, maxBytes: number): string {
  const bytes = Buffer.from(text, 'utf8');
  if (bytes.length <= maxBytes) return text;
  let end = maxBytes;
  // Back up over continuation bytes (10xxxxxx) to the start of the character that does not fit.
  while (end > 0 && ((bytes[end] ?? 0) & 0xc0) === 0x80) end -= 1;
  return bytes.subarray(0, end).toString('utf8');
}

const SHELL_WRAPPER_RE = /^\s*(?:\S*\/)?(?:bash|zsh|sh|dash|ksh)\s+-l?c\s+([\s\S]+?)\s*$/;

/**
 * The command inside Codex's shell wrapper: `/bin/zsh -lc 'git status'` gives `git status`. Codex
 * reports commands that way (CX-1); the server's allowlist and the summaries read the inner one.
 * A single-quoted body is unquoted (`'\''` is a quote), a double-quoted one unescaped; anything
 * else is returned as given.
 */
export function unwrapShellCommand(command: string): string {
  const match = SHELL_WRAPPER_RE.exec(command);
  const body = match?.[1];
  if (body === undefined) return command.trim();
  if (body.length >= 2 && body.startsWith("'") && body.endsWith("'")) {
    return body.slice(1, -1).replaceAll(`'\\''`, "'");
  }
  if (body.length >= 2 && body.startsWith('"') && body.endsWith('"')) {
    return body.slice(1, -1).replace(/\\(["\\$`])/g, '$1');
  }
  return body;
}

const ENV_ASSIGNMENT_RE = /^[A-Za-z_][A-Za-z0-9_]*=/;
const COMMAND_NAME_RE = /^[A-Za-z0-9._+-]{1,64}$/;
const SUBCOMMAND_RE = /^[a-z][a-z0-9-]{0,31}$/;

/**
 * A content-free activity line for a command: `Run git status`, `Run pnpm test`. Only the command
 * name (a basename) and a plain subcommand word are kept; arguments, pipelines and inline secrets
 * never are (ADR-0009, as the Claude adapter's `commandName`).
 */
export function commandActivity(command: string): string {
  const words = unwrapShellCommand(command)
    .split(/\s+/)
    .filter((w) => w !== '');
  const start = words.findIndex((w) => !ENV_ASSIGNMENT_RE.test(w));
  if (start < 0) return 'Run a command';
  const name = (words[start] ?? '').replace(/^.*[\\/]/, '');
  if (!COMMAND_NAME_RE.test(name)) return 'Run a command';
  const sub = words[start + 1];
  return sub !== undefined && SUBCOMMAND_RE.test(sub) ? `Run ${name} ${sub}` : `Run ${name}`;
}

/** An approval summary for a command: `Run <inner command>`, redacted and capped. */
export function commandApprovalSummary(innerCommand: string): string {
  return cleanFreeText(`Run ${innerCommand}`, MAX_SUMMARY_LENGTH) ?? 'Run a command';
}

/** An activity line for a file change: the one path relative to `cwd`, or a count. */
export function fileChangeActivity(paths: readonly string[], cwd: string): string {
  if (paths.length === 1) {
    const absolute = path.resolve(cwd, paths[0] ?? '');
    const relative = path.relative(cwd, absolute);
    const shown = relative.startsWith('..') || path.isAbsolute(relative) ? absolute : relative;
    return cleanFreeText(`Edit ${shown || '.'}`, MAX_SUMMARY_LENGTH) ?? 'Edit 1 file';
  }
  return `Edit ${paths.length} files`;
}

const TOOL_NAME_RE = /^[A-Za-z0-9_.:-]{1,128}$/;

/** An activity line for a tool call: a control-plane tool's plain label, else `Tool <name>`. */
export function toolActivity(tool: string): string {
  const label = controlToolLabel(tool);
  if (label !== null) return label;
  return TOOL_NAME_RE.test(tool) ? `Tool ${tool}` : 'Tool';
}
