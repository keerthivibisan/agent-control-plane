import { describe, expect, it } from 'vitest';
import { thrown } from '../helpers.js';
import { BUDGET, runWithAgents, setupOrchestration } from './setup.js';

describe('agent runs repository (P3-C)', () => {
  it('stores a lead and workers with the run cap as their budget limit', () => {
    const store = setupOrchestration();
    const { run, lead, workers } = runWithAgents(store, 2);
    expect(lead).toEqual({
      id: lead.id,
      runId: run.id,
      parentAgentRunId: null,
      kind: 'lead',
      role: 'Lead',
      task: null,
      status: 'QUEUED',
      sessionId: null,
      budgetTokensUsed: 0,
      budgetTokensLimit: BUDGET.maxTokensPerAgent,
      createdAt: lead.createdAt,
      endedAt: null,
    });
    expect(workers[0]).toMatchObject({
      kind: 'worker',
      parentAgentRunId: lead.id,
      task: 'Synthetic task 1',
    });
    expect(store.orch.agentRuns.listForRun(run.id).map((a) => a.role)).toEqual([
      'Lead',
      'Worker 1',
      'Worker 2',
    ]);
    expect(store.orch.agentRuns.getById('missing')).toBeUndefined();
  });

  it('enforces the lead/worker shape, depth <= 2, one lead, and same-run parents', () => {
    const store = setupOrchestration();
    const { run, lead, workers } = runWithAgents(store, 1);
    const worker = workers[0]!; // one worker was created above
    const base = { runId: run.id, role: 'R', status: 'QUEUED' as const };

    // A lead with a task, a worker without a parent or task.
    expect(
      thrown(() =>
        store.orch.agentRuns.insert({ ...base, kind: 'lead', parentAgentRunId: null, task: 't' }),
      ),
    ).toMatchObject({ code: 'invalid_input' });
    expect(
      thrown(() =>
        store.orch.agentRuns.insert({ ...base, kind: 'worker', parentAgentRunId: null, task: 't' }),
      ),
    ).toMatchObject({ code: 'invalid_input' });
    // Depth 2 (P4-B, ADR-0013 amendment): a helper's helper is allowed; depth 3 is refused.
    const child = store.orch.agentRuns.insert({
      ...base,
      kind: 'worker',
      parentAgentRunId: worker.id,
      task: 't',
    });
    expect(child.parentAgentRunId).toBe(worker.id);
    expect(
      thrown(() =>
        store.orch.agentRuns.insert({
          ...base,
          kind: 'worker',
          parentAgentRunId: child.id,
          task: 't',
        }),
      ),
    ).toMatchObject({ code: 'invalid_input' });
    // A second lead in the same run.
    expect(
      thrown(() =>
        store.orch.agentRuns.insert({ ...base, kind: 'lead', parentAgentRunId: null, task: null }),
      ),
    ).toMatchObject({ code: 'conflict' });
    // A parent from another run, and an unknown run.
    const other = runWithAgents(store, 0);
    expect(
      thrown(() =>
        store.orch.agentRuns.insert({
          ...base,
          runId: other.run.id,
          kind: 'worker',
          parentAgentRunId: lead.id,
          task: 't',
        }),
      ),
    ).toMatchObject({ code: 'not_found' });
    expect(
      thrown(() =>
        store.orch.agentRuns.insert({
          ...base,
          runId: 'missing',
          kind: 'lead',
          parentAgentRunId: null,
          task: null,
        }),
      ),
    ).toMatchObject({ code: 'not_found' });
    // Text limits from core's AgentRunSchema.
    expect(
      thrown(() =>
        store.orch.agentRuns.insert({
          ...base,
          kind: 'worker',
          parentAgentRunId: lead.id,
          task: 'x'.repeat(4001),
        }),
      ),
    ).toMatchObject({ code: 'invalid_input' });
    expect(
      thrown(() =>
        store.orch.agentRuns.insert({
          ...base,
          role: 'x'.repeat(61),
          kind: 'worker',
          parentAgentRunId: lead.id,
          task: 't',
        }),
      ),
    ).toMatchObject({ code: 'invalid_input' });
  });

  it('updates status with a from-guard, budget used and limit', () => {
    const store = setupOrchestration();
    const { workers } = runWithAgents(store, 1);
    const w = workers[0]!; // one worker was created above
    expect(
      store.orch.agentRuns.setStatus(w.id, 'RUNNING', { from: ['QUEUED', 'STARTING'] })?.status,
    ).toBe('RUNNING');
    expect(
      thrown(() => store.orch.agentRuns.setStatus(w.id, 'RUNNING', { from: ['QUEUED'] })),
    ).toMatchObject({ code: 'conflict' });
    expect(
      store.orch.agentRuns.setStatus(w.id, 'SUCCEEDED', { endedAt: '2026-10-11T13:00:00.000Z' }),
    ).toMatchObject({ status: 'SUCCEEDED', endedAt: '2026-10-11T13:00:00.000Z' });
    expect(store.orch.agentRuns.setStatus('missing', 'FAILED')).toBeUndefined();

    expect(store.orch.agentRuns.setBudgetTokensUsed(w.id, 1234)?.budgetTokensUsed).toBe(1234);
    expect(store.orch.agentRuns.setBudgetTokensLimit(w.id, 900_000)?.budgetTokensLimit).toBe(
      900_000,
    );
    expect(thrown(() => store.orch.agentRuns.setBudgetTokensUsed(w.id, -1))).toMatchObject({
      code: 'invalid_input',
    });
    expect(thrown(() => store.orch.agentRuns.setBudgetTokensLimit(w.id, 0))).toMatchObject({
      code: 'invalid_input',
    });
    expect(store.orch.agentRuns.setBudgetTokensUsed('missing', 1)).toBeUndefined();
  });

  it('lists agents by status for restart handling', () => {
    const store = setupOrchestration();
    const { lead, workers } = runWithAgents(store, 2);
    store.orch.agentRuns.setStatus(lead.id, 'RUNNING');
    store.orch.agentRuns.setStatus(workers[1]!.id, 'WAITING_APPROVAL'); // two workers exist
    expect(
      store.orch.agentRuns.listByStatus(['RUNNING', 'WAITING_APPROVAL']).map((a) => a.id),
    ).toEqual([lead.id, workers[1]!.id]); // two workers exist
    expect(store.orch.agentRuns.listByStatus([])).toEqual([]);
  });
});

describe('agent run sessions repository (P3-C)', () => {
  it('links the primary provider session idempotently and resolves the observed session', () => {
    const store = setupOrchestration();
    const { lead } = runWithAgents(store, 0);
    const input = {
      agentRunId: lead.id,
      provider: 'claude-code' as const,
      providerSessionId: 'sess-managed-1',
      relation: 'primary' as const,
    };
    const link = store.orch.agentRunSessions.link(input);
    expect(link).toMatchObject({ ...input, sessionId: null });
    expect(store.orch.agentRunSessions.link(input)).toEqual(link);
    expect(store.orch.agentRuns.getById(lead.id)?.sessionId).toBeNull();

    // The observation pipeline ingests the session later; the link resolves without a write.
    const observed = store.repos.sessions.upsert({
      key: { provider: 'claude-code', providerSessionId: 'sess-managed-1', providerAgentId: null },
      origin: 'managed',
      firstSeenAt: '2026-10-11T12:00:00.000Z',
      lastObservedAt: '2026-10-11T12:00:00.000Z',
    });
    expect(store.orch.agentRuns.getById(lead.id)?.sessionId).toBe(observed.id);
    expect(store.orch.agentRunSessions.listForAgentRun(lead.id)[0]?.sessionId).toBe(observed.id);
    expect(
      store.orch.agentRunSessions
        .findByProviderSession('claude-code', 'sess-managed-1')
        .map((l) => l.agentRunId),
    ).toEqual([lead.id]);
  });

  it('lists the links of many provider sessions at once (ADR-0024 §2)', () => {
    const store = setupOrchestration();
    const { lead, workers } = runWithAgents(store, 2);
    const link = (agentRunId: string, providerSessionId: string) =>
      store.orch.agentRunSessions.link({
        agentRunId,
        provider: 'claude-code',
        providerSessionId,
        relation: 'primary',
      });
    link(lead.id, 'sess-a');
    link(workers[0]?.id ?? '', 'sess-b');
    link(workers[1]?.id ?? '', 'sess-c');
    const found = store.orch.agentRunSessions.listForProviderSessions('claude-code', [
      'sess-c',
      'sess-a',
      'sess-a',
      'unknown',
      '',
    ]);
    expect(found.map((l) => [l.agentRunId, l.providerSessionId])).toEqual([
      [lead.id, 'sess-a'],
      [workers[1]?.id, 'sess-c'],
    ]);
    expect(store.orch.agentRunSessions.listForProviderSessions('claude-code', [])).toEqual([]);
    // Many ids at once stay under SQLite's parameter limit.
    const many = Array.from({ length: 1000 }, (_, i) => `sess-x${i}`).concat('sess-b');
    expect(
      store.orch.agentRunSessions
        .listForProviderSessions('claude-code', many)
        .map((l) => l.agentRunId),
    ).toEqual([workers[0]?.id]);
  });

  it('allows one primary session per agent and rejects relation changes and unknown agents', () => {
    const store = setupOrchestration();
    const { lead } = runWithAgents(store, 0);
    const base = { agentRunId: lead.id, provider: 'claude-code' as const };
    store.orch.agentRunSessions.link({ ...base, providerSessionId: 's1', relation: 'primary' });
    expect(
      thrown(() =>
        store.orch.agentRunSessions.link({ ...base, providerSessionId: 's2', relation: 'primary' }),
      ),
    ).toMatchObject({ code: 'conflict' });
    expect(
      thrown(() =>
        store.orch.agentRunSessions.link({ ...base, providerSessionId: 's1', relation: 'retry' }),
      ),
    ).toMatchObject({ code: 'conflict' });
    store.orch.agentRunSessions.link({ ...base, providerSessionId: 's2', relation: 'retry' });
    expect(store.orch.agentRunSessions.listForAgentRun(lead.id)).toHaveLength(2);
    expect(
      thrown(() =>
        store.orch.agentRunSessions.link({
          ...base,
          agentRunId: 'missing',
          providerSessionId: 's3',
          relation: 'primary',
        }),
      ),
    ).toMatchObject({ code: 'not_found' });
    expect(
      thrown(() =>
        store.orch.agentRunSessions.link({
          ...base,
          // @ts-expect-error: an unknown provider is rejected at runtime too
          provider: 'other',
          providerSessionId: 's4',
          relation: 'primary',
        }),
      ),
    ).toMatchObject({ code: 'invalid_input' });
  });
});
