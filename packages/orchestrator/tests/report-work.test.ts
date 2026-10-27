// Synthetic data only. ADR-0026 §3 (C-A): the helper's and tester's `report_work` note.
import { describe, expect, it } from 'vitest';
import { MAX_AGENT_NOTE_CHARS } from '@acp/core';
import {
  BRANCH_RULE_LINE,
  AGENT_NOTE_LINE,
  cancelRun,
  cleanAgentNote,
  controlToolsFor,
  withAgentNoteLine,
} from '../src/index.js';
import { LEAD, makeCtx, ok, refused, runningRun, startWorker } from './helpers.js';
import {
  A,
  effectsOf,
  finishTurn,
  helper,
  leadTool,
  loopRunning,
  readyForReview,
  RA,
} from './loop-helpers.js';

describe('report_work (ADR-0026 §3)', () => {
  it('a helper of a ticket run gets it, and its brief asks for it', () => {
    const s0 = loopRunning();
    const started = ok(leadTool(s0, 'start_agent', { role: 'API', task: 'Build the API' }, 'wa'));
    const start = effectsOf(started.effects, 'start-agent')[0];
    expect(start?.prompt).toBe(`Build the API\n\n${BRANCH_RULE_LINE}\n\n${AGENT_NOTE_LINE}`);
    const s = helper(s0, 'API', 'wa');
    expect(controlToolsFor(s, A)).toEqual(['report_work']);
    // Never the lead's, and the lead may not call it.
    expect(controlToolsFor(s, LEAD)).not.toContain('report_work');
    expect(refused(leadTool(s, 'report_work', { note: 'Done.' }))).toBe('not-lead');
  });

  it('stores the note as an agent-note effect, redacted and capped, without changing the run', () => {
    const s = helper(loopRunning(), 'API', 'wa');
    const r = ok(
      leadTool(s, 'report_work', { note: '  Added the endpoint and two tests.  ' }, 'n', A),
    );
    expect(r.effects).toEqual([
      { type: 'agent-note', agentRunId: A, body: 'Added the endpoint and two tests.' },
      // ADR-0030 §5: the outcome (default `completed`) for the lead and the operation.
      { type: 'helper-outcome', agentRunId: A, outcome: 'completed' },
    ]);
    expect(r.value).toContain('Noted on the ticket');
    // Only the in-memory report changes; the run and every status stay as they were.
    expect(r.state.run.status).toBe(s.run.status);
    expect(r.state.agents.map(({ reportedOutcome: _, ...a }) => a)).toEqual(s.agents);
    // A second call is allowed: the server replaces the earlier note.
    const again = ok(leadTool(r.state, 'report_work', { note: 'Fixed it.' }, 'n2', A));
    expect(effectsOf(again.effects, 'agent-note')[0]?.body).toBe('Fixed it.');
  });

  it('refuses an invalid note, a stopped run and an agent whose turn ended', () => {
    const s = helper(loopRunning(), 'API', 'wa');
    expect(refused(leadTool(s, 'report_work', { note: '' }, 'n', A))).toBe('invalid-input');
    expect(
      refused(leadTool(s, 'report_work', { note: 'x'.repeat(MAX_AGENT_NOTE_CHARS + 1) }, 'n', A)),
    ).toBe('invalid-input');
    const ended = ok(finishTurn(s, A)).state;
    expect(refused(leadTool(ended, 'report_work', { note: 'Late.' }, 'n', A))).toBe(
      'agent-not-live',
    );
    const stopping = ok(cancelRun(s, makeCtx(3000))).state;
    expect(refused(leadTool(stopping, 'report_work', { note: 'Late.' }, 'n', A))).toBe(
      'run-cancelling',
    );
  });

  it('is not for planners or reviewers', () => {
    const s = readyForReview(helper(loopRunning(), 'API', 'wa'), A);
    expect(controlToolsFor(s, RA)).toEqual(['submit_review']);
    expect(refused(leadTool(s, 'report_work', { note: 'x' }, 'n', RA))).toBe('not-lead');
  });

  it('a run without a ticket offers no note tool and no note line', () => {
    const { state, id } = startWorker(runningRun());
    expect(controlToolsFor(state, id)).toEqual([]);
    expect(refused(leadTool(state, 'report_work', { note: 'x' }, 'n', id))).toBe('invalid-input');
    expect(withAgentNoteLine('Do it', false)).toBe('Do it');
  });

  it('cleans the note like other ticket text', () => {
    expect(cleanAgentNote('  short  ')).toBe('short');
    const long = cleanAgentNote('y'.repeat(MAX_AGENT_NOTE_CHARS + 50));
    expect(long).toHaveLength(MAX_AGENT_NOTE_CHARS);
    expect(long.endsWith('…')).toBe(true);
  });
});
