import { describe, expect, it } from 'vitest';
import { deriveRunWorkflow, deriveRunWorkflowGraph } from '../../src/index.js';
import { GOLDEN_CASES } from './cases.js';
import { agentModeOf } from './golden.js';
import { SCRIPTS } from './scripts.js';
import { simulate } from './sim.js';

/**
 * `deriveRunWorkflowGraph` on version 1 runs gives each node with a version 1 stage id the same
 * state and agents as that stage in `deriveRunWorkflow`, at every step of every golden case.
 * (`review` differs by design: the graph's change reviewer node shows its review agents, the v1
 * stage counts changes.) Synthetic data only.
 */
const SHARED = ['orchestrate', 'helpers', 'code-review', 'unit-tests', 'plan'];

describe('deriveRunWorkflowGraph agrees with deriveRunWorkflow on v1 runs', () => {
  for (const c of GOLDEN_CASES.filter((g) => g.config.controlPanel !== true)) {
    it(c.name, () => {
      let checked = 0;
      simulate(c.config, SCRIPTS[c.script](), {
        modeOf: agentModeOf,
        onStep: ({ after }) => {
          const v1 = new Map<string, { state: string; agentRunIds: string[] }>(
            deriveRunWorkflow(after).stages.map((st) => [st.stage, st]),
          );
          for (const node of deriveRunWorkflowGraph(after).nodes) {
            if (!SHARED.includes(node.nodeId)) continue;
            const stage = v1.get(node.nodeId);
            expect({ id: node.nodeId, state: node.state }).toEqual({
              id: node.nodeId,
              state: stage?.state,
            });
            if (node.nodeId !== 'plan') expect(node.agentRunIds).toEqual(stage?.agentRunIds);
            checked++;
          }
        },
      });
      expect(checked).toBeGreaterThan(0);
    });
  }
});
