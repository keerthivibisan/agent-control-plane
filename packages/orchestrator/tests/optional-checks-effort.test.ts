import { describe, expect, it } from 'vitest';
import { withoutCheckBlocks } from '@acp/core';
import type { AgentEffort, WorkflowGraph, WorkflowNode } from '@acp/core';
import {
  changeMergeBlocked,
  changeSummary,
  checkChangeAction,
  checksFinished,
  followUpChat,
  hasMergeChecks,
  programOf,
  recordChangeDecision,
  testerBrief,
} from '../src/index.js';
import type { EngineEffect, RunState } from '../src/index.js';
import { POOL, createGraphRun, graphContext, graphRunning, testGraph } from './graph-helpers.js';
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
 * ADR-0028 (v0.3.1 P-A) in the engine:
 * - §2: without a Checks block before the merge the lead's merge_change merges a reviewed change
 *   with no checks run or awaited, and a late checks result changes nothing; every F-1/F-2 rule
 *   (only the lead merges, a moved or checked-out ticket branch goes to the owner, bounded
 *   failed merges) still holds;
 * - §1: a block's effort is on every start of its agents (first turn, rework) and on the lead's
 *   follow-up; absent when the block sets none.
 * Synthetic data only.
 */

const W = 'w-1';
const STORE = [{ title: 'Store', role: 'Store', detail: 'Persist it.' }];

/** The pool-only lead-route graph with no Checks block at all. */
function noChecksGraph(): WorkflowGraph {
  return withoutCheckBlocks(testGraph({ named: false, route: 'lead' }));
}

function withEffort(graph: WorkflowGraph, efforts: Record<string, AgentEffort>): WorkflowGraph {
  return {
    ...graph,
    nodes: graph.nodes.map((n) =>
      efforts[n.id] === undefined ? n : ({ ...n, effort: efforts[n.id] } as WorkflowNode),
    ),
  };
}

/** The pool's helper finished its first turn and its change was sealed; the lead reviews it. */
function atLead(graph: WorkflowGraph): RunState {
  let s = graphRunning(graph, {}, STORE);
  s = ok(leadTool(s, 'start_agent', { role: 'Store', task: 'Build the store' }, 'w')).state;
  s = ok(event(s, W, { type: 'started', providerSessionId: 'sess-w', model: null })).state;
  s = ok(finishTurn(s, W)).state;
  s = ok(sealed(s, W, 'rv')).state;
  expect(changeOf(s, W)).toMatchObject({ state: 'reviewing', reviewer: 'lead', checks: null });
  return s;
}

function merging(graph: WorkflowGraph = noChecksGraph()): RunState {
  const r = ok(leadTool(atLead(graph), 'merge_change', { agentId: W }, 'm'));
  expect(effectsOf(r.effects, 'merge-change')).toEqual([
    { type: 'merge-change', agentRunId: W, by: 'lead', anyway: false },
  ]);
  return r.state;
}

describe('no Checks block before the merge (ADR-0028 §2)', () => {
  it('compiles to merge null', () => {
    const graph = noChecksGraph();
    expect(programOf({ graph, graphContext: graphContext({}) }).checkBlocks.merge).toBeNull();
    expect(hasMergeChecks({ graph, graphContext: graphContext({}) })).toBe(false);
    const old = testGraph({ named: false, route: 'lead' });
    expect(hasMergeChecks({ graph: old, graphContext: graphContext({}) })).toBe(true);
  });

  it('the lead merges a reviewed change; no check runs, none is awaited', () => {
    const s = merging();
    const done = ok(
      recordChangeDecision(
        s,
        W,
        { decision: 'merge', by: 'lead', outcome: 'merged', headCommit: 'def5678' },
        makeCtx(7000, 'md'),
      ),
    );
    expect(changeOf(done.state, W)).toMatchObject({ state: 'merged', checks: null });
    expect(types(done.effects)).not.toContain('run-change-checks');
  });

  it('a stray checks result never holds a merge back', () => {
    const s = atLead(noChecksGraph());
    const r = ok(
      checksFinished(
        s,
        W,
        { commit: COMMIT, requiredPassed: false, failed: ['Unit tests'] },
        makeCtx(5500),
      ),
    );
    expect(changeOf(r.state, W).checks).toBeNull();
    expect(leadMessages(r.effects)).toEqual([]);
    // even a change that somehow carries a failed result merges after review
    const odd: RunState = {
      ...s,
      agents: s.agents.map((a) =>
        a.id === W && a.change !== undefined
          ? { ...a, change: { ...a.change, checks: 'failed' } }
          : a,
      ),
    };
    expect(checkChangeAction(odd, W, 'merge', 'lead')).toBeNull();
  });

  it('view_change says no checks run before the merge', () => {
    const s = atLead(noChecksGraph());
    expect(changeSummary(s, agentOf(s, W))).toContain(
      'Required checks: none (this workflow has no Checks block before the merge',
    );
    const old = atLead(testGraph({ named: false, route: 'lead' }));
    expect(changeSummary(old, agentOf(old, W))).toContain(
      'Required checks: not run yet on this change (merge_change runs them).',
    );
  });

  it('the tester’s brief does not promise checks the workflow does not run', () => {
    const none = graphRunning(noChecksGraph(), {}, STORE);
    expect(testerBrief(none)).toContain('decided like the helpers’ changes.');
    expect(testerBrief(none)).not.toContain('after the project’s checks');
    const old = graphRunning(testGraph({ named: false, route: 'lead' }), {}, STORE);
    expect(testerBrief(old)).toContain('after the project’s checks.');
  });

  it('only the lead (or the owner) merges; a reviewer cannot', () => {
    const s = atLead(noChecksGraph());
    expect(checkChangeAction(s, W, 'merge', 'reviewer')?.code).toBe('not-lead');
    expect(checkChangeAction(s, W, 'merge-anyway', 'lead')?.code).toBe('not-lead');
  });

  it('F-2: a moved or checked-out ticket branch still sends the change to the owner', () => {
    for (const reason of ['ticket-branch-moved', 'ticket-branch-checked-out'] as const) {
      const r = ok(changeMergeBlocked(merging(), W, { reason }, makeCtx(9000)));
      expect(changeOf(r.state, W)).toMatchObject({ state: 'needs-owner', merging: false });
      expect(r.value).toMatch(/do not try the merge again/);
      expect(refused(leadTool(r.state, 'merge_change', { agentId: W }, 'm2'))).toBe(
        'change-not-decidable',
      );
    }
  });

  it('F-2: failed merges stay bounded', () => {
    let s = merging();
    for (let i = 0; i < 3; i++) {
      const r = ok(changeMergeBlocked(s, W, { reason: 'failed' }, makeCtx(9000 + i, `f${i}`)));
      s = r.state;
      if (changeOf(s, W).state === 'needs-owner') break;
      s = ok(leadTool(s, 'merge_change', { agentId: W }, `m${i}`)).state;
    }
    expect(changeOf(s, W).state).toBe('needs-owner');
  });
});

describe('effort per agent block (ADR-0028 §1)', () => {
  const effortOf = (effects: readonly EngineEffect[], id: string) =>
    effectsOf(effects, 'start-agent').find((e) => e.agentRunId === id)?.effort;

  it('the lead starts with its block’s effort; absent without one', () => {
    const plain = ok(createGraphRun(noChecksGraph()));
    expect(effectsOf(plain.effects, 'start-agent')[0]).not.toHaveProperty('effort');
    const set = ok(createGraphRun(withEffort(noChecksGraph(), { orchestrate: 'high' })));
    expect(effortOf(set.effects, LEAD)).toBe('high');
  });

  it('a helper keeps its block’s effort on its first turn and on a rework turn', () => {
    const graph = withEffort(noChecksGraph(), { [POOL]: 'low' });
    let s = graphRunning(graph, {}, STORE);
    const started = ok(leadTool(s, 'start_agent', { role: 'Store', task: 'Build it' }, 'w'));
    expect(effortOf(started.effects, W)).toBe('low');
    s = ok(
      event(started.state, W, { type: 'started', providerSessionId: 'sess-w', model: null }),
    ).state;
    s = ok(finishTurn(s, W)).state;
    s = ok(sealed(s, W, 'rv')).state;
    const rework = ok(leadTool(s, 'request_rework', { agentId: W, comments: 'Add a test.' }, 'rw'));
    const effect = effectsOf(rework.effects, 'start-agent').find((e) => e.agentRunId === W);
    expect(effect).toMatchObject({ rework: { resumeSessionId: 'sess-w' }, effort: 'low' });
  });

  it('the lead’s follow-up turn keeps its effort', () => {
    const graph = withEffort(noChecksGraph(), { orchestrate: 'medium' });
    const s0 = graphRunning(graph, {}, STORE);
    const ended: RunState = {
      ...s0,
      agents: s0.agents.map((a) => (a.id === LEAD ? { ...a, status: 'SUCCEEDED' } : a)),
    };
    const r = ok(
      followUpChat(ended, 'Why?', makeCtx(20_000), {
        managed: true,
        leadSessionId: 'sess-lead',
        leadProcessActive: false,
      }),
    );
    expect(effectsOf(r.effects, 'start-follow-up')[0]?.effort).toBe('medium');
    const plain = graphRunning(noChecksGraph(), {}, STORE);
    const r2 = ok(
      followUpChat(
        {
          ...plain,
          agents: plain.agents.map((a) => (a.id === LEAD ? { ...a, status: 'SUCCEEDED' } : a)),
        },
        'Why?',
        makeCtx(20_000),
        { managed: true, leadSessionId: 'sess-lead', leadProcessActive: false },
      ),
    );
    expect(effectsOf(r2.effects, 'start-follow-up')[0]).not.toHaveProperty('effort');
  });
});
