import {
  WORKFLOW_TEMPLATE_IDS,
  generateValidGraph,
  withoutCheckBlocks,
  workflowTemplate,
} from '@acp/core';
import type { AgentEffort, WorkflowGraph, WorkflowNode } from '@acp/core';
import { describe, expect, it } from 'vitest';
import { programOf } from '../../src/index.js';
import { describeFailure, explore, graphSimConfig } from './explore.js';
import type { GraphRunSetup } from './explore.js';
import { agentModeOf } from './golden.js';
import { endInvariants, stepInvariants } from './invariants.js';
import { simulate } from './sim.js';
import { expectClean, generatedShard } from './small-graphs.js';

/**
 * Layer 2 for ADR-0028 (v0.3.1 P-A): the "no checks" variant of every template (no Checks block
 * at all: the lead merges each change after its review) and every template with an effort on each
 * agent block, every behaviour explored with no invariant violation or deadlock; generated graphs
 * that may lose the block before the merge (seeds 1-40). The invariants include: no merge checks
 * without a merge block, and each start carries its node's effort. Synthetic data only.
 */

const LEVELS: readonly AgentEffort[] = ['low', 'medium', 'high'];
const AGENT_TYPES = ['planner', 'lead', 'helper-pool', 'helper', 'reviewer', 'tester'];

/** Every agent block of `graph` with an effort, cycling through the levels. */
function withEfforts(graph: WorkflowGraph): WorkflowGraph {
  let i = 0;
  return {
    ...graph,
    nodes: graph.nodes.map((n) =>
      AGENT_TYPES.includes(n.type)
        ? ({ ...n, effort: LEVELS[i++ % LEVELS.length] } as WorkflowNode)
        : n,
    ),
  };
}

const SETUPS: GraphRunSetup[] = [
  { projectMode: 'manual' },
  { projectMode: 'full-auto' },
  { projectMode: 'auto', reviewer: 'lead' },
];

describe('the no-checks variant of each template', () => {
  for (const id of WORKFLOW_TEMPLATE_IDS) {
    for (const planner of [false, true]) {
      for (const setup of SETUPS) {
        it(`${id}${planner ? ' with a planner' : ''} ${JSON.stringify(setup)}`, () => {
          const graph = withoutCheckBlocks(workflowTemplate(id, { planner }));
          expect(
            programOf({ graph, graphContext: graphSimConfig(graph).extra?.graphContext })
              .checkBlocks.merge,
          ).toBeNull();
          const result = explore(graphSimConfig(graph, setup), 5000);
          expect(describeFailure(id, graph, result, setup)).toBe(`${id}: ok`);
          expect(result.exhaustive).toBe(true);
        });
      }
    }
  }

  it('runs to the owner’s merge: every change merged after review, no checks anywhere', () => {
    for (const id of WORKFLOW_TEMPLATE_IDS) {
      const graph = withoutCheckBlocks(workflowTemplate(id));
      const problems: string[] = [];
      const result = simulate(graphSimConfig(graph), (point) => point.options[0] ?? '', {
        modeOf: agentModeOf,
        onStep: (step) => {
          for (const p of stepInvariants(step)) problems.push(`#${step.index} ${p}`);
        },
      });
      expect([...problems, ...endInvariants(result)], id).toEqual([]);
      expect(result.state.run.status, id).toBe('COMPLETED');
      const changes = result.state.agents.flatMap((a) =>
        a.change === undefined ? [] : [a.change],
      );
      expect(changes.length, id).toBeGreaterThan(0);
      expect(
        changes.every((c) => c.state === 'merged' && c.checks === null),
        id,
      ).toBe(true);
    }
  });
});

describe('each template with an effort on every agent block', () => {
  for (const id of WORKFLOW_TEMPLATE_IDS) {
    for (const planner of [false, true]) {
      it(`${id}${planner ? ' with a planner' : ''}`, () => {
        const graph = withEfforts(workflowTemplate(id, { planner }));
        const result = explore(graphSimConfig(graph, { projectMode: 'manual' }), 5000);
        expect(describeFailure(id, graph, result)).toBe(`${id}: ok`);
        expect(result.exhaustive).toBe(true);
      });
    }
  }
});

describe('generated graphs that may have no block before the merge (seeds 1-40)', () => {
  it('covers graphs without one', () => {
    let without = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const graph = generateValidGraph(seed, { optionalChecks: true });
      const context = graphSimConfig(graph).extra?.graphContext;
      if (programOf({ graph, graphContext: context }).checkBlocks.merge === null) without++;
    }
    expect(without).toBeGreaterThan(0);
  });

  it('explores every behaviour without a violation', () => {
    const report = generatedShard(1, 40, 'optional');
    expectClean(report);
  }, 300_000);
});
