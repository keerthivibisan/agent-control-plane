// Pure units and a demo-mode server with fake adapters only (CX-4). Never the real codex or claude.
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { NormalizedEventSchema, type ManagedAgentSpec } from '@acp/core';
import { DiagnosticsDtoSchema } from '@acp/core/api';
import { resolveManagedAdapters, startServer } from '../../src/bootstrap.js';
import { ConfigError, loadConfig } from '../../src/config.js';
import {
  CODEX_FULL_AUTO_LINE,
  capabilityRefusal,
  dropsSkills,
} from '../../src/control/capabilities.js';
import { fullAutoDenyRead } from '../../src/control/full-auto.js';
import { managedSessionEvents, managedUsageEvent } from '../../src/control/managed-usage.js';
import { silentLogger } from '../../src/logger.js';
import { tempDir } from '../helpers.js';
import { FAKE_CODEX_CAPABILITIES, createFakeManagedAdapter } from './fake-adapter.js';

const ALL = { skills: true, profileTools: true, fullAuto: true, leadTools: true, followUp: true };
const PATHS = { tempDir: '/t', denyRead: ['/d'] };

function spec(extra: Partial<ManagedAgentSpec> = {}): ManagedAgentSpec {
  return { agentRunId: 'a1', kind: 'worker', cwd: '/w', prompt: 'p', model: null, ...extra };
}

describe('capabilityRefusal (ADR-0031 §5)', () => {
  it('lets a plain spec run on both providers', () => {
    expect(capabilityRefusal(spec(), FAKE_CODEX_CAPABILITIES, 'codex')).toBeNull();
    expect(capabilityRefusal(spec(), ALL, 'claude-code')).toBeNull();
  });

  it('refuses Full auto and its tightened sandbox on Codex, whatever the capabilities say', () => {
    for (const extra of [{ fullAuto: PATHS }, { sandbox: PATHS }]) {
      expect(capabilityRefusal(spec(extra), ALL, 'codex')).toEqual({
        failure: 'sandbox-unavailable',
        line: CODEX_FULL_AUTO_LINE,
        code: 'full-auto',
      });
      expect(capabilityRefusal(spec(extra), ALL, 'claude-code')).toBeNull();
      expect(
        capabilityRefusal(spec(extra), { ...ALL, fullAuto: false }, 'claude-code')?.failure,
      ).toBe('sandbox-unavailable');
    }
    expect(CODEX_FULL_AUTO_LINE).toBe(
      'Full auto is not available on Codex yet: its sandbox cannot block reads of private files.',
    );
  });

  it('refuses an agent file that narrows tools where they cannot be applied, and keeps one that does not', () => {
    const narrowing = spec({ profile: { name: 'narrow', instructions: 'x', tools: ['Read'] } });
    expect(capabilityRefusal(narrowing, FAKE_CODEX_CAPABILITIES, 'codex')).toMatchObject({
      failure: 'provider-unavailable',
      code: 'profile-tools',
    });
    expect(capabilityRefusal(narrowing, ALL, 'claude-code')).toBeNull();
    const plain = spec({ profile: { name: 'plain', instructions: 'x', tools: null } });
    expect(capabilityRefusal(plain, FAKE_CODEX_CAPABILITIES, 'codex')).toBeNull();
  });

  it('refuses lead tools and follow-ups an adapter cannot give', () => {
    const tools = spec({ kind: 'lead', leadTools: () => Promise.resolve('') });
    expect(capabilityRefusal(tools, { ...ALL, leadTools: false }, 'codex')?.code).toBe(
      'lead-tools',
    );
    const followUp = spec({ kind: 'lead', followUp: { resumeSessionId: 's' } });
    expect(capabilityRefusal(followUp, { ...ALL, followUp: false }, 'codex')?.code).toBe(
      'follow-up',
    );
  });

  it('strips skills only where they cannot load', () => {
    const skilled = spec({ skillPlugin: { path: '/p', skills: ['acp:lint'] } });
    expect(dropsSkills(skilled, FAKE_CODEX_CAPABILITIES)).toBe(true);
    expect(dropsSkills(skilled, ALL)).toBe(false);
    expect(dropsSkills(spec(), FAKE_CODEX_CAPABILITIES)).toBe(false);
  });
});

describe('managed usage events (ADR-0032 §5)', () => {
  const base = {
    provider: 'codex' as const,
    providerSessionId: 'th-1',
    observedAt: '2026-11-07T10:00:00.000Z',
  };

  it('builds valid normalized events on the managed channel, with nulls kept', () => {
    const events = [
      ...managedSessionEvents({ ...base, cwd: '/w', model: 'gpt-test' }),
      managedUsageEvent({
        ...base,
        messageId: 'th-1:tu-1:10',
        model: null,
        tokens: { input: 5, output: null, cacheCreation: null, cacheRead: 0 },
      }),
    ];
    for (const event of events) expect(NormalizedEventSchema.safeParse(event).success).toBe(true);
    expect(events.map((e) => [e.eventType, e.source.channel, e.provenance])).toEqual([
      ['session.observed', 'managed', 'observed'],
      ['session.started', 'managed', 'observed'],
      ['usage.reported', 'managed', 'observed'],
    ]);
    const usage = events[2];
    expect(usage?.eventType === 'usage.reported' && usage.payload.tokens.output).toBeNull();
  });

  it('keys each fact by provider identifiers only, so a replay is the same event', () => {
    const tokens = { input: 1, output: 1, cacheCreation: null, cacheRead: null };
    const a = managedUsageEvent({ ...base, messageId: 'm', model: null, tokens });
    const b = managedUsageEvent({
      ...base,
      observedAt: '2026-11-07T11:00:00.000Z',
      messageId: 'm',
      model: null,
      tokens,
    });
    expect(a.dedupKey).toBe(b.dedupKey);
    const s1 = managedSessionEvents({ ...base, cwd: '/w', model: null });
    const s2 = managedSessionEvents({ ...base, cwd: '/w', model: 'x' });
    expect(s1.map((e) => e.dedupKey)).toEqual(s2.map((e) => e.dedupKey));
  });
});

describe('Full auto deny list (CX-4)', () => {
  it("denies Codex's home: ~/.codex, and CODEX_HOME when set", async () => {
    const home = tempDir();
    const deny = await fullAutoDenyRead({ homeDir: home, dataDir: join(home, 'data') });
    expect(deny).toContain(join(home, '.codex'));
    const custom = await fullAutoDenyRead({
      homeDir: home,
      dataDir: join(home, 'data'),
      codexHome: '/elsewhere/codex',
    });
    expect(custom).toContain('/elsewhere/codex');
    expect(custom).toContain(join(home, '.codex'));
  });
});

describe('config (CX-4)', () => {
  it('reads ACP_CODEX_BIN and CODEX_HOME with defaults', () => {
    const c = loadConfig({}, { homeDir: '/home/tester' });
    expect(c.codexBin).toBe('codex');
    expect(c.codexHome).toBe('/home/tester/.codex');
    const d = loadConfig(
      { ACP_CODEX_BIN: '/opt/My Tools/codex', CODEX_HOME: '/c' },
      { homeDir: '/home/tester' },
    );
    expect(d.codexBin).toBe('/opt/My Tools/codex');
    expect(d.codexHome).toBe('/c');
  });

  it('refuses a Codex program that is empty, an option or has control characters', () => {
    for (const bad of ['', '--yolo', 'codex\nrm', ' codex']) {
      expect(() => loadConfig({ ACP_CODEX_BIN: bad })).toThrow(ConfigError);
    }
  });
});

describe('managed adapter registry (CX-4)', () => {
  const live = loadConfig({}, { homeDir: '/home/tester' });

  it('registers a single injected adapter under its own provider', () => {
    const one = createFakeManagedAdapter().adapter;
    expect([...resolveManagedAdapters(live, { single: one })]).toEqual([['claude-code', one]]);
    const codex = createFakeManagedAdapter({ provider: 'codex' }).adapter;
    expect([...resolveManagedAdapters(live, { single: codex }).keys()]).toEqual(['codex']);
  });

  it('registers several injected adapters, and none when managed is off or in demo mode', () => {
    const claude = createFakeManagedAdapter().adapter;
    const codex = createFakeManagedAdapter({ provider: 'codex' }).adapter;
    const both = resolveManagedAdapters(live, { single: claude, many: [codex] });
    expect([...both.keys()]).toEqual(['claude-code', 'codex']);
    const off = loadConfig({ ACP_MANAGED: 'off' }, { homeDir: '/home/tester' });
    expect(resolveManagedAdapters(off, { single: claude }).size).toBe(0);
    const demo = loadConfig({ ACP_MODE: 'demo' }, { homeDir: '/home/tester' });
    expect(resolveManagedAdapters(demo, {}).size).toBe(0);
  });

  it('serves each provider availability in diagnostics', async () => {
    const dataDir = tempDir();
    const config = loadConfig({ ACP_MODE: 'demo', ACP_DATA_DIR: dataDir });
    const claude = createFakeManagedAdapter().adapter;
    const codex = createFakeManagedAdapter({
      provider: 'codex',
      checkAvailable: () => Promise.resolve({ ok: true }),
    }).adapter;
    const server = await startServer({
      config,
      logger: silentLogger,
      port: 0,
      managedAdapters: [claude, codex],
    });
    try {
      expect(server.managed).toBe(true);
      const res = await fetch(`http://127.0.0.1:${server.port}/api/diagnostics/ingestion`);
      const body = DiagnosticsDtoSchema.parse(await res.json());
      expect(body.managedProviders).toEqual([
        { provider: 'claude-code', available: true, reason: null, checkedAt: null },
        { provider: 'codex', available: null, reason: null, checkedAt: null },
      ]);
    } finally {
      await server.close();
    }
  });
});
