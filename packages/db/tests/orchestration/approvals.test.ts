import { describe, expect, it } from 'vitest';
import { thrown } from '../helpers.js';
import { runWithAgents, setupOrchestration } from './setup.js';

describe('approvals repository (P3-C)', () => {
  function setup() {
    const store = setupOrchestration();
    const { run, workers } = runWithAgents(store, 1);
    const worker = workers[0]!; // one worker was created above
    const input = {
      runId: run.id,
      agentRunId: worker.id,
      kind: 'tool-use' as const,
      toolName: 'Edit',
      summary: 'Edit src/app.ts',
    };
    return { store, run, worker, input };
  }

  it('creates a pending approval and lists it', () => {
    const { store, run, worker, input } = setup();
    const approval = store.orch.approvals.insert(input);
    expect(approval).toEqual({
      id: approval.id,
      runId: run.id,
      agentRunId: worker.id,
      kind: 'tool-use',
      toolName: 'Edit',
      summary: 'Edit src/app.ts',
      status: 'pending',
      requestedAt: approval.requestedAt,
      decidedAt: null,
    });
    expect(store.orch.approvals.getById(approval.id)).toEqual(approval);
    expect(store.orch.approvals.listForRun(run.id)).toEqual([approval]);
    expect(store.orch.approvals.listPending()).toEqual([approval]);
    expect(store.orch.approvals.listPending({ runId: 'other' })).toEqual([]);
  });

  it('caps the summary at 200 characters and redacts it again before storage', () => {
    const { store, input } = setup();
    expect(
      thrown(() => store.orch.approvals.insert({ ...input, summary: 'x'.repeat(201) })),
    ).toMatchObject({ code: 'invalid_input' });
    expect(thrown(() => store.orch.approvals.insert({ ...input, summary: '' }))).toMatchObject({
      code: 'invalid_input',
    });
    const secret = 'sk-ant-api03-' + 'A'.repeat(40);
    const stored = store.orch.approvals.insert({
      ...input,
      toolName: 'Bash',
      summary: `Bash ${secret}`,
    });
    expect(stored.summary).not.toContain(secret);
    expect(stored.summary.length).toBeLessThanOrEqual(200);
  });

  it('rejects an agent from another run, an unknown run, and an unknown kind', () => {
    const { store, input } = setup();
    const other = runWithAgents(store, 0);
    expect(
      thrown(() => store.orch.approvals.insert({ ...input, runId: other.run.id })),
    ).toMatchObject({ code: 'not_found' });
    expect(thrown(() => store.orch.approvals.insert({ ...input, runId: 'missing' }))).toMatchObject(
      {
        code: 'not_found',
      },
    );
    expect(
      // @ts-expect-error: an unknown kind is rejected at runtime too
      thrown(() => store.orch.approvals.insert({ ...input, kind: 'other' })),
    ).toMatchObject({ code: 'invalid_input' });
  });

  it('records a decision once; decisions are immutable', () => {
    const { store, input } = setup();
    const approval = store.orch.approvals.insert(input);
    const decided = store.orch.approvals.decide(approval.id, 'approved');
    expect(decided).toMatchObject({ status: 'approved' });
    expect(decided?.decidedAt).not.toBeNull();
    expect(thrown(() => store.orch.approvals.decide(approval.id, 'denied'))).toMatchObject({
      code: 'conflict',
    });
    expect(store.orch.approvals.getById(approval.id)?.status).toBe('approved');
    expect(store.orch.approvals.decide('missing', 'denied')).toBeUndefined();
    expect(
      // @ts-expect-error: 'pending' is not a decision
      thrown(() => store.orch.approvals.decide(approval.id, 'pending')),
    ).toMatchObject({ code: 'invalid_input' });
    expect(store.orch.approvals.listPending()).toEqual([]);
  });

  it('expires pending approvals requested at or before a cutoff (timeout → deny)', () => {
    const { store, input } = setup();
    const first = store.orch.approvals.insert(input);
    const second = store.orch.approvals.insert({ ...input, summary: 'Write README.md' });
    const expired = store.orch.approvals.expirePending(
      first.requestedAt,
      '2026-10-11T13:00:00.000Z',
    );
    expect(expired.map((a) => [a.id, a.status, a.decidedAt])).toEqual([
      [first.id, 'expired', '2026-10-11T13:00:00.000Z'],
    ]);
    expect(store.orch.approvals.listPending().map((a) => a.id)).toEqual([second.id]);
  });

  it('stores a budget-raise approval without a tool name', () => {
    const { store, input } = setup();
    const raise = store.orch.approvals.insert({
      ...input,
      kind: 'budget-raise',
      toolName: null,
      summary: 'Worker 1 reached its budget of 500,000 budget tokens',
    });
    expect(raise).toMatchObject({ kind: 'budget-raise', toolName: null, status: 'pending' });
  });
});
