import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from '../src/config.js';

const home = '/home/tester';

describe('loadConfig', () => {
  it('applies the documented defaults and binds loopback only', () => {
    const c = loadConfig({}, { homeDir: home });
    expect(c).toMatchObject({
      host: '127.0.0.1',
      port: 7420,
      dataDir: '/home/tester/.agent-control-plane',
      homeDir: '/home/tester',
      claudeDir: '/home/tester/.claude',
      mode: 'live',
      databasePath: '/home/tester/.agent-control-plane/acp.sqlite',
      hookTokenPath: '/home/tester/.agent-control-plane/hook-token',
      pollIntervalMs: 5000,
      statusThresholds: { activeWindowMs: 120000, staleAfterMs: 1800000 },
    });
  });

  it('uses a separate demo.sqlite in demo mode', () => {
    const c = loadConfig({ ACP_MODE: 'demo', ACP_DATA_DIR: '/data' }, { homeDir: home });
    expect(c.databasePath).toBe('/data/demo.sqlite');
  });

  it('prefers ACP_CLAUDE_DIR, then CLAUDE_CONFIG_DIR, then ~/.claude', () => {
    expect(
      loadConfig({ ACP_CLAUDE_DIR: '/a', CLAUDE_CONFIG_DIR: '/b' }, { homeDir: home }).claudeDir,
    ).toBe('/a');
    expect(loadConfig({ CLAUDE_CONFIG_DIR: '/b' }, { homeDir: home }).claudeDir).toBe('/b');
  });

  it('rejects invalid values with a ConfigError naming the variable', () => {
    expect(() => loadConfig({ ACP_PORT: 'abc' }, { homeDir: home })).toThrow(ConfigError);
    expect(() => loadConfig({ ACP_PORT: '70000' }, { homeDir: home })).toThrow(/ACP_PORT/);
    expect(() => loadConfig({ ACP_MODE: 'prod' }, { homeDir: home })).toThrow(/ACP_MODE/);
    expect(() => loadConfig({ ACP_POLL_INTERVAL_MS: '0' }, { homeDir: home })).toThrow(
      /ACP_POLL_INTERVAL_MS/,
    );
  });

  it('rejects inverted status thresholds', () => {
    expect(() =>
      loadConfig({ ACP_ACTIVE_WINDOW_MS: '5000', ACP_STALE_AFTER_MS: '1000' }, { homeDir: home }),
    ).toThrow(/ACP_STALE_AFTER_MS/);
  });
});
