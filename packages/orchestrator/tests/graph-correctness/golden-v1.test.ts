import { describe, expect, it } from 'vitest';
import { GOLDEN_CASES } from './cases.js';
import {
  agentModeOf,
  asGraphRun,
  goldenTrace,
  runModeOf,
  withoutGraphLaunchFields,
} from './golden.js';

/**
 * Golden version 1 traces (README "Graph correctness", layer 5). The snapshots were recorded on
 * the engine BEFORE WG-B changed it (feature/workflow-graph 7ffd373). They must never be updated
 * to make a test pass: a difference is a behaviour change, to be explained in
 * docs/workflow-graph/wp/WG-B.md at tag v0.3.0. Synthetic data only.
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

/**
 * The same cases through the program-driven engine (WG-B): a v1 run (its snapshot migrated and
 * compiled inside the engine) with the server's per-agent mode, and the same workflow passed as a
 * migrated graph. Both must give the golden trace above. The only difference allowed is the graph
 * run's additive `autoMode`/`sandbox` launch fields (ADR-0023 §5), checked separately.
 */
describe('golden v1 traces through the program', () => {
  for (const c of GOLDEN_CASES) {
    it(c.name, () => {
      const v1 = goldenTrace(c, runModeOf);
      expect(goldenTrace(c, agentModeOf).trace).toBe(v1.trace);
      // A graph applies to ticket runs only.
      if (c.config.controlPanel === true) return;
      const graph = goldenTrace(c, agentModeOf, asGraphRun);
      expect(withoutGraphLaunchFields(graph.trace)).toBe(v1.trace);
      const fullAuto = c.config.approvals?.mode === 'full-auto';
      expect(graph.trace.includes('autoMode=true')).toBe(
        fullAuto && v1.trace.includes('kind="worker"'),
      );
    });
  }
});
