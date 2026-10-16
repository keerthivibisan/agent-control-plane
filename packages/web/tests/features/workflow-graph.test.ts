import { defaultProjectWorkflow, HARD_MAX_HELPERS, type ProjectWorkflow } from '@acp/core';
import { describe, expect, it } from 'vitest';
import {
  buildWorkflowGraph,
  GRAPH_WIDTH,
  stageOfNode,
  type AgentNode,
  type HelpersNode,
  type SetupShape,
  type WorkflowGraph,
} from '../../src/features/workflow/graph';

const setup: SetupShape = {
  maxConcurrentHelpers: 3,
  maxDepth: 1,
  defaultBudgetTokensPerAgent: 500_000,
  model: null,
  allowlist: { editInOwnWorktree: true, runHarnessChecks: false },
};

function workflow(mutate: (w: ProjectWorkflow) => void = () => {}): ProjectWorkflow {
  const w = defaultProjectWorkflow('p-1', '2026-10-16T09:00:00.000Z');
  mutate(w);
  return w;
}

const agentNode = (g: WorkflowGraph, id: string) =>
  g.nodes.find((n) => n.id === id) as AgentNode | undefined;
const edgeIds = (g: WorkflowGraph) => g.edges.map((e) => e.id).sort();
const edgesOf = (g: WorkflowGraph, kind: string) =>
  g.edges
    .filter((e) => e.data?.kind === kind)
    .map((e) => `${e.source}->${e.target}`)
    .sort();

describe('buildWorkflowGraph', () => {
  it('builds the default (Phase 4) flow: one lead covers Plan and Orchestrate', () => {
    const g = buildWorkflowGraph(workflow(), setup, []);
    expect(g.nodes.map((n) => n.id)).toEqual([
      'ticket',
      'plan',
      'approve',
      'orchestrate',
      'helpers',
      'helper-1',
      'helper-2',
      'helper-3',
      'review',
      'code-review',
      'unit-tests',
      'done',
    ]);
    const plan = agentNode(g, 'plan');
    const orchestrate = agentNode(g, 'orchestrate');
    expect(plan?.data).toMatchObject({
      role: 'lead',
      workspace: 'read-only',
      sameAgentAs: 'orchestrate',
    });
    expect(orchestrate?.data).toMatchObject({ role: 'lead', sameAgentAs: 'plan' });
    expect(agentNode(g, 'code-review')?.data).toMatchObject({
      role: 'reviewer',
      workspace: 'read-only',
      enabled: false,
      optional: true,
    });
    expect(agentNode(g, 'unit-tests')?.data).toMatchObject({
      role: 'tester',
      workspace: 'own-worktree',
      enabled: false,
    });
    expect(g.width).toBe(GRAPH_WIDTH);
    expect(g.height).toBeGreaterThan(0);
  });

  it('separate planner mode: a read-only planner, then the lead, with no shared-agent badge', () => {
    const g = buildWorkflowGraph(
      workflow((w) => {
        w.plannerMode = 'separate';
      }),
      setup,
    );
    expect(agentNode(g, 'plan')?.data).toMatchObject({
      role: 'planner',
      workspace: 'read-only',
      sameAgentAs: null,
    });
    expect(agentNode(g, 'orchestrate')?.data).toMatchObject({ role: 'lead', sameAgentAs: null });
  });

  it('draws the plan loop and the wrap from approval to the lead', () => {
    const g = buildWorkflowGraph(workflow(), setup);
    expect(edgesOf(g, 'loop')).toEqual(['approve->plan']);
    const loop = g.edges.find((e) => e.data?.kind === 'loop');
    expect(loop).toMatchObject({
      sourceHandle: 'out-top',
      targetHandle: 'in-top',
      label: 'Changes',
    });
    const wrap = g.edges.find((e) => e.id === 'flow:approve->orchestrate');
    expect(wrap).toMatchObject({ sourceHandle: 'out-bottom', targetHandle: 'in-top' });
    expect(g.edges.find((e) => e.id === 'flow:ticket->plan')).toMatchObject({
      sourceHandle: 'out-right',
      targetHandle: 'in-left',
    });
  });

  it('both optional stages off: faint edges through them and one dashed bypass to Done', () => {
    const g = buildWorkflowGraph(workflow(), setup);
    expect(edgesOf(g, 'off')).toEqual([
      'code-review->unit-tests',
      'review->code-review',
      'unit-tests->done',
    ]);
    expect(edgesOf(g, 'bypass')).toEqual(['review->done']);
    const bypass = g.edges.find((e) => e.data?.kind === 'bypass');
    expect(bypass).toMatchObject({
      sourceHandle: 'out-bottom',
      targetHandle: 'in-top',
      label: 'Off: skipped',
      style: { strokeDasharray: '7 5' },
    });
  });

  it('both optional stages on: a plain flow through them, no bypass', () => {
    const g = buildWorkflowGraph(
      workflow((w) => {
        w.stages['code-review'].enabled = true;
        w.stages['unit-tests'].enabled = true;
      }),
      setup,
    );
    expect(edgesOf(g, 'off')).toEqual([]);
    expect(edgesOf(g, 'bypass')).toEqual([]);
    expect(edgesOf(g, 'flow')).toEqual(
      expect.arrayContaining([
        'review->code-review',
        'code-review->unit-tests',
        'unit-tests->done',
      ]),
    );
  });

  it('only code review on: the bypass skips Unit tests underneath the row', () => {
    const g = buildWorkflowGraph(
      workflow((w) => {
        w.stages['code-review'].enabled = true;
      }),
      setup,
    );
    expect(edgesOf(g, 'off')).toEqual(['code-review->unit-tests', 'unit-tests->done']);
    expect(edgesOf(g, 'bypass')).toEqual(['code-review->done']);
    expect(g.edges.find((e) => e.data?.kind === 'bypass')).toMatchObject({
      sourceHandle: 'out-bottom',
      targetHandle: 'in-bottom',
    });
    expect(agentNode(g, 'code-review')?.data.enabled).toBe(true);
    expect(agentNode(g, 'unit-tests')?.data.enabled).toBe(false);
  });

  it('only unit tests on: the bypass goes from Review to Unit tests', () => {
    const g = buildWorkflowGraph(
      workflow((w) => {
        w.stages['unit-tests'].enabled = true;
      }),
      setup,
    );
    expect(edgesOf(g, 'off')).toEqual(['code-review->unit-tests', 'review->code-review']);
    expect(edgesOf(g, 'bypass')).toEqual(['review->unit-tests']);
    expect(edgesOf(g, 'flow')).toContain('unit-tests->done');
  });

  it.each([1, 2, 4, HARD_MAX_HELPERS])(
    'draws %i helper nodes inside the Helpers box, each joined to the lead and to review',
    (n) => {
      const g = buildWorkflowGraph(workflow(), { ...setup, maxConcurrentHelpers: n });
      const helpers = g.nodes.filter((x) => x.type === 'helper');
      expect(helpers).toHaveLength(n);
      for (const h of helpers) {
        expect(h.parentId).toBe('helpers');
        expect(h.data).toMatchObject({ nested: false });
        expect(edgeIds(g)).toEqual(
          expect.arrayContaining([`flow:orchestrate->${h.id}`, `flow:${h.id}->review`]),
        );
      }
      const box = g.nodes.find((x) => x.id === 'helpers') as HelpersNode;
      // The children fit inside the box.
      const last = helpers[helpers.length - 1];
      expect((last?.position.y ?? 0) + (last?.height ?? 0)).toBeLessThanOrEqual(box.height ?? 0);
    },
  );

  it('hints depth-2 helpers and carries the limits on the Helpers box', () => {
    const g = buildWorkflowGraph(workflow(), {
      ...setup,
      maxDepth: 2,
      defaultBudgetTokensPerAgent: 250_000,
      allowlist: { editInOwnWorktree: false, runHarnessChecks: true },
    });
    expect(g.nodes.filter((x) => x.type === 'helper').every((h) => h.data['nested'] === true)).toBe(
      true,
    );
    expect((g.nodes.find((x) => x.id === 'helpers') as HelpersNode).data).toMatchObject({
      role: 'helper',
      workspace: 'own-worktree',
      maxHelpers: 3,
      maxDepth: 2,
      budgetTokensPerAgent: 250_000,
      allowlist: { editInOwnWorktree: false, runHarnessChecks: true },
    });
  });

  it('flags a mapped skill missing only when the skill list is known', () => {
    const w = workflow((x) => {
      x.stages.plan.skill = 'plan-tickets';
      x.stages.helpers.skill = 'gone';
    });
    const known = buildWorkflowGraph(w, setup, ['plan-tickets']);
    expect(agentNode(known, 'plan')?.data).toMatchObject({
      skill: 'plan-tickets',
      skillMissing: false,
    });
    expect((known.nodes.find((x) => x.id === 'helpers') as HelpersNode).data).toMatchObject({
      skill: 'gone',
      skillMissing: true,
    });
    const unknown = buildWorkflowGraph(w, setup);
    expect((unknown.nodes.find((x) => x.id === 'helpers') as HelpersNode).data.skillMissing).toBe(
      false,
    );
    expect(agentNode(known, 'orchestrate')?.data).toMatchObject({
      skill: null,
      skillMissing: false,
    });
  });

  it('passes the stage model and the project default through, without inventing one', () => {
    const g = buildWorkflowGraph(
      workflow((w) => {
        w.stages.orchestrate.model = 'model-x';
      }),
      { ...setup, model: 'model-default' },
    );
    expect(agentNode(g, 'orchestrate')?.data).toMatchObject({
      model: 'model-x',
      projectModel: 'model-default',
    });
    expect(agentNode(g, 'plan')?.data).toMatchObject({
      model: null,
      projectModel: 'model-default',
    });
  });

  it('is read-only: nothing can be dragged or connected', () => {
    const g = buildWorkflowGraph(workflow(), setup);
    expect(g.nodes.every((n) => n.draggable === false && n.connectable === false)).toBe(true);
  });
});

describe('stageOfNode', () => {
  it('maps a click back to the stage it configures', () => {
    expect(stageOfNode('plan')).toBe('plan');
    expect(stageOfNode('review')).toBe('review');
    expect(stageOfNode('unit-tests')).toBe('unit-tests');
    expect(stageOfNode('helper-3')).toBe('helpers');
    expect(stageOfNode('approve')).toBeNull();
    expect(stageOfNode('ticket')).toBeNull();
    expect(stageOfNode('done')).toBeNull();
  });
});
