/**
 * The environment for a managed `claude` process (ADR-0012): the server's own environment without
 * any `ACP_*` variable (the hook token, data dir, ...) and without `GIT_*` variables (a server
 * started from inside a git hook must not point an agent's git at another repository). The SDK
 * replaces the child's environment with this object, so nothing else leaks through.
 */
export function managedAgentEnv(
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
