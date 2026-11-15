import { specialiseForTicket, workflowTemplateV3, type TicketType } from '@acp/core';
import { describe, expect, it } from 'vitest';
import { graphSimConfig } from './explore.js';
import { agentModeOf, goldenTrace } from './golden.js';
import type { ScriptName } from './scripts.js';

/**
 * ADR-0039: the BDD template as each ticket type runs it (`specialiseForTicket`), through the
 * program-driven engine on the main scripts. Every run ends, and the blocks a type skips never
 * start. Synthetic data only.
 */
const SCRIPTS: ScriptName[] = ['approve', 'rework-then-approve', 'failed-check'];
const TYPES: TicketType[] = ['feature', 'bug', 'chore', 'harness'];

describe('the BDD template per ticket type', () => {
  for (const type of TYPES) {
    for (const planner of [false, true]) {
      for (const script of SCRIPTS) {
        it(`${type}${planner ? ' with a planner' : ''} ${script}`, () => {
          const { graph, skipped } = specialiseForTicket(
            workflowTemplateV3('bdd', { planner }),
            type,
          );
          expect(skipped.map((n) => n.id)).toEqual(
            type === 'feature' ? [] : ['behaviour', 'scenario-tests'],
          );
          const config = graphSimConfig(graph, { projectMode: 'auto-edits' });
          const { trace, result } = goldenTrace(
            { name: `bdd-${type}`, config, script },
            agentModeOf,
          );
          expect(result.outcome).toBe('ended');
          if (type === 'feature') expect(trace).toContain('stage=behaviour');
          for (const id of skipped.map((n) => n.id)) expect(trace).not.toContain(`stage=${id}`);
        });
      }
    }
  }
});
