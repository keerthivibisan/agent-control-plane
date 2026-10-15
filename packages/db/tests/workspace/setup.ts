// Synthetic test data for the workspace repositories (P4-B). Ids, paths and texts are fake.
import { join } from 'node:path';
import { afterEach } from 'vitest';
import {
  createOrchestrationRepositories,
  createRepositories,
  createWorkspaceRepositories,
  openDatabase,
  type AcpDatabase,
  type OrchestrationRepositories,
  type ProjectSetupInput,
  type Repositories,
  type WorkspaceRepositories,
} from '../../src/index.js';
import { fixedClock, tempDir } from '../helpers.js';

export interface WorkspaceStore {
  db: AcpDatabase;
  repos: Repositories;
  orch: OrchestrationRepositories;
  ws: WorkspaceRepositories;
  projectId: string;
}

const open: AcpDatabase[] = [];
afterEach(() => {
  for (const db of open.splice(0)) db.close();
});

export function setupInput(projectId: string, projectKey = 'WEB'): ProjectSetupInput {
  return {
    projectId,
    projectKey,
    planFirst: true,
    maxConcurrentHelpers: 3,
    maxDepth: 1,
    defaultBudgetTokensPerAgent: 500_000,
    model: null,
    allowlist: { editInOwnWorktree: false, runHarnessChecks: true },
    contextFiles: ['CLAUDE.md'],
  };
}

/** A migrated temp-file database with one registered project; `withSetup` adds key `WEB`. */
export function setupWorkspace(options: { withSetup?: boolean; path?: string } = {}) {
  const db = openDatabase(options.path ?? join(tempDir(), 'acp.sqlite'));
  open.push(db);
  let n = 0;
  const repoOptions = {
    now: fixedClock('2026-10-13T12:00:00.000Z'),
    newId: () => `id-${String(++n).padStart(4, '0')}`,
  };
  const repos = createRepositories(db, repoOptions);
  const orch = createOrchestrationRepositories(db, repoOptions);
  const ws = createWorkspaceRepositories(db, repoOptions);
  const projectId = repos.projects.insert({ name: 'web', rootPath: '/home/user/web' }).id;
  if (options.withSetup ?? true) ws.projectSetup.upsert(setupInput(projectId));
  const store: WorkspaceStore = { db, repos, orch, ws, projectId };
  return store;
}

export const BUDGET = { maxTokensPerAgent: 500_000, softCostUsdPerRun: null };

/** A ticket with a started run (lead + one helper) set as its current run. */
export function ticketWithRun(store: WorkspaceStore, title = 'Dark mode') {
  const ticket = store.ws.tickets.insert({ projectId: store.projectId, title });
  const run = store.orch.runs.insert({
    projectId: store.projectId,
    ticketId: ticket.id,
    title,
    budget: BUDGET,
    status: 'PLANNING',
  });
  const lead = store.orch.agentRuns.insert({
    runId: run.id,
    kind: 'lead',
    parentAgentRunId: null,
    role: 'Lead',
    task: null,
  });
  const helper = store.orch.agentRuns.insert({
    runId: run.id,
    kind: 'worker',
    parentAgentRunId: lead.id,
    role: 'Frontend',
    task: 'Synthetic task',
  });
  const active = store.ws.tickets.setStatus(ticket.id, 'ACTIVE', { currentRunId: run.id });
  return { ticket: active!, run, lead, helper }; // the ticket was just inserted
}

export const STEPS = [
  { title: 'Theme store', role: 'Frontend', detail: 'Synthetic detail' },
  { title: 'Settings UI', role: 'frontend', detail: '' },
  { title: 'Tests', role: 'QA', detail: '' },
  { title: 'Review', role: 'Lead', detail: '' },
];

export function count(db: AcpDatabase, table: string): number {
  return db.connection.prepare(`SELECT COUNT(*) FROM ${table}`).pluck().get() as number;
}
