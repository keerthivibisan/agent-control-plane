// Synthetic data only: ids, paths and texts are fake (RL-H, migration 0007, ticket run options).
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
import { tempDir, thrown } from '../helpers.js';
import {
  legacyComment,
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
];

const stored = (db: AcpDatabase, id: string) =>
  db.connection.prepare('SELECT run_options FROM tickets WHERE id = ?').pluck().get(id) as
    string | null;

describe('migration 0007_ticket_run_options (RL-H)', () => {
  it('ships as version 7 after untouched 0001-0006', () => {
    // 0008 (ADR-0025) follows; the first seven stay as shipped.
    expect(SHIPPED.slice(0, 7).map((m) => [m.version, m.name])).toEqual([
      [1, 'observability'],
      [2, 'orchestration'],
      [3, 'workspace'],
      [4, 'redesign'],
      [5, 'stage_agents'],
      [6, 'review_loop'],
      [7, 'ticket_run_options'],
    ]);
    const sql = readFileSync(join(DEFAULT_MIGRATIONS_DIR, '0007_ticket_run_options.sql'), 'utf8');
    expect(SHIPPED[6]?.checksum).toBe(checksumOf(sql));
  });

  it('adds a nullable run_options column to the STRICT tickets table, checked as a JSON object', () => {
    const { db, ws, projectId } = setupWorkspace();
    const sql = db.connection
      .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'tickets'")
      .pluck()
      .get() as string;
    expect(sql).toMatch(/\)\s*STRICT$/);
    const column = (
      db.connection.pragma('table_info(tickets)') as {
        name: string;
        notnull: number;
        dflt_value: unknown;
      }[]
    ).find((c) => c.name === 'run_options');
    expect(column).toMatchObject({ notnull: 0, dflt_value: null });

    const t = ws.tickets.insert({ projectId, title: 'Raw' });
    const set = (value: string | null) =>
      db.connection.prepare('UPDATE tickets SET run_options = ? WHERE id = ?').run(value, t.id);
    set('{"approvalMode":"manual"}');
    set(null);
    expect(() => set('not json')).toThrow(/CHECK/);
    expect(() => set('["manual"]')).toThrow(/CHECK/);
    expect(() => set('"manual"')).toThrow(/CHECK/);
    expect(() => set(`{"x":"${'y'.repeat(500)}"}`)).toThrow(/CHECK/);
  });

  it('upgrades a 0006 database in place: tickets kept, run_options empty', () => {
    const dir = join(tempDir(), 'm');
    mkdirSync(dir);
    for (const file of BEFORE) copyFileSync(join(DEFAULT_MIGRATIONS_DIR, file), join(dir, file));
    const path = join(tempDir(), 'upgrade.sqlite');

    const v6 = openDatabase(path, { migrationsDir: dir });
    const store: WorkspaceStore = {
      db: v6,
      repos: createRepositories(v6),
      orch: createOrchestrationRepositories(v6),
      ws: createWorkspaceRepositories(v6),
      projectId: '',
    };
    store.projectId = store.repos.projects.insert({ name: 'keep', rootPath: '/home/user/k' }).id;
    store.ws.projectSetup.upsert(setupInput(store.projectId, 'KEEP'));
    const { ticket, run } = ticketWithRun(store);
    const other = store.ws.tickets.insert({
      projectId: store.projectId,
      title: 'Second',
      labels: ['ui'],
      status: 'READY',
    });
    legacyComment(store.db, ticket.id, 'Before 0007');
    const before = v6.connection
      .prepare('SELECT version, checksum FROM schema_migrations ORDER BY version')
      .all();
    const rowsBefore = v6.connection.prepare('SELECT * FROM tickets ORDER BY seq').all();
    expect(
      (v6.connection.pragma('table_info(tickets)') as { name: string }[]).map((c) => c.name),
    ).not.toContain('run_options');
    v6.close();

    const v7 = openDatabase(path);
    try {
      const recorded = v7.connection
        .prepare('SELECT version, checksum FROM schema_migrations ORDER BY version')
        .all() as { version: number; checksum: string }[];
      expect(recorded.map((r) => r.version).slice(0, 7)).toEqual([1, 2, 3, 4, 5, 6, 7]);
      // The 0001-0006 rows are unchanged, so their files were not edited.
      expect(recorded.slice(0, 6)).toEqual(before);
      expect(v7.connection.pragma('foreign_key_check')).toEqual([]);

      // Old rows keep every value and gain a NULL run_options.
      const rowsAfter = v7.connection.prepare('SELECT * FROM tickets ORDER BY seq').all();
      expect(rowsAfter).toEqual(
        // 0008 (ADR-0025) adds branch_prefs, NULL for these rows too.
        (rowsBefore as Record<string, unknown>[]).map((r) => ({
          ...r,
          run_options: null,
          branch_prefs: null,
        })),
      );

      // They read back through the repository as before: no runOptions, so the project's apply.
      const ws = createWorkspaceRepositories(v7);
      const kept = ws.tickets.getById(ticket.id);
      expect(kept).toMatchObject({ key: 'KEEP-1', currentRunId: run.id });
      expect(kept).not.toHaveProperty('runOptions');
      expect(createReviewLoopRepositories(v7).ticketRunOptions.get(ticket.id)).toBeUndefined();
      expect(ws.tickets.getById(other.id)).toMatchObject({ labels: ['ui'], status: 'READY' });
      expect(ws.comments.listForTicket(ticket.id)).toHaveLength(1);

      // The upgraded database takes the 0007 writes.
      const options = createReviewLoopRepositories(v7).ticketRunOptions;
      expect(options.set(other.id, { approvalMode: 'manual' })).toEqual({ approvalMode: 'manual' });
      expect(stored(v7, other.id)).toBe('{"approvalMode":"manual"}');
    } finally {
      v7.close();
    }
  });
});

function optionsStore() {
  const store = setupWorkspace();
  let n = 0;
  const loop = createReviewLoopRepositories(store.db, {
    now: () => new Date(Date.parse('2026-10-17T09:00:00.000Z') + n++ * 1000),
  });
  return { ...store, options: loop.ticketRunOptions };
}

describe('ticket run options repository (RL-H)', () => {
  it('stores none by default: tickets read without a runOptions key', () => {
    const { db, ws, options, projectId } = optionsStore();
    const t = options.insert({ projectId, title: 'Plain' });
    expect('runOptions' in t).toBe(false);
    expect(stored(db, t.id)).toBeNull();
    expect(options.get(t.id)).toBeUndefined();
    // An empty object is "all project default" too and is stored as NULL.
    const e = options.insert({ projectId, title: 'Empty', runOptions: {} });
    expect('runOptions' in e).toBe(false);
    expect(stored(db, e.id)).toBeNull();
    expect(ws.tickets.getById(e.id)).toEqual(e);
  });

  it('creates a ticket with its own options and reads them back', () => {
    const { db, ws, options, projectId } = optionsStore();
    const t = options.insert({
      projectId,
      title: 'Careful',
      runOptions: { approvalMode: 'manual', reviewer: 'lead', maxReworkRounds: 0 },
    });
    expect(t).toMatchObject({ key: 'WEB-1', title: 'Careful', status: 'BACKLOG' });
    expect(t.runOptions).toEqual({ approvalMode: 'manual', reviewer: 'lead', maxReworkRounds: 0 });
    expect(options.get(t.id)).toEqual(t.runOptions);
    expect(JSON.parse(stored(db, t.id) ?? 'null')).toEqual(t.runOptions);
    options.insert({ projectId, title: 'Plain' });
    expect([...options.listForProject(projectId)]).toEqual([[t.id, t.runOptions]]);
    // The Phase 4 repository is unchanged: it never reads the column.
    expect(ws.tickets.getById(t.id)).not.toHaveProperty('runOptions');
    const plain = ws.tickets.getById(t.id);
    expect(plain && options.withOptions(plain, options.get(t.id))).toEqual(t);
    expect(options.withOptions(t)).toEqual(plain);
  });

  it('replaces the options as a whole, clears them with null or {}, and bumps updatedAt', () => {
    const { db, ws, options, projectId } = optionsStore();
    const t = options.insert({ projectId, title: 'T', runOptions: { approvalMode: 'manual' } });
    // Other fields leave the options alone.
    ws.tickets.update(t.id, { title: 'Renamed' });
    expect(options.get(t.id)).toEqual({ approvalMode: 'manual' });
    const before = ws.tickets.getById(t.id)?.updatedAt;
    expect(options.set(t.id, { reviewer: 'lead' })).toEqual({ reviewer: 'lead' });
    expect(ws.tickets.getById(t.id)?.updatedAt).not.toBe(before);
    expect(options.set(t.id, null)).toBeUndefined();
    expect(stored(db, t.id)).toBeNull();
    options.set(t.id, { maxReworkRounds: 3 });
    expect(options.set(t.id, {})).toBeUndefined();
    expect(stored(db, t.id)).toBeNull();
    expect(options.listForProject(projectId).size).toBe(0);
  });

  it('refuses invalid options before the ticket number is taken, and unknown tickets', () => {
    const { ws, options, projectId } = optionsStore();
    expect(
      thrown(() => options.insert({ projectId, title: 'Bad', runOptions: { maxReworkRounds: 9 } })),
    ).toMatchObject({ code: 'invalid_input' });
    const t = options.insert({ projectId, title: 'Next' });
    expect(t.key).toBe('WEB-1');
    expect(
      thrown(() =>
        // @ts-expect-error: an unknown mode is refused at the boundary as well.
        options.set(t.id, { approvalMode: 'yolo' }),
      ),
    ).toMatchObject({ code: 'invalid_input' });
    expect(thrown(() => options.set('missing', { approvalMode: 'manual' }))).toMatchObject({
      code: 'not_found',
    });
    expect(ws.tickets.listForProject(projectId)).toHaveLength(1);
  });

  it('a failed ticket insert stores no options', () => {
    const { db, options } = optionsStore();
    expect(
      thrown(() =>
        options.insert({ projectId: 'missing', title: 'X', runOptions: { approvalMode: 'auto' } }),
      ),
    ).toMatchObject({ code: 'not_found' });
    expect(db.connection.prepare('SELECT COUNT(*) FROM tickets').pluck().get()).toBe(0);
  });

  it('a corrupt stored value is reported, not ignored', () => {
    const { db, options, projectId } = optionsStore();
    const t = options.insert({ projectId, title: 'T' });
    db.connection
      .prepare('UPDATE tickets SET run_options = ? WHERE id = ?')
      .run('{"approvalMode":"yolo"}', t.id);
    expect(() => options.get(t.id)).toThrow(/run_options/);
  });
});
