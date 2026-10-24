// Synthetic data only: ids, names, commits and output are fake (H-B, migration 0010, ADR-0027:
// setup runs and where each check ran).
import { copyFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  createHarnessRepositories,
  createReviewLoopRepositories,
  createWorkspaceRepositories,
  DEFAULT_MIGRATIONS_DIR,
  loadMigrations,
  openDatabase,
  type AcpDatabase,
  type CheckRunInsertInput,
  type SetupRunInsertInput,
} from '../../src/index.js';
import { tempDir } from '../helpers.js';
import { count, setupWorkspace, ticketWithRun } from './setup.js';

const COMMIT = 'a'.repeat(40);

function columns(db: AcpDatabase, table: string): string[] {
  return (db.connection.pragma(`table_info(${table})`) as { name: string }[]).map((c) => c.name);
}

function checkResult(
  over: Partial<CheckRunInsertInput> & { projectId: string },
): CheckRunInsertInput {
  return {
    runId: null,
    agentRunId: null,
    checkId: 'test',
    name: 'Unit tests',
    required: true,
    status: 'passed' as const,
    exitCode: 0,
    durationMs: 1200,
    outputTail: 'ok',
    startedAt: '2026-10-23T09:00:00.000Z',
    ...over,
  };
}

function setupResult(
  over: Partial<SetupRunInsertInput> & { projectId: string },
): SetupRunInsertInput {
  return {
    runId: null,
    agentRunId: null,
    stepId: 'install',
    name: 'Install dependencies',
    status: 'passed' as const,
    exitCode: 0,
    durationMs: 3000,
    outputTail: 'installed',
    startedAt: '2026-10-23T09:00:00.000Z',
    commit: COMMIT,
    ...over,
  };
}

describe('migration 0010 (H-B)', () => {
  it('ships as 0010_harness_setup', () => {
    const shipped = loadMigrations(DEFAULT_MIGRATIONS_DIR);
    expect(shipped.find((m) => m.version === 10)).toMatchObject({ name: 'harness_setup' });
  });

  it('upgrades a 0009 database in place: check runs kept without a place', () => {
    const dir = join(tempDir(), 'upto-0009');
    mkdirSync(dir);
    for (const m of loadMigrations(DEFAULT_MIGRATIONS_DIR).filter((m) => m.version <= 9)) {
      const name = `${String(m.version).padStart(4, '0')}_${m.name}.sql`;
      copyFileSync(join(DEFAULT_MIGRATIONS_DIR, name), join(dir, name));
    }
    const old = openDatabase(join(tempDir(), 'old9.sqlite'), { migrationsDir: dir });
    expect(columns(old, 'check_runs')).not.toContain('place');
    const at = '2026-10-22T09:00:00.000Z';
    old.connection
      .prepare("INSERT INTO projects VALUES ('p1', 'web', '/home/user/web', ?, ?)")
      .run(at, at);
    // The check runs repository still works on the old schema (no place columns yet).
    const oldWs = createWorkspaceRepositories(old);
    const kept = oldWs.checkRuns.insert(checkResult({ projectId: 'p1', place: 'main' }));
    expect(kept.place).toBeUndefined();
    const oldPath = old.connection.name;
    old.close();

    const migrated = openDatabase(oldPath);
    try {
      expect(columns(migrated, 'check_runs')).toEqual(
        expect.arrayContaining(['place', 'block_node_id']),
      );
      expect(columns(migrated, 'setup_runs')).toEqual([
        'id',
        'project_id',
        'run_id',
        'agent_run_id',
        'step_id',
        'name',
        'status',
        'exit_code',
        'duration_ms',
        'output_tail',
        'started_at',
        'commit_sha',
      ]);
      const ws = createWorkspaceRepositories(migrated);
      const before = ws.checkRuns.getById(kept.id);
      expect(before).toMatchObject({ status: 'passed', checkId: 'test' });
      expect(before).not.toHaveProperty('place');
      expect(before).not.toHaveProperty('blockNodeId');
      // And it takes the 0010 writes.
      const main = ws.checkRuns.insert(checkResult({ projectId: 'p1', place: 'main' }));
      expect(main).toMatchObject({ place: 'main', blockNodeId: null });
    } finally {
      migrated.close();
    }
  });
});

describe('check runs with a place (H-B)', () => {
  it('stores and reads the place and the block that ran it', () => {
    const store = setupWorkspace();
    const { run, helper } = ticketWithRun(store);
    const loop = createReviewLoopRepositories(store.db);
    const change = loop.checkCommits.insert(
      checkResult({
        projectId: store.projectId,
        runId: run.id,
        agentRunId: helper.id,
        commit: COMMIT,
        place: 'change',
        blockNodeId: 'fast-checks',
      }),
    );
    expect(change).toMatchObject({ place: 'change', blockNodeId: 'fast-checks', commit: COMMIT });
    expect(loop.checkCommits.latestForCommit(run.id, helper.id, COMMIT)).toEqual([change]);
    const tip = store.ws.checkRuns.insert(
      checkResult({
        projectId: store.projectId,
        runId: run.id,
        place: 'branch',
        blockNodeId: null,
      }),
    );
    expect(store.ws.checkRuns.getById(tip.id)).toMatchObject({
      place: 'branch',
      blockNodeId: null,
    });
    // Rows written without a place (callers from before ADR-0027) read without one.
    const plain = store.ws.checkRuns.insert(checkResult({ projectId: store.projectId }));
    expect(store.ws.checkRuns.getById(plain.id)).not.toHaveProperty('place');
  });

  it('refuses an unknown place and a block without a place', () => {
    const store = setupWorkspace();
    expect(() =>
      store.ws.checkRuns.insert(
        checkResult({ projectId: store.projectId, place: 'nowhere' as never }),
      ),
    ).toThrow();
    expect(() =>
      store.ws.checkRuns.insert(checkResult({ projectId: store.projectId, blockNodeId: 'checks' })),
    ).toThrow(/needs its place/);
    expect(() =>
      store.db.connection
        .prepare(
          `INSERT INTO check_runs (id, project_id, check_id, name, required, status, duration_ms,
             output_tail, started_at, place) VALUES ('x', ?, 'a', 'A', 1, 'passed', 0, '', ?, 'x')`,
        )
        .run(store.projectId, '2026-10-23T09:00:00.000Z'),
    ).toThrow(/CHECK constraint/);
  });
});

describe('setup runs (H-B)', () => {
  it("stores an agent's, a checkout's and main's setup runs", () => {
    const store = setupWorkspace();
    const { run, helper } = ticketWithRun(store);
    const harness = createHarnessRepositories(store.db);
    const agent = harness.setupRuns.insert(
      setupResult({ projectId: store.projectId, runId: run.id, agentRunId: helper.id }),
    );
    expect(agent).toMatchObject({
      projectId: store.projectId,
      runId: run.id,
      agentRunId: helper.id,
      stepId: 'install',
      status: 'passed',
      commit: COMMIT,
    });
    expect(harness.setupRuns.getById(agent.id)).toEqual(agent);
    const tip = harness.setupRuns.insert(
      setupResult({
        projectId: store.projectId,
        runId: run.id,
        status: 'refused',
        exitCode: null,
        durationMs: 0,
        startedAt: '2026-10-23T09:05:00.000Z',
        outputTail: 'Not run: it uses the network.',
      }),
    );
    const main1 = harness.setupRuns.insert(
      setupResult({ projectId: store.projectId, commit: null }),
    );
    const main2 = harness.setupRuns.insert(
      setupResult({
        projectId: store.projectId,
        status: 'failed',
        exitCode: 1,
        startedAt: '2026-10-23T09:10:00.000Z',
      }),
    );
    expect(harness.setupRuns.listForRun(run.id).map((s) => s.id)).toEqual([agent.id, tip.id]);
    expect(harness.setupRuns.listForAgentRun(helper.id)).toEqual([agent]);
    expect(harness.setupRuns.listForProjectMain(store.projectId)).toEqual([main2, main1]);
    expect(harness.setupRuns.listForProjectMain(store.projectId, { limit: 1 })).toEqual([main2]);
    expect(count(store.db, 'setup_runs')).toBe(4);
  });

  it('redacts and cuts the output, and refuses runs without their run or of another project', () => {
    const store = setupWorkspace();
    const { run, helper } = ticketWithRun(store);
    const harness = createHarnessRepositories(store.db);
    const long = `${'x'.repeat(20_000)} token=sk-ant-api03-${'A'.repeat(40)}`;
    const stored = harness.setupRuns.insert(
      setupResult({ projectId: store.projectId, outputTail: long }),
    );
    expect(stored.outputTail.length).toBeLessThanOrEqual(16 * 1024);
    expect(stored.outputTail).not.toContain('sk-ant-api03');
    expect(() =>
      harness.setupRuns.insert(setupResult({ projectId: store.projectId, agentRunId: helper.id })),
    ).toThrow(/needs its runId/);
    const other = store.repos.projects.insert({ name: 'api', rootPath: '/home/user/api' });
    expect(() =>
      harness.setupRuns.insert(setupResult({ projectId: other.id, runId: run.id })),
    ).toThrow(/not the run project/);
    expect(() =>
      harness.setupRuns.insert(
        setupResult({ projectId: store.projectId, status: 'skipped' as never }),
      ),
    ).toThrow();
  });

  it("goes with its run's agent (cascade)", () => {
    const store = setupWorkspace();
    const { run, helper } = ticketWithRun(store);
    const harness = createHarnessRepositories(store.db);
    harness.setupRuns.insert(
      setupResult({ projectId: store.projectId, runId: run.id, agentRunId: helper.id }),
    );
    store.db.connection.prepare('DELETE FROM orchestration_runs WHERE id = ?').run(run.id);
    expect(count(store.db, 'setup_runs')).toBe(0);
  });
});
