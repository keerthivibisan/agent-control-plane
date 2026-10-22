// Synthetic data only: ids, paths, commits, URLs and texts are fake (G-A, migration 0008,
// ADR-0025: ticket branch settings, any safe ticket branch name, the pull request columns).
import { copyFileSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  checksumOf,
  createOrchestrationRepositories,
  createRepositories,
  createReviewLoopRepositories,
  createWorkspaceRepositories,
  DEFAULT_MIGRATIONS_DIR,
  loadMigrations,
  openDatabase,
  type AcpDatabase,
} from '../../src/index.js';
import { fixedClock, tempDir } from '../helpers.js';
import {
  setupInput,
  setupWorkspace,
  ticketWithRun,
  type WorkspaceStore,
} from '../workspace/setup.js';

const SHIPPED = loadMigrations(DEFAULT_MIGRATIONS_DIR);
const BEFORE = [
  '0001_observability.sql',
  '0002_orchestration.sql',
  '0003_workspace.sql',
  '0004_redesign.sql',
  '0005_stage_agents.sql',
  '0006_review_loop.sql',
  '0007_ticket_run_options.sql',
];
const AT = '2026-10-22T09:00:00.000Z';
const BASE = 'a'.repeat(40);
const TIP = 'b'.repeat(40);
const URL1 = 'https://github.com/acme/widgets/pull/7';

function columns(db: AcpDatabase, table: string): string[] {
  return (db.connection.pragma(`table_info(${table})`) as { name: string }[]).map((c) => c.name);
}

function insertBranch(
  db: AcpDatabase,
  row: { runId: string; projectId: string } & Partial<Record<string, string | number | null>>,
) {
  db.connection
    .prepare(
      `INSERT INTO ticket_branches (run_id, project_id, branch, base_branch, base_commit,
         head_commit, state, merged_commit, created_at, updated_at)
       VALUES (@runId, @projectId, @branch, @baseBranch, @baseCommit, @headCommit, @state,
         @mergedCommit, @at, @at)`,
    )
    .run({
      branch: 'acp/WEB-1',
      baseBranch: 'main',
      baseCommit: BASE,
      headCommit: TIP,
      state: 'open',
      mergedCommit: null,
      at: AT,
      ...row,
    });
}

const setPr = (db: AcpDatabase, runId: string, values: Record<string, string | number | null>) =>
  db.connection
    .prepare(
      `UPDATE ticket_branches SET pr_provider = @provider, pr_number = @number, pr_url = @url,
         pr_state = @state, pr_checked_at = @checkedAt WHERE run_id = @runId`,
    )
    .run({
      provider: 'github',
      number: 7,
      url: URL1,
      state: 'open',
      checkedAt: AT,
      ...values,
      runId,
    });

const count = (db: AcpDatabase, table: string) =>
  db.connection.prepare(`SELECT COUNT(*) FROM ${table}`).pluck().get() as number;

describe('migration 0008_code_hosting (G-A, ADR-0025)', () => {
  it('ships as version 8 after untouched 0001-0007', () => {
    expect(SHIPPED.map((m) => [m.version, m.name])).toEqual([
      [1, 'observability'],
      [2, 'orchestration'],
      [3, 'workspace'],
      [4, 'redesign'],
      [5, 'stage_agents'],
      [6, 'review_loop'],
      [7, 'ticket_run_options'],
      [8, 'code_hosting'],
    ]);
    const sql = readFileSync(join(DEFAULT_MIGRATIONS_DIR, '0008_code_hosting.sql'), 'utf8');
    expect(SHIPPED[7]?.checksum).toBe(checksumOf(sql));
  });

  it('adds tickets.branch_prefs, checked as a bounded JSON object', () => {
    const { db, ws, projectId } = setupWorkspace();
    expect(columns(db, 'tickets')).toContain('branch_prefs');
    const t = ws.tickets.insert({ projectId, title: 'Raw' });
    const set = (value: string | null) =>
      db.connection.prepare('UPDATE tickets SET branch_prefs = ? WHERE id = ?').run(value, t.id);
    set('{"name":"feature/WEB-1-x","target":"develop"}');
    set(null);
    expect(() => set('not json')).toThrow(/CHECK/);
    expect(() => set('["main"]')).toThrow(/CHECK/);
    expect(() => set(`{"name":"${'y'.repeat(500)}"}`)).toThrow(/CHECK/);
  });

  it('rebuilds STRICT ticket_branches with a length check on the name and the PR columns', () => {
    const store = setupWorkspace();
    const { db, projectId } = store;
    const sql = db.connection
      .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'ticket_branches'")
      .pluck()
      .get() as string;
    expect(sql).toMatch(/\)\s*STRICT$/);
    expect(sql).not.toContain("GLOB 'acp/*'");
    expect(columns(db, 'ticket_branches')).toEqual([
      'run_id',
      'project_id',
      'branch',
      'base_branch',
      'base_commit',
      'head_commit',
      'state',
      'merged_commit',
      'created_at',
      'updated_at',
      'pr_provider',
      'pr_number',
      'pr_url',
      'pr_state',
      'pr_checked_at',
      'pr_pushed_commit',
    ]);
    // The indexes of 0006 are back.
    const indexes = db.connection
      .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = ?")
      .pluck()
      .all('ticket_branches') as string[];
    expect(indexes).toEqual(
      expect.arrayContaining(['ticket_branches_open_branch', 'ticket_branches_project']),
    );

    const run = ticketWithRun(store, 'One').run;
    // A strategy's name (or any name Zod accepts) fits; the length is still bounded.
    const bad = (row: Record<string, string | null>) =>
      insertBranch(db, { runId: run.id, projectId, ...row });
    expect(() => bad({ branch: '' })).toThrow(/CHECK/);
    expect(() => bad({ branch: 'x'.repeat(201) })).toThrow(/CHECK/);
    expect(() => bad({ baseCommit: 'HEAD' })).toThrow(/CHECK/);
    expect(() => bad({ state: 'merged' })).toThrow(/CHECK/);
    expect(() => bad({ mergedCommit: TIP })).toThrow(/CHECK/);
    bad({ branch: 'feature/WEB-1-dark-mode' });

    // The pull request is all set or all NULL, with a positive number and an https URL.
    setPr(db, run.id, {});
    expect(() => setPr(db, run.id, { checkedAt: null })).toThrow(/CHECK/);
    expect(() => setPr(db, run.id, { number: null })).toThrow(/CHECK/);
    expect(() => setPr(db, run.id, { number: 0 })).toThrow(/CHECK/);
    expect(() => setPr(db, run.id, { url: 'http://github.com/acme/widgets/pull/7' })).toThrow(
      /CHECK/,
    );
    expect(() => setPr(db, run.id, { state: '' })).toThrow(/CHECK/);
    expect(() => setPr(db, run.id, { provider: 'x'.repeat(21) })).toThrow(/CHECK/);
    const pushed = (value: string | null) =>
      db.connection
        .prepare('UPDATE ticket_branches SET pr_pushed_commit = ? WHERE run_id = ?')
        .run(value, run.id);
    pushed(TIP);
    expect(() => pushed('HEAD')).toThrow(/CHECK/);
    // A pushed commit only with a pull request.
    expect(() =>
      setPr(db, run.id, { provider: null, number: null, url: null, state: null, checkedAt: null }),
    ).toThrow(/CHECK/);
    pushed(null);
    setPr(db, run.id, { provider: null, number: null, url: null, state: null, checkedAt: null });
  });

  it("still ties a ticket branch to its run's project, one open branch per name", () => {
    const store = setupWorkspace();
    const { db, repos, ws, projectId } = store;
    const first = ticketWithRun(store, 'First').run;
    const second = ticketWithRun(store, 'Second').run;
    insertBranch(db, { runId: first.id, projectId });
    expect(() => insertBranch(db, { runId: second.id, projectId })).toThrow(/UNIQUE/);
    const other = repos.projects.insert({ name: 'other', rootPath: '/home/user/other' }).id;
    ws.projectSetup.upsert(setupInput(other, 'OTH'));
    expect(() =>
      insertBranch(db, { runId: second.id, projectId: other, branch: 'acp/WEB-2' }),
    ).toThrow(/FOREIGN KEY/);
    db.connection.prepare('DELETE FROM orchestration_runs WHERE id = ?').run(first.id);
    expect(count(db, 'ticket_branches')).toBe(0);
  });

  it('upgrades a 0007 database in place: tickets and ticket branches kept unchanged', () => {
    const dir = join(tempDir(), 'm');
    mkdirSync(dir);
    for (const file of BEFORE) copyFileSync(join(DEFAULT_MIGRATIONS_DIR, file), join(dir, file));
    const path = join(tempDir(), 'upgrade.sqlite');

    const v7 = openDatabase(path, { migrationsDir: dir });
    const store: WorkspaceStore = {
      db: v7,
      repos: createRepositories(v7),
      orch: createOrchestrationRepositories(v7),
      ws: createWorkspaceRepositories(v7),
      projectId: '',
    };
    store.projectId = store.repos.projects.insert({ name: 'keep', rootPath: '/home/user/k' }).id;
    store.ws.projectSetup.upsert(setupInput(store.projectId, 'KEEP'));
    const open = ticketWithRun(store, 'Open');
    const merged = ticketWithRun(store, 'Merged');
    insertBranch(v7, { runId: open.run.id, projectId: store.projectId, branch: 'acp/KEEP-1' });
    insertBranch(v7, {
      runId: merged.run.id,
      projectId: store.projectId,
      branch: 'acp/KEEP-2',
      state: 'merged',
      mergedCommit: TIP,
    });
    // 0006's name check is still there before the upgrade.
    expect(() =>
      insertBranch(v7, {
        runId: ticketWithRun(store, 'Third').run.id,
        projectId: store.projectId,
        branch: 'main',
      }),
    ).toThrow(/CHECK/);
    const before = v7.connection
      .prepare('SELECT version, checksum FROM schema_migrations ORDER BY version')
      .all();
    const branchesBefore = v7.connection
      .prepare('SELECT * FROM ticket_branches ORDER BY run_id')
      .all() as Record<string, unknown>[];
    const ticketsBefore = v7.connection
      .prepare('SELECT * FROM tickets ORDER BY seq')
      .all() as Record<string, unknown>[];
    v7.close();

    const v8 = openDatabase(path);
    try {
      const recorded = v8.connection
        .prepare('SELECT version, checksum FROM schema_migrations ORDER BY version')
        .all() as { version: number; checksum: string }[];
      expect(recorded.map((r) => r.version)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
      expect(recorded.slice(0, 7)).toEqual(before);
      expect(v8.connection.pragma('foreign_key_check')).toEqual([]);
      expect(v8.connection.pragma('integrity_check')).toEqual([{ integrity_check: 'ok' }]);

      // Every row is copied with every value; the new columns are NULL.
      const empty = {
        pr_provider: null,
        pr_number: null,
        pr_url: null,
        pr_state: null,
        pr_checked_at: null,
        pr_pushed_commit: null,
      };
      expect(v8.connection.prepare('SELECT * FROM ticket_branches ORDER BY run_id').all()).toEqual(
        branchesBefore.map((r) => ({ ...r, ...empty })),
      );
      expect(v8.connection.prepare('SELECT * FROM tickets ORDER BY seq').all()).toEqual(
        ticketsBefore.map((r) => ({ ...r, branch_prefs: null })),
      );

      // They read back through the repositories as before, with no pull request.
      const loop = createReviewLoopRepositories(v8, { now: fixedClock(AT) });
      expect(loop.ticketBranches.getByRun(open.run.id)).toMatchObject({
        branch: 'acp/KEEP-1',
        state: 'open',
        pullRequest: null,
      });
      expect(loop.ticketBranches.getByRun(merged.run.id)).toMatchObject({
        state: 'merged',
        mergedCommit: TIP,
      });
      expect(loop.ticketBranchPrefs.get(open.ticket.id)).toBeUndefined();

      // The constraints still hold after the rebuild.
      const again = ticketWithRun(
        {
          ...store,
          db: v8,
          ws: createWorkspaceRepositories(v8),
          orch: createOrchestrationRepositories(v8),
        },
        'Again',
      ).run;
      expect(() =>
        insertBranch(v8, { runId: again.id, projectId: store.projectId, branch: 'acp/KEEP-1' }),
      ).toThrow(/UNIQUE/);
      expect(() =>
        insertBranch(v8, { runId: again.id, projectId: store.projectId, state: 'merged' }),
      ).toThrow(/CHECK/);
      // And it takes the 0008 writes.
      insertBranch(v8, { runId: again.id, projectId: store.projectId, branch: 'fix/KEEP-4-x' });
      expect(
        loop.ticketBranches.setPullRequest(again.id, {
          provider: 'github',
          number: 3,
          url: URL1,
          state: 'open',
        })?.pullRequest,
      ).toEqual({
        provider: 'github',
        number: 3,
        url: URL1,
        state: 'open',
        checkedAt: AT,
        pushedCommit: null,
      });
      v8.connection.prepare('DELETE FROM orchestration_runs WHERE id = ?').run(again.id);
      expect(loop.ticketBranches.getByRun(again.id)).toBeUndefined();
    } finally {
      v8.close();
    }
  });
});
