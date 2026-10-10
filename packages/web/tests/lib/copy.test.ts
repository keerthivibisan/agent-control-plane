import { EVENT_TYPES, SessionStatusSchema, type EventType } from '@acp/core';
import { describe, expect, it } from 'vitest';
import {
  describeEvent,
  GLOSSARY,
  partialNote,
  sharedMessagesText,
  STATUS_COPY,
  TOKEN_TYPES,
} from '../../src/lib/copy';
import { event } from '../fixtures/dto';

/** One case per event type (plus variants), each with the DESIGN.md sentence. */
const CASES: readonly [EventType, Record<string, unknown>, string][] = [
  ['message.user', { uuid: 'u', parentUuid: null, isMeta: false }, 'You sent a message'],
  ['message.user', { uuid: 'u', parentUuid: null, isMeta: true }, 'Claude Code added a message'],
  [
    'message.assistant',
    {
      uuid: 'u',
      parentUuid: null,
      messageId: 'm',
      requestId: null,
      model: 'model-a',
      stopReason: null,
    },
    'Claude replied (model-a)',
  ],
  [
    'message.assistant',
    { uuid: 'u', parentUuid: null, messageId: 'm', requestId: null, model: null, stopReason: null },
    'Claude replied',
  ],
  [
    'usage.reported',
    {
      kind: 'per-turn',
      messageId: 'm',
      requestId: null,
      model: 'model-a',
      tokens: { input: 1200, output: 340, cacheCreation: 5, cacheRead: 9000 },
    },
    'Used 1,200 input · 340 output tokens',
  ],
  [
    'usage.reported',
    {
      kind: 'per-turn',
      messageId: 'm',
      requestId: null,
      model: null,
      tokens: { input: null, output: 0, cacheCreation: null, cacheRead: null },
    },
    'Used input not reported · 0 output tokens',
  ],
  ['tool.called', { toolUseId: 't', toolName: 'Bash', messageId: null }, 'Used tool: Bash'],
  ['tool.result', { toolUseId: 't', isError: false }, 'Tool finished'],
  ['tool.result', { toolUseId: 't', isError: null }, 'Tool finished'],
  ['tool.result', { toolUseId: 't', isError: true }, 'Tool failed'],
  [
    'subagent.spawned',
    {
      parentProviderSessionId: 'p',
      agentId: 'a',
      agentType: 'Explore',
      description: null,
      spawnToolUseId: null,
      spawnDepth: 1,
      model: null,
    },
    'Started a helper agent: Explore',
  ],
  [
    'subagent.spawned',
    {
      parentProviderSessionId: 'p',
      agentId: 'a',
      agentType: null,
      description: null,
      spawnToolUseId: null,
      spawnDepth: null,
      model: null,
    },
    'Started a helper agent',
  ],
  ['subagent.stopped', { agentId: 'a', agentType: 'Explore' }, 'Helper agent finished'],
  ['session.observed', { cwd: '/w', gitBranch: null, entrypoint: null }, 'Session found'],
  ['session.started', { startSource: 'startup', model: null }, 'Session started'],
  ['session.ended', { reason: 'exit' }, 'Session ended'],
  ['session.titled', { title: 'Fix the login bug', titleSource: 'ai' }, 'Named: Fix the login bug'],
  ['session.attention', { notificationType: 'permission_prompt' }, 'Waiting for you'],
  ['session.turn_ended', {}, 'Finished its turn'],
  ['session.cwd_changed', { from: '/a', to: '/b' }, 'Moved to another folder'],
  [
    'usage.snapshot',
    { kind: 'cumulative-snapshot', scope: 'unknown', byModel: {}, reportedCostUsd: 0.5 },
    'Claude Code reported a running total',
  ],
  [
    'provider.error',
    { kind: 'rate_limit', httpStatus: 429 },
    'The model returned an error (rate_limit)',
  ],
  ['provider.error', { kind: null, httpStatus: null }, 'The model returned an error'],
  ['record.unrecognized', { recordType: 'mystery' }, 'Unknown record (skipped)'],
];

describe('describeEvent', () => {
  it.each(CASES)('%s %j → %s', (eventType, payload, expected) => {
    expect(describeEvent(event({ id: 1, eventType, payload }))).toBe(expected);
  });

  it('has a sentence for every event type', () => {
    const covered = new Set(CASES.map(([t]) => t));
    expect(EVENT_TYPES.filter((t) => !covered.has(t))).toEqual([]);
  });

  it('never exposes raw event type names or payload keys', () => {
    for (const [eventType, payload] of CASES) {
      const text = describeEvent({ eventType, payload });
      expect(text).not.toContain(eventType);
      expect(text).not.toContain('=');
    }
  });
});

describe('copy', () => {
  it('has a status word and tip for every status, and no "completed"', () => {
    for (const s of SessionStatusSchema.options) {
      expect(STATUS_COPY[s].word.length).toBeGreaterThan(0);
      expect(STATUS_COPY[s].tip.length).toBeGreaterThan(0);
    }
    expect(JSON.stringify(STATUS_COPY)).not.toMatch(/complete/i);
    expect(STATUS_COPY.stale.word).toBe('Inactive');
    expect(STATUS_COPY.active.word).toBe('Running');
  });

  it('lists the four token types in display order with DESIGN.md labels', () => {
    expect(TOKEN_TYPES.map((t) => t.key)).toEqual([
      'input',
      'output',
      'cacheCreation',
      'cacheRead',
    ]);
    expect(TOKEN_TYPES.map((t) => t.label)).toEqual([
      'Input tokens',
      'Output tokens',
      'Cache write tokens',
      'Cache read tokens',
    ]);
    for (const t of TOKEN_TYPES) expect(t.tip.length).toBeGreaterThan(0);
  });

  it('says cost is an estimate reported by Claude Code', () => {
    expect(GLOSSARY.estimatedCost.term).toBe('Estimated cost');
    expect(GLOSSARY.estimatedCost.tip).toMatch(/reported by Claude Code/);
  });

  it('builds the shared-messages and partial notes in plain words', () => {
    expect(sharedMessagesText(1)).toBe(
      '1 message was copied between sessions (resume/fork); each is counted only once.',
    );
    expect(sharedMessagesText(1200)).toMatch(/^1,200 messages were copied/);
    expect(partialNote(3, 12)).toBe(
      "3 of 12 records didn't report this, so the real number may be higher.",
    );
  });
});
