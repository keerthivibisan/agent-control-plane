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

/** The app-server's argument array. No word comes from input. */
export function codexArgs(): string[] {
  return [
    'app-server',
    ...DISABLED_FEATURES.flatMap((feature) => ['--disable', feature]),
    ...CONFIG_OVERRIDES.flatMap((override) => ['-c', override]),
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
