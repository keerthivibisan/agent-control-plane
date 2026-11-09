// A stored version 3 graph (ADR-0037, AR-1): served as version 2 until the API carries version 3
// (AR-4), and refused plainly when version 2 cannot say it. Synthetic data only.
import {
  WORKFLOW_TEMPLATE_IDS,
  workflowTemplate,
  workflowTemplateV3,
  type WorkflowGraphV3,
} from '@acp/core';
import { describe, expect, it } from 'vitest';
import { WorkflowGraphVersionError, effectiveWorkflow } from '../../src/workflow/graph.js';

const AT = '2026-11-09T10:00:00.000Z';

function stored(graph: WorkflowGraphV3) {
  return { kind: 'v3' as const, graph: { projectId: 'p', graph, updatedAt: AT } };
}

describe('effectiveWorkflow: a stored version 3 graph', () => {
  it.each(WORKFLOW_TEMPLATE_IDS)('%s is served as its version 2 graph', (id) => {
    const v3 = workflowTemplateV3(id, { planner: true });
    const effective = effectiveWorkflow(stored(v3), 'manual');
    expect(effective.stored).toBe('v2');
    expect(effective.updatedAt).toBe(AT);
    // The same blocks, arrows and launch fields as version 2's template (arrow ids differ).
    const shape = (g: {
      nodes: readonly unknown[];
      edges: readonly { type: string; from: string; to: string }[];
    }) => ({
      nodes: g.nodes,
      edges: g.edges.map((e) => `${e.type}:${e.from}>${e.to}`).sort(),
    });
    expect(shape(effective.graph)).toEqual(shape(workflowTemplate(id, { planner: true })));
  });

  it('refuses a graph with version 3 only parts instead of serving it with parts missing', () => {
    const v3 = workflowTemplateV3('lead-only');
    const researched: WorkflowGraphV3 = {
      ...v3,
      nodes: [
        ...v3.nodes,
        { type: 'agent', id: 'r', label: 'Research', model: null, skills: [], agent: null },
      ],
      edges: [...v3.edges, { type: 'research', id: 'research-r', from: 'r', to: 'orchestrate' }],
    };
    expect(() => effectiveWorkflow(stored(researched), 'manual')).toThrow(
      WorkflowGraphVersionError,
    );
  });
});
