import { describe, expect, it } from 'vitest';
import { isSafeStoragePath } from '../../src/index.js';
import { thrown } from '../helpers.js';
import { runWithAgents, setupOrchestration, SHA } from './setup.js';

describe('artifacts repository (P3-C)', () => {
  it('stores a patch and a manifest by relative path and sha256', () => {
    const store = setupOrchestration();
    const { run, workers } = runWithAgents(store, 1);
    const w = workers[0]!; // one worker was created above
    const patch = store.orch.artifacts.insert({
      runId: run.id,
      agentRunId: w.id,
      kind: 'patch',
      storagePath: `artifacts/${run.id}/${w.id}/patch.diff`,
      sha256: SHA,
      sizeBytes: 120,
    });
    const manifest = store.orch.artifacts.insert({
      runId: run.id,
      agentRunId: w.id,
      kind: 'manifest',
      storagePath: `artifacts/${run.id}/${w.id}/manifest.json`,
      sha256: 'b'.repeat(64),
      sizeBytes: 0,
    });
    expect(patch).toMatchObject({ kind: 'patch', sha256: SHA, sizeBytes: 120, agentRunId: w.id });
    expect(store.orch.artifacts.getById(patch.id)).toEqual(patch);
    expect(store.orch.artifacts.listForRun(run.id)).toEqual([patch, manifest]);
    expect(store.orch.artifacts.listForAgentRun(w.id)).toEqual([patch, manifest]);
    expect(store.orch.artifacts.getById('missing')).toBeUndefined();
  });

  it('rejects paths outside the data dir, bad hashes, duplicates, and foreign agents', () => {
    const store = setupOrchestration();
    const { run, workers } = runWithAgents(store, 1);
    const base = {
      runId: run.id,
      agentRunId: workers[0]!.id, // one worker was created above
      kind: 'patch' as const,
      storagePath: 'artifacts/p.diff',
      sha256: SHA,
      sizeBytes: 1,
    };
    for (const storagePath of [
      '/etc/passwd',
      '../outside.diff',
      'artifacts/../../x',
      'artifacts//x',
      './x',
      'C:/x',
      'a\\b',
      '',
    ]) {
      expect(
        thrown(() => store.orch.artifacts.insert({ ...base, storagePath })),
        storagePath,
      ).toMatchObject({ code: 'invalid_input' });
    }
    expect(
      thrown(() => store.orch.artifacts.insert({ ...base, sha256: 'A'.repeat(64) })),
    ).toMatchObject({ code: 'invalid_input' });
    expect(thrown(() => store.orch.artifacts.insert({ ...base, sizeBytes: -1 }))).toMatchObject({
      code: 'invalid_input',
    });
    store.orch.artifacts.insert(base);
    expect(thrown(() => store.orch.artifacts.insert(base))).toMatchObject({ code: 'conflict' });
    const other = runWithAgents(store, 0);
    expect(
      thrown(() =>
        store.orch.artifacts.insert({ ...base, runId: other.run.id, storagePath: 'artifacts/q' }),
      ),
    ).toMatchObject({ code: 'not_found' });
    expect(isSafeStoragePath('artifacts/run/agent/patch.diff')).toBe(true);
  });
});

describe('managed workspaces repository (P3-C)', () => {
  function setup() {
    const store = setupOrchestration();
    const { run, lead, workers } = runWithAgents(store, 2);
    const input = (i: number) => ({
      runId: run.id,
      agentRunId: workers[i]!.id, // two workers were created above
      worktreePath: `/data/worktrees/${run.id}/${workers[i]!.id}`,
      branch: `acp/${run.id}/${workers[i]!.id}`,
      baseBranch: 'main',
      baseCommit: '0123456789abcdef0123456789abcdef01234567',
    });
    return { store, run, lead, input };
  }

  it('creates an active, pending-review workspace for a worker', () => {
    const { store, run, input } = setup();
    const ws = store.orch.workspaces.insert(input(0));
    expect(ws).toEqual({
      ...input(0),
      id: ws.id,
      projectId: store.projectId,
      state: 'active',
      reviewState: 'pending',
      changedFiles: null,
      createdAt: ws.createdAt,
      updatedAt: ws.createdAt,
      removedAt: null,
    });
    expect(store.orch.workspaces.getById(ws.id)).toEqual(ws);
    expect(store.orch.workspaces.getByAgentRun(input(0).agentRunId)).toEqual(ws);
    expect(store.orch.workspaces.listForRun(run.id)).toEqual([ws]);
    expect(store.orch.workspaces.listActive()).toEqual([ws]);
  });

  it('refuses the lead, relative paths, duplicates, and agents of another run', () => {
    const { store, lead, input } = setup();
    expect(
      thrown(() => store.orch.workspaces.insert({ ...input(0), agentRunId: lead.id })),
    ).toMatchObject({ code: 'invalid_input' });
    expect(
      thrown(() => store.orch.workspaces.insert({ ...input(0), worktreePath: 'relative/wt' })),
    ).toMatchObject({ code: 'invalid_input' });
    store.orch.workspaces.insert(input(0));
    expect(thrown(() => store.orch.workspaces.insert(input(0)))).toMatchObject({
      code: 'conflict',
    });
    expect(
      thrown(() => store.orch.workspaces.insert({ ...input(1), branch: input(0).branch })),
    ).toMatchObject({ code: 'conflict' });
    const other = runWithAgents(store, 0);
    expect(
      thrown(() => store.orch.workspaces.insert({ ...input(1), runId: other.run.id })),
    ).toMatchObject({ code: 'not_found' });
  });

  it('records the review and removal', () => {
    const { store, input } = setup();
    const ws = store.orch.workspaces.insert(input(0));
    expect(
      store.orch.workspaces.setReview(ws.id, { reviewState: 'pending', changedFiles: 3 }),
    ).toMatchObject({ reviewState: 'pending', changedFiles: 3 });
    expect(store.orch.workspaces.setReview(ws.id, { reviewState: 'merged' })).toMatchObject({
      reviewState: 'merged',
      changedFiles: 3,
    });
    const removed = store.orch.workspaces.markRemoved(ws.id);
    expect(removed).toMatchObject({ state: 'removed' });
    expect(removed?.removedAt).not.toBeNull();
    expect(store.orch.workspaces.markRemoved(ws.id)?.removedAt).toBe(removed?.removedAt);
    expect(store.orch.workspaces.listActive()).toEqual([]);
    expect(store.orch.workspaces.setReview('missing', { reviewState: 'merged' })).toBeUndefined();
    expect(store.orch.workspaces.markRemoved('missing')).toBeUndefined();
    expect(
      thrown(() =>
        store.orch.workspaces.setReview(ws.id, { reviewState: 'merged', changedFiles: -1 }),
      ),
    ).toMatchObject({ code: 'invalid_input' });
  });
});
