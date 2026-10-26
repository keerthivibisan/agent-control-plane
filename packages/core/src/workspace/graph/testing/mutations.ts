import { HARD_MAX_HELPERS } from '../../workspace.js';
import type {
  CheckFailureRoute,
  GraphIssueCode,
  WorkflowEdge,
  WorkflowGraph,
  WorkflowNode,
  WorkflowNodeId,
  WorkflowNodeType,
} from '../../workflow-graph.js';
import { RESERVED_HELPER_LABELS } from '../validate.js';
import {
  addEdge,
  addNode,
  chainIds,
  changeBlockOf,
  changeReviewers,
  editorNodes,
  finalStageNodes,
  firstOfType,
  freshId,
  helperNodes,
  leadId,
  mergeBlock,
  nodesOfType,
  pickOptional,
  removeEdges,
  removeNode,
  reviewTargetOf,
  updateNode,
  type NewEdge,
} from './graph-ops.js';
import type { GraphRng } from './rng.js';

/**
 * Single mutations that break a valid graph (README "Graph correctness", layer 3 mutants). Each
 * one names the error the validator must report for the result; other errors may come too. A
 * mutation that does not apply to a graph returns null.
 *
 * Not covered here, on purpose: shapes `WorkflowGraphSchema` already refuses (a mode on a read-only
 * node, a bad id, too many nodes or edges in total), which never reach the validator.
 */
export interface GraphMutation {
  name: string;
  expectedCode: GraphIssueCode;
  apply(graph: WorkflowGraph, rng: GraphRng): WorkflowGraph | null;
}

const AGENT = { model: null, skills: [], agent: null };

function helper(id: string, label: string): WorkflowNode {
  return {
    type: 'helper',
    id,
    label,
    model: null,
    skills: [],
    agent: null,
    approvalMode: null,
    description: '',
    maxInstances: 1,
    canStartHelpers: false,
  };
}

/** Adds a named helper with an assigns edge and a review route to the lead: legal on its own. */
function addWiredHelper(graph: WorkflowGraph, label: string): WorkflowGraph {
  const id = freshId(graph, 'named');
  let g = addNode(graph, helper(id, label));
  g = addEdge(g, { type: 'assigns', from: leadId(g), to: id });
  return addEdge(g, { type: 'review', from: id, to: leadId(g) });
}

/** Adds a change reviewer with its findings edge (unused until something reviews to it). */
function addReviewer(graph: WorkflowGraph): { graph: WorkflowGraph; id: string } {
  const id = freshId(graph, 'reviewer');
  let g = addNode(graph, {
    type: 'reviewer',
    id,
    label: 'Extra reviewer',
    scope: 'change',
    ...AGENT,
  });
  g = addEdge(g, { type: 'findings', from: id, to: leadId(g) });
  return { graph: g, id };
}

function addFinalReviewer(graph: WorkflowGraph): { graph: WorkflowGraph; id: string } {
  const id = freshId(graph, 'final');
  return {
    graph: addNode(graph, {
      type: 'reviewer',
      id,
      label: 'Extra code reviewer',
      scope: 'final',
      ...AGENT,
    }),
    id,
  };
}

/** Adds a Checks block; `inputs` flow into it (change blocks only). */
function addBlock(
  graph: WorkflowGraph,
  place: 'change' | 'merge' | 'branch',
  opts: { inputs?: readonly WorkflowNodeId[]; onFailure?: CheckFailureRoute } = {},
): { graph: WorkflowGraph; id: string } {
  const id = freshId(graph, `${place}-checks`);
  let g = addNode(graph, {
    type: 'checks',
    id,
    label: 'More checks',
    place,
    ...(opts.onFailure !== undefined ? { onFailure: opts.onFailure } : {}),
  });
  for (const input of opts.inputs ?? []) g = addEdge(g, { type: 'flow', from: input, to: id });
  return { graph: g, id };
}

/** An editing node without a change block, else any editing node, else null. */
function pickEditor(graph: WorkflowGraph, rng: GraphRng): WorkflowNodeId | null {
  const editors = editorNodes(graph);
  const free = editors.filter((n) => changeBlockOf(graph, n.id) === undefined);
  return pickId(free.length > 0 ? free : editors, rng);
}

function removeOne(graph: WorkflowGraph, rng: GraphRng, match: (e: WorkflowEdge) => boolean) {
  const candidates = graph.edges.filter(match);
  if (candidates.length === 0) return null;
  const drop = rng.pick(candidates).id;
  return removeEdges(graph, (e) => e.id === drop);
}

function deleteNodeOfType(type: WorkflowNodeType): GraphMutation {
  return {
    name: `delete the ${type} block`,
    // ADR-0028 §2: a Checks block is optional, but deleting the block before the merge without
    // giving the lead a merge link to the ticket merge breaks the merge path.
    expectedCode: type === 'checks' ? 'merge-path' : 'missing-node',
    apply: (graph) => {
      // Checks: the block before the lead's merge (other blocks may be removed freely).
      const node = type === 'checks' ? mergeBlock(graph) : firstOfType(graph, type);
      return node === undefined ? null : removeNode(graph, node.id);
    },
  };
}

/** A forbidden edge: `pick` chooses its ends, or null when the graph has no such nodes. */
function forbidden(
  name: string,
  pick: (graph: WorkflowGraph, rng: GraphRng) => NewEdge | null,
): GraphMutation {
  return {
    name,
    expectedCode: 'edge-not-allowed',
    apply: (graph, rng) => {
      const edge = pick(graph, rng);
      return edge === null ? null : addEdge(graph, edge);
    },
  };
}

function idOf(node: WorkflowNode | undefined): string | null {
  return node?.id ?? null;
}

function pickId(nodes: readonly WorkflowNode[], rng: GraphRng): string | null {
  return nodes.length === 0 ? null : rng.pick(nodes).id;
}

function edgeBetween(
  type: Exclude<WorkflowEdge['type'], 'rework'>,
  from: string | null,
  to: string | null,
): NewEdge | null {
  return from === null || to === null ? null : { type, from, to };
}

export const GRAPH_MUTATIONS: readonly GraphMutation[] = Object.freeze([
  // ------------------------------------------------------------ shape
  {
    name: 'duplicate a block id',
    expectedCode: 'duplicate-node-id',
    apply: (graph, rng) => {
      const node = rng.pick(graph.nodes);
      return addNode(graph, { ...node });
    },
  },
  {
    name: 'duplicate a link id',
    expectedCode: 'duplicate-edge-id',
    apply: (graph, rng) => {
      const n = graph.edges.length;
      if (n < 2) return null;
      const from = rng.int(n);
      const to = (from + 1 + rng.int(n - 1)) % n;
      const id = graph.edges[from]?.id;
      if (id === undefined) return null;
      return { ...graph, edges: graph.edges.map((e, i) => (i === to ? { ...e, id } : e)) };
    },
  },
  {
    name: 'link to a block that does not exist',
    expectedCode: 'edge-unknown-node',
    apply: (graph) => {
      const checks = mergeBlock(graph);
      return checks === undefined
        ? null
        : addEdge(graph, { type: 'flow', from: checks.id, to: freshId(graph, 'ghost') });
    },
  },
  {
    name: 'duplicate a link',
    expectedCode: 'duplicate-edge',
    apply: (graph, rng) => {
      const { id: _id, ...copy } = rng.pick(graph.edges);
      return addEdge(graph, copy);
    },
  },
  {
    name: 'link a block to itself',
    expectedCode: 'self-edge',
    apply: (graph, rng) => {
      const node = rng.pick(graph.nodes);
      return addEdge(graph, { type: 'rework', from: node.id, to: node.id, maxRounds: 1 });
    },
  },
  // ------------------------------------------------------------ counts
  ...(
    ['ticket', 'plan-approval', 'lead', 'checks', 'ticket-merge', 'owner-merge', 'done'] as const
  ).map(deleteNodeOfType),
  {
    name: 'add a second lead',
    expectedCode: 'too-many-nodes',
    apply: (graph) =>
      addNode(graph, { type: 'lead', id: freshId(graph, 'lead'), label: 'Second lead', ...AGENT }),
  },
  {
    name: 'add a second planner',
    expectedCode: 'too-many-nodes',
    apply: (graph) => {
      let g = graph;
      while (nodesOfType(g, 'planner').length < 2) {
        g = addNode(g, { type: 'planner', id: freshId(g, 'planner'), label: 'Planner', ...AGENT });
      }
      return g;
    },
  },
  {
    name: 'add a second helper pool',
    expectedCode: 'too-many-nodes',
    apply: (graph) => {
      let g = graph;
      while (nodesOfType(g, 'helper-pool').length < 2) {
        const id = freshId(g, 'pool');
        g = addNode(g, {
          type: 'helper-pool',
          id,
          label: 'More helpers',
          ...AGENT,
          approvalMode: null,
          canStartHelpers: false,
        });
        g = addEdge(g, { type: 'assigns', from: leadId(g), to: id });
        g = addEdge(g, { type: 'review', from: id, to: leadId(g) });
      }
      return g;
    },
  },
  {
    name: 'add a second ticket gate',
    expectedCode: 'too-many-nodes',
    apply: (graph) =>
      addNode(graph, { type: 'ticket', id: freshId(graph, 'ticket'), label: 'Ticket 2' }),
  },
  {
    name: 'remove every helper block',
    expectedCode: 'no-helpers',
    apply: (graph) => helperNodes(graph).reduce((g, n) => removeNode(g, n.id), graph),
  },
  {
    name: 'add one named helper too many',
    expectedCode: 'too-many-helpers',
    apply: (graph) => {
      let g = graph;
      for (let k = 1; nodesOfType(g, 'helper').length <= HARD_MAX_HELPERS; k++) {
        g = addWiredHelper(g, `Extra helper ${k}`);
      }
      return g;
    },
  },
  {
    name: 'give two named helpers the same label',
    expectedCode: 'duplicate-helper-label',
    apply: (graph) => {
      const existing = firstOfType(graph, 'helper');
      if (existing !== undefined) return addWiredHelper(graph, existing.label.toUpperCase());
      return addWiredHelper(addWiredHelper(graph, 'Twin helper'), 'Twin helper');
    },
  },
  {
    name: 'call a named helper by a reserved word',
    expectedCode: 'reserved-helper-label',
    apply: (graph, rng) => {
      const word = rng.pick(RESERVED_HELPER_LABELS);
      const label = `${word.charAt(0).toUpperCase()}${word.slice(1)}`;
      const existing = firstOfType(graph, 'helper');
      return existing === undefined
        ? addWiredHelper(graph, label)
        : updateNode(graph, existing.id, (n) => ({ ...n, label }));
    },
  },
  // ------------------------------------------------------------ forbidden edges
  forbidden('a helper flows to the checks', (g, rng) =>
    edgeBetween('flow', pickId(helperNodes(g), rng), idOf(mergeBlock(g))),
  ),
  forbidden('a change reviewer merges', (g, rng) =>
    edgeBetween('merge', pickId(changeReviewers(g), rng), idOf(mergeBlock(g))),
  ),
  forbidden('a tester sends findings to the lead', (g, rng) =>
    edgeBetween('findings', pickId(nodesOfType(g, 'tester'), rng), leadId(g)),
  ),
  forbidden('the lead assigns the tester', (g, rng) =>
    edgeBetween('assigns', leadId(g), pickId(nodesOfType(g, 'tester'), rng)),
  ),
  forbidden('the planner assigns a helper', (g, rng) =>
    edgeBetween('assigns', idOf(firstOfType(g, 'planner')), pickId(helperNodes(g), rng)),
  ),
  forbidden('a helper is reviewed by a final reviewer', (g, rng) =>
    edgeBetween(
      'review',
      pickId(helperNodes(g), rng),
      pickId(
        finalStageNodes(g).filter((n) => n.type === 'reviewer'),
        rng,
      ),
    ),
  ),
  forbidden('a helper flows to your merge', (g, rng) =>
    edgeBetween('flow', pickId(helperNodes(g), rng), idOf(firstOfType(g, 'owner-merge'))),
  ),
  // ADR-0028 §2: forbidden only past a block before the merge; without one it is the merge path.
  forbidden('the lead merges into the ticket merge directly', (g) =>
    mergeBlock(g) === undefined
      ? null
      : edgeBetween('merge', leadId(g), idOf(firstOfType(g, 'ticket-merge'))),
  ),
  forbidden('a change reviewer sends findings to a helper', (g, rng) =>
    edgeBetween('findings', pickId(changeReviewers(g), rng), pickId(helperNodes(g), rng)),
  ),
  forbidden('done flows back to the ticket', (g) =>
    edgeBetween('flow', idOf(firstOfType(g, 'done')), idOf(firstOfType(g, 'ticket'))),
  ),
  forbidden('the plan skips the planner, or goes back to a lead that plans itself', (g) =>
    firstOfType(g, 'planner') !== undefined
      ? edgeBetween('flow', idOf(firstOfType(g, 'ticket')), leadId(g))
      : edgeBetween('flow', idOf(firstOfType(g, 'plan-approval')), leadId(g)),
  ),
  {
    name: 'a helper sends work back to the lead',
    expectedCode: 'edge-not-allowed',
    apply: (graph, rng) => {
      const from = pickId(editorNodes(graph), rng);
      return from === null
        ? null
        : addEdge(graph, { type: 'rework', from, to: leadId(graph), maxRounds: 1 });
    },
  },
  // ------------------------------------------------------------ paths
  {
    name: 'cut the plan path',
    expectedCode: 'plan-path',
    apply: (graph, rng) => {
      const plan = new Set(
        graph.nodes
          .filter((n) => ['ticket', 'planner', 'plan-approval', 'lead'].includes(n.type))
          .map((n) => n.id),
      );
      return removeOne(graph, rng, (e) => e.type === 'flow' && plan.has(e.from) && plan.has(e.to));
    },
  },
  {
    name: 'add or remove the planner without rewiring the plan path',
    expectedCode: 'plan-path',
    apply: (graph) => {
      const planner = firstOfType(graph, 'planner');
      return planner !== undefined
        ? removeNode(graph, planner.id)
        : addNode(graph, {
            type: 'planner',
            id: freshId(graph, 'planner'),
            label: 'Planner',
            ...AGENT,
          });
    },
  },
  {
    name: 'remove a review route',
    expectedCode: 'no-review-route',
    apply: (graph, rng) => removeOne(graph, rng, (e) => e.type === 'review'),
  },
  {
    name: 'give a block a second review route',
    expectedCode: 'many-review-routes',
    apply: (graph, rng) => {
      const editors = editorNodes(graph);
      if (editors.length === 0) return null;
      const node = rng.pick(editors);
      const lead = leadId(graph);
      if (reviewTargetOf(graph, node.id) !== lead) {
        return addEdge(graph, { type: 'review', from: node.id, to: lead });
      }
      const { graph: g, id } = addReviewer(graph);
      return addEdge(g, { type: 'review', from: node.id, to: id });
    },
  },
  {
    name: 'remove a reviewer’s findings link',
    expectedCode: 'reviewer-no-findings',
    apply: (graph, rng) => removeOne(graph, rng, (e) => e.type === 'findings'),
  },
  {
    name: 'add a reviewer nothing sends changes to',
    expectedCode: 'reviewer-unused',
    apply: (graph) => addReviewer(graph).graph,
  },
  {
    name: 'a reviewer sends back a change it did not review',
    expectedCode: 'rework-without-review',
    apply: (graph, rng) => {
      const options: [string, string][] = [];
      for (const r of changeReviewers(graph)) {
        for (const n of editorNodes(graph)) {
          const reworks = graph.edges.some(
            (e) => e.type === 'rework' && e.from === r.id && e.to === n.id,
          );
          if (reviewTargetOf(graph, n.id) !== r.id && !reworks) options.push([r.id, n.id]);
        }
      }
      if (options.length > 0) {
        const [from, to] = rng.pick(options);
        return addEdge(graph, { type: 'rework', from, to, maxRounds: 1 });
      }
      const target = pickId(editorNodes(graph), rng);
      if (target === null) return null;
      const { graph: g, id } = addReviewer(graph);
      return addEdge(g, { type: 'rework', from: id, to: target, maxRounds: 1 });
    },
  },
  {
    name: 'remove the lead’s assigns link to a helper',
    expectedCode: 'not-assigned',
    apply: (graph, rng) => removeOne(graph, rng, (e) => e.type === 'assigns'),
  },
  {
    name: 'remove the lead’s merge link',
    expectedCode: 'merge-path',
    apply: (graph, rng) => removeOne(graph, rng, (e) => e.type === 'merge'),
  },
  {
    name: 'cut the checks from the ticket merge',
    expectedCode: 'merge-path',
    apply: (graph, rng) => {
      const checks = idOf(mergeBlock(graph));
      return removeOne(graph, rng, (e) => e.type === 'flow' && e.from === checks);
    },
  },
  {
    name: 'cut the link into your merge',
    expectedCode: 'final-chain',
    apply: (graph, rng) => {
      const owner = idOf(firstOfType(graph, 'owner-merge'));
      return removeOne(graph, rng, (e) => e.type === 'flow' && e.to === owner);
    },
  },
  {
    name: 'cut your merge from done',
    expectedCode: 'final-chain',
    apply: (graph, rng) => {
      const owner = idOf(firstOfType(graph, 'owner-merge'));
      return removeOne(graph, rng, (e) => e.type === 'flow' && e.from === owner);
    },
  },
  {
    name: 'a final reviewer off the chain',
    expectedCode: 'final-chain',
    apply: (graph) => addFinalReviewer(graph).graph,
  },
  {
    name: 'a tester off the chain',
    expectedCode: 'final-chain',
    apply: (graph) => {
      if (nodesOfType(graph, 'tester').length >= 2) return null;
      const id = freshId(graph, 'tester');
      const g = addNode(graph, {
        type: 'tester',
        id,
        label: 'Tester',
        ...AGENT,
        approvalMode: null,
      });
      return addEdge(g, { type: 'review', from: id, to: leadId(g) });
    },
  },
  {
    name: 'branch the final chain',
    expectedCode: 'final-chain',
    apply: (graph) => {
      const start = idOf(firstOfType(graph, 'ticket-merge'));
      const end = idOf(firstOfType(graph, 'owner-merge'));
      if (start === null || end === null) return null;
      const { graph: g, id } = addFinalReviewer(graph);
      return addEdge(addEdge(g, { type: 'flow', from: start, to: id }), {
        type: 'flow',
        from: id,
        to: end,
      });
    },
  },
  {
    name: 'a flow cycle among the final steps',
    expectedCode: 'cycle',
    apply: (graph, rng) => {
      const chain = chainIds(graph);
      let g = graph;
      let stages = chain.slice(1, -1);
      if (stages.length === 0) {
        const [start, end] = [chain[0], chain[chain.length - 1]];
        if (start === undefined || end === undefined || chain.length < 2) return null;
        const added = addFinalReviewer(g);
        g = removeEdges(added.graph, (e) => e.type === 'flow' && e.from === start && e.to === end);
        g = addEdge(addEdge(g, { type: 'flow', from: start, to: added.id }), {
          type: 'flow',
          from: added.id,
          to: end,
        });
        stages = [added.id];
      }
      const at = rng.pick(stages);
      const { graph: g2, id } = addFinalReviewer(g);
      return addEdge(addEdge(g2, { type: 'flow', from: at, to: id }), {
        type: 'flow',
        from: id,
        to: at,
      });
    },
  },
  {
    name: 'a helper nothing leads to',
    expectedCode: 'unreachable',
    apply: (graph) => {
      const id = freshId(graph, 'named');
      const g = addNode(graph, helper(id, 'Lonely helper'));
      return addEdge(g, { type: 'review', from: id, to: leadId(g) });
    },
  },
  // ------------------------------------------------------------ Checks blocks (ADR-0027 §5)
  // Appended last, so the mutants above stay the same for a seed.
  {
    name: 'add a second Checks block before the merge',
    expectedCode: 'too-many-nodes',
    apply: (graph) => {
      let g = graph;
      while (
        g.nodes.filter((n) => n.type === 'checks' && (n.place ?? 'merge') === 'merge').length < 2
      ) {
        g = addBlock(g, 'merge').graph;
      }
      return g;
    },
  },
  {
    name: 'add a second Checks block on the ticket branch',
    expectedCode: 'too-many-nodes',
    apply: (graph) => {
      let g = graph;
      while (g.nodes.filter((n) => n.type === 'checks' && n.place === 'branch').length < 2) {
        g = addBlock(g, 'branch').graph;
      }
      return g;
    },
  },
  {
    name: 'a Checks block on the ticket branch off the line',
    expectedCode: 'final-chain',
    apply: (graph) => addBlock(graph, 'branch').graph,
  },
  {
    name: 'a change Checks block nothing flows into',
    expectedCode: 'check-block-input',
    apply: (graph) => addBlock(graph, 'change').graph,
  },
  {
    name: 'a helper flows into two change Checks blocks',
    expectedCode: 'many-check-blocks',
    apply: (graph, rng) => {
      const editor = pickId(editorNodes(graph), rng);
      if (editor === null) return null;
      const first = addBlock(graph, 'change', { inputs: [editor] }).graph;
      return addBlock(first, 'change', { inputs: [editor] }).graph;
    },
  },
  {
    name: 'a failure route the block’s place does not allow',
    expectedCode: 'check-failure-route',
    apply: (graph, rng) => {
      const block = mergeBlock(graph);
      if (rng.bool() || block === undefined) {
        const { graph: g, id } = addBlock(graph, 'branch', { onFailure: 'lead' });
        // on the chain, right before your merge, so only the route is wrong
        const into = g.edges.find(
          (e) => e.type === 'flow' && g.nodes.find((n) => n.id === e.to)?.type === 'owner-merge',
        );
        if (into === undefined) return g;
        const rewired = removeEdges(g, (e) => e.id === into.id);
        return addEdge(addEdge(rewired, { type: 'flow', from: into.from, to: id }), {
          type: 'flow',
          from: id,
          to: into.to,
        });
      }
      return updateNode(graph, block.id, (n) =>
        n.type === 'checks' ? { ...n, onFailure: 'helper' } : n,
      );
    },
  },
  {
    name: 'back to the helper without a rework link',
    expectedCode: 'check-rework',
    apply: (graph, rng) => {
      const editor = pickEditor(graph, rng);
      return editor === null
        ? null
        : addBlock(graph, 'change', { inputs: [editor], onFailure: 'helper' }).graph;
    },
  },
  {
    name: 'a rework link from a Checks block that does not send work back',
    expectedCode: 'check-rework',
    apply: (graph, rng) => {
      const editor = pickEditor(graph, rng);
      if (editor === null) return null;
      const onFailure = pickOptional<CheckFailureRoute>(rng, ['lead', 'owner']);
      const { graph: g, id } = addBlock(graph, 'change', {
        inputs: [editor],
        ...(onFailure !== undefined ? { onFailure } : {}),
      });
      return addEdge(g, { type: 'rework', from: id, to: editor, maxRounds: rng.int(6) });
    },
  },
  {
    name: 'a change Checks block sends back a node it does not check',
    expectedCode: 'check-rework',
    apply: (graph, rng) => {
      const editors = editorNodes(graph);
      if (editors.length === 0) return null;
      const target = rng.pick(editors).id;
      const others = editors.filter((n) => n.id !== target);
      const input = others.length > 0 ? rng.pick(others).id : null;
      const { graph: g, id } = addBlock(graph, 'change', {
        inputs: input === null ? [] : [input],
        onFailure: 'helper',
      });
      let out = addEdge(g, { type: 'rework', from: id, to: target, maxRounds: 1 });
      if (input !== null) out = addEdge(out, { type: 'rework', from: id, to: input, maxRounds: 1 });
      return out;
    },
  },
  {
    name: 'the lead merges through a change Checks block',
    expectedCode: 'edge-not-allowed',
    apply: (graph, rng) => {
      const editor = pickEditor(graph, rng);
      if (editor === null) return null;
      const { graph: g, id } = addBlock(graph, 'change', { inputs: [editor] });
      return addEdge(g, { type: 'merge', from: leadId(g), to: id });
    },
  },
  {
    name: 'a change Checks block flows to the ticket merge',
    expectedCode: 'edge-not-allowed',
    apply: (graph, rng) => {
      const editor = pickEditor(graph, rng);
      const ticketMerge = idOf(firstOfType(graph, 'ticket-merge'));
      if (editor === null || ticketMerge === null) return null;
      const { graph: g, id } = addBlock(graph, 'change', { inputs: [editor] });
      return addEdge(g, { type: 'flow', from: id, to: ticketMerge });
    },
  },
  {
    name: 'the lead or a reviewer flows to a change Checks block',
    expectedCode: 'edge-not-allowed',
    apply: (graph, rng) => {
      const editor = pickEditor(graph, rng);
      if (editor === null) return null;
      const { graph: g, id } = addBlock(graph, 'change', { inputs: [editor] });
      const from = pickId([...changeReviewers(g), ...finalStageNodes(g)], rng) ?? leadId(g);
      const tester = g.nodes.find((n) => n.id === from)?.type === 'tester';
      return addEdge(g, { type: 'flow', from: tester ? leadId(g) : from, to: id });
    },
  },
  {
    name: 'a helper flows to the Checks block on the ticket branch',
    expectedCode: 'edge-not-allowed',
    apply: (graph, rng) => {
      const helperId = pickId(helperNodes(graph), rng);
      if (helperId === null) return null;
      const { graph: g, id } = addBlock(graph, 'branch');
      return addEdge(g, { type: 'flow', from: helperId, to: id });
    },
  },
  {
    name: 'the Checks block before the merge sends work back',
    expectedCode: 'edge-not-allowed',
    apply: (graph, rng) => {
      const block = idOf(mergeBlock(graph));
      const editor = pickId(editorNodes(graph), rng);
      return block === null || editor === null
        ? null
        : addEdge(graph, { type: 'rework', from: block, to: editor, maxRounds: 1 });
    },
  },
  // ------------------------------------------------------------ optional checks (ADR-0028 §2)
  // Appended last, so the mutants above stay the same for a seed.
  {
    name: 'add a Checks block before the merge without the lead merging through it',
    expectedCode: 'edge-not-allowed',
    apply: (graph) => {
      if (mergeBlock(graph) !== undefined) return null;
      const ticketMerge = idOf(firstOfType(graph, 'ticket-merge'));
      if (ticketMerge === null) return null;
      const { graph: g, id } = addBlock(graph, 'merge');
      return addEdge(g, { type: 'flow', from: id, to: ticketMerge });
    },
  },
  {
    name: 'the lead merges into the ticket branch without its merge link',
    expectedCode: 'merge-path',
    apply: (graph, rng) => {
      if (mergeBlock(graph) !== undefined) return null;
      return removeOne(graph, rng, (e) => e.type === 'merge');
    },
  },
]);
