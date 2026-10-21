import { describe, expect, it } from 'vitest';
import { deriveRunWorkflowGraph, isLiveAgentStatus, type RunState } from '../../src/index.js';
import { GOLDEN_CASES } from './cases.js';
import { agentModeOf, asGraphRun } from './golden.js';
import { SCRIPTS } from './scripts.js';
import { simulate } from './sim.js';

/**
 * A run reloaded from the database (a restart, or an old run's page after the upgrade from
 * v0.1.0) has no `reviewsAgentRunId` on its change reviewers: it lives with the live run only. The
 * run's graph view must still put each change reviewer on its review node, as the version 1 view
 * does by its stage (WG-V finding: the review block of every reloaded run showed no agent and
 * "skipped"). Checked at every step where no agent is live (what a reload can see), for every
 * golden case, as a version 1 run and as a graph run. Synthetic data only.
 */

function reloaded(state: RunState): RunState {
  return {
    ...state,
    agents: state.agents.map((a) => {
      const { reviewsAgentRunId: _live, ...stored } = a;
      return stored;
    }),
  };
}

describe('the run graph of a reloaded run keeps its change reviewers', () => {
  for (const asGraph of [false, true]) {
    for (const c of GOLDEN_CASES.filter((g) => g.config.controlPanel !== true)) {
      it(`${asGraph ? 'graph' : 'v1'}: ${c.name}`, () => {
        let checked = 0;
        simulate(asGraph ? asGraphRun(c.config) : c.config, SCRIPTS[c.script](), {
          modeOf: agentModeOf,
          onStep: ({ after }) => {
            if (after.agents.some((a) => isLiveAgentStatus(a.status))) return;
            expect(deriveRunWorkflowGraph(reloaded(after)).nodes).toEqual(
              deriveRunWorkflowGraph(after).nodes,
            );
            checked++;
          },
        });
        expect(checked).toBeGreaterThan(0);
      });
    }
  }
});
