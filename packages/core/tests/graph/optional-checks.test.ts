// Optional Checks blocks and effort per agent block in the graph (ADR-0028 §1–§2, v0.3.1 P-A):
// a workflow may have no block before the lead's merge (the lead then merges straight into the
// ticket merge), the validator warns when it has no Checks block at all, `canConnect` and the
// validator agree on the lead's merge link, and `compileWorkflow` gives the engine `merge: null`
// and each agent block's effort. Old graphs compile as before. Synthetic data only.
import { describe, expect, it } from 'vitest';
import {
  NODE_CAPABILITIES,
  NO_CHECKS_MESSAGE,
  WORKFLOW_TEMPLATE_IDS,
  canConnect,
  compileWorkflow,
  validateWorkflowGraph,
  withoutCheckBlocks,
  workflowTemplate,
  type CompileContext,
  type WorkflowGraph,
  type WorkflowNode,
} from '../../src/index.js';
import {
  e,
  errorCodes,
  errors,
  mapNode,
  warnings,
  withEdges,
  withNodes,
  withoutNode,
} from './helpers.js';

const ctx: CompileContext = {
  projectMode: 'auto-edits',
  approvalCeilings: [],
  maxConcurrentHelpers: 3,
};

/** `lead-only` without its block before the merge, the lead merging straight into the branch. */
function noChecks(planner = false): WorkflowGraph {
  return withoutCheckBlocks(workflowTemplate('lead-only', { planner }));
}

function checksBlock(id: string, fields: Partial<Extract<WorkflowNode, { type: 'checks' }>> = {}) {
  return { type: 'checks', id, label: `Checks ${id}`, ...fields } as WorkflowNode;
}

describe('optional Checks blocks (ADR-0028 §2)', () => {
  it('no Checks node type is required any more', () => {
    expect(NODE_CAPABILITIES.checks.minPerGraph).toBe(0);
  });

  it('every template without its Checks block is valid and compiles with merge null', () => {
    for (const id of WORKFLOW_TEMPLATE_IDS) {
      for (const planner of [false, true]) {
        const graph = withoutCheckBlocks(workflowTemplate(id, { planner }));
        expect(graph.nodes.some((n) => n.type === 'checks')).toBe(false);
        expect(errors(graph), id).toEqual([]);
        expect(compileWorkflow(graph, ctx).checkBlocks).toEqual({
          merge: null,
          branch: null,
          change: {},
        });
      }
    }
  });

  it('warns, never refuses, when the workflow has no Checks block at all', () => {
    const issues = validateWorkflowGraph(noChecks());
    expect(issues).toEqual([
      { code: 'no-checks', severity: 'warning', message: NO_CHECKS_MESSAGE },
    ]);
    expect(NO_CHECKS_MESSAGE).toBe('No checks: changes merge after review only.');
  });

  it('does not warn while any Checks block remains, nor for the templates', () => {
    for (const id of WORKFLOW_TEMPLATE_IDS) {
      expect(warnings(workflowTemplate(id)).map((i) => i.code)).not.toContain('no-checks');
    }
    const changeOnly = withEdges(
      withNodes(noChecks(), checksBlock('fast', { place: 'change' })),
      e('flow', 'helpers', 'fast'),
    );
    expect(errors(changeOnly)).toEqual([]);
    expect(warnings(changeOnly).map((i) => i.code)).not.toContain('no-checks');
    expect(compileWorkflow(changeOnly, ctx).checkBlocks.merge).toBeNull();
  });

  it('a block on the ticket branch alone: merge null, the branch block compiled', () => {
    const g = noChecks();
    const into = g.edges.find((x) => x.type === 'flow' && x.to === 'owner-merge');
    if (into === undefined) throw new Error('test graph has no link into your merge');
    const graph = withEdges(
      withNodes(
        { ...g, edges: g.edges.filter((x) => x.id !== into.id) },
        checksBlock('full', { place: 'branch', select: { kind: 'labels', labels: ['full'] } }),
      ),
      e('flow', into.from, 'full'),
      e('flow', 'full', 'owner-merge'),
    );
    expect(errors(graph)).toEqual([]);
    const blocks = compileWorkflow(graph, ctx).checkBlocks;
    expect(blocks.merge).toBeNull();
    expect(blocks.branch).toMatchObject({
      nodeId: 'full',
      place: 'branch',
      select: { kind: 'labels', labels: ['full'] },
      onFailure: 'owner',
      afterStages: 0,
    });
  });

  it('without a block before the merge the lead needs a merge link to the ticket merge', () => {
    const cut = withoutNode(workflowTemplate('lead-only'), 'checks');
    const issue = errors(cut).find((i) => i.code === 'merge-path');
    expect(issue).toMatchObject({ nodeId: 'orchestrate' });
    expect(issue?.message).toBe(
      '"Lead" needs a merge link to "Ticket branch": only the Lead merges changes into the ticket branch, after their review.',
    );
    expect(errorCodes(cut)).not.toContain('missing-node');
  });

  it('canConnect: the lead merges straight into the ticket merge only without a block before it', () => {
    const without = withoutNode(workflowTemplate('lead-only'), 'checks');
    expect(canConnect(without, 'orchestrate', 'ticket-merge', 'merge')).toEqual({ ok: true });
    const withBlock = workflowTemplate('lead-only');
    const refused = canConnect(withBlock, 'orchestrate', 'ticket-merge', 'merge');
    expect(refused).toMatchObject({ ok: false, code: 'edge-not-allowed' });
    expect(refused.ok ? '' : refused.message).toContain(
      'The workflow has a Checks block before the merge, so the Lead merges through it.',
    );
    // and the validator reports exactly that edge
    const both = withEdges(withBlock, e('merge', 'orchestrate', 'ticket-merge'));
    const reported = errors(both).filter((i) => i.code === 'edge-not-allowed');
    expect(reported).toHaveLength(1);
    // only the lead merges, and only into the ticket merge or the block before it
    expect(canConnect(without, 'helpers', 'ticket-merge', 'merge').ok).toBe(false);
    expect(canConnect(without, 'orchestrate', 'owner-merge', 'merge').ok).toBe(false);
  });

  it('adding a block before the merge again refuses the lead’s direct merge link', () => {
    const graph = withEdges(
      withNodes(noChecks(), checksBlock('again')),
      e('flow', 'again', 'ticket-merge'),
    );
    const codes = errorCodes(graph);
    expect(codes).toContain('edge-not-allowed');
    expect(codes).toContain('merge-path');
  });

  it('at most one block before the merge, still', () => {
    const two = withNodes(workflowTemplate('lead-only'), checksBlock('again'));
    expect(errors(two).find((i) => i.code === 'too-many-nodes')).toMatchObject({
      nodeId: 'again',
    });
  });

  it('old graphs compile exactly as before: the merge block with required and lead', () => {
    for (const id of WORKFLOW_TEMPLATE_IDS) {
      expect(compileWorkflow(workflowTemplate(id), ctx).checkBlocks.merge).toEqual({
        nodeId: 'checks',
        label: 'Checks',
        place: 'merge',
        select: { kind: 'required' },
        onFailure: 'lead',
      });
    }
  });
});

describe('effort per agent block (ADR-0028 §1)', () => {
  const programNodes = (graph: WorkflowGraph) => {
    const p = compileWorkflow(graph, ctx);
    return [
      p.lead,
      ...(p.planner === null ? [] : [p.planner]),
      ...p.helpers,
      ...p.changeReviewers,
      ...p.finalStages,
    ];
  };

  it('compiles each agent block’s effort into its program node; absent stays absent', () => {
    for (const id of WORKFLOW_TEMPLATE_IDS) {
      const plain = workflowTemplate(id, { planner: true });
      for (const node of programNodes(plain)) expect(node).not.toHaveProperty('effort');
      const levels = ['low', 'medium', 'high'] as const;
      let i = 0;
      const chosen = new Map<string, string>();
      let graph = plain;
      for (const node of plain.nodes) {
        if (!['planner', 'lead', 'helper-pool', 'helper', 'reviewer', 'tester'].includes(node.type))
          continue;
        const effort = levels[i++ % levels.length] ?? 'low';
        chosen.set(node.id, effort);
        graph = mapNode(graph, node.id, (n) => ({ ...n, effort }) as WorkflowNode);
      }
      const nodes = programNodes(graph);
      expect(nodes.length, id).toBeGreaterThan(2);
      for (const node of nodes) expect(node.effort, `${id} ${node.id}`).toBe(chosen.get(node.id));
    }
  });
});
