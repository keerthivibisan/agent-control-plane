import { describe, expect, it } from 'vitest';
import {
  CumulativeUsageSnapshotSchema,
  EVENT_TYPES,
  NormalizedEventSchema,
  PerTurnUsageSchema,
  RegisterProjectInputSchema,
  SessionEdgeSchema,
  sourcedSchema,
  unavailable,
} from '../src/index.js';
import { z } from 'zod';

const envelope = {
  schemaVersion: 1,
  provider: 'claude-code',
  dedupKey: 'claude-code:line:sess-1:uuid-1',
  sourceEventId: 'uuid-1',
  providerSessionId: 'sess-1',
  providerAgentId: null,
  occurredAt: '2026-10-10T08:00:00.000Z',
  observedAt: '2026-10-10T08:00:01.000Z',
  provenance: 'observed',
  source: {
    channel: 'transcript',
    providerVersion: '2.1.263',
    path: '/home/u/.claude/projects/-repo/sess-1.jsonl',
    byteOffset: 0,
    hookEvent: null,
  },
} as const;

const tokens = { input: 3, output: 120, cacheCreation: 500, cacheRead: 20_000 };

describe('provenance', () => {
  const schema = sourcedSchema(z.number());

  it('represents unavailable values as null, never 0', () => {
    expect(unavailable()).toEqual({ provenance: 'unavailable', value: null });
    expect(unavailable('not reported by hook')).toEqual({
      provenance: 'unavailable',
      value: null,
      reason: 'not reported by hook',
    });
    expect(schema.safeParse({ provenance: 'unavailable', value: 0 }).success).toBe(false);
  });

  it('accepts available values with an explicit provenance', () => {
    expect(schema.parse({ provenance: 'derived', value: 42 })).toEqual({
      provenance: 'derived',
      value: 42,
    });
    expect(schema.safeParse({ value: 42 }).success).toBe(false);
  });
});

describe('usage contracts', () => {
  it('keeps missing token categories as null (unavailable)', () => {
    const parsed = PerTurnUsageSchema.parse({
      kind: 'per-turn',
      messageId: 'msg_1',
      requestId: null,
      model: null,
      tokens: { input: null, output: 10, cacheCreation: null, cacheRead: null },
    });
    expect(parsed.tokens.input).toBeNull();
  });

  it('rejects negative, fractional, or omitted token counts', () => {
    const base = { kind: 'per-turn', messageId: 'm', requestId: null, model: null };
    expect(
      PerTurnUsageSchema.safeParse({ ...base, tokens: { ...tokens, input: -1 } }).success,
    ).toBe(false);
    expect(
      PerTurnUsageSchema.safeParse({ ...base, tokens: { ...tokens, output: 1.5 } }).success,
    ).toBe(false);
    const { cacheRead: _omitted, ...missingCategory } = tokens;
    expect(PerTurnUsageSchema.safeParse({ ...base, tokens: missingCategory }).success).toBe(false);
  });

  it('requires a message id for per-turn usage (the dedup identity)', () => {
    expect(
      PerTurnUsageSchema.safeParse({
        kind: 'per-turn',
        messageId: '',
        requestId: null,
        model: null,
        tokens,
      }).success,
    ).toBe(false);
  });

  it('keeps cumulative snapshots a distinct kind from per-turn usage', () => {
    const snapshot = {
      kind: 'cumulative-snapshot',
      scope: 'unknown',
      byModel: { 'model-a': tokens },
      reportedCostUsd: 1.25,
    };
    expect(CumulativeUsageSnapshotSchema.parse(snapshot).kind).toBe('cumulative-snapshot');
    expect(PerTurnUsageSchema.safeParse(snapshot).success).toBe(false);
  });
});

describe('normalized events', () => {
  const examples: Record<string, unknown> = {
    'session.observed': { cwd: '/repo', gitBranch: 'main', entrypoint: 'claude-desktop' },
    'session.started': { startSource: 'startup', model: null },
    'session.ended': { reason: 'prompt_input_exit' },
    'session.cwd_changed': { from: '/repo', to: '/repo/packages/a' },
    'session.titled': { title: 'Fix login bug', titleSource: 'user' },
    'session.attention': { notificationType: 'permission_prompt' },
    'session.turn_ended': {},
    'subagent.spawned': {
      parentProviderSessionId: 'sess-1',
      agentId: 'a1',
      agentType: 'Explore',
      description: 'Find usages',
      spawnToolUseId: 'toolu_1',
      spawnDepth: 1,
      model: null,
    },
    'subagent.stopped': { agentId: 'a1', agentType: 'Explore' },
    'message.user': { uuid: 'u1', parentUuid: null, isMeta: false },
    'message.assistant': {
      uuid: 'u2',
      parentUuid: 'u1',
      messageId: 'msg_1',
      requestId: 'req_1',
      model: 'model-a',
      stopReason: 'end_turn',
    },
    'tool.called': { toolUseId: 'toolu_1', toolName: 'Agent', messageId: 'msg_1' },
    'tool.result': { toolUseId: 'toolu_1', isError: false },
    'usage.reported': {
      kind: 'per-turn',
      messageId: 'msg_1',
      requestId: 'req_1',
      model: 'model-a',
      tokens,
    },
    'usage.snapshot': {
      kind: 'cumulative-snapshot',
      scope: 'unknown',
      byModel: { 'model-a': tokens },
      reportedCostUsd: null,
    },
    'provider.error': { kind: 'api_error', httpStatus: 529 },
    'record.unrecognized': { recordType: 'some-future-record' },
  };

  it('has one valid example per declared event type', () => {
    expect(new Set(EVENT_TYPES).size).toBe(EVENT_TYPES.length);
    expect(Object.keys(examples).sort()).toEqual([...EVENT_TYPES].sort());
  });

  it.each(Object.entries(examples))('accepts a valid %s event', (eventType, payload) => {
    const parsed = NormalizedEventSchema.parse({ ...envelope, eventType, payload });
    expect(parsed.eventType).toBe(eventType);
  });

  it('rejects a payload that does not match its event type', () => {
    const result = NormalizedEventSchema.safeParse({
      ...envelope,
      eventType: 'usage.reported',
      payload: examples['session.observed'],
    });
    expect(result.success).toBe(false);
  });

  it('rejects unknown event types and schema versions', () => {
    const payload = examples['session.ended'];
    expect(
      NormalizedEventSchema.safeParse({ ...envelope, eventType: 'session.completed', payload })
        .success,
    ).toBe(false);
    expect(
      NormalizedEventSchema.safeParse({
        ...envelope,
        schemaVersion: 2,
        eventType: 'session.ended',
        payload,
      }).success,
    ).toBe(false);
  });

  it('does not allow events with estimated or unavailable provenance', () => {
    const payload = examples['session.ended'];
    for (const provenance of ['estimated', 'unavailable']) {
      expect(
        NormalizedEventSchema.safeParse({
          ...envelope,
          provenance,
          eventType: 'session.ended',
          payload,
        }).success,
      ).toBe(false);
    }
  });
});

describe('session edges', () => {
  const parent = { provider: 'claude-code', providerSessionId: 'sess-1', providerAgentId: null };
  const child = { provider: 'claude-code', providerSessionId: 'sess-1', providerAgentId: 'a1' };

  it('accepts a subagent edge backed by subagent evidence', () => {
    expect(
      SessionEdgeSchema.safeParse({
        kind: 'subagent',
        parent,
        child,
        provenance: 'observed',
        evidence: ['subagent-metadata', 'spawn-tool-use'],
      }).success,
    ).toBe(true);
  });

  it('rejects edges without evidence', () => {
    expect(
      SessionEdgeSchema.safeParse({
        kind: 'subagent',
        parent,
        child,
        provenance: 'observed',
        evidence: [],
      }).success,
    ).toBe(false);
  });

  it('does not let shared history alone create a subagent edge', () => {
    expect(
      SessionEdgeSchema.safeParse({
        kind: 'subagent',
        parent,
        child,
        provenance: 'derived',
        evidence: ['shared-message-history'],
      }).success,
    ).toBe(false);
  });

  it('requires shared-message-history evidence for continuation edges', () => {
    const forked = { ...parent, providerSessionId: 'sess-2' };
    expect(
      SessionEdgeSchema.safeParse({
        kind: 'continuation',
        parent,
        child: forked,
        provenance: 'derived',
        evidence: ['subagent-metadata'],
      }).success,
    ).toBe(false);
    expect(
      SessionEdgeSchema.safeParse({
        kind: 'continuation',
        parent,
        child: forked,
        provenance: 'derived',
        evidence: ['shared-message-history'],
      }).success,
    ).toBe(true);
  });
});

describe('project registration', () => {
  it('requires an absolute root path', () => {
    expect(RegisterProjectInputSchema.safeParse({ name: 'x', rootPath: 'repo' }).success).toBe(
      false,
    );
    expect(RegisterProjectInputSchema.safeParse({ name: 'x', rootPath: '/repo' }).success).toBe(
      true,
    );
  });
});
