import { describe, expect, it } from 'vitest';
import { thrown } from '../helpers.js';
import { BUDGET, setupOrchestration } from './setup.js';

describe('orchestrator messages repository (P3-C, ADR-0015)', () => {
  it('appends owner and lead messages in order with a per-run sequence', () => {
    const store = setupOrchestration();
    const run = store.orch.runs.insert({ projectId: store.projectId, title: 'T', budget: BUDGET });
    const other = store.orch.runs.insert({
      projectId: store.projectId,
      title: 'U',
      budget: BUDGET,
    });
    const m1 = store.orch.messages.insert({ runId: run.id, role: 'owner', text: 'Synthetic ask' });
    const m2 = store.orch.messages.insert({ runId: run.id, role: 'lead', text: 'Synthetic reply' });
    const o1 = store.orch.messages.insert({ runId: other.id, role: 'owner', text: 'Other run' });
    expect(m1).toMatchObject({ runId: run.id, seq: 1, role: 'owner', text: 'Synthetic ask' });
    expect(m2.seq).toBe(2);
    expect(o1.seq).toBe(1);
    expect(store.orch.messages.list(run.id)).toEqual([m1, m2]);
    expect(store.orch.messages.count(run.id)).toBe(2);
  });

  it('pages backwards from the newest message, returning each page oldest first', () => {
    const store = setupOrchestration();
    const run = store.orch.runs.insert({ projectId: store.projectId, title: 'T', budget: BUDGET });
    for (let i = 1; i <= 5; i++) {
      store.orch.messages.insert({ runId: run.id, role: i % 2 ? 'owner' : 'lead', text: `m${i}` });
    }
    expect(store.orch.messages.list(run.id, { limit: 2 }).map((m) => m.text)).toEqual(['m4', 'm5']);
    expect(store.orch.messages.list(run.id, { limit: 2, beforeSeq: 4 }).map((m) => m.text)).toEqual(
      ['m2', 'm3'],
    );
    expect(thrown(() => store.orch.messages.list(run.id, { beforeSeq: 0 }))).toMatchObject({
      code: 'invalid_input',
    });
  });

  it('rejects unknown runs, roles, and empty text', () => {
    const store = setupOrchestration();
    const run = store.orch.runs.insert({ projectId: store.projectId, title: 'T', budget: BUDGET });
    expect(
      thrown(() => store.orch.messages.insert({ runId: 'missing', role: 'owner', text: 'x' })),
    ).toMatchObject({ code: 'not_found' });
    expect(
      // @ts-expect-error: workers never write to the chat
      thrown(() => store.orch.messages.insert({ runId: run.id, role: 'worker', text: 'x' })),
    ).toMatchObject({ code: 'invalid_input' });
    expect(
      thrown(() => store.orch.messages.insert({ runId: run.id, role: 'owner', text: '' })),
    ).toMatchObject({ code: 'invalid_input' });
  });
});
