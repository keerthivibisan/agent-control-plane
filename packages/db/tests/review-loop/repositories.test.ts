// Synthetic data only: ids, paths, commits and texts are fake (RL-B, ADR-0021, migration 0006).
import { describe, expect, it } from 'vitest';
import {
  createRedesignRepositories,
  createReviewLoopRepositories,
  StoredRunSnapshotParser,
} from '../../src/index.js';
import { fixedClock, thrown } from '../helpers.js';
import { setupInput, setupWorkspace, ticketWithRun } from '../workspace/setup.js';

const BASE = 'a'.repeat(40);
const TIP = 'b'.repeat(40);
const NEXT = 'c'.repeat(40);

function setup() {
  const store = setupWorkspace();
  const { ticket, run, lead, helper } = ticketWithRun(store);
  const loop = createReviewLoopRepositories(store.db, {
    now: fixedClock('2026-10-17T09:00:00.000Z'),
  });
  const redesign = createRedesignRepositories(store.db);
  return { store, ticket, run, lead, helper, loop, redesign };
}

describe('ticket branches repository (ADR-0021 §4)', () => {
  it('inserts an open branch, moves its tip only by compare-and-swap, then merges once', () => {
    const { store, run, loop } = setup();
    const row = loop.ticketBranches.insert({
      runId: run.id,
      projectId: store.projectId,
      branch: 'acp/WEB-1',
      baseBranch: 'main',
      baseCommit: BASE,
      headCommit: BASE,
    });
    expect(row).toMatchObject({ state: 'open', headCommit: BASE, mergedCommit: null });
    expect(loop.ticketBranches.getByRun(run.id)).toEqual(row);
    expect(loop.ticketBranches.getOpenByBranch('acp/WEB-1')).toEqual(row);
    expect(loop.ticketBranches.listForProject(store.projectId)).toEqual([row]);

    // A stale expected tip changes nothing.
    expect(loop.ticketBranches.advance(run.id, TIP, NEXT)).toBeUndefined();
    expect(loop.ticketBranches.advance(run.id, BASE, TIP)?.headCommit).toBe(TIP);
    expect(loop.ticketBranches.getByRun(run.id)?.headCommit).toBe(TIP);

    expect(loop.ticketBranches.markMerged(run.id, TIP)).toMatchObject({
      state: 'merged',
      mergedCommit: TIP,
    });
    expect(loop.ticketBranches.getOpenByBranch('acp/WEB-1')).toBeUndefined();
    // Merged is final: no more tip moves, no discard.
    expect(loop.ticketBranches.advance(run.id, TIP, NEXT)).toBeUndefined();
    expect(thrown(() => loop.ticketBranches.markDiscarded(run.id))).toMatchObject({
      code: 'conflict',
    });
    expect(loop.ticketBranches.markDiscarded('nope')).toBeUndefined();
  });

  it('rejects bad names and commits, a second branch per run, and another project', () => {
    const { store, run, loop } = setup();
    const base = {
      runId: run.id,
      projectId: store.projectId,
      branch: 'acp/WEB-1',
      baseBranch: 'main',
      baseCommit: BASE,
      headCommit: BASE,
    };
    for (const bad of [
      { ...base, branch: 'main' },
      { ...base, branch: 'acp/web-1' },
      { ...base, branch: 'acp/WEB-1;rm' },
      { ...base, baseCommit: 'XYZ' },
      { ...base, headCommit: '' },
      { ...base, baseBranch: '' },
    ]) {
      expect(
        thrown(() => loop.ticketBranches.insert(bad)),
        bad.branch,
      ).toMatchObject({
        code: 'invalid_input',
      });
    }
    const other = store.repos.projects.insert({ name: 'api', rootPath: '/home/user/api' });
    expect(
      thrown(() => loop.ticketBranches.insert({ ...base, projectId: other.id })),
    ).toMatchObject({ code: 'not_found' });
    loop.ticketBranches.insert(base);
    expect(thrown(() => loop.ticketBranches.insert(base))).toMatchObject({ code: 'conflict' });
  });

  it('discard frees the name: a later run may open a branch of the same name', () => {
    const { store, run, loop } = setup();
    const input = {
      runId: run.id,
      projectId: store.projectId,
      branch: 'acp/WEB-1',
      baseBranch: 'main',
      baseCommit: BASE,
      headCommit: BASE,
    };
    loop.ticketBranches.insert(input);
    const second = store.orch.runs.insert({
      projectId: store.projectId,
      title: 'Again',
      budget: { maxTokensPerAgent: 500_000, softCostUsdPerRun: null },
    });
    expect(thrown(() => loop.ticketBranches.insert({ ...input, runId: second.id }))).toMatchObject({
      code: 'conflict',
    });
    expect(loop.ticketBranches.markDiscarded(run.id)?.state).toBe('discarded');
    expect(loop.ticketBranches.insert({ ...input, runId: second.id }).state).toBe('open');
  });
});

describe('change reviews repository (ADR-0021 §3)', () => {
  it('records a round, the verdict with its comment, then the decision once', () => {
    const { store, ticket, run, lead, helper, loop } = setup();
    const reviewer = store.orch.agentRuns.insert({
      runId: run.id,
      kind: 'reviewer',
      parentAgentRunId: lead.id,
      role: 'Change reviewer',
      task: null,
    });
    const round = loop.changeReviews.insert({
      runId: run.id,
      agentRunId: helper.id,
      round: 0,
      reviewer: 'agent',
      reviewerAgentRunId: reviewer.id,
    });
    expect(round).toMatchObject({ verdict: null, decision: null, decidedBy: null, round: 0 });
    const comment = store.ws.comments.insert({
      ticketId: ticket.id,
      runId: run.id,
      author: 'reviewer',
      body: 'Synthetic findings',
    });
    expect(loop.changeReviews.setVerdict(round.id, 'rework', comment.id)).toMatchObject({
      verdict: 'rework',
      commentId: comment.id,
    });
    const decided = loop.changeReviews.decide(round.id, { decision: 'rework', decidedBy: 'lead' });
    expect(decided).toMatchObject({ decision: 'rework', decidedBy: 'lead', commentId: comment.id });
    expect(decided?.decidedAt).not.toBeNull();
    expect(
      thrown(() => loop.changeReviews.decide(round.id, { decision: 'merge', decidedBy: 'owner' })),
    ).toMatchObject({ code: 'conflict' });
    expect(loop.changeReviews.decide('nope', { decision: 'merge', decidedBy: 'lead' })).toBe(
      undefined,
    );

    const next = loop.changeReviews.insert({
      runId: run.id,
      agentRunId: helper.id,
      round: 1,
      reviewer: 'lead',
    });
    expect(loop.changeReviews.listForAgentRun(helper.id).map((r) => r.round)).toEqual([0, 1]);
    expect(loop.changeReviews.listForRun(run.id).map((r) => r.id)).toEqual([round.id, next.id]);
    expect(loop.changeReviews.setComment(next.id, comment.id)?.commentId).toBe(comment.id);
  });

  it('refuses agents of another run, bad enums, and a reviewer reviewing itself', () => {
    const { store, run, helper, loop } = setup();
    const other = ticketWithRun(store, 'Other');
    expect(
      thrown(() =>
        loop.changeReviews.insert({
          runId: run.id,
          agentRunId: other.helper.id,
          round: 0,
          reviewer: 'lead',
        }),
      ),
    ).toMatchObject({ code: 'not_found' });
    expect(
      thrown(() =>
        loop.changeReviews.insert({
          runId: run.id,
          agentRunId: helper.id,
          round: -1,
          reviewer: 'lead',
        }),
      ),
    ).toMatchObject({ code: 'invalid_input' });
    expect(
      thrown(() =>
        loop.changeReviews.insert({
          runId: run.id,
          agentRunId: helper.id,
          round: 0,
          // @ts-expect-error: rejected at runtime too
          reviewer: 'robot',
        }),
      ),
    ).toMatchObject({ code: 'invalid_input' });
    expect(
      thrown(() =>
        loop.changeReviews.insert({
          runId: run.id,
          agentRunId: helper.id,
          round: 0,
          reviewer: 'agent',
          reviewerAgentRunId: helper.id,
        }),
      ),
    ).toMatchObject({ code: 'invalid_input' });
  });
});

describe('managed workspace review-loop columns (migration 0006)', () => {
  it('sets change state, rounds and head commit independently; legacy rows read as null/0', () => {
    const { store, run, helper, loop } = setup();
    const ws = store.orch.workspaces.insert({
      runId: run.id,
      agentRunId: helper.id,
      worktreePath: '/data/worktrees/r/a',
      branch: 'acp/r/a',
      baseBranch: 'acp/WEB-1',
      baseCommit: BASE,
    });
    expect(loop.workspaceChanges.getByAgentRun(helper.id)).toEqual({
      workspaceId: ws.id,
      agentRunId: helper.id,
      changeState: null,
      reworkRounds: 0,
      headCommit: null,
    });
    expect(loop.workspaceChanges.listForRun(run.id)).toHaveLength(1);
    expect(loop.workspaceChanges.set(helper.id, { changeState: 'sealing' })).toMatchObject({
      changeState: 'sealing',
      reworkRounds: 0,
      headCommit: null,
    });
    expect(
      loop.workspaceChanges.set(helper.id, { headCommit: TIP, changeState: 'ready' }),
    ).toMatchObject({ changeState: 'ready', headCommit: TIP });
    expect(loop.workspaceChanges.set(helper.id, { reworkRounds: 2 })).toMatchObject({
      changeState: 'ready',
      reworkRounds: 2,
      headCommit: TIP,
    });
    expect(loop.workspaceChanges.set(helper.id, { changeState: null })?.changeState).toBeNull();
    for (const bad of [{ changeState: 'done' }, { reworkRounds: -1 }, { headCommit: 'zz' }]) {
      expect(
        thrown(() =>
          // @ts-expect-error: rejected at runtime too
          loop.workspaceChanges.set(helper.id, bad),
        ),
      ).toMatchObject({ code: 'invalid_input' });
    }
    expect(loop.workspaceChanges.set('nope', { reworkRounds: 1 })).toBeUndefined();
  });
});

describe('check runs per commit (ADR-0021 checks gate)', () => {
  it('stores the commit and counts only results on that commit, per agent or the tip', () => {
    const { store, run, helper, loop } = setup();
    const base = {
      projectId: store.projectId,
      runId: run.id,
      agentRunId: helper.id,
      checkId: 'test',
      name: 'Tests',
      required: true,
      exitCode: 0,
      durationMs: 10,
      outputTail: '',
    };
    const legacy = loop.checkCommits.insert({
      ...base,
      status: 'failed',
      startedAt: '2026-10-17T09:00:00.000Z',
    });
    expect(legacy).not.toHaveProperty('commit');
    loop.checkCommits.insert({
      ...base,
      status: 'failed',
      commit: TIP,
      startedAt: '2026-10-17T09:01:00.000Z',
    });
    const passed = loop.checkCommits.insert({
      ...base,
      status: 'passed',
      commit: TIP,
      startedAt: '2026-10-17T09:02:00.000Z',
    });
    expect(passed.commit).toBe(TIP);
    loop.checkCommits.insert({
      ...base,
      status: 'failed',
      commit: NEXT,
      startedAt: '2026-10-17T09:03:00.000Z',
    });
    const tip = loop.checkCommits.insert({
      ...base,
      agentRunId: null,
      status: 'passed',
      commit: NEXT,
      startedAt: '2026-10-17T09:04:00.000Z',
    });
    expect(loop.checkCommits.latestForCommit(run.id, helper.id, TIP)).toEqual([passed]);
    expect(loop.checkCommits.latestForCommit(run.id, helper.id, NEXT)[0]?.status).toBe('failed');
    expect(loop.checkCommits.latestForCommit(run.id, null, NEXT)).toEqual([tip]);
    expect(loop.checkCommits.latestForCommit(run.id, null, TIP)).toEqual([]);
    // The Phase 4 repository reads the same row without the commit (it predates the column).
    expect(store.ws.checkRuns.getById(passed.id)).toEqual({ ...passed, commit: undefined });
    expect(loop.checkCommits.listForRun(run.id).map((r) => r.commit ?? null)).toEqual([
      null,
      TIP,
      TIP,
      NEXT,
      NEXT,
    ]);
    loop.checkCommits.set(legacy.id, TIP);
    expect(loop.checkCommits.listForRun(run.id)[0]?.commit).toBe(TIP);
    expect(thrown(() => loop.checkCommits.set('nope', TIP))).toMatchObject({ code: 'not_found' });
    expect(
      thrown(() => loop.checkCommits.latestForCommit(run.id, helper.id, 'nope')),
    ).toMatchObject({ code: 'invalid_input' });
  });
});

describe('approvals allow rule and run snapshot (ADR-0021 §1)', () => {
  it('records the allow rule per approval', () => {
    const { store, run, helper, loop } = setup();
    const approval = store.orch.approvals.insert({
      runId: run.id,
      agentRunId: helper.id,
      kind: 'tool-use',
      toolName: 'Edit',
      summary: 'Edit src/app.ts',
    });
    expect(loop.approvalRules.forRun(run.id).get(approval.id)).toBeNull();
    loop.approvalRules.set(approval.id, 'command-allowlist');
    expect(loop.approvalRules.forRun(run.id).get(approval.id)).toBe('command-allowlist');
    expect(
      thrown(() =>
        // @ts-expect-error: rejected at runtime too
        loop.approvalRules.set(approval.id, 'owner-said-so'),
      ),
    ).toMatchObject({ code: 'invalid_input' });
    expect(thrown(() => loop.approvalRules.set('nope', 'run-harness-check'))).toMatchObject({
      code: 'not_found',
    });
  });

  it('round-trips approvals and integration in the snapshot and rejects bad ones', () => {
    const { run, redesign } = setup();
    const snapshot = {
      maxConcurrentHelpers: 2,
      maxDepth: 1,
      approvals: {
        mode: 'auto' as const,
        commands: [{ argv: ['npm', 'test'], match: 'prefix' as const }],
      },
      integration: {
        reviewer: 'agent' as const,
        maxReworkRounds: 2,
        handedOver: false,
        ticketKey: 'WEB-1',
        ticketBranch: 'acp/WEB-1' as string | null,
      },
    };
    redesign.runAudit.setRunSnapshot(run.id, snapshot);
    expect(redesign.runAudit.getRunSnapshot(run.id)).toEqual(snapshot);
    const before = { ...snapshot, integration: { ...snapshot.integration, ticketBranch: null } };
    redesign.runAudit.setRunSnapshot(run.id, before);
    expect(redesign.runAudit.getRunSnapshot(run.id)).toEqual(before);
    for (const bad of [
      { ...snapshot, approvals: { mode: 'yolo', commands: [] } },
      { ...snapshot, approvals: { mode: 'auto', commands: [{ argv: ['sh'], match: 'exact' }] } },
      { ...snapshot, integration: { ...snapshot.integration, reviewer: 'robot' } },
      { ...snapshot, integration: { ...snapshot.integration, maxReworkRounds: 9 } },
      { ...snapshot, integration: { reviewer: 'lead', maxReworkRounds: 1 } },
      { ...snapshot, integration: { ...snapshot.integration, ticketKey: 'web-1' } },
      { ...snapshot, integration: { ...snapshot.integration, ticketBranch: 'main' } },
      { ...snapshot, integration: { ...snapshot.integration, extra: 1 } },
      { ...snapshot, surprise: true },
    ]) {
      expect(StoredRunSnapshotParser.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    }
  });

  it('round-trips Full auto and the automatically approved plan (ADR-0022)', () => {
    const { run, redesign } = setup();
    const snapshot = {
      maxConcurrentHelpers: 2,
      maxDepth: 1,
      approvals: { mode: 'full-auto' as const, commands: [] },
      autoApprovedPlanId: 'plan-1',
    };
    redesign.runAudit.setRunSnapshot(run.id, snapshot);
    expect(redesign.runAudit.getRunSnapshot(run.id)).toEqual(snapshot);
    for (const bad of [
      { ...snapshot, autoApprovedPlanId: '' },
      { ...snapshot, autoApprovedPlanId: 7 },
      { ...snapshot, autoApprovedPlanId: 'x'.repeat(101) },
    ]) {
      expect(StoredRunSnapshotParser.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    }
  });
});

describe('project setup approvals (ADR-0021 §1)', () => {
  it('stores approvals with the setup; a legacy setup keeps none', () => {
    const store = setupWorkspace({ withSetup: false });
    const legacy = store.ws.projectSetup.upsert(setupInput(store.projectId));
    expect(legacy.approvals).toBeUndefined();
    const saved = store.ws.projectSetup.upsert({
      ...setupInput(store.projectId),
      approvals: { mode: 'auto-edits', commands: [{ argv: ['mvn'], match: 'prefix' }] },
    });
    expect(store.ws.projectSetup.get(store.projectId)?.approvals).toEqual(saved.approvals);
    expect(
      thrown(() =>
        store.ws.projectSetup.upsert({
          ...setupInput(store.projectId),
          approvals: { mode: 'auto', commands: [{ argv: ['git', 'push'], match: 'prefix' }] },
        }),
      ),
    ).toMatchObject({ code: 'invalid_input' });
  });
});
