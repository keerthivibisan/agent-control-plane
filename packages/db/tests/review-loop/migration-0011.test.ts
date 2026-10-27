// Synthetic data only: ids, branch names and commits are fake (G-H, migration 0011, ADR-0025 §10:
// the branch a ticket branch started from).
import { copyFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  createReviewLoopRepositories,
  DEFAULT_MIGRATIONS_DIR,
  loadMigrations,
  openDatabase,
  type AcpDatabase,
} from '../../src/index.js';
import { tempDir, thrown } from '../helpers.js';
import { setupWorkspace, ticketWithRun } from '../workspace/setup.js';

const BASE = 'a'.repeat(40);
const AT = '2026-10-24T09:00:00.000Z';

function columns(db: AcpDatabase, table: string): string[] {
  return (db.connection.pragma(`table_info(${table})`) as { name: string }[]).map((c) => c.name);
}

describe('migration 0011 (G-H)', () => {
  it('ships as 0011_ticket_branch_source', () => {
    expect(loadMigrations(DEFAULT_MIGRATIONS_DIR).find((m) => m.version === 11)).toMatchObject({
      version: 11,
      name: 'ticket_branch_source',
    });
  });

  it('upgrades a 0010 database in place: branches made before it have no source', () => {
    const dir = join(tempDir(), 'upto-0010');
    mkdirSync(dir);
    for (const m of loadMigrations(DEFAULT_MIGRATIONS_DIR).filter((m) => m.version <= 10)) {
      const name = `${String(m.version).padStart(4, '0')}_${m.name}.sql`;
      copyFileSync(join(DEFAULT_MIGRATIONS_DIR, name), join(dir, name));
    }
    const old = openDatabase(join(tempDir(), 'old10.sqlite'), { migrationsDir: dir });
    expect(columns(old, 'ticket_branches')).not.toContain('source_branch');
    const c = old.connection;
    c.prepare("INSERT INTO projects VALUES ('p1', 'web', '/home/user/web', ?, ?)").run(AT, AT);
    c.prepare(
      `INSERT INTO orchestration_runs (id, project_id, title, status, max_tokens_per_agent,
         created_at, updated_at) VALUES ('r1', 'p1', 'WEB-1 Notes', 'RUNNING', 1000, ?, ?)`,
    ).run(AT, AT);
    c.prepare(
      `INSERT INTO ticket_branches (run_id, project_id, branch, base_branch, base_commit,
         head_commit, state, merged_commit, created_at, updated_at)
       VALUES ('r1', 'p1', 'acp/WEB-1', 'main', ?, ?, 'open', NULL, ?, ?)`,
    ).run(BASE, BASE, AT, AT);
    const oldPath = c.name;
    old.close();

    const migrated = openDatabase(oldPath);
    try {
      expect(columns(migrated, 'ticket_branches')).toContain('source_branch');
      const row = createReviewLoopRepositories(migrated).ticketBranches.getByRun('r1');
      expect(row).toMatchObject({ branch: 'acp/WEB-1', baseBranch: 'main', sourceBranch: null });
    } finally {
      migrated.close();
    }
  });
});

describe('the ticket branch source (ADR-0025 §10)', () => {
  it('stores the source when given, null otherwise, and refuses an unsafe name', () => {
    const store = setupWorkspace();
    const loop = createReviewLoopRepositories(store.db);
    const { run } = ticketWithRun(store);
    const row = loop.ticketBranches.insert({
      runId: run.id,
      projectId: store.projectId,
      branch: 'feature/WEB-1-notes',
      baseBranch: 'dev',
      baseCommit: BASE,
      headCommit: BASE,
      sourceBranch: 'release/1.0',
    });
    expect(row.sourceBranch).toBe('release/1.0');
    expect(loop.ticketBranches.getByRun(run.id)).toEqual(row);
    const second = ticketWithRun(store).run;
    const bad = {
      runId: second.id,
      projectId: store.projectId,
      branch: 'feature/WEB-2-notes',
      baseBranch: 'dev',
      baseCommit: BASE,
      headCommit: BASE,
    };
    expect(thrown(() => loop.ticketBranches.insert({ ...bad, sourceBranch: '-x' }))).toMatchObject({
      code: 'invalid_input',
    });
    expect(loop.ticketBranches.insert(bad).sourceBranch).toBeNull();
  });
});
