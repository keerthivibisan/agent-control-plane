// Workflow templates (README §1): each validates with no errors and no warnings in an Auto edits
// project, with and without a planner, and has the review route it promises. Synthetic data only.
import { describe, expect, it } from 'vitest';
import {
  WORKFLOW_TEMPLATES,
  WORKFLOW_TEMPLATE_IDS,
  WorkflowGraphSchema,
  defaultProjectWorkflow,
  migrateWorkflowV1,
  validateWorkflowGraph,
  workflowTemplate,
} from '../../src/index.js';

describe('workflow templates', () => {
  it('lists every template id once, with plain names and descriptions', () => {
    expect(WORKFLOW_TEMPLATES.map((t) => t.id)).toEqual([...WORKFLOW_TEMPLATE_IDS]);
    for (const t of WORKFLOW_TEMPLATES) {
      expect(t.name.length).toBeGreaterThan(0);
      expect(t.description.length).toBeGreaterThan(20);
    }
  });

  for (const id of WORKFLOW_TEMPLATE_IDS) {
    for (const planner of [false, true]) {
      it(`${id}${planner ? ' with a planner' : ''}: parses and validates with no issue`, () => {
        const graph = workflowTemplate(id, { planner });
        expect(WorkflowGraphSchema.parse(graph)).toEqual(graph);
        expect(graph.template).toBe(id);
        expect(graph.legacyV1).toBeUndefined();
        expect(
          validateWorkflowGraph(graph, { projectMode: 'auto-edits', maxConcurrentHelpers: 3 }),
        ).toEqual([]);
        expect(graph.nodes.some((n) => n.type === 'planner')).toBe(planner);
      });
    }
  }

  it('todays-setup is the default version 1 workflow, migrated', () => {
    for (const planner of [false, true]) {
      const v1 = defaultProjectWorkflow('p1', '2026-10-17T09:00:00.000Z');
      const migrated = migrateWorkflowV1(
        { plannerMode: planner ? 'separate' : 'lead', stages: v1.stages },
        { projectMode: 'auto-edits' },
      );
      const { legacyV1: _legacy, ...rest } = migrated;
      expect(workflowTemplate('todays-setup', { planner })).toEqual({
        ...rest,
        template: 'todays-setup',
      });
    }
  });

  it('lead-only reviews in the lead; reviewer-helper-loop reworks the pool from the reviewer', () => {
    const lead = workflowTemplate('lead-only');
    expect(lead.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'review', from: 'helpers', to: 'orchestrate' }),
        expect.objectContaining({
          type: 'rework',
          from: 'orchestrate',
          to: 'helpers',
          maxRounds: 2,
        }),
      ]),
    );
    const loop = workflowTemplate('reviewer-helper-loop');
    expect(loop.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'review', from: 'helpers', to: 'review' }),
        expect.objectContaining({ type: 'rework', from: 'review', to: 'helpers', maxRounds: 2 }),
        expect.objectContaining({ type: 'findings', from: 'review', to: 'orchestrate' }),
      ]),
    );
    expect(loop.edges.some((e) => e.type === 'rework' && e.from === 'orchestrate')).toBe(false);
  });

  it('returns a fresh graph each time', () => {
    const a = workflowTemplate('lead-only');
    a.nodes.length = 0;
    expect(workflowTemplate('lead-only').nodes.length).toBeGreaterThan(0);
  });
});
