import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { NormalizedEventSchema } from '@acp/core';
import type { NormalizedEvent } from '@acp/core';
import { describe, expect, it } from 'vitest';
import {
  HookPayloadError,
  hookSettingsSnippet,
  normalizeHook,
  SUBSCRIBED_HOOKS,
} from '../src/hooks.js';
import {
  copyScenario,
  expectGolden,
  FIXTURES_DIR,
  portable,
  scenarioRoot,
} from './helpers/scenarios.js';
import { put, PROJECT_DIR } from './helpers/temp-claude-dir.js';

const S1 = 'c0ffee00-0000-4000-8000-000000000001';
const S2 = 'c0ffee00-0000-4000-8000-000000000002';
const RECEIVED = '2026-10-10T12:00:00.000Z';
const HOOKS_DIR = path.join(FIXTURES_DIR, '13-hooks', 'hooks');

type Body = Record<string, unknown>;

async function loadHooks(): Promise<[string, Body][]> {
  const names = (await readdir(HOOKS_DIR)).filter((f) => f.endsWith('.json')).sort();
  return Promise.all(
    names.map(async (n) => [
      n.replace(/\.json$/, ''),
      JSON.parse(await readFile(path.join(HOOKS_DIR, n), 'utf8')) as Body,
    ]),
  );
}

describe('C6 normalizeHook (synthetic fixtures; real capture not approved)', () => {
  it('maps every subscribed hook; an unsubscribed one gives []', async () => {
    const claudeDir = await scenarioRoot('13-hooks');
    const events: NormalizedEvent[] = [];
    const seen: string[] = [];
    for (const [name, body] of await loadHooks()) {
      const out = normalizeHook(body, RECEIVED, { claudeDir });
      if (!(SUBSCRIBED_HOOKS as readonly string[]).includes(name)) {
        expect(out).toEqual([]);
        continue;
      }
      expect(out).toHaveLength(1);
      seen.push(name);
      events.push(...out);
    }
    expect(seen.sort()).toEqual([...SUBSCRIBED_HOOKS].sort());
    for (const e of events) {
      expect(NormalizedEventSchema.safeParse(e).success).toBe(true);
      expect(e).toMatchObject({
        occurredAt: null,
        observedAt: RECEIVED,
        provenance: 'observed',
        providerSessionId: S1,
        source: { channel: 'hook', providerVersion: null, byteOffset: null },
      });
      // /home/user/.claude/... is outside this Claude data root, so no path is recorded.
      expect(e.source.path).toBeNull();
      expect(e.source.hookEvent).not.toBeNull();
    }
    await expectGolden('13-hooks', events);
  });

  it('records the transcript path only when it passes the allowlist (golden)', async () => {
    const claudeDir = await scenarioRoot('13-hooks');
    const main = path.join(claudeDir, 'projects', PROJECT_DIR, `${S1}.jsonl`);
    const events: NormalizedEvent[] = [];
    for (const [name, body] of await loadHooks()) {
      if (name === 'PreToolUse') continue;
      events.push(...normalizeHook({ ...body, transcript_path: main }, RECEIVED, { claudeDir }));
    }
    for (const e of events) expect(e.source.path).toBe(main);
    await expectGolden('13-hooks', portable(events, claudeDir), 'events-allowlisted.json');
  });

  it('SubagentStop prefers the allowlisted agent transcript of the same agent', async () => {
    const dir = await copyScenario('13-hooks');
    const agentFile = await put(
      dir,
      `projects/${PROJECT_DIR}/${S1}/subagents/agent-afake1301.jsonl`,
      '{}\n',
    );
    const stop = (await loadHooks()).find(([n]) => n === 'SubagentStop')?.[1] ?? {};
    const mk = (agentPath: string) =>
      normalizeHook({ ...stop, agent_transcript_path: agentPath }, RECEIVED, { claudeDir: dir })[0];
    expect(mk(agentFile)?.source.path).toBe(agentFile);
    // A different agent's file does not count for this agent.
    const other = await put(
      dir,
      `projects/${PROJECT_DIR}/${S1}/subagents/agent-aother.jsonl`,
      '{}\n',
    );
    expect(mk(other)?.source.path).toBeNull();
    expect(mk('/home/user/.claude/elsewhere.jsonl')?.source.path).toBeNull();
  });

  it('ignores paths that are denied, relative, traversing, or from another session', async () => {
    const dir = await copyScenario('13-hooks');
    await put(dir, `projects/${PROJECT_DIR}/${S2}.jsonl`, '{}\n');
    await put(dir, 'settings.json', '{}');
    const start = (await loadHooks()).find(([n]) => n === 'SessionStart')?.[1] ?? {};
    for (const p of [
      path.join(dir, 'settings.json'),
      path.join(dir, 'projects', PROJECT_DIR, '..', '..', 'settings.json'),
      'projects/x.jsonl',
      path.join(dir, 'projects', PROJECT_DIR, `${S2}.jsonl`), // another session's transcript
      path.join(dir, 'projects', PROJECT_DIR, `${S1}.jsonl.missing`),
    ]) {
      const [event] = normalizeHook({ ...start, transcript_path: p }, RECEIVED, { claudeDir: dir });
      expect(event?.source.path).toBeNull();
    }
  });

  it('uses tool_use_id for the key when present, else the canonical body hash', async () => {
    const claudeDir = await scenarioRoot('13-hooks');
    const stop = (await loadHooks()).find(([n]) => n === 'Stop')?.[1] ?? {};
    const [a] = normalizeHook(stop, RECEIVED, { claudeDir });
    const reordered = Object.fromEntries(Object.entries(stop).reverse());
    const [b] = normalizeHook(reordered, '2026-10-10T13:00:00.000Z', { claudeDir });
    expect(a?.dedupKey).toBe(b?.dedupKey);
    expect(a?.dedupKey).toMatch(new RegExp(`^cc:hook:${S1}:Stop:[0-9a-f]{64}$`));
    const [c] = normalizeHook({ ...stop, tool_use_id: 'toolu_x' }, RECEIVED, { claudeDir });
    expect(c?.dedupKey).toBe(`cc:hook:${S1}:Stop:toolu_x`);
    expect(c?.sourceEventId).toBe('toolu_x');
  });

  it('never copies message text or other free text from the payload', async () => {
    const claudeDir = await scenarioRoot('13-hooks');
    const note = (await loadHooks()).find(([n]) => n === 'Notification')?.[1] ?? {};
    const [event] = normalizeHook(
      {
        ...note,
        message: 'MESSAGE-SECRET',
        title: 'TITLE-SECRET',
        notification_type: 'long free text that is not an identifier'.repeat(5),
      },
      RECEIVED,
      { claudeDir },
    );
    expect(JSON.stringify(event)).not.toMatch(/SECRET|free text/);
    expect(event?.payload).toEqual({ notificationType: null });
  });

  it('CwdChanged falls back to the common cwd and rejects a payload with no usable cwd', async () => {
    const claudeDir = await scenarioRoot('13-hooks');
    const base = { session_id: S1, hook_event_name: 'CwdChanged' };
    const [ok] = normalizeHook({ ...base, cwd: '/home/user/project' }, RECEIVED, { claudeDir });
    expect(ok?.payload).toEqual({ from: null, to: '/home/user/project' });
    expect(() => normalizeHook({ ...base, cwd: 'relative' }, RECEIVED, { claudeDir })).toThrow(
      HookPayloadError,
    );
  });

  describe('invalid bodies are rejected without quoting them', () => {
    const cases: [string, unknown][] = [
      ['null', null],
      ['a string', 'SECRET-BODY'],
      ['an array', [1]],
      ['no session_id', { hook_event_name: 'Stop' }],
      ['a non-uuid session_id', { session_id: 'SECRET-ID', hook_event_name: 'Stop' }],
      ['no hook_event_name', { session_id: S1 }],
      ['SubagentStart without agent_id', { session_id: S1, hook_event_name: 'SubagentStart' }],
      [
        'SubagentStop with a bad agent_id',
        { session_id: S1, hook_event_name: 'SubagentStop', agent_id: '../x' },
      ],
    ];
    for (const [label, body] of cases) {
      it(label, async () => {
        const claudeDir = await scenarioRoot('13-hooks');
        let message = '';
        try {
          normalizeHook(body, RECEIVED, { claudeDir });
        } catch (err) {
          expect(err).toBeInstanceOf(HookPayloadError);
          message = (err as Error).message;
        }
        expect(message).not.toBe('');
        expect(message).not.toContain('SECRET');
      });
    }

    it('an invalid receivedAt', async () => {
      const claudeDir = await scenarioRoot('13-hooks');
      expect(() =>
        normalizeHook({ session_id: S1, hook_event_name: 'Stop' }, 'yesterday', { claudeDir }),
      ).toThrow(HookPayloadError);
    });
  });

  it('returns [] for an unknown event name without requiring its other fields', async () => {
    const claudeDir = await scenarioRoot('13-hooks');
    expect(
      normalizeHook(
        { session_id: S1, hook_event_name: 'PostToolUse', tool_response: { usage: 1 } },
        RECEIVED,
        {
          claudeDir,
        },
      ),
    ).toEqual([]);
  });
});

describe('hookSettingsSnippet', () => {
  const snippet = hookSettingsSnippet({ port: 7420, tokenEnvVar: 'ACP_HOOK_TOKEN' });
  const parsed = JSON.parse(snippet) as {
    hooks: Record<
      string,
      {
        hooks: {
          type: string;
          url: string;
          timeout: number;
          headers: Record<string, string>;
          allowedEnvVars: string[];
        }[];
      }[]
    >;
  };

  it('is valid JSON with one http hook per subscribed event', () => {
    expect(Object.keys(parsed.hooks).sort()).toEqual([...SUBSCRIBED_HOOKS].sort());
    for (const entries of Object.values(parsed.hooks)) {
      expect(entries[0]?.hooks[0]).toEqual({
        type: 'http',
        url: 'http://127.0.0.1:7420/api/hooks/claude-code',
        timeout: 2,
        headers: { 'X-ACP-Hook-Token': '$ACP_HOOK_TOKEN' },
        allowedEnvVars: ['ACP_HOOK_TOKEN'],
      });
    }
  });

  it('only references the token by variable name and binds loopback', () => {
    expect(snippet).not.toMatch(/localhost|0\.0\.0\.0/);
    expect(snippet).toContain('127.0.0.1');
  });

  it('rejects an invalid port or variable name', () => {
    expect(() => hookSettingsSnippet({ port: 0, tokenEnvVar: 'X' })).toThrow(RangeError);
    expect(() => hookSettingsSnippet({ port: 70000, tokenEnvVar: 'X' })).toThrow(RangeError);
    expect(() => hookSettingsSnippet({ port: 1.5, tokenEnvVar: 'X' })).toThrow(RangeError);
    expect(() => hookSettingsSnippet({ port: 7420, tokenEnvVar: 'A B' })).toThrow(RangeError);
    expect(() => hookSettingsSnippet({ port: 7420, tokenEnvVar: '1A' })).toThrow(RangeError);
  });
});
