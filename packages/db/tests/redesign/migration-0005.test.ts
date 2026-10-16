// Synthetic data only (R-G Part 2, migration 0005).
import { copyFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MIGRATIONS_DIR,
  createOrchestrationRepositories,
  createRepositories,
  createWorkspaceRepositories,
  loadMigrations,
  openDatabase,
} from '../../src/index.js';
import { tempDir, thrown } from '../helpers.js';
import { setupInput, setupWorkspace, ticketWithRun } from '../workspace/setup.js';

describe('migration 0005_stage_agents (R-G Part 2)', () => {
  it('ships as version 5', () => {
    expect(loadMigrations(DEFAULT_MIGRATIONS_DIR).map((m) => m.version)).toEqual([1, 2, 3, 4, 5]);
  });

  it('lets the planner, reviewer and tester run without a parent, next to the lead', () => {
    const s = setupWorkspace();
    const { run, lead } = ticketWithRun(s);
    for (const kind of ['planner', 'reviewer'] as const) {
      const agent = s.orch.agentRuns.insert({
        runId: run.id,
        kind,
        parentAgentRunId: null,
        role: kind === 'planner' ? 'Planner' : 'Reviewer',
        task: null,
      });
      expect(agent).toMatchObject({ kind, parentAgentRunId: null });
    }
    const tester = s.orch.agentRuns.insert({
      runId: run.id,
      kind: 'tester',
      parentAgentRunId: null,
      role: 'Tester',
      task: 'Write unit tests for the merged change.',
    });
    expect(tester.parentAgentRunId).toBeNull();
    expect(s.orch.agentRuns.listForRun(run.id).filter((a) => a.kind === 'lead')).toEqual([
      expect.objectContaining({ id: lead.id }),
    ]);
  });

  it('gives the tester a worktree record, never the planner or the reviewer', () => {
    const s = setupWorkspace();
    const { run } = ticketWithRun(s);
    const add = (kind: 'planner' | 'reviewer' | 'tester') =>
      s.orch.agentRuns.insert({
        runId: run.id,
        kind,
        parentAgentRunId: null,
        role: kind,
        task: kind === 'tester' ? 'Write unit tests for the merged change.' : null,
      });
    const workspace = (agentRunId: string) =>
      s.orch.workspaces.insert({
        runId: run.id,
        agentRunId,
        worktreePath: `/data/worktrees/${run.id}/${agentRunId}`,
        branch: `acp/${run.id}/${agentRunId}`,
        baseBranch: 'main',
        baseCommit: 'a'.repeat(40),
      });
    const tester = add('tester');
    expect(workspace(tester.id)).toMatchObject({ agentRunId: tester.id, state: 'active' });
    for (const kind of ['planner', 'reviewer'] as const) {
      expect(thrown(() => workspace(add(kind).id))).toMatchObject({ code: 'invalid_input' });
    }
  });

  it('still allows exactly one lead per run', () => {
    const s = setupWorkspace();
    const { run } = ticketWithRun(s);
    const error = thrown(() =>
      s.orch.agentRuns.insert({
        runId: run.id,
        kind: 'lead',
        parentAgentRunId: null,
        role: 'Lead',
        task: null,
      }),
    );
    expect(error).toMatchObject({ code: 'conflict' });
  });

  it('upgrades a 0004 database with its runs kept', () => {
    const dir = join(tempDir(), 'm');
    mkdirSync(dir);
    for (const file of [
      '0001_observability.sql',
      '0002_orchestration.sql',
      '0003_workspace.sql',
      '0004_redesign.sql',
    ]) {
      copyFileSync(join(DEFAULT_MIGRATIONS_DIR, file), join(dir, file));
    }
    const path = join(tempDir(), 'upgrade.sqlite');
    const v4 = openDatabase(path, { migrationsDir: dir });
    const store = {
      db: v4,
      repos: createRepositories(v4),
      orch: createOrchestrationRepositories(v4),
      ws: createWorkspaceRepositories(v4),
      projectId: '',
    };
    store.projectId = store.repos.projects.insert({ name: 'keep', rootPath: '/home/user/k' }).id;
    store.ws.projectSetup.upsert(setupInput(store.projectId, 'KEEP'));
    const { run } = ticketWithRun(store);
    v4.close();

    const v5 = openDatabase(path);
    try {
      const orch = createOrchestrationRepositories(v5);
      expect(orch.agentRuns.listForRun(run.id)).toHaveLength(2);
      const reviewer = orch.agentRuns.insert({
        runId: run.id,
        kind: 'reviewer',
        parentAgentRunId: null,
        role: 'Reviewer',
        task: null,
      });
      expect(reviewer.kind).toBe('reviewer');
    } finally {
      v5.close();
    }
  });
});
