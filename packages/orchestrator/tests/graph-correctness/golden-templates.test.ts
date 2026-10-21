import { WORKFLOW_TEMPLATE_IDS, workflowTemplate } from '@acp/core';
import { describe, expect, it } from 'vitest';
import { graphSimConfig } from './explore.js';
import { agentModeOf, goldenTrace } from './golden.js';
import type { ScriptName } from './scripts.js';

/**
 * Template traces (README "Graph correctness", layer 5): each template's run on the main scripts,
 * pinned as a snapshot on the program-driven engine (WG-B), so any later change to how a template
 * runs shows up as a diff. Synthetic data only.
 */
const SCRIPTS_PINNED: ScriptName[] = ['approve', 'rework-then-approve', 'failed-check'];

describe('template traces', () => {
  for (const id of WORKFLOW_TEMPLATE_IDS) {
    for (const planner of [false, true]) {
      for (const script of SCRIPTS_PINNED) {
        it(`${id}${planner ? ' with a planner' : ''} ${script}`, () => {
          const config = graphSimConfig(workflowTemplate(id, { planner }), {
            projectMode: 'auto-edits',
          });
          const { trace, result } = goldenTrace({ name: id, config, script }, agentModeOf);
          expect(result.outcome).toBe('ended');
          expect(trace).toMatchSnapshot();
        });
      }
    }
  }
});
