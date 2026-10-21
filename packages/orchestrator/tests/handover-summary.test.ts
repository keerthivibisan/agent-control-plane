import { describe, expect, it } from 'vitest';
import {
  HANDOVER_NOTE_LINE,
  HANDOVER_NOTE_MAX_CHARS,
  agentEvent,
  cleanHandoverNote,
  leadToolCall,
  requestTicketChanges,
} from '../src/index.js';
import { LEAD, REGISTERED, makeCtx, ok, runningRun, startWorker } from './helpers.js';
import { leadMessages, leadTool, mergedA, types } from './loop-helpers.js';

/**
 * ADR-0024 §3 (v0.3.0 S-A): the lead's `request_review.summary` reaches the server through the
 * `handover-summary` effect of a review-loop handover; legacy runs emit nothing new. Synthetic
 * data only.
 */

describe('the handover note', () => {
  it('goes to the server, trimmed, with the handover', () => {
    const r = ok(
      leadTool(mergedA(), 'request_review', { summary: '  Added the toggle. Tests pass.  ' }, 'h'),
    );
    expect(r.effects).toContainEqual({
      type: 'handover-summary',
      note: 'Added the toggle. Tests pass.',
    });
    expect(r.state.integration?.handedOver).toBe(true);
  });

  it('is null without a summary, and the handover still works', () => {
    const r = ok(leadTool(mergedA(), 'request_review', {}, 'h'));
    expect(r.effects.filter((e) => e.type === 'handover-summary')).toEqual([
      { type: 'handover-summary', note: null },
    ]);
  });

  it('is redacted and capped at 1,500 characters', () => {
    expect(cleanHandoverNote('Key sk-ant-abcdefghijkl0123 was not used.')).not.toContain('sk-ant-');
    const long = cleanHandoverNote('x'.repeat(HANDOVER_NOTE_MAX_CHARS + 10)) ?? '';
    expect(long).toHaveLength(HANDOVER_NOTE_MAX_CHARS);
    expect(long.endsWith('…')).toBe(true);
    expect(cleanHandoverNote('   ')).toBeNull();
    expect(cleanHandoverNote(undefined)).toBeNull();
  });

  it('is refused when it breaks the contract (too long)', () => {
    const r = leadTool(mergedA(), 'request_review', { summary: 'x'.repeat(1501) }, 'h');
    expect(r.ok).toBe(false);
  });

  it('is never emitted by a legacy run, with or without a summary', () => {
    let s = runningRun();
    const w = startWorker(s);
    s = ok(
      agentEvent(
        w.state,
        w.id,
        { type: 'finished', outcome: 'success', reportedCostUsd: null },
        makeCtx(3000),
      ),
    ).state;
    const r = ok(
      leadToolCall(
        s,
        {
          callerAgentRunId: LEAD,
          name: 'request_review',
          input: { summary: 'Done.' },
          registeredProjectIds: REGISTERED,
        },
        makeCtx(4000, 'rr'),
      ),
    );
    expect(r.state.run.status).toBe('REVIEW');
    expect(types(r.effects)).not.toContain('handover-summary');
  });

  it('is asked for in the hand-over prompts', () => {
    expect(HANDOVER_NOTE_LINE).toContain('3 to 6 short plain sentences');
    const changes = ok(
      requestTicketChanges(
        ok(leadTool(mergedA(), 'request_review', {}, 'h')).state,
        'Also cover the settings page.',
        makeCtx(9000, 'rc'),
      ),
    );
    expect(leadMessages(changes.effects).join('\n')).toContain(
      'call request_review again with an updated summary',
    );
  });
});
