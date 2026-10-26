import { WORKFLOW_TEMPLATE_IDS, generateValidGraph, workflowTemplate } from '@acp/core';
import type { ApprovalMode, WorkflowGraph } from '@acp/core';
import { describe, expect, it } from 'vitest';
import { graphSimConfig } from '../graph-correctness/explore.js';
import { exploreAdversarial } from './sim-invariants.js';

/*
 * The adversarial invariants (`sim-invariants.ts`: bounded starts, lead and owner progress) over
 * every behaviour of the workflow templates and of generated graphs, with the existing safety
 * invariants alongside. The explored merges include repeated conflicts and failed checks (a
 * persistent lead meets every blocked merge). Synthetic data only.
 */

const BUDGET = 1500;

function expectClean(name: string, graph: WorkflowGraph, mode: ApprovalMode): void {
  const result = exploreAdversarial(graphSimConfig(graph, { projectMode: mode }), BUDGET);
  const v = result.violation;
  expect(
    v === null
      ? null
      : `${name} (${mode}, focus ${v.focus}): ${v.problems.join('; ')}\n${v.choices.join(' ')}`,
  ).toBeNull();
  expect(result.exhaustive, `${name} (${mode}) was not explored within the budget`).toBe(true);
}

describe('adversarial invariants over the templates', () => {
  for (const id of WORKFLOW_TEMPLATE_IDS) {
    for (const planner of [false, true]) {
      for (const mode of ['auto-edits', 'full-auto'] as const) {
        it(`${id}${planner ? ' with a planner' : ''} (${mode})`, () => {
          expectClean(id, workflowTemplate(id, { planner }), mode);
        }, 60_000);
      }
    }
  }
});

describe('adversarial invariants over generated graphs', () => {
  it('seeds 1-20, and 1-10 with Checks blocks', () => {
    for (let seed = 1; seed <= 20; seed++) {
      expectClean(`seed ${seed}`, generateValidGraph(seed), 'manual');
    }
    for (let seed = 1; seed <= 10; seed++) {
      expectClean(
        `seed ${seed} with checks`,
        generateValidGraph(seed, { checkBlocks: true }),
        'manual',
      );
    }
  }, 240_000);
});
