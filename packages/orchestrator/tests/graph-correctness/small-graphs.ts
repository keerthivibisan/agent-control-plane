import {
  WorkflowGraphInvalidError,
  enumerateSmallGraphs,
  generateValidGraph,
  validateWorkflowGraph,
} from '@acp/core';
import type { WorkflowGraph } from '@acp/core';
import { expect } from 'vitest';
import { programOf } from '../../src/index.js';
import { describeFailure, exploreGraph, graphSimConfig } from './explore.js';

/**
 * Layers 2 and 4 (README "Graph correctness") over many graphs, in shards so the test files run
 * in parallel. Synthetic data only.
 *
 * Bound (layer 4): `enumerateSmallGraphs()` yields, per structure, a baseline graph and graphs
 * that vary one editing node's review route and rework edges. A valid baseline is explored node
 * by node (each editing node branches while the others answer by default); a valid variation is
 * explored with its varied node branching, since the rest is the baseline's, already explored.
 * Each focus is a bounded model check with explored states pruned, capped at `BUDGET` runs.
 */
export const BUDGET = 3000;

const CONTEXT = { projectMode: 'manual' as const, approvalCeilings: [], maxConcurrentHelpers: 3 };

export interface ShardReport {
  graphs: number;
  valid: number;
  rejected: number;
  runs: number;
  notExhaustive: string[];
  /** Graphs the validator accepted but the simulator flagged: validator gaps. */
  gaps: string[];
  /** Graphs the validator rejected but compile accepted (must never happen). */
  compiledInvalid: string[];
}

function emptyReport(): ShardReport {
  return {
    graphs: 0,
    valid: 0,
    rejected: 0,
    runs: 0,
    notExhaustive: [],
    gaps: [],
    compiledInvalid: [],
  };
}

/** Layer 4 soundness and completeness over one shard of the small graphs. */
export function smallGraphShard(shard: number, shards: number): ShardReport {
  const report = emptyReport();
  let i = 0;
  for (const { name, graph } of enumerateSmallGraphs()) {
    if (i++ % shards !== shard) continue;
    report.graphs++;
    const errors = validateWorkflowGraph(graph, { projectMode: 'manual' }).filter(
      (x) => x.severity === 'error',
    );
    if (errors.length > 0) {
      report.rejected++;
      try {
        programOf({ graph, graphContext: CONTEXT });
        report.compiledInvalid.push(name);
      } catch (error) {
        if (!(error instanceof WorkflowGraphInvalidError)) throw error;
      }
      continue;
    }
    report.valid++;
    const varied = name.endsWith(' baseline') ? undefined : name.split(' ').at(-1)?.split(':')[0];
    check(report, name, graph, varied === undefined ? undefined : [varied]);
  }
  return report;
}

/**
 * Layer 2 over one shard of the generated valid graphs (seeds `from` to `to`); `checkBlocks`
 * (ADR-0027) adds Checks blocks on changes, before the merge and on the ticket branch, and
 * `'optional'` (ADR-0028 §2) may also remove the block before the merge.
 */
export function generatedShard(
  from: number,
  to: number,
  checkBlocks: boolean | 'optional' = false,
): ShardReport {
  const report = emptyReport();
  for (let seed = from; seed <= to; seed++) {
    const graph =
      checkBlocks === 'optional'
        ? generateValidGraph(seed, { optionalChecks: true })
        : checkBlocks
          ? generateValidGraph(seed, { checkBlocks: true })
          : generateValidGraph(seed);
    report.graphs++;
    report.valid++;
    check(report, `seed ${seed}`, graph, undefined);
  }
  return report;
}

function check(
  report: ShardReport,
  name: string,
  graph: WorkflowGraph,
  onlyNodes: readonly string[] | undefined,
): void {
  const result = exploreGraph(graphSimConfig(graph), BUDGET, false, onlyNodes);
  report.runs += result.runs;
  if (result.violation !== null) {
    report.gaps.push(describeFailure(`${name} (focus ${result.violation.focus})`, graph, result));
  } else if (!result.exhaustive) {
    report.notExhaustive.push(name);
  }
}

export function expectClean(report: ShardReport): void {
  expect(report.gaps).toEqual([]);
  expect(report.compiledInvalid).toEqual([]);
  expect(report.notExhaustive).toEqual([]);
  expect(report.valid).toBeGreaterThan(0);
}
