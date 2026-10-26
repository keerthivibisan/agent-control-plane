// Checks blocks in the workflow graph (ADR-0027 §5, v0.3.0 H-A): the defaults of a `checks` node,
// one named test per validation rule (valid and invalid examples, with the issue code), what
// `compileWorkflow` gives the engine, and that old graphs read and compile as before. Synthetic
// data only.
import { describe, expect, it } from 'vitest';
import {
  CHECK_FAILURE_ROUTES,
  WORKFLOW_TEMPLATE_IDS,
  canConnect,
  checkBlockOf,
  compileWorkflow,
  graphRunDefaults,
  isCheckBlockAt,
  migrateWorkflowV1,
  defaultProjectWorkflow,
  validateWorkflowGraph,
  workflowTemplate,
  type CompileContext,
  type WorkflowGraph,
  type WorkflowNode,
} from '../../src/index.js';
import {
  base,
  e,
  errorCodes,
  errors,
  finalReviewer,
  mapNode,
  rw,
  tester,
  withEdges,
  withFinalChain,
  withNamedHelper,
  withNodes,
  withoutEdges,
  withoutNode,
} from './helpers.js';

const ctx: CompileContext = {
  projectMode: 'auto-edits',
  approvalCeilings: [],
  maxConcurrentHelpers: 3,
};

function block(id: string, fields: Partial<Extract<WorkflowNode, { type: 'checks' }>> = {}) {
  return { type: 'checks', id, label: `Checks ${id}`, ...fields } as WorkflowNode;
}

/** `lead-only` with a change block on the pool (`helpers`) that sends it back (2 rounds). */
function withFastChecks(graph: WorkflowGraph = base()): WorkflowGraph {
  return withEdges(
    withNodes(
      graph,
      block('fast', {
        label: 'Fast checks',
        place: 'change',
        select: { kind: 'labels', labels: ['fast'] },
        onFailure: 'helper',
      }),
    ),
    e('flow', 'helpers', 'fast'),
    rw('fast', 'helpers', 2),
  );
}

/** A branch block right before your merge (after any final stages). */
function withBranchChecks(graph: WorkflowGraph, fields = {}): WorkflowGraph {
  const into = graph.edges.find((x) => x.type === 'flow' && x.to === 'owner-merge');
  if (into === undefined) throw new Error('test graph has no flow into your merge');
  return withEdges(
    withNodes(
      withoutEdges(graph, into.id),
      block('full', { label: 'Full checks', place: 'branch', ...fields }),
    ),
    e('flow', into.from, 'full'),
    e('flow', 'full', 'owner-merge'),
  );
}

describe('checkBlockOf: the defaults', () => {
  it('reads a block without fields as today’s block: before the merge, required, the lead', () => {
    expect(checkBlockOf({ type: 'checks', id: 'checks', label: 'Checks' })).toEqual({
      place: 'merge',
      select: { kind: 'required' },
      onFailure: 'lead',
    });
  });

  it('gives each place its first failure route when none is set', () => {
    for (const place of ['change', 'merge', 'branch'] as const) {
      expect(checkBlockOf({ type: 'checks', id: 'c', label: 'C', place }).onFailure).toBe(
        CHECK_FAILURE_ROUTES[place][0],
      );
    }
    expect(isCheckBlockAt({ type: 'checks', id: 'c', label: 'C' }, 'merge')).toBe(true);
    expect(isCheckBlockAt({ type: 'checks', id: 'c', label: 'C', place: 'change' }, 'merge')).toBe(
      false,
    );
  });
});

describe('old graphs (ADR-0027: unchanged in behaviour)', () => {
  it('every template and migrated workflow validates with no issue and compiles to the default blocks', () => {
    const graphs: WorkflowGraph[] = [
      ...WORKFLOW_TEMPLATE_IDS.flatMap((id) => [
        workflowTemplate(id),
        workflowTemplate(id, { planner: true }),
      ]),
      migrateWorkflowV1(defaultProjectWorkflow('p1', '2026-10-23T09:00:00.000Z'), {
        projectMode: 'auto-edits',
      }),
    ];
    for (const graph of graphs) {
      expect(validateWorkflowGraph(graph, { projectMode: 'auto-edits' })).toEqual([]);
      expect(compileWorkflow(graph, ctx).checkBlocks).toEqual({
        merge: {
          nodeId: 'checks',
          label: 'Checks',
          place: 'merge',
          select: { kind: 'required' },
          onFailure: 'lead',
        },
        branch: null,
        change: {},
      });
    }
  });

  it('the templates’ and the migration’s Checks block has no new fields', () => {
    const graphs = [
      ...WORKFLOW_TEMPLATE_IDS.map((id) => workflowTemplate(id)),
      migrateWorkflowV1(defaultProjectWorkflow('p1', '2026-10-23T09:00:00.000Z'), {
        projectMode: 'manual',
      }),
    ];
    for (const graph of graphs) {
      expect(graph.nodes.filter((n) => n.type === 'checks')).toEqual([
        { type: 'checks', id: 'checks', label: 'Checks' },
      ]);
    }
  });
});

describe('count rules for Checks blocks', () => {
  it('no block before the merge is allowed (ADR-0028 §2); without the lead’s merge link it is merge-path', () => {
    const noMerge = withoutNode(withFastChecks(), 'checks');
    expect(errorCodes(noMerge)).not.toContain('missing-node');
    expect(errors(noMerge).find((i) => i.code === 'merge-path')?.message).toContain(
      'needs a merge link to "Ticket branch"',
    );
    expect(errorCodes(withEdges(noMerge, e('merge', 'orchestrate', 'ticket-merge')))).toEqual([]);
  });

  it('too-many-nodes: a second block before the merge, or on the ticket branch', () => {
    const two = withNodes(withFastChecks(), block('again'));
    expect(errors(two).find((i) => i.code === 'too-many-nodes')).toMatchObject({
      nodeId: 'again',
      message: expect.stringContaining('before the Lead’s merge') as string,
    });
    const branch2 = withNodes(withBranchChecks(base()), block('full-2', { place: 'branch' }));
    expect(errors(branch2).find((i) => i.code === 'too-many-nodes')).toMatchObject({
      nodeId: 'full-2',
    });
  });

  it('allows a change block per editing node and one on the branch', () => {
    let g = withNamedHelper(withFastChecks(), 'fe', 'Frontend helper');
    g = withEdges(
      withNodes(g, block('fe-checks', { place: 'change', onFailure: 'owner' })),
      e('flow', 'fe', 'fe-checks'),
    );
    g = withBranchChecks(g);
    expect(errorCodes(g)).toEqual([]);
  });
});

describe('the edge matrix for Checks blocks (canConnect = validator)', () => {
  it('edge-not-allowed: the lead merges only through the block before the merge', () => {
    const g = withEdges(withFastChecks(), e('merge', 'orchestrate', 'fast'));
    expect(errorCodes(g)).toContain('edge-not-allowed');
    expect(canConnect(withFastChecks(), 'orchestrate', 'fast', 'merge').ok).toBe(false);
  });

  it('edge-not-allowed: a change block is not on the merge path', () => {
    expect(errorCodes(withEdges(withFastChecks(), e('flow', 'fast', 'ticket-merge')))).toContain(
      'edge-not-allowed',
    );
  });

  it('edge-not-allowed: only helpers and testers flow into a change block', () => {
    expect(errorCodes(withEdges(withFastChecks(), e('flow', 'orchestrate', 'fast')))).toContain(
      'edge-not-allowed',
    );
  });

  it('edge-not-allowed: only a change block sends work back', () => {
    const g = withEdges(
      withBranchChecks(base()),
      rw('checks', 'helpers', 1),
      rw('full', 'helpers', 1),
    );
    expect(errors(g).filter((i) => i.code === 'edge-not-allowed')).toHaveLength(2);
  });

  it('edge-not-allowed: a helper does not flow to a block on the ticket branch', () => {
    expect(errorCodes(withEdges(withBranchChecks(base()), e('flow', 'helpers', 'full')))).toContain(
      'edge-not-allowed',
    );
  });
});

describe('check-failure-route', () => {
  it('refuses a route the place does not allow, naming the allowed ones', () => {
    const merge = mapNode(base(), 'checks', (n) => ({ ...n, onFailure: 'helper' }) as typeof n);
    expect(errors(merge)).toMatchObject([
      {
        code: 'check-failure-route',
        nodeId: 'checks',
        message: expect.stringContaining('"the Lead decides" or "ask me"') as string,
      },
    ]);
    const branch = withBranchChecks(base(), { onFailure: 'lead' });
    expect(errorCodes(branch)).toEqual(['check-failure-route']);
    expect(errorCodes(withBranchChecks(base(), { onFailure: 'owner' }))).toEqual([]);
    expect(
      errorCodes(mapNode(base(), 'checks', (n) => ({ ...n, onFailure: 'owner' }) as typeof n)),
    ).toEqual([]);
  });
});

describe('check-block-input', () => {
  it('refuses a change block nothing flows into', () => {
    const g = withNodes(base(), block('lonely', { place: 'change' }));
    expect(errorCodes(g)).toEqual(['check-block-input', 'unreachable']);
  });
});

describe('many-check-blocks', () => {
  it('refuses a helper that flows into two change blocks', () => {
    const g = withEdges(
      withNodes(withFastChecks(), block('second', { place: 'change' })),
      e('flow', 'helpers', 'second'),
    );
    expect(errors(g)).toMatchObject([{ code: 'many-check-blocks', nodeId: 'helpers' }]);
  });

  it('allows two helpers to share one change block', () => {
    let g = withNamedHelper(withFastChecks(), 'fe', 'Frontend helper');
    g = withEdges(g, e('flow', 'fe', 'fast'), rw('fast', 'fe', 1));
    expect(errorCodes(g)).toEqual([]);
  });
});

describe('check-rework', () => {
  it('"back to the helper" needs a rework link to each node it checks', () => {
    const fast = withFastChecks();
    const g = withoutEdges(fast, fast.edges.at(-1)?.id ?? '');
    expect(errors(g)).toMatchObject([{ code: 'check-rework', nodeId: 'fast' }]);
  });

  it('a rework link needs the route "back to the helper"', () => {
    const g = mapNode(withFastChecks(), 'fast', (n) => ({ ...n, onFailure: 'lead' }) as typeof n);
    expect(errorCodes(g)).toEqual(['check-rework']);
  });

  it('sends back only a node whose change it checks', () => {
    let g = withNamedHelper(withFastChecks(), 'fe', 'Frontend helper');
    g = withEdges(g, rw('fast', 'fe', 1));
    expect(errors(g)).toMatchObject([
      { code: 'check-rework', message: expect.stringContaining('only if it checks') as string },
    ]);
  });

  it('a change reviewer’s and the lead’s rework rules are unchanged', () => {
    expect(errorCodes(withFastChecks(base('reviewer-helper-loop')))).toEqual([]);
  });
});

describe('final-chain: the block on the ticket branch', () => {
  it('accepts it anywhere on the chain, once', () => {
    const r = finalReviewer('cr');
    const t = tester('ut');
    const chain = withEdges(withFinalChain(base(), [r, t]), e('review', 'ut', 'orchestrate'));
    expect(errorCodes(withBranchChecks(chain))).toEqual([]);
    // between the two final stages
    const mid = withEdges(
      withNodes(
        withoutEdges(chain, chain.edges.find((x) => x.from === 'cr')?.id ?? ''),
        block('full', { place: 'branch' }),
      ),
      e('flow', 'cr', 'full'),
      e('flow', 'full', 'ut'),
    );
    expect(errorCodes(mid)).toEqual([]);
  });

  it('refuses it off the chain', () => {
    const g = withNodes(base(), block('full', { place: 'branch' }));
    expect(errors(g)).toMatchObject([
      { code: 'final-chain', nodeId: 'full' },
      { code: 'unreachable', nodeId: 'full' },
    ]);
  });

  it('a tester’s flow to its change block is not a second step of the chain', () => {
    const t = tester('ut');
    let g = withEdges(withFinalChain(base(), [t]), e('review', 'ut', 'orchestrate'));
    g = withEdges(
      withNodes(g, block('ut-checks', { place: 'change' })),
      e('flow', 'ut', 'ut-checks'),
    );
    expect(errorCodes(g)).toEqual([]);
  });
});

describe('compileWorkflow: the check blocks', () => {
  it('gives each editing node its change block, with its rounds only for "back to the helper"', () => {
    let g = withNamedHelper(withFastChecks(), 'fe', 'Frontend helper');
    g = withEdges(
      withNodes(g, block('fe-checks', { label: 'FE checks', place: 'change', onFailure: 'owner' })),
      e('flow', 'fe', 'fe-checks'),
    );
    const program = compileWorkflow(g, ctx);
    expect({ ...program.checkBlocks.change }).toEqual({
      helpers: {
        nodeId: 'fast',
        label: 'Fast checks',
        place: 'change',
        select: { kind: 'labels', labels: ['fast'] },
        onFailure: 'helper',
        maxRounds: 2,
      },
      fe: {
        nodeId: 'fe-checks',
        label: 'FE checks',
        place: 'change',
        select: { kind: 'required' },
        onFailure: 'owner',
        maxRounds: null,
      },
    });
  });

  it('keeps a block’s rounds when the run sets the review’s rework rounds', () => {
    const program = compileWorkflow(withFastChecks(), {
      ...ctx,
      maxReworkRounds: 0,
      reviewer: 'lead',
    });
    expect(program.checkBlocks.change.helpers?.maxRounds).toBe(2);
    expect(program.helpers[0]?.review).toEqual({ by: 'lead', leadRounds: 0 });
  });

  it('places the branch block among the final stages, and a tester’s change block', () => {
    const r = finalReviewer('cr');
    const t = tester('ut');
    let g = withEdges(withFinalChain(base(), [r, t]), e('review', 'ut', 'orchestrate'));
    g = withBranchChecks(g, { select: { kind: 'ids', ids: ['e2e'] } });
    // the tester's change block edge first, so the chain must not follow it
    g = {
      ...g,
      nodes: [...g.nodes, block('ut-checks', { place: 'change' })],
      edges: [e('flow', 'ut', 'ut-checks'), ...g.edges],
    };
    const program = compileWorkflow(g, ctx);
    expect(program.finalStages.map((s) => s.id)).toEqual(['cr', 'ut']);
    expect(program.checkBlocks.branch).toEqual({
      nodeId: 'full',
      label: 'Full checks',
      place: 'branch',
      select: { kind: 'ids', ids: ['e2e'] },
      onFailure: 'owner',
      afterStages: 2,
    });
    expect(program.checkBlocks.change.ut).toMatchObject({ nodeId: 'ut-checks', onFailure: 'lead' });
    expect(program.checkBlocks.merge).toMatchObject({ nodeId: 'checks', onFailure: 'lead' });
  });

  it('copies the selection, so the program shares nothing with the graph', () => {
    const g = withFastChecks();
    const program = compileWorkflow(g, ctx);
    const node = g.nodes.find((n) => n.id === 'fast');
    if (node?.type !== 'checks' || node.select?.kind !== 'labels') throw new Error('test graph');
    node.select.labels.push('full');
    expect(program.checkBlocks.change.helpers?.select).toEqual({
      kind: 'labels',
      labels: ['fast'],
    });
  });

  it('throws for every graph the validator refuses because of a block', () => {
    const bad = mapNode(base(), 'checks', (n) => ({ ...n, onFailure: 'helper' }) as typeof n);
    expect(() => compileWorkflow(bad, ctx)).toThrow(/check-failure-route/);
  });
});

describe('graphRunDefaults leaves the blocks’ rounds out', () => {
  it('reads the review rounds only', () => {
    const g = withFastChecks(withoutEdges(base(), 'rework-orchestrate-helpers'));
    expect(graphRunDefaults(g)).toEqual({ reviewer: 'lead', maxReworkRounds: 0 });
  });
});
