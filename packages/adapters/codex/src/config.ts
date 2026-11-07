import path from 'node:path';
import type { CodexProfile } from './modes.js';

/**
 * How a managed `codex app-server` is started (ADR-0031 owner decision 4): user-level Codex
 * configuration is neutralised so a managed run sees only what ACP gives it, as
 * `settingSources: []` does for Claude. Each flag below was verified against CLI 0.166.0 in the
 * CX-1 spike (docs/research/codex-app-server-2026-11-07.md): no hooks, plugins, apps, native
 * subagents (`multi_agent`), memories, browser or computer use, no project `AGENTS.md`
 * (`project_doc_max_bytes=0`), no user MCP servers and no web search.
 */
export const DISABLED_FEATURES: readonly string[] = [
  'hooks',
  'multi_agent',
  'plugins',
  'apps',
  'remote_plugin',
  'goals',
  'memories',
  'image_generation',
  'browser_use',
  'computer_use',
  'guardian_approval',
  'tool_suggest',
  'skill_mcp_dependency_install',
  'daemon_auto_start',
  'in_app_browser',
];

/** `-c key=value` overrides of `config.toml` (values are TOML). */
export const CONFIG_OVERRIDES: readonly string[] = [
  'project_doc_max_bytes=0',
  'mcp_servers={}',
  'web_search="disabled"',
];

/**
 * The app-server's argument array. Fixed words, plus, for an agent, the `-c` overrides that define
 * its one permission profile and make it the default (CX-1b): spawning is per agent, so the
 * profile is too. Paths reach the array only TOML-quoted (`tomlString`) and never a shell.
 * Throws `CodexProfileError` for a profile that cannot be written safely.
 */
export function codexArgs(profile?: CodexProfile): string[] {
  return [
    'app-server',
    ...DISABLED_FEATURES.flatMap((feature) => ['--disable', feature]),
    ...CONFIG_OVERRIDES.flatMap((override) => ['-c', override]),
    ...(profile === undefined ? [] : profileOverrides(profile).flatMap((o) => ['-c', o])),
  ];
}

/** A permission profile that cannot be written as config; the agent ends `sandbox-unavailable`. */
export class CodexProfileError extends Error {
  readonly code = 'codex_profile_invalid';
  constructor(reason: string) {
    super(`Codex permission profile not written: ${reason}`);
    this.name = 'CodexProfileError';
  }
}

/** C0 controls, DEL and C1 controls: TOML basic strings forbid most, and none belongs in a path. */
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/u;
/** With the `u` flag a paired surrogate is one code point above U+FFFF, so only lone ones match. */
const LONE_SURROGATE = /[\ud800-\udfff]/u;

/**
 * `text` as a TOML basic string: backslash and double quote escaped, everything else (spaces,
 * single quotes, non-ASCII) as is. Refuses control characters, newlines included, and lone
 * surrogates rather than escape them: such a path is never a real folder the server meant.
 */
export function tomlString(text: string): string {
  if (CONTROL.test(text)) throw new CodexProfileError('a path contains a control character');
  // A lone surrogate would reach Codex as U+FFFD: a different path than the one meant.
  if (LONE_SURROGATE.test(text)) throw new CodexProfileError('a path is not well-formed Unicode');
  return `"${text.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`;
}

const PROFILE_ID = /^[a-z][a-z0-9-]*$/;
const SPECIAL_KEY = /^:[a-z_]+$/;

/** The `-c` overrides of one profile: `extends`, `filesystem` and `default_permissions`. */
export function profileOverrides(profile: CodexProfile): string[] {
  if (!PROFILE_ID.test(profile.id)) throw new CodexProfileError('unexpected profile id');
  const entries = Object.entries(profile.filesystem).map(([key, access]) => {
    if (!SPECIAL_KEY.test(key) && !path.isAbsolute(key)) {
      throw new CodexProfileError('a path is not absolute');
    }
    return `${tomlString(key)}=${tomlString(access)}`;
  });
  return [
    `permissions.${profile.id}.extends=${tomlString(profile.extends)}`,
    `permissions.${profile.id}.filesystem={${entries.join(', ')}}`,
    `default_permissions=${tomlString(profile.id)}`,
  ];
}

/**
 * The environment for a managed `codex` process (ADR-0012, ADR-0031 §3): the server's own
 * environment without any `ACP_*` variable (the hook token, the data folder) and without `GIT_*`
 * variables (a server started from inside a git hook must not point an agent's git at another
 * repository), as the server does for `claude`. Everything else stays: Codex finds its login
 * through HOME and its tools through PATH. ACP never reads Codex's credentials itself.
 */
export function codexEnv(
  env: Readonly<Record<string, string | undefined>>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) continue;
    const upper = key.toUpperCase();
    if (upper.startsWith('ACP_') || upper.startsWith('GIT_')) continue;
    out[key] = value;
  }
  return out;
}
