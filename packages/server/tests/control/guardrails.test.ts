import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ManagedExecutionAdapter } from '@acp/core';
import { CSRF_HEADER, ReviewDtoSchema, type StreamNoticeDto } from '@acp/core/api';
import { MAX_CONCURRENT_CHILD_AGENTS } from '@acp/core';
import request from 'supertest';
import { createFakeManagedAdapter } from './fake-adapter.js';
import { expectError, setupControl } from './helpers.js';

/*
 * Every ADR-0013 guardrail the server exposes, refused through the real routes or the adapter
 * callbacks: CSRF, an unregistered project, a 4th worker, depth, the budget soft cap, a
 * non-read-only tool without approval, and a merge into a dirty base. Plus the ordering rule:
 * state is persisted before any effect runs (orchestration-lifecycle §1).
 */

describe('CSRF (ADR-0013 §6)', () => {
  it('every mutating route needs the X-ACP-CSRF token; a wrong or missing one changes nothing', async () => {
    const s = await setupControl();
    const run = (await s.post('/api/runs', { projectId: s.project.id })).body as { id: string };
    const routes: [string, object][] = [
      ['/api/runs', { projectId: s.project.id }],
      [`/api/runs/${run.id}/chat`, { text: 'hi' }],
      ['/api/approvals/x', { decision: 'approve' }],
      [`/api/runs/${run.id}/agents/x/stop`, {}],
      [`/api/runs/${run.id}/agents/x/message`, { text: 'hi' }],
      [`/api/runs/${run.id}/stop`, {}],
      [`/api/runs/${run.id}/review`, { agentRunId: 'x', action: 'discard' }],
    ];
    for (const [path, body] of routes) {
      expectError(await request(s.app).post(path).send(body), 403, 'csrf_missing');
      expectError(
        await request(s.app).post(path).set(CSRF_HEADER, 'f'.repeat(64)).send(body),
        403,
        'csrf_invalid',
      );
      expectError(
        await request(s.app).post(path).set(CSRF_HEADER, s.token.slice(0, 10)).send(body),
        403,
        'csrf_invalid',
      );
    }
    expect(s.control.listRuns()).toHaveLength(1);
    expect(s.fake.agents).toEqual([]);
    expect((await s.detail(run.id)).status).toBe('QUEUED');
  });
});

describe('policy refusals surface as ErrorDtos or denies', () => {
  it('refuses a run for an unregistered project', async () => {
    const s = await setupControl();
    expectError(
      await s.post('/api/runs', { projectId: 'not-a-project' }),
      409,
      'project_not_registered',
    );
    expect(s.control.listRuns()).toEqual([]);
  });

  it(`refuses a worker beyond ${MAX_CONCURRENT_CHILD_AGENTS} live ones; the lead gets the reason`, async () => {
    const s = await setupControl();
    await s.startRun();
    s.fake.lead().started();
    for (let i = 0; i < MAX_CONCURRENT_CHILD_AGENTS; i++) await s.startWorker(`W${i}`, `Task ${i}`);
    await expect(
      s.fake.lead().callLead('start_agent', { role: 'Extra', task: 'One too many' }),
    ).rejects.toThrow(/At most 3 agents/);
    await s.control.idle();
    expect(s.fake.workers()).toHaveLength(MAX_CONCURRENT_CHILD_AGENTS);
  });

  it('workers never get the lead tools (depth 1), and lead tool input is validated', async () => {
    const s = await setupControl();
    await s.startRun();
    s.fake.lead().started();
    const worker = await s.startWorker();
    expect(worker.spec.leadTools).toBeUndefined();
    await expect(s.fake.lead().callLead('start_agent', { role: '' })).rejects.toThrow(
      /Invalid input/,
    );
    await expect(
      s.fake.lead().callLead('message_agent', { agentId: 'nope', text: 'x' }),
    ).rejects.toThrow(/No agent with that id/);
  });

  it('a non-read-only tool use waits for the owner; nothing is allowed by default', async () => {
    const s = await setupControl();
    const runId = (await s.startRun()).id;
    s.fake.lead().started();
    const worker = await s.startWorker();
    worker.started();
    let settled = false;
    void worker.ask('Bash', 'Run git push').then(() => (settled = true));
    await s.control.idle();
    expect(settled).toBe(false);
    expect((await s.detail(runId)).approvals.map((a) => a.status)).toEqual(['pending']);
  });

  it('the budget soft cap blocks the agent, denies its tools and asks the owner to raise it', async () => {
    const s = await setupControl();
    const created = await s.post('/api/runs', {
      projectId: s.project.id,
      budget: { maxTokensPerAgent: 1000, softCostUsdPerRun: null },
    });
    const runId = (created.body as { id: string }).id;
    await s.post(`/api/runs/${runId}/chat`, { text: 'go' });
    await s.control.idle();
    s.fake.lead().started();
    const worker = await s.startWorker();
    worker.started();
    // Cache reads are tracked, never counted (ADR-0014): 600 + 500 + 0 = 1,100 budget tokens.
    worker.usage('m1', { input: 600, output: 500, cacheCreation: 0, cacheRead: 99_999 });
    let run = await s.detail(runId);
    expect(run.agents[1]).toMatchObject({ status: 'BLOCKED', budget: { used: 1100, limit: 1000 } });
    expect(worker.interrupts).toBe(1);
    const raise = run.approvals.find((a) => a.kind === 'budget-raise');
    expect(raise).toMatchObject({ status: 'pending', toolName: null });

    expect(await worker.ask('Edit', 'Edit README.md')).toMatchObject({ allow: false });
    expectError(
      await s.post(`/api/runs/${runId}/agents/${worker.id}/message`, { text: 'continue' }),
      409,
      'over_budget',
    );

    await s.post(`/api/approvals/${raise?.id ?? ''}`, { decision: 'approve' });
    run = await s.detail(runId);
    expect(run.agents[1]).toMatchObject({ status: 'RUNNING', budget: { used: 1100, limit: 2000 } });
    expect(worker.sent).toEqual(['The owner raised your budget. Continue your task.']);
  });

  it('warns (never stops) when one agent’s estimated cost passes the run value; never sums', async () => {
    const s = await setupControl();
    const created = await s.post('/api/runs', {
      projectId: s.project.id,
      budget: { maxTokensPerAgent: 500_000, softCostUsdPerRun: 1 },
    });
    const runId = (created.body as { id: string }).id;
    await s.post(`/api/runs/${runId}/chat`, { text: 'go' });
    await s.control.idle();
    s.fake.lead().started();
    const a = await s.startWorker('A', 'a');
    const b = await s.startWorker('B', 'b');
    // 0.6 + 0.6 would pass 1 if added up; each alone does not.
    a.finish('success', 0.6);
    b.finish('success', 0.6);
    await s.control.idle();
    expect(s.control.counters().costWarnings).toBe(0);
    const c = await s.startWorker('C', 'c');
    c.finish('success', 1.5);
    await s.control.idle();
    expect(s.control.counters().costWarnings).toBe(1);
    expect((await s.detail(runId)).agents[3]?.status).toBe('SUCCEEDED');
  });

  it('refuses a merge into a dirty base branch, then allows discard', async () => {
    const s = await setupControl();
    const runId = (await s.startRun()).id;
    const lead = s.fake.lead();
    lead.started();
    const worker = await s.startWorker();
    writeFileSync(join(s.worktree(runId, worker.id), 'new.txt'), 'agent work\n');
    worker.finish('success');
    await s.control.idle();
    await lead.callLead('request_review', {});
    // The owner has uncommitted changes to a tracked file.
    writeFileSync(join(s.repo, 'README.md'), 'owner edit\n');
    expectError(
      await s.post(`/api/runs/${runId}/review`, { agentRunId: worker.id, action: 'merge' }),
      409,
      'base_dirty',
    );
    expect((await s.detail(runId)).status).toBe('REVIEW');
    const res = await s.post(`/api/runs/${runId}/review`, {
      agentRunId: worker.id,
      action: 'discard',
    });
    expect(ReviewDtoSchema.parse(res.body).agents[0]?.state).toBe('discarded');
    expect((await s.detail(runId)).status).toBe('COMPLETED');
  });

  it('review actions are refused while agents still work', async () => {
    const s = await setupControl();
    const runId = (await s.startRun()).id;
    s.fake.lead().started();
    const worker = await s.startWorker();
    expectError(
      await s.post(`/api/runs/${runId}/review`, { agentRunId: worker.id, action: 'merge' }),
      409,
      'review_not_allowed',
    );
    await expect(s.fake.lead().callLead('request_review', {})).rejects.toThrow(/still working/);
  });
});

describe('ordering: persisted before effects (orchestration-lifecycle §1)', () => {
  it('an agent starts only after its STARTING row is stored; approval notices follow the row', async () => {
    const inner = createFakeManagedAdapter();
    const seen: { agent: string; storedStatus: unknown }[] = [];
    const approvalRowsAtNotice: number[] = [];
    // Filled in once the database exists.
    const db: { probe?: (id: string) => unknown; countApprovals?: () => number } = {};
    const adapter: ManagedExecutionAdapter = {
      provider: 'claude-code',
      start(spec, callbacks) {
        seen.push({ agent: spec.kind, storedStatus: db.probe?.(spec.agentRunId) });
        return inner.adapter.start(spec, callbacks);
      },
    };
    const notices: StreamNoticeDto[] = [];
    const s = await setupControl({
      overrides: {
        adapter,
        publish: (n) => {
          notices.push(n);
          if (n.kind === 'approval-requested')
            approvalRowsAtNotice.push(db.countApprovals?.() ?? -1);
        },
      },
    });
    db.probe = (id) =>
      s.db.connection.prepare('SELECT status FROM agent_runs WHERE id = ?').pluck().get(id);
    db.countApprovals = () =>
      s.db.connection.prepare('SELECT COUNT(*) FROM approvals').pluck().get() as number;

    const run = (await s.post('/api/runs', { projectId: s.project.id })).body as { id: string };
    await s.post(`/api/runs/${run.id}/chat`, { text: 'go' });
    await s.control.idle();
    const lead = inner.lead();
    lead.started();
    await s.control.idle();
    await lead.callLead('start_agent', { role: 'W', task: 'T' });
    await s.control.idle();
    expect(seen).toEqual([
      { agent: 'lead', storedStatus: 'STARTING' },
      { agent: 'worker', storedStatus: 'STARTING' },
    ]);
    const worker = inner.workers()[0];
    worker?.started();
    void worker?.ask('Edit', 'Edit a file');
    await s.control.idle();
    expect(approvalRowsAtNotice).toEqual([1]);
    expect(notices.filter((n) => n.kind === 'approval-requested')).toHaveLength(1);
  });
});
