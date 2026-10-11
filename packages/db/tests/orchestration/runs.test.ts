import { describe, expect, it } from 'vitest';
import { DbError } from '../../src/index.js';
import { thrown } from '../helpers.js';
import { BUDGET, runWithAgents, setupOrchestration } from './setup.js';

describe('orchestration runs repository (P3-C)', () => {
  it('inserts a QUEUED run and reads it back', () => {
    const store = setupOrchestration();
    const run = store.orch.runs.insert({
      projectId: store.projectId,
      title: 'Build X',
      budget: BUDGET,
    });
    expect(run).toEqual({
      id: 'id-0002',
      projectId: store.projectId,
      title: 'Build X',
      status: 'QUEUED',
      budget: BUDGET,
      createdAt: '2026-10-11T12:00:01.000Z',
      updatedAt: '2026-10-11T12:00:01.000Z',
      endedAt: null,
    });
    expect(store.orch.runs.getById(run.id)).toEqual(run);
    expect(store.orch.runs.getById('missing')).toBeUndefined();
  });

  it('rejects invalid input and an unknown project with typed errors', () => {
    const store = setupOrchestration();
    const base = { projectId: store.projectId, title: 'T', budget: BUDGET };
    expect(thrown(() => store.orch.runs.insert({ ...base, title: '' }))).toMatchObject({
      code: 'invalid_input',
    });
    expect(
      thrown(() => store.orch.runs.insert({ ...base, title: 'x'.repeat(201) })),
    ).toBeInstanceOf(DbError);
    expect(
      thrown(() =>
        store.orch.runs.insert({
          ...base,
          budget: { maxTokensPerAgent: 0, softCostUsdPerRun: null },
        }),
      ),
    ).toMatchObject({ code: 'invalid_input' });
    expect(
      thrown(() =>
        // @ts-expect-error: an unknown status is rejected at runtime too
        store.orch.runs.insert({ ...base, status: 'DONE' }),
      ),
    ).toMatchObject({ code: 'invalid_input' });
    expect(thrown(() => store.orch.runs.insert({ ...base, projectId: 'nope' }))).toMatchObject({
      code: 'not_found',
    });
  });

  it('lists newest first with agent and pending-approval counts, by project, with a cursor', () => {
    const store = setupOrchestration();
    const other = store.repos.projects.insert({ name: 'other', rootPath: '/home/user/other' });
    const a = runWithAgents(store, 2);
    store.orch.approvals.insert({
      runId: a.run.id,
      agentRunId: a.workers[0]!.id, // two workers were created above
      kind: 'tool-use',
      toolName: 'Edit',
      summary: 'Edit src/app.ts',
    });
    const b = store.orch.runs.insert({ projectId: other.id, title: 'Other', budget: BUDGET });

    const all = store.orch.runs.list();
    expect(all.map((r) => [r.id, r.agentCount, r.pendingApprovals])).toEqual([
      [b.id, 0, 0],
      [a.run.id, 3, 1],
    ]);
    expect(store.orch.runs.list({ projectId: other.id }).map((r) => r.id)).toEqual([b.id]);
    const page1 = store.orch.runs.list({ limit: 1 });
    expect(page1.map((r) => r.id)).toEqual([b.id]);
    const last = page1[0]!; // limit 1 returned one row
    expect(
      store.orch.runs
        .list({ limit: 1, before: { createdAt: last.createdAt, id: last.id } })
        .map((r) => r.id),
    ).toEqual([a.run.id]);
    expect(() => store.orch.runs.list({ limit: 0 })).toThrow(DbError);
  });

  it('updates status with an optional from-guard, and sets endedAt', () => {
    const store = setupOrchestration();
    const run = store.orch.runs.insert({ projectId: store.projectId, title: 'T', budget: BUDGET });
    const running = store.orch.runs.setStatus(run.id, 'RUNNING', { from: ['QUEUED'] });
    expect(running).toMatchObject({ status: 'RUNNING', endedAt: null });
    expect((running?.updatedAt ?? '') > run.updatedAt).toBe(true);

    expect(
      thrown(() => store.orch.runs.setStatus(run.id, 'REVIEW', { from: ['QUEUED'] })),
    ).toMatchObject({ code: 'conflict' });
    expect(store.orch.runs.getById(run.id)?.status).toBe('RUNNING');

    const ended = store.orch.runs.setStatus(run.id, 'CANCELLED', {
      endedAt: '2026-10-11T14:00:00+02:00',
    });
    expect(ended).toMatchObject({ status: 'CANCELLED', endedAt: '2026-10-11T12:00:00.000Z' });
    expect(store.orch.runs.setStatus('missing', 'RUNNING')).toBeUndefined();
    expect(thrown(() => store.orch.runs.setStatus(run.id, 'RUNNING', { from: [] }))).toMatchObject({
      code: 'invalid_input',
    });
  });

  it('lists runs by status for restart handling', () => {
    const store = setupOrchestration();
    const a = store.orch.runs.insert({ projectId: store.projectId, title: 'A', budget: BUDGET });
    const b = store.orch.runs.insert({ projectId: store.projectId, title: 'B', budget: BUDGET });
    store.orch.runs.setStatus(b.id, 'RUNNING');
    expect(store.orch.runs.listByStatus(['RUNNING', 'BLOCKED']).map((r) => r.id)).toEqual([b.id]);
    expect(store.orch.runs.listByStatus(['QUEUED']).map((r) => r.id)).toEqual([a.id]);
    expect(store.orch.runs.listByStatus([])).toEqual([]);
  });

  it('changes the budget', () => {
    const store = setupOrchestration();
    const run = store.orch.runs.insert({ projectId: store.projectId, title: 'T', budget: BUDGET });
    const budget = { maxTokensPerAgent: 750_000, softCostUsdPerRun: 5 };
    expect(store.orch.runs.setBudget(run.id, budget)?.budget).toEqual(budget);
    expect(store.orch.runs.setBudget('missing', budget)).toBeUndefined();
  });

  it('refuses to unregister a project that still has runs', () => {
    const store = setupOrchestration();
    store.orch.runs.insert({ projectId: store.projectId, title: 'T', budget: BUDGET });
    expect(() => store.repos.projects.remove(store.projectId)).toThrow(/FOREIGN KEY/);
  });
});
