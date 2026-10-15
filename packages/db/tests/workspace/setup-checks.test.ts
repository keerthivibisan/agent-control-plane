import { MAX_CHECK_OUTPUT_BYTES, type CheckRun } from '@acp/core';
import { describe, expect, it } from 'vitest';
import { thrown } from '../helpers.js';
import { BUDGET, count, setupInput, setupWorkspace, ticketWithRun } from './setup.js';

describe('project setup repository (P4-B)', () => {
  it('creates, reads and replaces a setup; JSON round-trips through the schema', () => {
    const store = setupWorkspace({ withSetup: false });
    expect(store.ws.projectSetup.get(store.projectId)).toBeUndefined();
    const created = store.ws.projectSetup.upsert(setupInput(store.projectId));
    expect(created).toEqual({ ...setupInput(store.projectId), updatedAt: created.updatedAt });
    expect(store.ws.projectSetup.get(store.projectId)).toEqual(created);
    expect(store.ws.projectSetup.getByProjectKey('WEB')).toEqual(created);

    const changed = store.ws.projectSetup.upsert({
      ...setupInput(store.projectId, 'APP'),
      maxConcurrentHelpers: 6,
      maxDepth: 2,
      model: 'synthetic-model',
      contextFiles: [],
    });
    expect(changed).toMatchObject({ projectKey: 'APP', maxConcurrentHelpers: 6, maxDepth: 2 });
    expect(store.ws.projectSetup.getByProjectKey('WEB')).toBeUndefined();
    expect(count(store.db, 'project_setup')).toBe(1);
  });

  it('rejects values over the ceilings, bad paths, unknown projects and a taken key', () => {
    const store = setupWorkspace();
    const base = setupInput(store.projectId);
    for (const bad of [
      { ...base, maxConcurrentHelpers: 7 },
      { ...base, maxDepth: 3 },
      { ...base, projectKey: 'web' },
      { ...base, projectKey: 'TOOLONG' },
      { ...base, planFirst: false },
      { ...base, contextFiles: ['../secret'] },
      { ...base, contextFiles: ['/etc/passwd'] },
      { ...base, contextFiles: Array.from({ length: 11 }, (_, i) => `f${i}.md`) },
      { ...base, defaultBudgetTokensPerAgent: 0 },
    ]) {
      expect(
        thrown(() =>
          // @ts-expect-error: invalid values are rejected at runtime too
          store.ws.projectSetup.upsert(bad),
        ),
        JSON.stringify(bad).slice(0, 80),
      ).toMatchObject({ code: 'invalid_input' });
    }
    expect(
      thrown(() => store.ws.projectSetup.upsert(setupInput('nope', 'NOPE'))),
    ).toMatchObject({ code: 'not_found' });
    const other = store.repos.projects.insert({ name: 'api', rootPath: '/home/user/api' });
    expect(thrown(() => store.ws.projectSetup.upsert(setupInput(other.id, 'WEB')))).toMatchObject(
      { code: 'conflict' },
    );
  });

  it('a stored setup that no longer validates fails loudly on read', () => {
    const store = setupWorkspace();
    store.db.connection
      .prepare(`UPDATE project_setup SET setup = json_set(setup, '$.maxDepth', 9)`)
      .run();
    expect(thrown(() => store.ws.projectSetup.get(store.projectId))).toMatchObject({
      code: 'invalid_stored_value',
    });
  });
});

describe('check runs repository (P4-B)', () => {
  function result(over: Partial<Omit<CheckRun, 'id'>>): Omit<CheckRun, 'id'> {
    return {
      projectId: 'p',
      runId: null,
      agentRunId: null,
      checkId: 'test',
      name: 'Unit tests',
      required: true,
      status: 'passed',
      exitCode: 0,
      durationMs: 1200,
      outputTail: 'ok',
      startedAt: '2026-10-13T12:00:00.000Z',
      ...over,
    };
  }

  it('stores agent and main-branch results and returns the latest per check', () => {
    const store = setupWorkspace();
    const { run, helper } = ticketWithRun(store);
    const agent = { projectId: store.projectId, runId: run.id, agentRunId: helper.id };
    const failed = store.ws.checkRuns.insert(
      result({ ...agent, status: 'failed', exitCode: 1, startedAt: '2026-10-13T12:01:00.000Z' }),
    );
    expect(failed).toMatchObject({ ...agent, status: 'failed', exitCode: 1, required: true });
    expect(store.ws.checkRuns.getById(failed.id)).toEqual(failed);
    const lint = store.ws.checkRuns.insert(
      result({ ...agent, checkId: 'lint', name: 'Lint', required: false }),
    );
    const passed = store.ws.checkRuns.insert(
      result({ ...agent, startedAt: '2026-10-13T12:05:00.000Z' }),
    );
    const timedOut = store.ws.checkRuns.insert(
      result({
        ...agent,
        checkId: 'e2e',
        name: 'E2E',
        status: 'timed-out',
        exitCode: null,
        startedAt: '2026-10-13T12:06:00.000Z',
      }),
    );
    const main = store.ws.checkRuns.insert(result({ projectId: store.projectId }));

    expect(store.ws.checkRuns.listForRun(run.id).map((c) => c.id)).toEqual([
      lint.id,
      failed.id,
      passed.id,
      timedOut.id,
    ]);
    expect(store.ws.checkRuns.listForAgentRun(helper.id)).toHaveLength(4);
    expect(store.ws.checkRuns.latestForAgentRun(helper.id).map((c) => c.id)).toEqual([
      timedOut.id,
      lint.id,
      passed.id,
    ]);
    expect(store.ws.checkRuns.listForProjectMain(store.projectId)).toEqual([main]);
    expect(store.ws.checkRuns.listForProjectMain(store.projectId, { limit: 1 })).toHaveLength(1);
  });

  it('redacts the output again and keeps only the last 16 KiB', () => {
    const store = setupWorkspace();
    const secret = store.ws.checkRuns.insert(
      result({
        projectId: store.projectId,
        outputTail: 'FAIL url https://x.test/?token=abc123secret',
      }),
    );
    expect(secret.outputTail).not.toContain('abc123secret');
    const long = 'a'.repeat(MAX_CHECK_OUTPUT_BYTES) + 'END';
    const tail = store.ws.checkRuns.insert(
      result({ projectId: store.projectId, outputTail: long }),
    );
    expect(tail.outputTail).toHaveLength(MAX_CHECK_OUTPUT_BYTES);
    expect(tail.outputTail.endsWith('END')).toBe(true);
  });

  it('rejects mismatched projects, unknown runs, agents of other runs and bad values', () => {
    const store = setupWorkspace();
    const { run, helper } = ticketWithRun(store);
    const other = store.repos.projects.insert({ name: 'api', rootPath: '/home/user/api' });
    expect(
      thrown(() => store.ws.checkRuns.insert(result({ projectId: other.id, runId: run.id }))),
    ).toMatchObject({ code: 'invalid_input' });
    expect(
      thrown(() => store.ws.checkRuns.insert(result({ projectId: store.projectId, runId: 'x' }))),
    ).toMatchObject({ code: 'not_found' });
    expect(
      thrown(() =>
        store.ws.checkRuns.insert(result({ projectId: store.projectId, agentRunId: helper.id })),
      ),
    ).toMatchObject({ code: 'invalid_input' });
    const plain = store.orch.runs.insert({ projectId: store.projectId, title: 'P', budget: BUDGET });
    expect(
      thrown(() =>
        store.ws.checkRuns.insert(
          result({ projectId: store.projectId, runId: plain.id, agentRunId: helper.id }),
        ),
      ),
    ).toMatchObject({ code: 'not_found' });
    expect(
      thrown(() => store.ws.checkRuns.insert(result({ projectId: store.projectId, checkId: 'A' }))),
    ).toMatchObject({ code: 'invalid_input' });
    expect(
      thrown(() =>
        store.ws.checkRuns.insert(
          // @ts-expect-error: unknown status
          result({ projectId: store.projectId, status: 'flaky' }),
        ),
      ),
    ).toMatchObject({ code: 'invalid_input' });
    expect(
      thrown(() => store.ws.checkRuns.insert(result({ projectId: 'nope' }))),
    ).toMatchObject({ code: 'not_found' });
  });

  it("deleting a run removes its checks; main-branch checks stay", () => {
    const store = setupWorkspace();
    const { run, helper } = ticketWithRun(store);
    store.ws.checkRuns.insert(
      result({ projectId: store.projectId, runId: run.id, agentRunId: helper.id }),
    );
    store.ws.checkRuns.insert(result({ projectId: store.projectId }));
    store.orch.runs.remove(run.id);
    expect(count(store.db, 'check_runs')).toBe(1);
  });
});
