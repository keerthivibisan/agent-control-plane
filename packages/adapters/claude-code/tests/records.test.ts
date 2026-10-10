import { NormalizedEventSchema } from '@acp/core';
import { describe, expect, it } from 'vitest';
import type { ParsedLine } from '../src/reader.js';
import { freshFileState, normalizeLine, replayLine, timestamp } from '../src/records.js';
import type { FileState, LineContext } from '../src/records.js';

const CTX: LineContext = {
  sessionId: 'c0ffee00-0000-4000-8000-000000000001',
  agentId: null,
  sourcePath: '/claude/projects/-p/c0ffee00-0000-4000-8000-000000000001.jsonl',
  observedAt: '2026-10-10T12:00:00.000Z',
};

const line = (value: unknown, offset = 0): ParsedLine => ({
  offset,
  raw: Buffer.from(JSON.stringify(value)),
  value,
});

const env = {
  uuid: 'u1',
  parentUuid: null,
  timestamp: '2026-10-01T10:00:00.000Z',
  cwd: '/home/user/project',
  version: '2.1.263',
  gitBranch: 'main',
};

function run(value: unknown, state: FileState = freshFileState()) {
  const result = normalizeLine(line(value), CTX, state);
  if (result.ok) {
    for (const e of result.events) expect(NormalizedEventSchema.safeParse(e).success).toBe(true);
  }
  return { result, state };
}

describe('normalizeLine: content minimization (ADR-0009)', () => {
  it('never copies message text, tool input, or tool output into events', () => {
    const secret = 'TOP-SECRET-CONTENT';
    const user = run({
      ...env,
      type: 'user',
      message: {
        role: 'user',
        content: [
          { type: 'text', text: secret },
          { type: 'tool_result', tool_use_id: 'toolu_1', content: secret, is_error: true },
        ],
      },
    });
    const assistant = run({
      ...env,
      type: 'assistant',
      requestId: 'req_1',
      message: {
        id: 'msg_1',
        model: 'claude-sonnet-4-5',
        stop_reason: 'tool_use',
        content: [
          { type: 'thinking', thinking: secret },
          { type: 'text', text: secret },
          { type: 'tool_use', id: 'toolu_2', name: 'Bash', input: { command: secret } },
        ],
        usage: { input_tokens: 1, output_tokens: 2 },
      },
    });
    for (const { result } of [user, assistant]) {
      expect(result.ok).toBe(true);
      expect(JSON.stringify(result)).not.toContain(secret);
    }
    if (!user.result.ok) throw new Error('unreachable');
    expect(user.result.events.map((e) => e.eventType)).toEqual([
      'session.observed',
      'message.user',
      'tool.result',
    ]);
    expect(user.result.events[2]?.payload).toEqual({ toolUseId: 'toolu_1', isError: true });
  });

  it('reads only the type of an unknown record', () => {
    const { result } = run({
      type: 'bridge-session',
      accountUuid: 'ACCOUNT',
      cwd: '/x/never-read',
    });
    expect(result.ok && result.unrecognized).toBe(true);
    expect(JSON.stringify(result)).not.toMatch(/ACCOUNT|never-read/);
  });

  it('emits nothing for a known, ignored type and reports its name (ADR-0011)', () => {
    const state = freshFileState();
    state.lastVersion = '2.1.263';
    const { result } = run(
      { ...env, type: 'attachment', attachment: { content: 'SECRET' }, cwd: '/x/never-read' },
      state,
    );
    expect(result).toEqual({
      ok: true,
      events: [],
      version: '2.1.263',
      unrecognized: false,
      ignored: 'attachment',
    });
    // Its envelope is not read either: the cwd and version stay as they were.
    expect(state).toEqual({ lastCwd: null, lastVersion: '2.1.263' });
  });

  it('ignores a known system subtype but still applies its envelope', () => {
    const { result } = run({ ...env, type: 'system', subtype: 'stop_hook_summary', hookInfos: [] });
    expect(result.ok && result.ignored).toBe('system:stop_hook_summary');
    expect(result.ok && result.unrecognized).toBe(false);
    expect(result.ok && result.events.map((e) => e.eventType)).toEqual(['session.observed']);
  });

  it('keeps uncertain types unrecognized', () => {
    for (const type of ['frame-link', 'atis-latch', 'agent-name', 'mode', 'relocated']) {
      const { result } = run({ type });
      expect(result.ok && result.unrecognized).toBe(true);
      expect(result.ok && result.ignored).toBeUndefined();
    }
  });

  it('replaces an unsafe record type name with null', () => {
    const { result } = run({ type: 'has space\nand newline' });
    expect(result.ok && result.events[0]?.payload).toEqual({ recordType: null });
  });
});

describe('normalizeLine: tolerance', () => {
  it('treats unusable token values as null, never 0', () => {
    const { result } = run({
      ...env,
      type: 'assistant',
      message: {
        id: 'msg_1',
        content: [],
        usage: { input_tokens: -1, output_tokens: 1.5, cache_read_input_tokens: '9' },
      },
    });
    const usage = result.ok ? result.events.find((e) => e.eventType === 'usage.reported') : null;
    expect(usage?.payload).toMatchObject({
      tokens: { input: null, output: null, cacheCreation: null, cacheRead: null },
    });
  });

  it('emits no usage event when the message has no usage object', () => {
    const { result } = run({ ...env, type: 'assistant', message: { id: 'msg_1', content: [] } });
    expect(result.ok && result.events.map((e) => e.eventType)).toEqual([
      'session.observed',
      'message.assistant',
    ]);
  });

  it('rejects an assistant record without message.id, leaving state untouched', () => {
    const state = freshFileState();
    const { result } = run({ ...env, type: 'assistant', message: {} }, state);
    expect(result.ok).toBe(false);
    expect(state).toEqual(freshFileState());
  });

  it('rejects lines without a string type', () => {
    expect(run([1, 2]).result.ok).toBe(false);
    expect(run({ type: 5 }).result.ok).toBe(false);
    expect(run({}).result.ok).toBe(false);
  });

  it('drops an invalid timestamp and a relative cwd instead of failing', () => {
    const { result } = run({
      ...env,
      type: 'user',
      timestamp: 'yesterday',
      cwd: 'relative/dir',
      message: {},
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.events.map((e) => e.eventType)).toEqual(['message.user']);
    expect(result.events[0]?.occurredAt).toBeNull();
  });

  it('names other system subtypes and falls back for a missing or unsafe one', () => {
    const named = run({ ...env, type: 'system', subtype: 'compact_boundary' }).result;
    const missing = run({ ...env, type: 'system' }).result;
    const unsafe = run({ ...env, type: 'system', subtype: 'a b' }).result;
    const names = [named, missing, unsafe].map((r) =>
      r.ok ? r.events.find((e) => e.eventType === 'record.unrecognized')?.payload : null,
    );
    expect(names).toEqual([
      { recordType: 'system:compact_boundary' },
      { recordType: 'system' },
      { recordType: 'system' },
    ]);
  });
});

describe('normalizeLine: provider errors, snapshots, titles', () => {
  it('reads only status and type identifiers from an api_error, never its message', () => {
    const { result } = run({
      ...env,
      type: 'system',
      subtype: 'api_error',
      error: {
        status: 529,
        error: { type: 'error', error: { type: 'overloaded_error', message: 'SECRET' } },
      },
    });
    expect(JSON.stringify(result)).not.toContain('SECRET');
    const err = result.ok ? result.events.find((e) => e.eventType === 'provider.error') : null;
    expect(err?.payload).toEqual({ kind: 'overloaded_error', httpStatus: 529 });
  });

  it('rejects a cost-state record with neither model usage nor cost', () => {
    expect(run({ type: 'cost-state' }).result.ok).toBe(false);
  });

  it('maps an unreadable per-model usage entry to all-null counts', () => {
    const { result } = run({ type: 'cost-state', modelUsage: { m: 'bad' }, totalCostUSD: 1 });
    expect(result.ok && result.events[0]?.payload).toMatchObject({
      byModel: { m: { input: null, output: null, cacheCreation: null, cacheRead: null } },
      reportedCostUsd: 1,
    });
  });

  it('ignores a title that is empty after cleanup but rejects one with no field at all', () => {
    const blank = run({ type: 'ai-title', aiTitle: '   ' }).result;
    expect(blank.ok && blank.events).toEqual([]);
    expect(run({ type: 'custom-title' }).result.ok).toBe(false);
  });

  it('attributes the title source from the record type', () => {
    const user = run({ type: 'custom-title', customTitle: 'A' }).result;
    const ai = run({ type: 'ai-title', aiTitle: 'B' }).result;
    expect(user.ok && user.events[0]?.payload).toEqual({ title: 'A', titleSource: 'user' });
    expect(ai.ok && ai.events[0]?.payload).toEqual({ title: 'B', titleSource: 'ai' });
  });
});

describe('file state', () => {
  it('replayLine rebuilds cwd and version without events, and ignores non-envelope types', () => {
    const state = freshFileState();
    replayLine(line({ ...env, type: 'user', cwd: '/a', version: '1.0.0' }), state);
    replayLine(line({ type: 'bridge-session', cwd: '/never', version: '9' }), state);
    expect(state).toEqual({ lastCwd: '/a', lastVersion: '1.0.0' });
  });

  it('carries the last seen version to records that do not state one', () => {
    const state = freshFileState();
    run({ ...env, type: 'user', message: {} }, state);
    const { result } = run({ type: 'mode' }, state);
    expect(result.ok && result.events[0]?.source.providerVersion).toBe('2.1.263');
  });

  it('timestamp normalizes offsets to UTC and rejects garbage', () => {
    expect(timestamp('2026-10-01T12:00:00+02:00')).toBe('2026-10-01T10:00:00.000Z');
    expect(timestamp('nope')).toBeNull();
    expect(timestamp(null)).toBeNull();
  });
});
