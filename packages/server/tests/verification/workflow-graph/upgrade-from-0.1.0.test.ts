import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { migrateWorkflowV1, type ProjectWorkflow, type WorkflowGraph } from '@acp/core';
import {
  BoardDtoSchema,
  ProjectWorkflowDtoSchema,
  RunWorkflowDtoSchema,
  RunWorkflowGraphDtoSchema,
  TicketDetailDtoSchema,
  WorkflowGraphDtoSchema,
  type WorkflowGraphDto,
} from '@acp/core/api';
import { StoredRunSnapshotParser, openDatabase } from '@acp/db';
import {
  bootGraphServer,
  errorCode,
  ok,
  tempFolders,
  waitFor,
  type GraphServer,
} from './harness.js';
import { newTicket, ownerMerge, run, startTicket, ticket } from './owner.js';
import { buildV010DataDir, type V010Fixture } from './v010-fixture.js';
import { sweepRepositories, tableDigests, v010Readability } from './v010-readers.js';

/*
 * The upgrade from v0.1.0 (WG-V; docs/workflow-graph/RESUME.md Step 4b items 3 and 5). A data dir
 * in the v0.1.0 shape (`v010-fixture.ts`: 27 projects with every planner and reviewer setting,
 * the default workflow, finished and in-flight version 1 runs, tickets with their own options)
 * meets the current server, in-process with the fake managed adapter, an empty temp Claude dir and
 * an ephemeral port. Then: every project's workflow graph loads from its version 1 workflow with no
 * errors, the version 1 routes still answer, every old run's page and run graph load (the graph is
 * the version 1 workflow migrated), the board and tickets answer, the run in flight completes, a new
 * ticket starts on a version 1 project and snapshots its graph, a saved graph closes the version 1
 * routes, and finally what v0.1.0 could still read after all that (rollback). Synthetic data only.
 */

const folders = tempFolders();
let fx: V010Fixture;
let b: GraphServer;
const db = () => join(fx.dataDir, 'acp.sqlite');
let digestsBefore: ReturnType<typeof tableDigests>;
let agentRowsBefore: Record<string, unknown>[];
let newRunId = '';
let savedV2ProjectId = '';

beforeAll(async () => {
  fx = await buildV010DataDir((prefix) => folders.make(prefix));
  digestsBefore = tableDigests(db());
  agentRowsBefore = rows('SELECT * FROM agent_runs ORDER BY id');
  b = await bootGraphServer({ dataDir: fx.dataDir });
}, 240_000);

afterAll(async () => {
  await b.close();
  folders.removeAll();
});

function rows(sql: string): Record<string, unknown>[] {
  const conn = openDatabase(db(), { migrate: false });
  try {
    return conn.connection.prepare(sql).all() as Record<string, unknown>[];
  } finally {
    conn.close();
  }
}

/** The stored snapshot of a run, read with today's parser. */
function snapshotOf(runId: string) {
  const conn = openDatabase(db(), { migrate: false });
  try {
    const row = conn.connection
      .prepare('SELECT limits FROM orchestration_runs WHERE id = ?')
      .get(runId) as { limits: string | null } | undefined;
    if (row?.limits === null || row === undefined) return null;
    return StoredRunSnapshotParser.safeParse(JSON.parse(row.limits));
  } finally {
    conn.close();
  }
}

/** What a version 1 run follows: its workflow with the run's review settings, migrated. */
function expectedRunGraph(runId: string): WorkflowGraph {
  const parsed = snapshotOf(runId);
  if (parsed === null || !parsed.success) throw new Error('no snapshot');
  const s = parsed.data;
  const base: ProjectWorkflow | undefined = s.workflow;
  if (base === undefined) throw new Error('no workflow in the snapshot');
  const workflow: ProjectWorkflow =
    s.integration === undefined
      ? base
      : {
          ...base,
          stages: {
            ...base.stages,
            review: {
              ...base.stages.review,
              reviewer: s.integration.reviewer,
              maxReworkRounds: s.integration.maxReworkRounds,
            },
          },
        };
  return migrateWorkflowV1(workflow, { projectMode: s.approvals?.mode ?? 'manual' });
}

const errorsOf = (dto: WorkflowGraphDto) => dto.issues.filter((i) => i.severity === 'error');

describe('upgrade from v0.1.0 (RESUME.md Step 4b item 3)', { timeout: 120_000 }, () => {
  it('starts from a data dir v0.1.0 reads in full', () => {
    expect(fx.projects).toHaveLength(29);
    expect(fx.projects.filter((p) => p.stored === 'v1')).toHaveLength(26);
    expect(fx.runs.map((r) => [r.flow, r.status])).toEqual([
      ['legacy', 'COMPLETED'],
      ['route-b', 'COMPLETED'],
      ['stopped', 'CANCELLED'],
      ['control-panel', expect.any(String)],
      ['separate-lead-final', 'COMPLETED'],
      ['full-auto-in-flight', 'REVIEW'],
    ]);
    // Today's server snapshots a graph with every run; v0.1.0 did not: the reduction removed it.
    expect(fx.reducedSnapshots).toBeGreaterThanOrEqual(4);
    expect(fx.tickets.filter((t) => t.runOptions !== undefined)).toHaveLength(5);
  });

  it('every project’s workflow graph loads as stored v1 or default, with no error issue', async () => {
    const stored: Record<string, number> = {};
    let warnings = 0;
    for (const p of fx.projects) {
      const dto = WorkflowGraphDtoSchema.parse(
        ok(await b.get(`/api/projects/${p.id}/workflow-graph`)),
      );
      expect(dto.stored, p.name).toBe(p.stored);
      expect(errorsOf(dto), p.name).toEqual([]);
      stored[dto.stored] = (stored[dto.stored] ?? 0) + 1;
      warnings += dto.issues.length;
      if (p.workflow !== undefined) {
        // The stored version 1 workflow, migrated with the project's mode.
        expect(dto.graph, p.name).toEqual(
          migrateWorkflowV1(p.workflow, { projectMode: dto.setup.approvals?.mode ?? 'manual' }),
        );
      }
      if (p.workflow?.stages.helpers.skill === 'gone-skill') {
        expect(dto.issues.map((i) => i.severity)).not.toContain('error');
        expect(dto.issues.length, p.name).toBeGreaterThan(0);
      }
    }
    expect(stored).toEqual({ v1: 26, default: 3 });
    // Missing skills only warn (ADR-0019 §4: the agent starts without it).
    expect(warnings).toBeGreaterThan(0);
  });

  it('the version 1 GET /workflow still answers for every project', async () => {
    for (const p of fx.projects) {
      const dto = ProjectWorkflowDtoSchema.parse(ok(await b.get(`/api/projects/${p.id}/workflow`)));
      if (p.workflow !== undefined) {
        expect(dto.workflow.plannerMode, p.name).toBe(p.workflow.plannerMode);
        expect(dto.workflow.stages, p.name).toEqual(p.workflow.stages);
      }
    }
  });

  it('every old run’s page and run graph load; the graph is the version 1 workflow migrated', async () => {
    for (const r of fx.runs) {
      const detail = await run(b, r.id);
      expect(detail.status, r.flow).toBe(r.status);
      const graph = RunWorkflowGraphDtoSchema.parse(
        ok(await b.get(`/api/runs/${r.id}/workflow-graph`)),
      );
      ok(await b.get(`/api/runs/${r.id}/workflow`));
      RunWorkflowDtoSchema.parse((await b.get(`/api/runs/${r.id}/workflow`)).body);
      if (r.ticketId !== null) {
        expect(graph.graph, r.flow).toEqual(expectedRunGraph(r.id));
        // Every agent sits on a node of that graph, under its version 1 stage id.
        const onNodes = new Set(graph.nodes.flatMap((n) => n.agentRunIds));
        for (const a of detail.agents) expect(onNodes.has(a.id), `${r.flow} ${a.kind}`).toBe(true);
      }
    }
  });

  it('the board, the ticket lists and every ticket page answer, run options kept', async () => {
    for (const p of fx.projects) {
      BoardDtoSchema.parse(ok(await b.get(`/api/board?projectId=${p.id}`)));
      ok(await b.get(`/api/projects/${p.id}/tickets`));
      ok(await b.get(`/api/projects/${p.id}/skills`));
      ok(await b.get(`/api/projects/${p.id}/agents`));
    }
    for (const t of fx.tickets) {
      const d = await ticket(b, t.id);
      expect(d.ticket.runOptions ?? {}).toEqual(t.runOptions ?? {});
      for (const r of d.runs) ok(await b.get(`/api/runs/${r.id}`));
    }
  });

  it('a read-only visit changed only the restart recovery of the run in flight and one default setup', () => {
    const after = tableDigests(db());
    const changed = Object.keys(after).filter((t) => after[t]?.digest !== digestsBefore[t]?.digest);
    expect(changed).toEqual(['agent_runs', 'project_setup']);
    // The project that had no setup got its default row on first read (as in v0.1.0).
    expect((after['project_setup']?.rows ?? 0) - (digestsBefore['project_setup']?.rows ?? 0)).toBe(
      1,
    );
    // The restart recovery (ADR-0013 §7, unchanged since v0.1.0): the live agents of the run in
    // flight end; only their status and end time change, in values v0.1.0 knows.
    const now = rows('SELECT * FROM agent_runs ORDER BY id');
    expect(now).toHaveLength(agentRowsBefore.length);
    const diffs = now.flatMap((row, i) => {
      const old = agentRowsBefore[i] ?? {};
      const cols = Object.keys(row).filter((k) => row[k] !== old[k]);
      return cols.length === 0 ? [] : [{ run: row['run_id'], cols, status: row['status'] }];
    });
    expect(diffs.length).toBeGreaterThan(0);
    for (const d of diffs) {
      expect(d.run).toBe(fx.inFlight.runId);
      expect(d.cols.filter((c) => c !== 'status' && c !== 'ended_at')).toEqual([]);
    }
  });

  it('the run in flight at the upgrade completes with the owner’s merge and keeps its v0.1.0 snapshot', async () => {
    await ownerMerge(b, fx.inFlight.runId);
    expect((await ticket(b, fx.inFlight.ticketId)).ticket.status).toBe('DONE');
    const s = snapshotOf(fx.inFlight.runId);
    expect(s?.success).toBe(true);
    expect(s?.success === true && s.data.graph).toBeFalsy();
  });

  it('a new ticket on a version 1 project starts, reaches plan review, and snapshots its graph', async () => {
    const project = fx.projects.find((p) => p.name === 'run-b');
    if (project === undefined) throw new Error('no run-b');
    const t = await newTicket(b, project.id, 'New ticket after the upgrade');
    newRunId = await startTicket(b, t.id);
    const lead = await waitFor(
      () => b.fake.agents.find((a) => a.spec.kind === 'lead' && !a.ended),
      'the lead',
    );
    lead.started();
    await waitFor(
      async () => ((await run(b, newRunId)).agents[0]?.status === 'RUNNING' ? true : undefined),
      'lead running',
    );
    await lead.callLead('submit_plan', {
      summary: 'Synthetic plan.',
      steps: [{ title: 'Build', role: 'Builder', detail: 'Synthetic.' }],
    });
    const d = await waitFor(async () => {
      const x = await ticket(b, t.id);
      return x.ticket.stage === 'PLAN_REVIEW' ? x : undefined;
    }, 'plan review');
    expect(d.currentRun?.status).toBe('PLAN_REVIEW');
    const s = snapshotOf(newRunId);
    if (s === null || !s.success) throw new Error('no snapshot');
    const projectGraph = WorkflowGraphDtoSchema.parse(
      ok(await b.get(`/api/projects/${project.id}/workflow-graph`)),
    );
    expect(s.data.graph).toEqual(projectGraph.graph);
    expect(s.data.graphContext).toMatchObject({ projectMode: 'auto-edits', approvalCeilings: [] });
    // It still snapshots the version 1 workflow too.
    expect(s.data.workflow?.plannerMode).toBe('lead');
    const runGraph = RunWorkflowGraphDtoSchema.parse(
      ok(await b.get(`/api/runs/${newRunId}/workflow-graph`)),
    );
    expect(runGraph.graph).toEqual(projectGraph.graph);
    TicketDetailDtoSchema.parse(d);
  });

  it('after a graph is saved, the version 1 GET and PUT answer 409', async () => {
    const project = fx.projects.find((p) => p.name === 'combo-0');
    if (project?.workflow === undefined) throw new Error('no combo-0');
    savedV2ProjectId = project.id;
    const before = WorkflowGraphDtoSchema.parse(
      ok(await b.get(`/api/projects/${project.id}/workflow-graph`)),
    );
    const saved = WorkflowGraphDtoSchema.parse(
      ok(await b.put(`/api/projects/${project.id}/workflow-graph`, { graph: before.graph })),
    );
    expect(saved.stored).toBe('v2');
    const v1Get = await b.get(`/api/projects/${project.id}/workflow`);
    expect([v1Get.status, errorCode(v1Get)]).toEqual([409, 'workflow_is_graph']);
    const v1Put = await b.put(`/api/projects/${project.id}/workflow`, project.workflow);
    expect([v1Put.status, errorCode(v1Put)]).toEqual([409, 'workflow_is_graph']);
    const again = WorkflowGraphDtoSchema.parse(
      ok(await b.get(`/api/projects/${project.id}/workflow-graph`)),
    );
    expect([again.stored, again.graph]).toEqual(['v2', before.graph]);
  });
});

describe(
  'rollback to v0.1.0 after the new build ran (RESUME.md Step 4b item 5)',
  { timeout: 60_000 },
  () => {
    it('today’s repositories read every row; v0.1.0 reads every row but the ones only v0.2.0 writes', async () => {
      await b.close();
      const sweep = sweepRepositories(db());
      expect(sweep.failed).toEqual({});
      expect(sweep.read['orchestration_runs']).toBe(fx.runs.length + 1);
      const report = v010Readability(db());
      // Every row v0.1.0 wrote, and every row the new build wrote for version 1 runs (agent stages,
      // deciders, plan steps), still reads in v0.1.0. What does not: the new run's snapshot (its
      // `graph` and `graphContext` keys fail v0.1.0's strict snapshot parser) and the graph saved
      // as version 2. In v0.1.0 those fail the run's page and its ticket's page, and the project's
      // Workflow page (see WG-V.md, finding R1).
      expect(report.unreadableIds).toEqual({
        'orchestration_runs.limits': [newRunId],
        'project_workflow.workflow': [savedV2ProjectId],
        'agent_runs.stage': [],
        'change_reviews.decided_by': [],
        'ticket_plans.steps': [],
      });
      expect(Object.keys(report.reasons).sort()).toEqual([
        'orchestration_runs.limits: invalid limits',
        expect.stringMatching(/^project_workflow\.workflow: /),
      ]);
      expect(report.rows['agent_runs.stage']).toBeGreaterThan(10);
      expect(report.rows['change_reviews.decided_by']).toBeGreaterThan(3);
    });
  },
);
