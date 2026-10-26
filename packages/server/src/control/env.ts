/**
 * P-D (v0.3.1): Claude Code reads `CLAUDE_CODE_EXIT_AFTER_STOP_DELAY` as an idle timer: once set,
 * the process exits after that long without a turn ("Exiting after N ms of idle time", read from
 * the bundled CLI 0.3.296). Inherited from the owner's shell, it would end the lead while it waits
 * for the owner's decision on a change. The app never sets it.
 */
const DROPPED: ReadonlySet<string> = new Set(['CLAUDE_CODE_EXIT_AFTER_STOP_DELAY']);

/**
 * The environment for a managed `claude` process (ADR-0012): the server's own environment without
 * any `ACP_*` variable (the hook token, data dir, ...), without `GIT_*` variables (a server
 * started from inside a git hook must not point an agent's git at another repository) and without
 * Claude Code's idle-exit timer (`DROPPED`). The SDK replaces the child's environment with this
 * object, so nothing else leaks through.
 */
export function managedAgentEnv(
  env: Readonly<Record<string, string | undefined>>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) continue;
    const upper = key.toUpperCase();
    if (upper.startsWith('ACP_') || upper.startsWith('GIT_') || DROPPED.has(upper)) continue;
    out[key] = value;
  }
  return out;
}
