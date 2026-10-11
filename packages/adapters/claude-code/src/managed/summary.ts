import path from 'node:path';
import { cleanFreeText } from '../redact.js';

/** Approval and activity summaries are capped here (ADR-0013, `PermissionRequest.summary`). */
export const MAX_SUMMARY_LENGTH = 200;

const TOOL_NAME_RE = /^[A-Za-z0-9_.:-]{1,128}$/;
/** A shell command name: a bare word such as `git`, `pnpm` or `ls`. Anything else is dropped. */
const COMMAND_NAME_RE = /^[A-Za-z0-9._+-]{1,64}$/;
const ENV_ASSIGNMENT_RE = /^[A-Za-z_][A-Za-z0-9_]*=/;
/** Input fields that name the file or directory a tool acts on, in priority order. */
const PATH_FIELDS = ['file_path', 'notebook_path', 'path'] as const;
const SHELL_TOOLS = new Set(['Bash', 'PowerShell']);

/**
 * The file or directory a tool call targets, or null. Only the path fields above are read; other
 * input (file contents, edit strings, patterns, URLs, prompts) never is (ADR-0009, ADR-0015).
 */
export function targetPath(input: Record<string, unknown>): string | null {
  for (const field of PATH_FIELDS) {
    const value = input[field];
    if (typeof value === 'string' && value.trim().length > 0) return value;
  }
  return null;
}

/**
 * The command name of a shell call (`git` for `git commit -m "..."`), or null. Leading
 * `NAME=value` assignments are skipped and a path is reduced to its basename, so arguments,
 * pipelines and inline secrets never reach the summary.
 */
export function commandName(command: unknown): string | null {
  if (typeof command !== 'string') return null;
  const words = command.trim().split(/\s+/);
  const first = words.find((w) => !ENV_ASSIGNMENT_RE.test(w));
  if (first === undefined) return null;
  const name = first.replace(/^.*[\\/]/, '');
  return COMMAND_NAME_RE.test(name) ? name : null;
}

/** A path shown relative to the agent's directory when inside it, else as given. */
function displayPath(target: string, cwd: string): string {
  const absolute = path.resolve(cwd, target);
  return isInside(absolute, cwd) ? path.relative(cwd, absolute) || '.' : absolute;
}

/** True when `absolute` is `dir` or below it (lexically; symlinks are not resolved). */
export function isInside(absolute: string, dir: string): boolean {
  const relative = path.relative(path.resolve(dir), path.resolve(absolute));
  return !relative.startsWith('..') && !path.isAbsolute(relative);
}

/**
 * A short, content-free description of a tool call: the tool name plus its target path or, for a
 * shell call, the command name only, e.g. `Edit src/app.ts` or `Bash git`. Redacted and capped at
 * MAX_SUMMARY_LENGTH. Used for approval requests and activity events.
 */
export function summarizeToolUse(toolName: string, input: unknown, cwd: string): string {
  const name = TOOL_NAME_RE.test(toolName) ? toolName : 'Unknown tool';
  const fields = isRecord(input) ? input : {};
  let target: string | null = null;
  if (SHELL_TOOLS.has(name)) target = commandName(fields['command']);
  else {
    const p = targetPath(fields);
    if (p !== null) target = displayPath(p, cwd);
  }
  const text = target === null ? name : `${name} ${target}`;
  return cleanFreeText(text, MAX_SUMMARY_LENGTH) ?? name;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
