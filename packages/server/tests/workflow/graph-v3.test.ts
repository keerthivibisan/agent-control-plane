// The effective workflow is version 3 (ADR-0037, AR-4): a stored version 3 graph is served as it is,
// version 3 only parts included; a stored version 2 graph is served migrated. Synthetic data only.
import {
  WORKFLOW_TEMPLATE_IDS,
  migrateWorkflowV2,
  workflowTemplate,
  workflowTemplateV3,
  type WorkflowGraphV3,
} from '@acp/core';
import { describe, expect, it } from 'vitest';
import { effectiveWorkflow } from '../../src/workflow/graph.js';

const AT = '2026-11-09T10:00:00.000Z';

function stored(graph: WorkflowGraphV3) {
  return { kind: 'v3' as const, graph: { projectId: 'p', graph, updatedAt: AT } };
}

describe('effectiveWorkflow: version 3', () => {
  it.each(WORKFLOW_TEMPLATE_IDS)('%s: a stored version 3 graph is served as it is', (id) => {
    const v3 = workflowTemplateV3(id, { planner: true });
    const effective = effectiveWorkflow(stored(v3), 'manual');
    expect(effective).toEqual({ stored: 'v3', graph: v3, updatedAt: AT });
  });

  it.each(WORKFLOW_TEMPLATE_IDS)('%s: a stored version 2 graph is served migrated', (id) => {
    const v2 = workflowTemplate(id, { planner: true });
    const effective = effectiveWorkflow(
      { kind: 'v2', graph: { projectId: 'p', graph: v2, updatedAt: AT } },
      'manual',
    );
    expect(effective).toEqual({ stored: 'v2', graph: migrateWorkflowV2(v2), updatedAt: AT });
  });

  it('serves version 3 only parts (a researcher, a labelled arrow) without loss', () => {
    const v3 = workflowTemplateV3('lead-only');
    const researched: WorkflowGraphV3 = {
      ...v3,
      nodes: [
        ...v3.nodes,
        { type: 'agent', id: 'r', label: 'Research', model: null, skills: [], agent: null },
      ],
      edges: [
        ...v3.edges,
        {
          type: 'research',
          id: 'research-r',
          from: 'r',
          to: 'orchestrate',
          label: 'Notes',
          purpose: 'What the code does today',
        },
      ],
    };
    expect(effectiveWorkflow(stored(researched), 'manual').graph).toEqual(researched);
  });
});
