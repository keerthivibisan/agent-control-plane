import { copyFileSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  checksumOf,
  createOrchestrationRepositories,
  createRepositories,
  createWorkspaceRepositories,
  DEFAULT_MIGRATIONS_DIR,
  loadMigrations,
  openDatabase,
} from '../../src/index.js';
import { tempDir } from '../helpers.js';
import { BUDGET, setupInput, setupWorkspace } from './setup.js';

const PHASE4_TABLES = ['project_setup', 'tickets', 'ticket_plans', 'ticket_comments', 'check_runs'];

// Checksums of the shipped migrations. 0001 and 0002 must never change (P4-B acceptance).
const SHIPPED = loadMigrations(DEFAULT_MIGRATIONS_DIR);

describe('migration 0003_workspace (P4-B)', () => {
  it('ships as version 3 after untouched 0001 and 0002', () => {
    // Later migrations (0004, R-G) follow; the first three stay as shipped.
    expect(SHIPPED.slice(0, 3).map((m) => [m.version, m.name])).toEqual([
      [1, 'observability'],
      [2, 'orchestration'],
      [3, 'workspace'],
    ]);
    const sql = readFileSync(join(DEFAULT_MIGRATIONS_DIR, '0003_workspace.sql'), 'utf8');
    expect(SHIPPED[2]?.checksum).toBe(checksumOf(sql));
  });

  it('upgrades a 0002 database in place: data kept, runs get ticketId null', () => {
    const dir = join(tempDir(), 'm');
    mkdirSync(dir);
    for (const file of ['0001_observability.sql', '0002_orchestration.sql']) {
      copyFileSync(join(DEFAULT_MIGRATIONS_DIR, file), join(dir, file));
    }
    const path = join(tempDir(), 'upgrade.sqlite');
    const v2 = openDatabase(path, { migrationsDir: dir });
    const projectId = createRepositories(v2).projects.insert({
      name: 'keep',
      rootPath: '/home/user/keep',
    }).id;
    // Raw SQL: this build's repository already writes ticket_id, which 0002 does not have.
    const oldRun = { id: 'run-old' };
    v2.connection
      .prepare(
        `INSERT INTO orchestration_runs (id, project_id, title, status, max_tokens_per_agent,
           soft_cost_usd_per_run, created_at, updated_at, ended_at)
         VALUES (?, ?, 'Phase 3 run', 'COMPLETED', 500000, NULL, ?, ?, ?)`,
      )
      .run(
        oldRun.id,
        projectId,
        '2026-10-11T12:00:00.000Z',
        '2026-10-11T12:00:00.000Z',
        '2026-10-11T13:00:00.000Z',
      );
    const v2Checksums = v2.connection
      .prepare('SELECT version, checksum FROM schema_migrations ORDER BY version')
      .all();
    v2.close();

    const v3 = openDatabase(path);
    try {
      const recorded = v3.connection
        .prepare('SELECT version, checksum FROM schema_migrations ORDER BY version')
        .all() as { version: number; checksum: string }[];
      expect(recorded.map((r) => r.version).slice(0, 3)).toEqual([1, 2, 3]);
      // The 0001/0002 rows are unchanged, so their files were not edited.
      expect(recorded.slice(0, 2)).toEqual(v2Checksums);
      expect(v3.connection.pragma('foreign_key_check')).toEqual([]);

      const orch = createOrchestrationRepositories(v3);
      expect(orch.runs.getById(oldRun.id)).toMatchObject({ title: 'Phase 3 run', ticketId: null });

      // The upgraded database works for Phase 4.
      const ws = createWorkspaceRepositories(v3);
      ws.projectSetup.upsert(setupInput(projectId, 'KEEP'));
      const ticket = ws.tickets.insert({ projectId, title: 'After upgrade' });
      expect(ticket.key).toBe('KEEP-1');
      const run = orch.runs.insert({ projectId, ticketId: ticket.id, title: 'T', budget: BUDGET });
      expect(run.ticketId).toBe(ticket.id);
    } finally {
      v3.close();
    }
  });

  it('uses STRICT tables and stores only the text ADR-0016/0017 allow', () => {
    const { db } = setupWorkspace();
    for (const table of PHASE4_TABLES) {
      const sql = db.connection
        .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?")
        .pluck()
        .get(table) as string;
      expect(sql, table).toMatch(/\)\s*STRICT$/);
    }
    const forbidden = /prompt|response|thinking|content|input|transcript|message/i;
    const textColumns: string[] = [];
    for (const table of PHASE4_TABLES) {
      const columns = db.connection.pragma(`table_info(${table})`) as {
        name: string;
        type: string;
      }[];
      for (const column of columns) {
        expect(column.name, `${table}.${column.name}`).not.toMatch(forbidden);
        if (
          ['title', 'description', 'body', 'summary', 'steps', 'output_tail'].includes(column.name)
        )
          textColumns.push(`${table}.${column.name}`);
      }
    }
    expect(textColumns.sort()).toEqual([
      'check_runs.output_tail',
      'ticket_comments.body',
      'ticket_plans.steps',
      'ticket_plans.summary',
      'tickets.description',
      'tickets.title',
    ]);
  });
});
