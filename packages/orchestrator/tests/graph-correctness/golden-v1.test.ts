import { describe, expect, it } from 'vitest';
import { GOLDEN_CASES } from './cases.js';
import { goldenTrace, runModeOf } from './golden.js';

/**
 * Golden version 1 traces (README "Graph correctness", layer 5). The snapshots were recorded on
 * the engine BEFORE WG-B changed it (feature/workflow-graph 7ffd373). They must never be updated
 * to make a test pass: a difference is a behaviour change, to be explained in
 * docs/workflow-graph/wp/WG-B.md. Synthetic data only.
 */
describe('golden v1 traces', () => {
  it('has unique case names', () => {
    const names = GOLDEN_CASES.map((c) => c.name);
    expect(new Set(names).size).toBe(names.length);
  });

  for (const c of GOLDEN_CASES) {
    it(c.name, () => {
      const { trace, digest, result } = goldenTrace(c, runModeOf);
      expect(result.outcome).not.toBe('step-limit');
      expect(c.full === false ? digest : trace).toMatchSnapshot();
    });
  }
});
