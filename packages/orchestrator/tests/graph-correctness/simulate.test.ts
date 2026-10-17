import { WORKFLOW_TEMPLATE_IDS, workflowTemplate } from '@acp/core';
import type { ApprovalMode } from '@acp/core';
import { describe, expect, it } from 'vitest';
import { GOLDEN_CASES, PERMISSIONS, v1Workflow } from './cases.js';
import { describeFailure, explore, exploreGraph, graphSimConfig } from './explore.js';
import type { GraphRunSetup } from './explore.js';
import { agentModeOf } from './golden.js';
import { endInvariants, stepInvariants } from './invariants.js';
import { SCRIPTS } from './scripts.js';
import { simulate } from './sim.js';
import type { StepRecord } from './sim.js';

/**
 * Layers 1 and 2 (README "Graph correctness"): the run simulator's invariants on every step of
 * every golden script, and the exhaustive exploration of every template and every migrated v1
 * workflow. Synthetic data only.
 */

describe('layer 1: invariants on every step of every golden script', () => {
  for (const c of GOLDEN_CASES) {
    it(c.name, () => {
      const problems: string[] = [];
      const result = simulate(c.config, SCRIPTS[c.script](), {
        modeOf: agentModeOf,
        onStep: (step) => {
          for (const p of stepInvariants(step)) problems.push(`#${step.index} ${p}`);
        },
      });
      const end = endInvariants(result);
      // Stop all ends a run as CANCELLED, which counts as finished.
      expect([...problems, ...end]).toEqual([]);
    });
  }
});

describe('layer 2: every behaviour of each template', () => {
  const setups: GraphRunSetup[] = [
    { projectMode: 'manual' },
    { projectMode: 'full-auto' },
    { projectMode: 'full-auto', ceilings: ['auto-edits'] },
    { projectMode: 'auto', reviewer: 'lead' },
    { projectMode: 'auto-edits', maxReworkRounds: 0 },
    { projectMode: 'auto-edits', stepHelpers: false },
  ];
  for (const id of WORKFLOW_TEMPLATE_IDS) {
    for (const planner of [false, true]) {
      for (const setup of setups) {
        it(`${id}${planner ? ' with a planner' : ''} ${JSON.stringify(setup)}`, () => {
          const graph = workflowTemplate(id, { planner });
          const plan = (o: GraphRunSetup) => ({ ...graphSimConfig(graph, o) });
          const result = explore(plan(setup), 5000);
          expect(describeFailure(id, graph, result, setup)).toBe(`${id}: ok`);
          expect(result.exhaustive).toBe(true);
        });
      }
    }
  }

  it('a template with tool uses in every approval mode', () => {
    for (const mode of ['manual', 'auto-edits', 'auto', 'full-auto'] as ApprovalMode[]) {
      const graph = workflowTemplate('reviewer-helper-loop');
      const config = { ...graphSimConfig(graph, { projectMode: mode }), permissions: PERMISSIONS };
      const result = explore(config, 5000);
      expect(describeFailure(mode, graph, result)).toBe(`${mode}: ok`);
      expect(result.exhaustive).toBe(true);
    }
  });
});

describe('layer 2: every behaviour of each migrated v1 workflow', () => {
  for (const plannerMode of ['lead', 'separate'] as const) {
    for (const reviewer of ['agent', 'lead'] as const) {
      for (const rounds of [0, 2]) {
        for (const codeReview of [false, true]) {
          for (const unitTests of [false, true]) {
            const o = { plannerMode, reviewer, rounds, codeReview, unitTests };
            it(JSON.stringify(o), () => {
              const wf = v1Workflow(o);
              const config = {
                workflow: wf,
                loop: { reviewer, rounds },
                approvals: { mode: 'auto-edits' as const, commands: [] },
              };
              const result = exploreGraph(config, 5000, true);
              expect(result.violation).toBeNull();
              expect(result.exhaustive).toBe(true);
            });
          }
        }
      }
    }
  }
});

describe('the invariants are not vacuous', () => {
  /** A real step of a golden run, to break by hand. */
  function realStep(predicate: (s: StepRecord) => boolean): StepRecord {
    let found: StepRecord | undefined;
    const c = GOLDEN_CASES.find((g) => g.name === 'loop lead-plans/rev-agent/r2/cr/ut approve');
    if (c === undefined) throw new Error('missing golden case');
    simulate(c.config, SCRIPTS[c.script](), {
      modeOf: agentModeOf,
      onStep: (step) => {
        if (found === undefined && predicate(step)) found = step;
      },
    });
    if (found === undefined) throw new Error('no such step');
    return found;
  }
  const merged = (s: StepRecord) =>
    s.after.agents.some((a) => a.change?.state === 'merged') &&
    !s.before.agents.some((a) => a.change?.state === 'merged');

  it('flags a change merged without going through the checks', () => {
    const step = realStep(merged);
    const before = {
      ...step.before,
      agents: step.before.agents.map((a) =>
        a.change === undefined ? a : { ...a, change: { ...a.change, merging: false } },
      ),
    };
    expect(stepInvariants({ ...step, before }).join()).toContain(
      'without a merge through the checks',
    );
  });

  it('flags a helper before an approved plan', () => {
    const step = realStep(merged);
    const after = { ...step.after, plans: [] };
    expect(stepInvariants({ ...step, after }).join()).toContain('before an approved plan');
  });

  it('flags a merge by anyone but the lead or the owner', () => {
    const step = realStep((s) => s.action.startsWith('merge_change'));
    expect(stepInvariants({ ...step, actor: 'Store' }).join()).toContain('merge-change by lead');
  });

  it('flags a lead rework past its rounds', () => {
    const step = realStep(merged);
    const id = step.after.agents.find((a) => a.change?.state === 'merged')?.id ?? '';
    const before = {
      ...step.before,
      agents: step.before.agents.map((a) =>
        a.id === id && a.change !== undefined ? { ...a, change: { ...a.change, round: 2 } } : a,
      ),
    };
    const rework = {
      type: 'change-round' as const,
      agentRunId: id,
      round: 2,
      reviewer: 'agent' as const,
      reviewerAgentRunId: null,
      verdict: null,
      decision: 'rework' as const,
      decidedBy: 'lead' as const,
    };
    const result =
      step.result !== null && step.result.ok ? { ...step.result, effects: [rework] } : null;
    expect(stepInvariants({ ...step, before, result }).join()).toContain('past its 2 rounds');
  });

  it('flags a run nothing can move on (the deadlock class)', () => {
    // The lead names a helper node that does not exist, so it can never start one.
    const graph = workflowTemplate('todays-setup');
    const config = { ...graphSimConfig(graph), stepHelpers: false, helperFor: { Store: 'nope' } };
    const result = simulate(config, SCRIPTS.approve(), { modeOf: agentModeOf });
    expect(result.outcome).toBe('stuck');
    expect(endInvariants(result).join()).toContain('did not finish: stuck in RUNNING');
  });
});
