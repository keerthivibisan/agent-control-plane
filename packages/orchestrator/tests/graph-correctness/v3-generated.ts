import { generateValidGraphV3 } from '@acp/core';
import { expect } from 'vitest';
import { programOf } from '../../src/index.js';
import { describeFailure, exploreGraph, graphSimConfig } from './explore.js';

/**
 * ADR-0037 (AR-3): layer 2 over seeded random version 3 graphs (`generateValidGraphV3` with four
 * version 3 moves: researchers, more planners, review fan-outs, custom arrows, labels and
 * purposes), in shards so the files run in parallel. Each graph is explored node by node, like
 * the version 2 generated graphs, with one more focus for its researchers and plan options.
 * Synthetic data only.
 */

/** Runs per focus: a few version 3 graphs need more than the version 2 `BUDGET`. */
const BUDGET_V3 = 12_000;
const CONTEXT = { projectMode: 'manual' as const, approvalCeilings: [], maxConcurrentHelpers: 3 };

export function expectGeneratedV3Clean(from: number, to: number): void {
  const gaps: string[] = [];
  const notExhaustive: string[] = [];
  let withV3 = 0;
  for (let seed = from; seed <= to; seed++) {
    const graph = generateValidGraphV3(seed, { v3Moves: 4 });
    const program = programOf({ graph, graphContext: CONTEXT });
    if (
      program.researchers.length > 0 ||
      program.handoffs.length > 0 ||
      program.planners.length > 1 ||
      program.changeReviewers.length > 1
    ) {
      withV3++;
    }
    const result = exploreGraph(graphSimConfig(graph), BUDGET_V3);
    if (result.violation !== null) {
      gaps.push(describeFailure(`seed ${seed} (focus ${result.violation.focus})`, graph, result));
    } else if (!result.exhaustive) {
      notExhaustive.push(`seed ${seed}`);
    }
  }
  expect(gaps).toEqual([]);
  expect(notExhaustive).toEqual([]);
  // Most seeds draw at least one version 3 part (the moves can be refused for lack of room).
  expect(withV3).toBeGreaterThan((to - from + 1) / 2);
}
