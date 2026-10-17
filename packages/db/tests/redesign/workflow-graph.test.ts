// Synthetic data only: ids, paths and texts are fake (WG-C, ADR-0023).
import {
  defaultProjectWorkflow,
  migrateWorkflowV1,
  workflowTemplate,
  type CompileContext,
  type WorkflowGraph,
} from '@acp/core';
import { describe, expect, it } from 'vitest';
import {
  createRedesignRepositories,
  DbError,
  StoredValueError,
  WorkflowStoredAsGraphError,
  type StoredRunSnapshot,
} from '../../src/index.js';
import { fixedClock, thrown } from '../helpers.js';
import { setupWorkspace, ticketWithRun } from '../workspace/setup.js';

function setup() {
  const store = setupWorkspace();
  const redesign = createRedesignRepositories(store.db, {
    now: fixedClock('2026-10-18T09:00:00.000Z'),
  });
  return { ...store, redesign };
}

const LOOP: WorkflowGraph = workflowTemplate('reviewer-helper-loop');

describe('project workflow repository: version 1 or 2 (ADR-0023 §9)', () => {
  it('answers the default until something is stored, and says which kind it is', () => {
    const { redesign, repos, projectId } = setup();
    const created = repos.projects.getById(projectId)?.createdAt ?? '';
    expect(redesign.workflow.stored(projectId)).toEqual({
      kind: 'default',
      workflow: defaultProjectWorkflow(projectId, created),
    });
    expect(redesign.workflow.stored('nope')).toBeUndefined();

    const v1 = redesign.workflow.put({
      projectId,
      plannerMode: 'separate',
      stages: defaultProjectWorkflow(projectId, created).stages,
    });
    expect(redesign.workflow.stored(projectId)).toEqual({ kind: 'v1', workflow: v1 });
    expect(redesign.workflow.get(projectId)).toEqual(v1);
  });

  it('stores a graph as {version: 2, graph} and reads it back with its date', () => {
    const { redesign, db, projectId } = setup();
    const saved = redesign.workflow.putGraph(projectId, LOOP);
    expect(saved).toEqual({ projectId, graph: LOOP, updatedAt: '2026-10-18T09:00:00.000Z' });
    expect(redesign.workflow.stored(projectId)).toEqual({ kind: 'v2', graph: saved });
    expect(redesign.workflow.isStored(projectId)).toBe(true);
    const raw = db.connection
      .prepare('SELECT workflow FROM project_workflow WHERE project_id = ?')
      .pluck()
      .get(projectId) as string;
    expect(JSON.parse(raw)).toEqual({ version: 2, graph: LOOP });

    // A graph replaces a stored version 1 workflow, and another graph replaces it in turn.
    const lead = workflowTemplate('lead-only');
    expect(redesign.workflow.putGraph(projectId, lead).graph).toEqual(lead);
    expect(redesign.workflow.stored(projectId)).toMatchObject({
      kind: 'v2',
      graph: { graph: lead },
    });
  });

  it('replaces a version 1 workflow with a graph', () => {
    const { redesign, projectId } = setup();
    const base = defaultProjectWorkflow(projectId, '2026-10-18T09:00:00.000Z');
    redesign.workflow.put({ projectId, plannerMode: 'lead', stages: base.stages });
    const graph = migrateWorkflowV1(base, { projectMode: 'auto-edits' });
    redesign.workflow.putGraph(projectId, graph);
    expect(redesign.workflow.stored(projectId)).toMatchObject({ kind: 'v2' });
  });

  it('refuses a version 1 read or write once a graph is stored, keeping the graph', () => {
    const { redesign, projectId } = setup();
    redesign.workflow.putGraph(projectId, LOOP);
    const base = defaultProjectWorkflow(projectId, '2026-10-18T09:00:00.000Z');
    const write = thrown(() =>
      redesign.workflow.put({ projectId, plannerMode: 'lead', stages: base.stages }),
    );
    expect(write).toBeInstanceOf(WorkflowStoredAsGraphError);
    expect(write).toBeInstanceOf(DbError);
    expect(write).toMatchObject({ code: 'conflict', projectId });
    expect(redesign.workflow.stored(projectId)).toMatchObject({
      kind: 'v2',
      graph: { graph: LOOP },
    });
    expect(thrown(() => redesign.workflow.get(projectId))).toBeInstanceOf(
      WorkflowStoredAsGraphError,
    );
  });

  it('validates the graph shape on write and the stored JSON on read', () => {
    const { redesign, db, projectId } = setup();
    const bad = { ...LOOP, nodes: [{ type: 'lead', id: 'Lead!', label: 'Lead' }] };
    expect(
      thrown(() => redesign.workflow.putGraph(projectId, bad as unknown as WorkflowGraph)),
    ).toMatchObject({ code: 'invalid_input' });
    expect(redesign.workflow.isStored(projectId)).toBe(false);
    expect(thrown(() => redesign.workflow.putGraph('nope', LOOP))).toMatchObject({
      code: 'not_found',
    });

    db.connection
      .prepare('INSERT INTO project_workflow (project_id, workflow, updated_at) VALUES (?, ?, ?)')
      .run(projectId, '{"version":2,"graph":{"version":2}}', '2026-10-18T09:00:00.000Z');
    expect(thrown(() => redesign.workflow.stored(projectId))).toBeInstanceOf(StoredValueError);
  });
});

describe('run snapshot: graph and graphContext (ADR-0023)', () => {
  const CONTEXT: CompileContext = {
    projectMode: 'full-auto',
    approvalCeilings: ['auto-edits'],
    reviewer: 'lead',
    maxReworkRounds: 1,
    maxConcurrentHelpers: 3,
  };

  it('stores both with the limits and reads them back; older snapshots still parse', () => {
    const store = setup();
    const { run } = ticketWithRun(store);
    const audit = store.redesign.runAudit;
    const older: StoredRunSnapshot = {
      maxConcurrentHelpers: 3,
      maxDepth: 1,
      approvals: { mode: 'auto-edits', commands: [] },
    };
    audit.setRunSnapshot(run.id, older);
    expect(audit.getRunSnapshot(run.id)).toEqual(older);

    const snapshot: StoredRunSnapshot = { ...older, graph: LOOP, graphContext: CONTEXT };
    audit.setRunSnapshot(run.id, snapshot);
    expect(audit.getRunSnapshot(run.id)).toEqual(snapshot);

    // Without the optional overrides, nothing is stored for them.
    const plain: CompileContext = {
      projectMode: 'manual',
      approvalCeilings: [],
      maxConcurrentHelpers: 3,
    };
    audit.setRunSnapshot(run.id, { ...older, graph: LOOP, graphContext: plain });
    expect(audit.getRunSnapshot(run.id)?.graphContext).toEqual(plain);
    const raw = store.db.connection
      .prepare('SELECT limits FROM orchestration_runs WHERE id = ?')
      .pluck()
      .get(run.id) as string;
    expect(Object.keys((JSON.parse(raw) as { graphContext: object }).graphContext).sort()).toEqual([
      'approvalCeilings',
      'maxConcurrentHelpers',
      'projectMode',
    ]);
  });

  it('refuses a graph without its context, a bad context, or a helper limit not the run’s', () => {
    const store = setup();
    const { run } = ticketWithRun(store);
    const audit = store.redesign.runAudit;
    const base = { maxConcurrentHelpers: 3, maxDepth: 1 };
    const bad: object[] = [
      { ...base, graph: LOOP },
      { ...base, graphContext: CONTEXT },
      { ...base, graph: { ...LOOP, version: 1 }, graphContext: CONTEXT },
      { ...base, graph: LOOP, graphContext: { ...CONTEXT, projectMode: 'yolo' } },
      { ...base, graph: LOOP, graphContext: { ...CONTEXT, approvalCeilings: ['auto', 'x'] } },
      {
        ...base,
        graph: LOOP,
        graphContext: { ...CONTEXT, approvalCeilings: ['auto', 'auto', 'auto'] },
      },
      { ...base, graph: LOOP, graphContext: { ...CONTEXT, reviewer: 'robot' } },
      { ...base, graph: LOOP, graphContext: { ...CONTEXT, maxReworkRounds: 9 } },
      { ...base, graph: LOOP, graphContext: { ...CONTEXT, extra: true } },
      { ...base, graph: LOOP, graphContext: { ...CONTEXT, maxConcurrentHelpers: 2 } },
      { ...base, graph: LOOP, graphContext: [] },
    ];
    for (const value of bad) {
      expect(
        thrown(() => audit.setRunSnapshot(run.id, value as StoredRunSnapshot)),
        JSON.stringify(value).slice(0, 200),
      ).toMatchObject({ code: 'invalid_input' });
    }
    expect(audit.getRunSnapshot(run.id)).toBeNull();

    store.db.connection
      .prepare('UPDATE orchestration_runs SET limits = ? WHERE id = ?')
      .run(JSON.stringify({ ...base, graph: LOOP }), run.id);
    expect(thrown(() => audit.getRunSnapshot(run.id))).toBeInstanceOf(StoredValueError);
  });
});

describe('plans keep each step’s helper node (ADR-0023 §7)', () => {
  it('round-trips steps[].helper and still reads steps without one', () => {
    const store = setup();
    const { ticket, run } = ticketWithRun(store);
    const steps = [
      { title: 'Page', role: 'Frontend helper', detail: 'The form', helper: 'frontend' },
      { title: 'Docs', role: 'Writer', detail: '' },
    ];
    const plan = store.ws.plans.insert({ ticketId: ticket.id, runId: run.id, summary: 'S', steps });
    expect(plan.steps).toEqual(steps);
    expect(store.ws.plans.getById(plan.id)?.steps).toEqual(steps);
    expect(
      thrown(() =>
        store.ws.plans.insert({
          ticketId: ticket.id,
          runId: run.id,
          summary: 'S',
          steps: [{ title: 'x', role: 'R', detail: '', helper: 'Not An Id' }],
        }),
      ),
    ).toMatchObject({ code: 'invalid_input' });
  });
});
