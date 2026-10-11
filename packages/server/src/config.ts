import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { z } from 'zod';

/** Runtime configuration (docs/development.md §5). Parsed once at startup; invalid values fail fast. */

const positiveInt = (name: string) =>
  z.coerce
    .number({ error: `${name} must be a number` })
    .int(`${name} must be an integer`)
    .positive(`${name} must be positive`);

const EnvSchema = z.object({
  ACP_PORT: positiveInt('ACP_PORT').max(65535).default(7420),
  ACP_DATA_DIR: z.string().min(1).optional(),
  ACP_CLAUDE_DIR: z.string().min(1).optional(),
  CLAUDE_CONFIG_DIR: z.string().min(1).optional(),
  ACP_MODE: z.enum(['live', 'demo']).default('live'),
  ACP_POLL_INTERVAL_MS: positiveInt('ACP_POLL_INTERVAL_MS').default(5_000),
  ACP_ACTIVE_WINDOW_MS: positiveInt('ACP_ACTIVE_WINDOW_MS').default(120_000),
  ACP_STALE_AFTER_MS: positiveInt('ACP_STALE_AFTER_MS').default(1_800_000),
  ACP_MANAGED: z.enum(['on', 'off']).optional(),
  ACP_RUN_TIMEOUT_MS: positiveInt('ACP_RUN_TIMEOUT_MS').default(7_200_000),
});

export interface ServerConfig {
  /** The server only ever binds the loopback interface (AGENTS.md §3.8). */
  readonly host: '127.0.0.1';
  readonly port: number;
  readonly dataDir: string;
  readonly claudeDir: string;
  readonly mode: 'live' | 'demo';
  /** Demo data lives in its own file and is never mixed with live data (ADR-0007). */
  readonly databasePath: string;
  readonly hookTokenPath: string;
  readonly pollIntervalMs: number;
  readonly statusThresholds: { readonly activeWindowMs: number; readonly staleAfterMs: number };
  /**
   * Managed agents (Phase 3): `on`, `off`, or `auto` (unset): on in live mode, off in demo unless a
   * managed adapter is injected (tests and e2e). The real Agent SDK never runs in demo mode.
   */
  readonly managed: 'on' | 'off' | 'auto';
  /** A working run is stopped (agents TIMED_OUT) after this long (ADR-0013 §3). */
  readonly runTimeoutMs: number;
}

export class ConfigError extends Error {
  override readonly name = 'ConfigError';
}

export interface LoadConfigOptions {
  /** Injected for tests; defaults to `os.homedir()`. */
  homeDir?: string;
}

export function loadConfig(
  env: Readonly<Record<string, string | undefined>>,
  options: LoadConfigOptions = {},
): ServerConfig {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.') || 'env'}: ${i.message}`);
    throw new ConfigError(`Invalid configuration: ${issues.join('; ')}`);
  }
  const e = parsed.data;
  if (e.ACP_STALE_AFTER_MS < e.ACP_ACTIVE_WINDOW_MS) {
    throw new ConfigError(
      'Invalid configuration: ACP_STALE_AFTER_MS must be >= ACP_ACTIVE_WINDOW_MS',
    );
  }
  const home = options.homeDir ?? homedir();
  const dataDir = resolve(e.ACP_DATA_DIR ?? join(home, '.agent-control-plane'));
  return {
    host: '127.0.0.1',
    port: e.ACP_PORT,
    dataDir,
    claudeDir: resolve(e.ACP_CLAUDE_DIR ?? e.CLAUDE_CONFIG_DIR ?? join(home, '.claude')),
    mode: e.ACP_MODE,
    databasePath: join(dataDir, e.ACP_MODE === 'demo' ? 'demo.sqlite' : 'acp.sqlite'),
    hookTokenPath: join(dataDir, 'hook-token'),
    pollIntervalMs: e.ACP_POLL_INTERVAL_MS,
    statusThresholds: {
      activeWindowMs: e.ACP_ACTIVE_WINDOW_MS,
      staleAfterMs: e.ACP_STALE_AFTER_MS,
    },
    managed: e.ACP_MANAGED ?? 'auto',
    runTimeoutMs: e.ACP_RUN_TIMEOUT_MS,
  };
}
