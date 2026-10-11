import { copyFileSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  checksumOf,
  createRepositories,
  DEFAULT_MIGRATIONS_DIR,
  loadMigrations,
  openDatabase,
} from '../../src/index.js';
import { tempDir } from '../helpers.js';
import { count, runWithAgents, setupOrchestration, SHA } from './setup.js';

const PHASE3_TABLES = [
  'orchestration_runs',
  'agent_runs',
  'agent_run_sessions',
  'approvals',
  'artifacts',
  'managed_workspaces',
  'orchestrator_messages',
];

describe('migration 0002_orchestration (P3-C)', () => {
  it('ships as version 2 with a checksum of its normalized content', () => {
    const migrations = loadMigrations(DEFAULT_MIGRATIONS_DIR);
    const m = migrations.find((x) => x.version === 2);
    expect(m?.name).toBe('orchestration');
    const sql = readFileSync(join(DEFAULT_MIGRATIONS_DIR, '0002_orchestration.sql'), 'utf8');
    expect(m?.checksum).toBe(checksumOf(sql));
    expect(m?.checksum).toMatch(/^[0-9a-f]{64}$/);
  });

  it('upgrades an existing Phase 1 database in place and keeps its data', () => {
    const dir = join(tempDir(), 'm');
    mkdirSync(dir);
    copyFileSync(
      join(DEFAULT_MIGRATIONS_DIR, '0001_observability.sql'),
      join(dir, '0001_observability.sql'),
    );
    const path = join(tempDir(), 'upgrade.sqlite');
    const v1 = openDatabase(path, { migrationsDir: dir });
    createRepositories(v1).projects.insert({ name: 'keep', rootPath: '/home/user/keep' });
    v1.close();

    const v2 = openDatabase(path);
    try {
      const recorded = v2.connection
        .prepare('SELECT version, checksum FROM schema_migrations ORDER BY version')
        .all() as { version: number; checksum: string }[];
      expect(recorded.map((r) => r.version)).toEqual([1, 2]);
      expect(recorded[1]?.checksum).toBe(loadMigrations()[1]?.checksum);
      expect(
        createRepositories(v2)
          .projects.list()
          .map((p) => p.name),
      ).toEqual(['keep']);
    } finally {
      v2.close();
    }
  });

  it('uses STRICT tables with foreign keys enforced', () => {
    const { db } = setupOrchestration();
    for (const table of PHASE3_TABLES) {
      const sql = db.connection
        .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?")
        .pluck()
        .get(table) as string;
      expect(sql, table).toMatch(/\)\s*STRICT$/);
    }
    expect(db.connection.pragma('foreign_key_check')).toEqual([]);
  });

  it('has no column for worker conversation content (ADR-0009, ADR-0015)', () => {
    const { db } = setupOrchestration();
    const forbidden = /prompt|response|thinking|content|input|output|transcript|message$|reason/i;
    for (const table of PHASE3_TABLES) {
      const columns = (db.connection.pragma(`table_info(${table})`) as { name: string }[]).map(
        (c) => c.name,
      );
      for (const column of columns) expect(column, `${table}.${column}`).not.toMatch(forbidden);
    }
    // The only free-text columns are the ones ADR-0015 allows.
    const text = PHASE3_TABLES.flatMap((table) =>
      (db.connection.pragma(`table_info(${table})`) as { name: string }[])
        .map((c) => c.name)
        .filter((name) => ['task', 'text', 'summary', 'title', 'role'].includes(name))
        .map((name) => `${table}.${name}`),
    );
    expect(text.sort()).toEqual([
      'agent_runs.role',
      'agent_runs.task',
      'approvals.summary',
      'orchestration_runs.title',
      'orchestrator_messages.role',
      'orchestrator_messages.text',
    ]);
  });

  it('deleting a run removes its agents, links, approvals, artifacts, workspaces and chat', () => {
    const store = setupOrchestration();
    const keep = runWithAgents(store, 1);
    store.orch.messages.insert({ runId: keep.run.id, role: 'owner', text: 'Keep me' });

    const { run, lead, workers } = runWithAgents(store, 2);
    const w = workers[0]!; // two workers were created above
    store.orch.agentRunSessions.link({
      agentRunId: lead.id,
      provider: 'claude-code',
      providerSessionId: 'sess-x',
      relation: 'primary',
    });
    store.orch.approvals.insert({
      runId: run.id,
      agentRunId: w.id,
      kind: 'tool-use',
      toolName: 'Edit',
      summary: 'Edit a.ts',
    });
    store.orch.artifacts.insert({
      runId: run.id,
      agentRunId: w.id,
      kind: 'patch',
      storagePath: `artifacts/${run.id}/patch.diff`,
      sha256: SHA,
      sizeBytes: 1,
    });
    const ws = store.orch.workspaces.insert({
      runId: run.id,
      agentRunId: w.id,
      worktreePath: `/data/worktrees/${run.id}/${w.id}`,
      branch: `acp/${run.id}/${w.id}`,
      baseBranch: 'main',
      baseCommit: null,
    });
    store.orch.messages.insert({ runId: run.id, role: 'owner', text: 'Synthetic ask' });
    store.orch.messages.insert({ runId: run.id, role: 'lead', text: 'Synthetic reply' });

    const removal = store.orch.runs.remove(run.id);
    expect(removal).toEqual({
      artifactPaths: [`artifacts/${run.id}/patch.diff`],
      activeWorktreePaths: [ws.worktreePath],
    });
    expect(store.orch.runs.remove(run.id)).toBeUndefined();

    expect(store.orch.messages.list(run.id)).toEqual([]);
    expect(store.orch.agentRuns.listForRun(run.id)).toEqual([]);
    expect(count(store.db, 'agent_run_sessions')).toBe(0);
    expect(count(store.db, 'approvals')).toBe(0);
    expect(count(store.db, 'artifacts')).toBe(0);
    expect(count(store.db, 'managed_workspaces')).toBe(0);
    // The other run is untouched.
    expect(count(store.db, 'orchestrator_messages')).toBe(1);
    expect(store.orch.agentRuns.listForRun(keep.run.id)).toHaveLength(2);
    // With no runs left the project can be unregistered.
    store.orch.runs.remove(keep.run.id);
    expect(store.repos.projects.remove(store.projectId)).toBe(true);
  });

  it('deleting an observed session never deletes the agent-run link', () => {
    const store = setupOrchestration();
    const { lead } = runWithAgents(store, 0);
    store.orch.agentRunSessions.link({
      agentRunId: lead.id,
      provider: 'claude-code',
      providerSessionId: 'sess-y',
      relation: 'primary',
    });
    const s = store.repos.sessions.upsert({
      key: { provider: 'claude-code', providerSessionId: 'sess-y', providerAgentId: null },
      origin: 'managed',
      firstSeenAt: '2026-10-11T12:00:00.000Z',
      lastObservedAt: '2026-10-11T12:00:00.000Z',
    });
    expect(store.orch.agentRuns.getById(lead.id)?.sessionId).toBe(s.id);
    store.db.connection.prepare('DELETE FROM sessions WHERE id = ?').run(s.id);
    expect(store.orch.agentRuns.getById(lead.id)?.sessionId).toBeNull();
    expect(store.orch.agentRunSessions.listForAgentRun(lead.id)).toHaveLength(1);
  });
});
