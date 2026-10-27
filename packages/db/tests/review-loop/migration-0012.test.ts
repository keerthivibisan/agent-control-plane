// Synthetic data only: ids, branch names and commits are fake (CR-B, migration 0012, ADR-0030:
// one conflict-resolution operation per run, compare-and-swap updates).
import { describe, expect, it } from 'vitest';
import { DEFAULT_AUTOMATION, policyFingerprint } from '@acp/core';
import type { ConflictResolutionRecord } from '@acp/core/api';
import {
  createReviewLoopRepositories,
  DEFAULT_MIGRATIONS_DIR,
  loadMigrations,
} from '../../src/index.js';
import { thrown } from '../helpers.js';
import { setupWorkspace, ticketWithRun, count } from '../workspace/setup.js';

const AT = '2026-10-27T09:00:00.000Z';

function record(runId: string, projectId: string, id: string): ConflictResolutionRecord {
  return {
    id,
    runId,
    projectId,
    trigger: 'owner',
    state: 'preparing',
    ticketBranch: 'acp/WEB-1',
    targetBranch: 'main',
    ticketCommit: 'a'.repeat(40),
    targetCommit: 'b'.repeat(40),
    mergeBase: 'c'.repeat(40),
    candidateCommit: null,
    conflictFiles: [],
    policy: DEFAULT_AUTOMATION,
    policyFingerprint: policyFingerprint(DEFAULT_AUTOMATION),
    maxAttempts: 2,
    attempts: [],
    resolverAgentRunId: null,
    resolution: { status: 'preparing', reason: null },
    verification: {
      status: 'pending',
      route: null,
      classification: null,
      assessedPaths: 0,
      outsideScope: [],
      checkIds: [],
      mandatoryCheckIds: [],
      omitted: [],
      failedChecks: [],
      checkedCommit: null,
      matchedRule: null,
      reason: null,
      assessment: null,
      deliverAs: null,
    },
    review: { status: 'pending-owner', reason: null },
    delivery: { status: 'not-delegated', reason: null, commit: null, draft: false },
    createdAt: AT,
    updatedAt: AT,
    finishedAt: null,
  };
}

describe('migration 0012 (CR-B)', () => {
  it('ships as 0012_conflict_resolution', () => {
    expect(loadMigrations(DEFAULT_MIGRATIONS_DIR).at(-1)).toMatchObject({
      version: 12,
      name: 'conflict_resolution',
    });
  });

  it('keeps one active operation per run, and frees the slot when it ends', () => {
    const store = setupWorkspace();
    const repo = createReviewLoopRepositories(store.db).conflictResolutions;
    const { run } = ticketWithRun(store);
    const first = repo.insert(record(run.id, store.projectId, 'op-1'));
    expect(repo.latestForRun(run.id)).toEqual(first);
    expect(thrown(() => repo.insert(record(run.id, store.projectId, 'op-2')))).toMatchObject({
      code: 'conflict',
    });
    expect(repo.listActive().map((r) => r.id)).toEqual(['op-1']);
    const done = repo.update({ ...first, state: 'completed', updatedAt: AT }, 'preparing');
    expect(done?.state).toBe('completed');
    expect(repo.listActive()).toEqual([]);
    const second = repo.insert({
      ...record(run.id, store.projectId, 'op-2'),
      createdAt: '2026-10-27T10:00:00.000Z',
    });
    expect(repo.latestForRun(run.id)?.id).toBe(second.id);
  });

  it('updates only from the state the caller read (compare and swap)', () => {
    const store = setupWorkspace();
    const repo = createReviewLoopRepositories(store.db).conflictResolutions;
    const { run } = ticketWithRun(store);
    const op = repo.insert(record(run.id, store.projectId, 'op-1'));
    expect(repo.update({ ...op, state: 'resolving' }, 'preparing')?.state).toBe('resolving');
    // A second writer that read `preparing` loses.
    expect(repo.update({ ...op, state: 'cancelled' }, 'preparing')).toBeUndefined();
    expect(repo.get('op-1')?.state).toBe('resolving');
  });

  it('validates records both ways and refuses content-sized notes', () => {
    const store = setupWorkspace();
    const repo = createReviewLoopRepositories(store.db).conflictResolutions;
    const { run } = ticketWithRun(store);
    const bad = { ...record(run.id, store.projectId, 'op-x'), ticketCommit: 'nope' };
    expect(thrown(() => repo.insert(bad))).toMatchObject({ code: 'invalid_input' });
    const long = {
      ...record(run.id, store.projectId, 'op-y'),
      resolution: { status: 'failed' as const, reason: 'x'.repeat(5000) },
    };
    expect(thrown(() => repo.insert(long))).toMatchObject({ code: 'invalid_input' });
    expect(count(store.db, 'conflict_resolutions')).toBe(0);
  });
});
