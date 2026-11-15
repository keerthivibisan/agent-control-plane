// Synthetic data only: ids, names and plan texts are fake (AR-4, migration 0016, ADR-0037 §4).
import { copyFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  createOrchestrationRepositories,
  createWorkspaceRepositories,
  DEFAULT_MIGRATIONS_DIR,
  loadMigrations,
  openDatabase,
  type TicketPlanOptionInsertInput,
} from '../../src/index.js';
import { tempDir, thrown } from '../helpers.js';
import { BUDGET, count, setupInput, setupWorkspace, STEPS, ticketWithRun } from './setup.js';

function option(
  over: Partial<TicketPlanOptionInsertInput> & { ticketId: string; runId: string },
): TicketPlanOptionInsertInput {
  return {
    agentRunId: 'planner-a',
    nodeId: 'plan-claude',
    label: 'Claude planner',
    summary: 'Synthetic option',
    steps: STEPS,
    plannedHelpers: 2,
    ...over,
  };
}

describe('ticket plan options repository (AR-4, ADR-0037 §4)', () => {
  it('numbers options per run, keeps every draft and decides each once', () => {
    const store = setupWorkspace();
    const { ticket, run } = ticketWithRun(store);
    const base = { ticketId: ticket.id, runId: run.id };
    const a = store.ws.planOptions.insert(option(base));
    const b = store.ws.planOptions.insert(
      option({ ...base, agentRunId: 'planner-b', nodeId: 'plan-codex', label: 'Codex planner' }),
    );
    expect(a).toMatchObject({ optionIndex: 1, status: 'proposed', planId: null, decidedAt: null });
    expect(b).toMatchObject({ optionIndex: 2, label: 'Codex planner', steps: STEPS });
    expect(store.ws.planOptions.getById(a.id)).toEqual(a);

    // The chosen option becomes the run's plan, stored in ticket_plans exactly as before.
    const plan = store.ws.plans.insert({ ...base, summary: a.summary, steps: a.steps });
    store.ws.plans.decide(plan.id, 'approved');
    const chosen = store.ws.planOptions.decide(a.id, 'chosen', { planId: plan.id });
    expect(chosen).toMatchObject({ status: 'chosen', planId: plan.id });
    expect(store.ws.planOptions.decide(b.id, 'not-chosen')).toMatchObject({
      status: 'not-chosen',
      planId: null,
    });
    expect(store.ws.planOptions.listForRun(run.id).map((o) => o.status)).toEqual([
      'chosen',
      'not-chosen',
    ]);
    expect(store.ws.plans.listForRun(run.id)).toHaveLength(1);
    expect(store.ws.plans.approvedForRun(run.id)?.id).toBe(plan.id);

    expect(thrown(() => store.ws.planOptions.decide(a.id, 'superseded'))).toMatchObject({
      code: 'conflict',
    });
    expect(store.ws.planOptions.decide('missing', 'superseded')).toBeUndefined();
  });

  it('refuses a chosen option without its plan, a plan on another status, and bad input', () => {
    const store = setupWorkspace();
    const { ticket, run } = ticketWithRun(store);
    const base = { ticketId: ticket.id, runId: run.id };
    const a = store.ws.planOptions.insert(option(base));
    expect(thrown(() => store.ws.planOptions.decide(a.id, 'chosen'))).toMatchObject({
      code: 'invalid_input',
    });
    expect(
      thrown(() => store.ws.planOptions.decide(a.id, 'not-chosen', { planId: 'x' })),
    ).toMatchObject({ code: 'invalid_input' });
    // A plan id that is not a plan of this ticket breaks the foreign key.
    expect(
      thrown(() => store.ws.planOptions.decide(a.id, 'chosen', { planId: 'nope' })),
    ).toBeTruthy();
    expect(store.ws.planOptions.getById(a.id)?.status).toBe('proposed');
    expect(
      thrown(() => store.ws.planOptions.insert(option({ ...base, nodeId: 'Not An Id' }))),
    ).toMatchObject({ code: 'invalid_input' });
    expect(thrown(() => store.ws.planOptions.insert(option({ ...base, steps: [] })))).toMatchObject(
      { code: 'invalid_input' },
    );
  });

  it('deletes a run’s options with the run', () => {
    const store = setupWorkspace();
    const { ticket, run } = ticketWithRun(store);
    store.ws.planOptions.insert(option({ ticketId: ticket.id, runId: run.id }));
    expect(count(store.db, 'ticket_plan_options')).toBe(1);
    store.db.connection.prepare('DELETE FROM orchestration_runs WHERE id = ?').run(run.id);
    expect(count(store.db, 'ticket_plan_options')).toBe(0);
  });
});

describe('migration 0016 (AR-4)', () => {
  it('ships as 0016_plan_options', () => {
    const shipped = loadMigrations(DEFAULT_MIGRATIONS_DIR);
    expect(shipped.find((m) => m.version === 16)).toMatchObject({ name: 'plan_options' });
  });

  it('upgrades a 0015 database in place, keeping its plans and plan comments', () => {
    const dir = join(tempDir(), 'upto-0015');
    mkdirSync(dir);
    for (const m of loadMigrations(DEFAULT_MIGRATIONS_DIR).filter((m) => m.version <= 15)) {
      const name = `${String(m.version).padStart(4, '0')}_${m.name}.sql`;
      copyFileSync(join(DEFAULT_MIGRATIONS_DIR, name), join(dir, name));
    }
    const path = join(tempDir(), 'old15.sqlite');
    const old = openDatabase(path, { migrationsDir: dir });
    const at = '2026-11-01T09:00:00.000Z';
    old.connection
      .prepare("INSERT INTO projects VALUES ('p1', 'web', '/home/user/web', ?, ?)")
      .run(at, at);
    const oldWs = createWorkspaceRepositories(old);
    oldWs.projectSetup.upsert(setupInput('p1'));
    const ticket = oldWs.tickets.insert({ projectId: 'p1', title: 'Dark mode' });
    const run = createOrchestrationRepositories(old).runs.insert({
      projectId: 'p1',
      ticketId: ticket.id,
      title: 'Dark mode',
      budget: BUDGET,
      status: 'PLANNING',
    });
    const base = { ticketId: ticket.id, runId: run.id, summary: 'S', steps: STEPS };
    const v1 = oldWs.plans.insert(base);
    oldWs.plans.decide(v1.id, 'changes-requested');
    const v2 = oldWs.plans.insert(base);
    oldWs.plans.decide(v2.id, 'approved');
    const note = oldWs.comments.insert({
      ticketId: ticket.id,
      runId: run.id,
      planId: v1.id,
      author: 'owner',
      body: 'Synthetic change request',
    });
    const before = oldWs.plans.listForRun(run.id);
    old.close();

    const migrated = openDatabase(path);
    try {
      const ws = createWorkspaceRepositories(migrated);
      expect(ws.plans.listForRun(run.id)).toEqual(before);
      expect(ws.plans.approvedForRun(run.id)?.id).toBe(v2.id);
      expect(ws.comments.getById(note.id)).toMatchObject({ planId: v1.id });
      expect(ws.planOptions.listForRun(run.id)).toEqual([]);
      // And it takes plan options.
      const a = ws.planOptions.insert(option({ ticketId: ticket.id, runId: run.id }));
      expect(a.optionIndex).toBe(1);
    } finally {
      migrated.close();
    }
  });
});
