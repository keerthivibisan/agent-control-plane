// Synthetic data only: ids, paths and texts are fake (R-G).
import { defaultProjectWorkflow } from '@acp/core';
import { describe, expect, it } from 'vitest';
import { createRedesignRepositories, DbError, StoredValueError } from '../../src/index.js';
import { fixedClock, thrown } from '../helpers.js';
import { setupWorkspace, ticketWithRun } from '../workspace/setup.js';

function setup() {
  const store = setupWorkspace();
  const redesign = createRedesignRepositories(store.db, {
    now: fixedClock('2026-10-16T09:00:00.000Z'),
  });
  return { ...store, redesign };
}

describe('project workflow repository (R-G)', () => {
  it('answers the default workflow until one is saved, then the saved one', () => {
    const { redesign, repos, projectId } = setup();
    const created = repos.projects.getById(projectId)?.createdAt ?? '';
    expect(redesign.workflow.get(projectId)).toEqual(defaultProjectWorkflow(projectId, created));
    expect(redesign.workflow.isStored(projectId)).toBe(false);

    const base = defaultProjectWorkflow(projectId, created);
    const saved = redesign.workflow.put({
      projectId,
      plannerMode: 'separate',
      stages: {
        ...base.stages,
        plan: { model: 'claude-opus-4-1', skill: 'plan' },
        'code-review': { enabled: true, model: null, skill: 'code-review' },
      },
    });
    expect(saved).toMatchObject({
      projectId,
      plannerMode: 'separate',
      updatedAt: '2026-10-16T09:00:00.000Z',
    });
    expect(saved.stages['code-review']).toEqual({
      enabled: true,
      model: null,
      skill: 'code-review',
    });
    expect(redesign.workflow.get(projectId)).toEqual(saved);
    expect(redesign.workflow.isStored(projectId)).toBe(true);

    // Replacing keeps one row.
    const again = redesign.workflow.put({ projectId, plannerMode: 'lead', stages: base.stages });
    expect(again.plannerMode).toBe('lead');
    expect(redesign.workflow.get(projectId)).toEqual(again);
  });

  it('is undefined for an unknown project, and refuses to save one', () => {
    const { redesign } = setup();
    expect(redesign.workflow.get('nope')).toBeUndefined();
    const base = defaultProjectWorkflow('nope', '2026-10-16T09:00:00.000Z');
    const error = thrown(() =>
      redesign.workflow.put({ projectId: 'nope', plannerMode: 'lead', stages: base.stages }),
    );
    expect(error).toBeInstanceOf(DbError);
    expect(error).toMatchObject({ code: 'not_found' });
  });

  it('validates input and stored JSON with ProjectWorkflowSchema', () => {
    const { redesign, db, projectId } = setup();
    const base = defaultProjectWorkflow(projectId, '2026-10-16T09:00:00.000Z');
    const bad = {
      projectId,
      plannerMode: 'lead' as const,
      stages: { ...base.stages, helpers: { model: null, skill: 'Not A Slug' } },
    };
    expect(thrown(() => redesign.workflow.put(bad))).toMatchObject({ code: 'invalid_input' });
    expect(redesign.workflow.isStored(projectId)).toBe(false);

    db.connection
      .prepare('INSERT INTO project_workflow (project_id, workflow, updated_at) VALUES (?, ?, ?)')
      .run(projectId, '{"plannerMode":"chaos"}', '2026-10-16T09:00:00.000Z');
    expect(thrown(() => redesign.workflow.get(projectId))).toBeInstanceOf(StoredValueError);
  });
});

describe('run audit repository (R-G)', () => {
  it('stores who decided an approval', () => {
    const store = setup();
    const { run, lead } = ticketWithRun(store);
    const approval = store.orch.approvals.insert({
      runId: run.id,
      agentRunId: lead.id,
      kind: 'tool-use',
      toolName: 'Edit',
      summary: 'Edit src/app.ts',
    });
    const audit = store.redesign.runAudit;
    expect(audit.approvalDecidersForRun(run.id)).toEqual(new Map([[approval.id, null]]));
    audit.setApprovalDecidedBy(approval.id, 'allowlist');
    expect(audit.approvalDecidersForRun(run.id).get(approval.id)).toBe('allowlist');
    audit.setApprovalDecidedBy(approval.id, null);
    expect(audit.approvalDecidersForRun(run.id).get(approval.id)).toBeNull();

    expect(thrown(() => audit.setApprovalDecidedBy('nope', 'owner'))).toMatchObject({
      code: 'not_found',
    });
    const wrong = 'robot' as unknown as 'owner';
    expect(thrown(() => audit.setApprovalDecidedBy(approval.id, wrong))).toMatchObject({
      code: 'invalid_input',
    });
  });

  it('stores the run limits snapshot within the hard ceilings', () => {
    const store = setup();
    const { run } = ticketWithRun(store);
    const audit = store.redesign.runAudit;
    expect(audit.getRunSnapshot(run.id)).toBeNull();
    audit.setRunSnapshot(run.id, { maxConcurrentHelpers: 4, maxDepth: 2 });
    expect(audit.getRunSnapshot(run.id)).toEqual({ maxConcurrentHelpers: 4, maxDepth: 2 });
    audit.setRunSnapshot(run.id, null);
    expect(audit.getRunSnapshot(run.id)).toBeNull();
    expect(audit.getRunSnapshot('nope')).toBeNull();

    for (const limits of [
      { maxConcurrentHelpers: 0, maxDepth: 1 },
      { maxConcurrentHelpers: 99, maxDepth: 1 },
      { maxConcurrentHelpers: 2, maxDepth: 3 },
      { maxConcurrentHelpers: 2, maxDepth: 1, extra: true },
    ]) {
      expect(
        thrown(() => audit.setRunSnapshot(run.id, limits)),
        JSON.stringify(limits),
      ).toMatchObject({ code: 'invalid_input' });
    }
    expect(
      thrown(() => audit.setRunSnapshot('nope', { maxConcurrentHelpers: 1, maxDepth: 1 })),
    ).toMatchObject({ code: 'not_found' });

    store.db.connection
      .prepare('UPDATE orchestration_runs SET limits = ? WHERE id = ?')
      .run('{"maxConcurrentHelpers":"x"}', run.id);
    expect(thrown(() => audit.getRunSnapshot(run.id))).toBeInstanceOf(StoredValueError);
  });

  it('stores the workflow snapshot and the held-stages flag with the limits (R-G Part 2)', () => {
    const store = setup();
    const { run } = ticketWithRun(store);
    const audit = store.redesign.runAudit;
    const workflow = defaultProjectWorkflow(store.projectId, '2026-10-16T09:00:00.000Z');
    workflow.stages['code-review'] = { enabled: true, model: null, skill: 'code-review' };
    const snapshot = { maxConcurrentHelpers: 2, maxDepth: 1, workflow, stagesHeld: true as const };
    audit.setRunSnapshot(run.id, snapshot);
    expect(audit.getRunSnapshot(run.id)).toEqual(snapshot);

    const bad = [
      { maxConcurrentHelpers: 2, maxDepth: 1, stagesHeld: false },
      { maxConcurrentHelpers: 2, maxDepth: 1, workflow: { plannerMode: 'chaos' } },
      { workflow },
    ];
    for (const value of bad) {
      const wrong = value as unknown as typeof snapshot;
      expect(
        thrown(() => audit.setRunSnapshot(run.id, wrong)),
        JSON.stringify(value),
      ).toMatchObject({ code: 'invalid_input' });
    }
    expect(audit.getRunSnapshot(run.id)).toEqual(snapshot);
  });

  it('stores an agent run stage', () => {
    const store = setup();
    const { run, lead, helper } = ticketWithRun(store);
    const audit = store.redesign.runAudit;
    audit.setAgentStage(lead.id, 'orchestrate');
    audit.setAgentStage(helper.id, 'helpers');
    expect(audit.agentStagesForRun(run.id)).toEqual(
      new Map([
        [lead.id, 'orchestrate'],
        [helper.id, 'helpers'],
      ]),
    );
    const wrong = 'Not a node id';
    expect(thrown(() => audit.setAgentStage(helper.id, wrong))).toMatchObject({
      code: 'invalid_input',
    });
    expect(thrown(() => audit.setAgentStage('nope', 'plan'))).toMatchObject({ code: 'not_found' });
  });
});
