import { generateValidGraph } from '@acp/core';
import { describe, expect, it } from 'vitest';
import { programOf } from '../../src/index.js';
import { expectClean, generatedShard } from './small-graphs.js';

/**
 * Layer 2 over generated valid graphs with Checks blocks (ADR-0027 §5, H-C; seeds 1–60): blocks
 * on helpers' and testers' changes (every failure route), before the lead's merge and on the
 * ticket branch, every behaviour explored with no invariant violation or deadlock: nothing merges
 * past a failed check without the owner, a block reworks a change within its rounds, every run
 * ends. Synthetic data only.
 */
const FROM = 1;
const TO = 60;
const CONTEXT = { projectMode: 'manual' as const, approvalCeilings: [], maxConcurrentHelpers: 3 };

describe('layer 2: generated graphs with Checks blocks (seeds 1-60)', () => {
  it('covers each kind of block', () => {
    const routes = new Set<string>();
    let branch = 0;
    for (let seed = FROM; seed <= TO; seed++) {
      const graph = generateValidGraph(seed, { checkBlocks: true });
      const blocks = programOf({ graph, graphContext: CONTEXT }).checkBlocks;
      for (const b of Object.values(blocks.change)) routes.add(b.onFailure);
      routes.add(`merge-${blocks.merge.onFailure}`);
      if (blocks.branch !== null) branch++;
    }
    expect(routes.has('helper')).toBe(true);
    expect([...routes].filter((r) => !r.startsWith('merge-')).length).toBeGreaterThan(1);
    expect(branch).toBeGreaterThan(0);
  });

  it('explores every behaviour without a violation', () => {
    const report = generatedShard(FROM, TO, true);
    expectClean(report);
    expect(report.runs).toBeGreaterThan(TO);
  }, 300_000);
});
