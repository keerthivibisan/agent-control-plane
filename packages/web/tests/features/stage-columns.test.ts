import { WorkflowGraphV3Schema, workflowTemplateV3 } from '@acp/core';
import { describe, expect, it } from 'vitest';
import { columnOf, layoutGraph } from '../../src/features/workflow/editor/layout';
import { stageHeaders } from '../../src/features/workflow/editor/StageHeaders';

/*
 * ADR-0040: Tidy layout puts each block in its stage's column, left to right in run order, and the
 * canvas numbers the stages as the lead's playbook does.
 */

describe('stage columns', () => {
  it('puts every block of the BDD template in its column, in run order', () => {
    const g = workflowTemplateV3('bdd');
    const cols = columnOf(g);
    expect(cols.get('ticket')).toBe('start');
    expect(cols.get('behaviour')).toBe('start');
    expect(cols.get('orchestrate')).toBe('lead');
    expect(cols.get('plan-approval')).toBe('lead');
    expect(cols.get('scenario-tests')).toBe('build');
    expect(cols.get('developer')).toBe('build');
    expect(cols.get('checks')).toBe('merge');
    expect(cols.get('unit-tests')).toBe('final');
    expect(cols.get('author')).toBe('final');
    expect(cols.get('owner-merge')).toBe('finish');
    const pos = layoutGraph(g);
    const x = (id: string) => pos.get(id)?.x ?? NaN;
    expect(x('ticket')).toBeLessThan(x('orchestrate'));
    expect(x('orchestrate')).toBeLessThan(x('developer'));
    expect(x('developer')).toBeLessThan(x('checks'));
    expect(x('checks')).toBeLessThan(x('unit-tests'));
    expect(x('unit-tests')).toBeLessThan(x('owner-merge'));
    // The lead writes the plan, so its approval stands under it; with a planner, over it.
    expect(pos.get('plan-approval')?.y ?? 0).toBeGreaterThan(pos.get('orchestrate')?.y ?? 0);
    const planned = layoutGraph(workflowTemplateV3('bdd', { planner: true }));
    expect(planned.get('plan-approval')?.y ?? 0).toBeLessThan(planned.get('orchestrate')?.y ?? 0);
  });

  it('numbers the stages over the columns, the build stage over the lead and its helpers', () => {
    const g = workflowTemplateV3('bdd');
    const pos = layoutGraph(g);
    const headers = stageHeaders(g, pos);
    expect(headers.map((h) => `${h.n} ${h.title}`)).toEqual([
      '1 Ticket and research',
      '3 Build',
      '5 Merge',
      '6 Final checks',
      '7 Finish',
    ]);
    const build = headers.find((h) => h.key === 'build');
    expect(build?.x).toBe(pos.get('orchestrate')?.x);
    expect((build?.x ?? 0) + (build?.width ?? 0)).toBeGreaterThan(pos.get('developer')?.x ?? 0);
  });

  it('shows no headers once a block has been moved by hand', () => {
    const g = workflowTemplateV3('bdd');
    const moved = WorkflowGraphV3Schema.parse({
      ...g,
      nodes: g.nodes.map((n) => (n.id === 'developer' ? { ...n, position: { x: 1, y: 2 } } : n)),
    });
    expect(stageHeaders(moved, layoutGraph(moved))).toEqual([]);
  });
});
