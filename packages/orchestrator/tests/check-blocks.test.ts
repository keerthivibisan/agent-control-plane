import { describe, expect, it } from 'vitest';
import type { CheckFailureRoute, WorkflowEdge, WorkflowGraph } from '@acp/core';
import {
  agentSetupFailed,
  changeChecksFinished,
  changeMergeBlocked,
  checksFinished,
  programOf,
  recordChangeDecision,
} from '../src/index.js';
import type { FailedCheck, RunState } from '../src/index.js';
import { POOL, graphRunning, testGraph } from './graph-helpers.js';
import { LEAD, agentOf, event, makeCtx, ok, refused } from './helpers.js';
import {
  COMMIT,
  changeOf,
  effectsOf,
  finishTurn,
  leadMessages,
  leadTool,
  sealed,
  types,
} from './loop-helpers.js';

/**
 * ADR-0027 §5 (H-C): Checks blocks in the engine. A block on a helper's change runs on the sealed
 * commit before the review; its failure goes back to the helper (within the block's rounds, the
 * lead told each round), to the lead, or to the owner. The merge block may send a failed change
 * to the owner; the branch block runs as the final chain reaches it; a failed setup never starts
 * the agent. Synthetic data only.
 */

const BLOCK = 'fast-checks';
const W = 'w-1';

const flow = (from: string, to: string): WorkflowEdge => ({
  type: 'flow',
  id: `flow-${from}-${to}`.slice(0, 40),
  from,
  to,
});

/** The pool-only lead-route graph with a fast Checks block on the pool's change. */
function blockGraph(
  onFailure: CheckFailureRoute,
  rounds = 1,
  mergeOnFailure?: 'owner',
): WorkflowGraph {
  const g = testGraph({ named: false, route: 'lead' });
  const nodes = g.nodes.map((n) =>
    n.type === 'checks' && mergeOnFailure !== undefined ? { ...n, onFailure: mergeOnFailure } : n,
  );
  nodes.push({
    type: 'checks',
    id: BLOCK,
    label: 'Fast checks',
    place: 'change',
    select: { kind: 'labels', labels: ['fast'] },
    onFailure,
  });
  const edges: WorkflowEdge[] = [...g.edges, flow(POOL, BLOCK)];
  if (onFailure === 'helper') {
    edges.push({
      type: 'rework',
      id: `rework-${BLOCK}-${POOL}`,
      from: BLOCK,
      to: POOL,
      maxRounds: rounds,
    });
  }
  return { ...g, nodes, edges };
}

/** A helper of the pool, its first turn ended and sealed (its block now runs). */
function sealedHelper(graph: WorkflowGraph): RunState {
  let s = graphRunning(graph, {}, [{ title: 'Store', role: 'Store', detail: 'Persist it.' }]);
  s = ok(leadTool(s, 'start_agent', { role: 'Store', task: 'Build the store' }, 'w')).state;
  s = ok(event(s, W, { type: 'started', providerSessionId: 'sess-w', model: null })).state;
  s = ok(finishTurn(s, W)).state;
  return s;
}

const FAILED: FailedCheck[] = [
  { name: 'Lint', status: 'failed', exitCode: 1, outputTail: 'src/a.ts: missing semicolon' },
];

function finished(s: RunState, passed: boolean, commit = COMMIT, offset = 6000) {
  return changeChecksFinished(
    s,
    W,
    { commit, passed, failed: passed ? [] : FAILED },
    makeCtx(offset, `cf${offset}`),
  );
}

describe('a Checks block on a helper change (ADR-0027 §5)', () => {
  it('compiles the block, runs it on the sealed commit, and holds the review until it passes', () => {
    const graph = blockGraph('lead');
    expect(
      programOf({
        graph,
        graphContext: { projectMode: 'manual', approvalCeilings: [], maxConcurrentHelpers: 3 },
      }).checkBlocks.change[POOL],
    ).toMatchObject({ nodeId: BLOCK, onFailure: 'lead' });
    const s0 = sealedHelper(graph);
    const r = ok(sealed(s0, W, 'rv'));
    expect(effectsOf(r.effects, 'run-change-checks')).toEqual([
      {
        type: 'run-change-checks',
        agentRunId: W,
        commit: COMMIT,
        blockNodeId: BLOCK,
        select: { kind: 'labels', labels: ['fast'] },
      },
    ]);
    // The lead route reviews at once without a block; here the change waits for its checks.
    expect(changeOf(r.state, W)).toMatchObject({ state: 'ready', blockChecks: 'pending' });
    expect(leadMessages(r.effects)).toEqual([]);
    const passed = ok(finished(r.state, true));
    expect(changeOf(passed.state, W)).toMatchObject({
      state: 'reviewing',
      reviewer: 'lead',
      blockChecks: 'passed',
    });
    expect(leadMessages(passed.effects).join('\n')).toMatch(/ready for your review/);
  });

  it('ignores a late result for another commit, and refuses an invalid commit id', () => {
    const r = ok(sealed(sealedHelper(blockGraph('lead')), W, 'rv'));
    const late = ok(finished(r.state, false, 'def5678'));
    expect(late.effects).toEqual([]);
    expect(changeOf(late.state, W).blockChecks).toBe('pending');
    expect(refused(finished(r.state, true, 'not-a-commit'))).toBe('invalid-input');
  });

  it('back to the helper: rework with the failing checks, the lead told; then the lead decides', () => {
    const r = ok(sealed(sealedHelper(blockGraph('helper', 1)), W, 'rv'));
    const failed = ok(finished(r.state, false));
    expect(changeOf(failed.state, W)).toMatchObject({ state: 'rework', round: 0, checkRounds: 1 });
    expect(changeOf(failed.state, W).blockChecks).toBeUndefined();
    const start = effectsOf(failed.effects, 'start-agent')[0];
    expect(start).toMatchObject({ agentRunId: W, rework: { resumeSessionId: 'sess-w' } });
    expect(start?.prompt).toMatch(/checks failed on your change \(check round 1 of 1\)/);
    expect(start?.prompt).toContain('Lint (exit 1), last output:\nsrc/a.ts: missing semicolon');
    expect(leadMessages(failed.effects).join('\n')).toMatch(
      /failed: Lint; it went back to Store for rework \(check round 1 of 1\)/,
    );
    // No review round is used and no change-round row is written for a check rework.
    expect(types(failed.effects)).not.toContain('change-round');

    // Round two fails again: the block has no round left, so the lead decides with the details.
    let s = ok(
      event(failed.state, W, { type: 'started', providerSessionId: 'sess-w', model: null }),
    ).state;
    s = ok(finishTurn(s, W, 'success', 7000)).state;
    expect(changeOf(s, W).checkRounds).toBe(1);
    s = ok(sealed(s, W, 'rv2', true, 'def5678', 7500)).state;
    const again = ok(finished(s, false, 'def5678', 8000));
    expect(changeOf(again.state, W)).toMatchObject({ state: 'decision', checkRounds: 1 });
    const note = leadMessages(again.effects).join('\n');
    expect(note).toMatch(/no rework round left \(1 of 1 used\), so you decide/);
    expect(note).toContain('src/a.ts: missing semicolon');
  });

  it('the lead decides, or the owner is asked', () => {
    const lead = ok(finished(ok(sealed(sealedHelper(blockGraph('lead')), W, 'rv')).state, false));
    expect(changeOf(lead.state, W).state).toBe('decision');
    expect(leadMessages(lead.effects).join('\n')).toMatch(/failed: Lint\. You decide\./);
    const owner = ok(finished(ok(sealed(sealedHelper(blockGraph('owner')), W, 'rv')).state, false));
    expect(changeOf(owner.state, W).state).toBe('needs-owner');
    expect(leadMessages(owner.effects).join('\n')).toMatch(/sends it to the owner/);
  });

  it('a change with no changes never runs its block', () => {
    const r = ok(sealed(sealedHelper(blockGraph('helper')), W, 'rv', false, null));
    expect(types(r.effects)).not.toContain('run-change-checks');
    expect(changeOf(r.state, W).state).toBe('no-changes');
  });
});

describe('the block before the merge with "ask me" (ADR-0027 §5)', () => {
  function atLead(): RunState {
    const graph = blockGraph('lead', 1, 'owner');
    const s = ok(finished(ok(sealed(sealedHelper(graph), W, 'rv')).state, true)).state;
    expect(changeOf(s, W)).toMatchObject({ state: 'reviewing', reviewer: 'lead' });
    return s;
  }

  it('a merge blocked by failed checks goes to the owner, not back to the lead', () => {
    let s = ok(leadTool(atLead(), 'merge_change', { agentId: W }, 'm')).state;
    const blocked = ok(
      changeMergeBlocked(s, W, { reason: 'checks-failed', failed: ['Unit tests'] }, makeCtx(9000)),
    );
    expect(changeOf(blocked.state, W)).toMatchObject({ state: 'needs-owner', merging: false });
    expect(blocked.value).toMatch(
      /sends a change whose checks failed before the merge to the owner/,
    );
    s = blocked.state;
    expect(refused(leadTool(s, 'merge_change', { agentId: W }, 'm2'))).toBe('change-not-decidable');
  });

  it('checks that finish failing at the lead send the change to the owner', () => {
    const s = atLead();
    const r = ok(
      checksFinished(
        s,
        W,
        { commit: COMMIT, requiredPassed: false, failed: ['Unit tests'] },
        makeCtx(9000),
      ),
    );
    expect(changeOf(r.state, W).state).toBe('needs-owner');
    expect(leadMessages(r.effects).join('\n')).toMatch(/Required checks failed.*owner/);
  });

  it("the lead's merge_change on a change whose early checks failed goes to the owner", () => {
    const graph = blockGraph('lead', 1, 'owner');
    let s = ok(sealed(sealedHelper(graph), W, 'rv')).state;
    // The merge block's early run on the sealed commit failed while the change block still ran.
    s = ok(
      checksFinished(s, W, { commit: COMMIT, requiredPassed: false, failed: [] }, makeCtx(5500)),
    ).state;
    s = ok(finished(s, true)).state;
    expect(changeOf(s, W)).toMatchObject({
      state: 'reviewing',
      reviewer: 'lead',
      checks: 'failed',
    });
    const r = ok(leadTool(s, 'merge_change', { agentId: W }, 'm'));
    expect(changeOf(r.state, W).state).toBe('needs-owner');
    expect(types(r.effects)).not.toContain('merge-change');
  });

  it('old graphs keep the lead route: failed checks are refused to the lead', () => {
    const graph = blockGraph('lead');
    let s = ok(finished(ok(sealed(sealedHelper(graph), W, 'rv')).state, true)).state;
    s = ok(leadTool(s, 'merge_change', { agentId: W }, 'm')).state;
    const blocked = ok(
      changeMergeBlocked(s, W, { reason: 'checks-failed', failed: ['Unit tests'] }, makeCtx(9000)),
    );
    expect(changeOf(blocked.state, W).state).toBe('reviewing');
    expect(blocked.value).toMatch(/Ask for rework, discard it, or ask the owner/);
  });
});

describe('a failed setup (ADR-0027 §1)', () => {
  it('ends the starting helper with the reason, tells the lead, and seals its empty worktree', () => {
    let s = graphRunning(testGraph({ named: false }), {}, [
      { title: 'S', role: 'Store', detail: '' },
    ]);
    s = ok(leadTool(s, 'start_agent', { role: 'Store', task: 'Build the store' }, 'w')).state;
    expect(agentOf(s, W).status).toBe('STARTING');
    const r = ok(agentSetupFailed(s, W, "Setup 'install' failed: exit 1.", makeCtx(3000, 'sf')));
    expect(agentOf(r.state, W)).toMatchObject({
      status: 'AWAITING_REVIEW',
      latestActivity: "Setup 'install' failed: exit 1.",
    });
    expect(types(r.effects)).toContain('seal-change');
    expect(leadMessages(r.effects).join('\n')).toMatch(/did not start: Setup 'install' failed/);
    // Late or repeated reports change nothing; the lead cannot have a setup.
    expect(ok(agentSetupFailed(r.state, W, 'again', makeCtx(3100))).effects).toEqual([]);
    expect(refused(agentSetupFailed(r.state, LEAD, 'x', makeCtx(3200)))).toBe('invalid-input');
  });
});

describe('the Checks block on the ticket branch (ADR-0027 §5)', () => {
  it('runs as the final chain reaches it (after afterStages final stages)', () => {
    const g = testGraph({ named: false, finals: ['final'] });
    const edges = g.edges.filter((e) => !(e.type === 'flow' && e.from === 'ticket-merge'));
    edges.push(flow('ticket-merge', 'branch-checks'), flow('branch-checks', 'final-1'));
    const graph: WorkflowGraph = {
      ...g,
      nodes: [
        ...g.nodes,
        {
          type: 'checks',
          id: 'branch-checks',
          label: 'Full checks',
          place: 'branch',
          select: { kind: 'labels', labels: ['full'] },
        },
      ],
      edges,
    };
    const ctx = { projectMode: 'manual' as const, approvalCeilings: [], maxConcurrentHelpers: 3 };
    expect(programOf({ graph, graphContext: ctx }).checkBlocks.branch).toMatchObject({
      nodeId: 'branch-checks',
      afterStages: 0,
      onFailure: 'owner',
    });
    // Merge one change, hand over: the final reviewer starts and the branch block runs first.
    let s = ok(finished(ok(sealed(sealedHelper(graph), W, 'rv')).state, true)).state;
    s = ok(leadTool(s, 'merge_change', { agentId: W }, 'm')).state;
    // The server merged it.
    s = ok(
      recordChangeDecision(
        s,
        W,
        { decision: 'merge', by: 'lead', outcome: 'merged', headCommit: 'def5678' },
        makeCtx(9000, 'md'),
      ),
    ).state;
    const handed = ok(leadTool(s, 'request_review', { summary: 'Done.' }, 'rr', LEAD, 9500));
    const kinds = types(handed.effects);
    expect(kinds).toContain('run-branch-checks');
    expect(kinds.indexOf('run-branch-checks')).toBeLessThan(kinds.lastIndexOf('start-agent'));
    expect(effectsOf(handed.effects, 'run-branch-checks')).toEqual([
      {
        type: 'run-branch-checks',
        blockNodeId: 'branch-checks',
        select: { kind: 'labels', labels: ['full'] },
      },
    ]);
  });
});
