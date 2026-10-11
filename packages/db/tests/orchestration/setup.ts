// Synthetic test data for the orchestration repositories. Ids, paths, and texts are fake.
import { join } from 'node:path';
import { afterEach } from 'vitest';
import {
  createOrchestrationRepositories,
  createRepositories,
  openDatabase,
  type AcpDatabase,
  type OrchestrationRepositories,
  type Repositories,
  type StoredAgentRun,
} from '../../src/index.js';
import { fixedClock, tempDir } from '../helpers.js';

export interface OrchestrationStore {
  db: AcpDatabase;
  repos: Repositories;
  orch: OrchestrationRepositories;
  projectId: string;
}

const open: AcpDatabase[] = [];
afterEach(() => {
  for (const db of open.splice(0)) db.close();
});

/** A migrated temp-file database with one registered project. */
export function setupOrchestration(): OrchestrationStore {
  const db = openDatabase(join(tempDir(), 'acp.sqlite'));
  open.push(db);
  let n = 0;
  const options = {
    now: fixedClock('2026-10-11T12:00:00.000Z'),
    newId: () => `id-${String(++n).padStart(4, '0')}`,
  };
  const repos = createRepositories(db, options);
  const orch = createOrchestrationRepositories(db, options);
  const projectId = repos.projects.insert({ name: 'demo', rootPath: '/home/user/demo' }).id;
  return { db, repos, orch, projectId };
}

export const BUDGET = { maxTokensPerAgent: 500_000, softCostUsdPerRun: null };

/** A run with a lead and `workers` workers. */
export function runWithAgents(store: OrchestrationStore, workers = 1) {
  const run = store.orch.runs.insert({
    projectId: store.projectId,
    title: 'Build X',
    budget: BUDGET,
  });
  const lead = store.orch.agentRuns.insert({
    runId: run.id,
    kind: 'lead',
    parentAgentRunId: null,
    role: 'Lead',
    task: null,
  });
  const children: StoredAgentRun[] = [];
  for (let i = 1; i <= workers; i++) {
    children.push(
      store.orch.agentRuns.insert({
        runId: run.id,
        kind: 'worker',
        parentAgentRunId: lead.id,
        role: `Worker ${i}`,
        task: `Synthetic task ${i}`,
      }),
    );
  }
  return { run, lead, workers: children };
}

export function count(db: AcpDatabase, table: string): number {
  return db.connection.prepare(`SELECT COUNT(*) FROM ${table}`).pluck().get() as number;
}

export const SHA = 'a'.repeat(64);
