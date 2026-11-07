// Synthetic data only: ids and titles are fake (CX-2, migration 0013, ADR-0031: the provider that
// runs each managed agent).
import { copyFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  createOrchestrationRepositories,
  DEFAULT_MIGRATIONS_DIR,
  loadMigrations,
  openDatabase,
  type AcpDatabase,
} from '../../src/index.js';
import { tempDir, thrown } from '../helpers.js';
import { BUDGET, runWithAgents, setupOrchestration } from './setup.js';

const AT = '2026-11-07T09:00:00.000Z';

function columns(db: AcpDatabase, table: string): string[] {
  return (db.connection.pragma(`table_info(${table})`) as { name: string }[]).map((c) => c.name);
}

/** A database migrated only up to `version`. */
function databaseUpTo(version: number): AcpDatabase {
  const dir = join(tempDir(), `upto-${version}`);
  mkdirSync(dir);
  for (const m of loadMigrations(DEFAULT_MIGRATIONS_DIR).filter((m) => m.version <= version)) {
    const name = `${String(m.version).padStart(4, '0')}_${m.name}.sql`;
    copyFileSync(join(DEFAULT_MIGRATIONS_DIR, name), join(dir, name));
  }
  return openDatabase(join(tempDir(), `old${version}.sqlite`), { migrationsDir: dir });
}

describe('migration 0013 (CX-2)', () => {
  it('ships as 0013_agent_run_provider', () => {
    expect(loadMigrations(DEFAULT_MIGRATIONS_DIR).find((m) => m.version === 13)).toMatchObject({
      version: 13,
      name: 'agent_run_provider',
    });
  });

  it('upgrades a 0012 database in place: agents stored before it read as Claude Code', () => {
    const old = databaseUpTo(12);
    expect(columns(old, 'agent_runs')).not.toContain('provider');
    const c = old.connection;
    c.prepare("INSERT INTO projects VALUES ('p1', 'web', '/home/user/web', ?, ?)").run(AT, AT);
    c.prepare(
      `INSERT INTO orchestration_runs (id, project_id, title, status, max_tokens_per_agent,
         created_at, updated_at) VALUES ('r1', 'p1', 'WEB-1 Notes', 'RUNNING', 1000, ?, ?)`,
    ).run(AT, AT);
    c.prepare(
      `INSERT INTO agent_runs (id, run_id, parent_agent_run_id, kind, role, task, status,
         budget_tokens_used, budget_tokens_limit, created_at, ended_at)
       VALUES ('a1', 'r1', NULL, 'lead', 'Lead', NULL, 'RUNNING', 0, 1000, ?, NULL)`,
    ).run(AT);
    // Repositories built on the old database still read its agents, as Claude Code's.
    expect(createOrchestrationRepositories(old).agentRuns.getById('a1')?.provider).toBe(
      'claude-code',
    );
    const oldPath = c.name;
    old.close();

    const migrated = openDatabase(oldPath);
    try {
      expect(columns(migrated, 'agent_runs')).toContain('provider');
      const row = migrated.connection
        .prepare("SELECT provider FROM agent_runs WHERE id = 'a1'")
        .get() as { provider: string };
      expect(row.provider).toBe('claude-code');
      expect(createOrchestrationRepositories(migrated).agentRuns.getById('a1')).toMatchObject({
        id: 'a1',
        kind: 'lead',
        provider: 'claude-code',
      });
    } finally {
      migrated.close();
    }
  });
});

describe('the agent run provider (ADR-0031)', () => {
  it('stores the given provider, Claude Code by default, and reads it back everywhere', () => {
    const store = setupOrchestration();
    const { run, lead } = runWithAgents(store, 0);
    expect(lead.provider).toBe('claude-code');
    const codex = store.orch.agentRuns.insert({
      runId: run.id,
      kind: 'worker',
      parentAgentRunId: lead.id,
      role: 'Codex helper',
      task: 'Synthetic task',
      provider: 'codex',
    });
    expect(codex).toMatchObject({ provider: 'codex', budgetTokensLimit: BUDGET.maxTokensPerAgent });
    expect(store.orch.agentRuns.getById(codex.id)).toEqual(codex);
    expect(store.orch.agentRuns.listForRun(run.id).map((a) => a.provider)).toEqual([
      'claude-code',
      'codex',
    ]);
    expect(store.orch.agentRuns.listByStatus(['QUEUED']).map((a) => a.provider)).toContain('codex');
  });

  it('refuses an unknown provider', () => {
    const store = setupOrchestration();
    const { run, lead } = runWithAgents(store, 0);
    const bad = {
      runId: run.id,
      kind: 'worker' as const,
      parentAgentRunId: lead.id,
      role: 'R',
      task: 't',
      provider: 'demo' as 'codex',
    };
    expect(thrown(() => store.orch.agentRuns.insert(bad))).toMatchObject({
      code: 'invalid_input',
    });
  });
});
