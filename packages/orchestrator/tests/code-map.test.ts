// Synthetic data only. ADR-0034 §4 (CM-2): the read-only `code_map` tool and tool-use counts.
import { describe, expect, it } from 'vitest';
import { controlToolsFor } from '../src/index.js';
import { event, LEAD, ok, refused, runningRun, startWorker } from './helpers.js';
import { A, helper, leadTool, loopRunning, readyForReview, RA } from './loop-helpers.js';

describe('code_map (ADR-0034 §4)', () => {
  it('is offered to every agent of the run', () => {
    const s = readyForReview(helper(loopRunning(), 'API', 'wa'), A);
    for (const id of [LEAD, A, RA]) expect(controlToolsFor(s, id)).toContain('code_map');
    const { state, id } = startWorker(runningRun());
    expect(controlToolsFor(state, id)).toContain('code_map');
  });

  it('any caller gets an empty engine value, with no state change and no effects', () => {
    const s = readyForReview(helper(loopRunning(), 'API', 'wa'), A);
    for (const caller of [LEAD, A, RA]) {
      const r = ok(leadTool(s, 'code_map', { action: 'search', query: 'app' }, 'cm', caller));
      expect(r.state).toBe(s);
      expect(r.effects).toEqual([]);
      expect(r.value).toBe('');
    }
  });

  it('refuses invalid input and an unknown caller', () => {
    const s = loopRunning();
    expect(refused(leadTool(s, 'code_map', { action: 'cat', path: 'a.ts' }))).toBe('invalid-input');
    expect(refused(leadTool(s, 'code_map', { action: 'file', depth: 3 }))).toBe('invalid-input');
    expect(refused(leadTool(s, 'code_map', { action: 'file' }, 'cm', 'nobody'))).toBe(
      'unknown-agent',
    );
  });
});

describe('tool-use counts (CM-2)', () => {
  it('counts each category on the agent, replacing the object each time', () => {
    const { state, id } = startWorker(runningRun());
    let s = state;
    const categories = ['read', 'read', 'search', 'edit', 'shell', 'code_map', 'other'] as const;
    const seen: unknown[] = [];
    for (const category of categories) {
      s = ok(event(s, id, { type: 'tool-use', category })).state;
      seen.push(s.agents.find((a) => a.id === id)?.toolCounts);
    }
    expect(seen.at(-1)).toEqual({ read: 2, search: 1, edit: 1, shell: 1, code_map: 1, other: 1 });
    expect(new Set(seen).size).toBe(categories.length);
    expect(s.agents.find((a) => a.id === LEAD)?.toolCounts).toBeUndefined();
  });

  it('drops an unknown category with a diagnostic', () => {
    const { state, id } = startWorker(runningRun());
    const r = ok(event(state, id, { type: 'tool-use', category: 'browse' as 'read' }));
    expect(r.state.agents.find((a) => a.id === id)?.toolCounts).toBeUndefined();
    expect(r.effects).toContainEqual({
      type: 'diagnostic',
      code: 'invalid-tool-use',
      agentRunId: id,
    });
  });
});
