import type { WorkflowEdge, WorkflowGraph, WorkflowNode } from '../../workflow-graph.js';
import {
  GATE_IDS,
  STAGE_NODE_IDS,
  edge,
  finalChainEdges,
  gateNodes,
  planPathEdges,
  rework,
} from '../build.js';

/**
 * Every small graph within the README layer 4 bounds, legal and illegal (README "Graph
 * correctness", layer 4): up to 2 named helpers, 0–1 helper pool, 0–1 change reviewer, the planner
 * on or off, and up to 2 final stages (final reviewers or testers, in every order).
 *
 * For each of those structures, each editing node (helpers, pool, testers) has a review route
 * (none, the lead, the reviewer, or both) and rework edges (none, the lead's, the reviewer's, or
 * both). The full product of those choices is too large (16⁵ per structure), so each structure
 * yields one legal baseline, then every other choice for one node at a time with the rest at the
 * baseline. That covers every illegal choice on every node position, about four thousand graphs.
 */

export interface EnumeratedGraph {
  /** Says how the graph was built, e.g. `planner+pool+named1+reviewer+[final,tester] pool:both/lead`. */
  name: string;
  graph: WorkflowGraph;
}

type Route = 'none' | 'lead' | 'reviewer' | 'both';
type Reworks = 'none' | 'lead' | 'reviewer' | 'both';
interface Choice {
  route: Route;
  reworks: Reworks;
}

type FinalStage = 'final' | 'tester';
const FINAL_SEQUENCES: readonly (readonly FinalStage[])[] = [
  [],
  ['final'],
  ['tester'],
  ['final', 'final'],
  ['final', 'tester'],
  ['tester', 'final'],
  ['tester', 'tester'],
];

const AGENT = { model: null, skills: [], agent: null };
const LEAD_ROUNDS = 1;
const REVIEWER_ROUNDS = 2;

function choicesFor(reviewer: boolean): Choice[] {
  const routes: Route[] = reviewer ? ['none', 'lead', 'reviewer', 'both'] : ['none', 'lead'];
  const reworks: Reworks[] = reviewer ? ['none', 'lead', 'reviewer', 'both'] : ['none', 'lead'];
  return routes.flatMap((route) => reworks.map((r) => ({ route, reworks: r })));
}

/** The legal baseline for the editing node at `index`: varied routes (a), (b) and (c). */
function baseline(reviewer: boolean, index: number): Choice {
  if (!reviewer) return { route: 'lead', reworks: index % 2 === 0 ? 'lead' : 'none' };
  const reworks: Reworks[] = ['lead', 'reviewer', 'none'];
  return { route: 'reviewer', reworks: reworks[index % 3] ?? 'none' };
}

interface Structure {
  planner: boolean;
  pool: boolean;
  named: number;
  reviewer: boolean;
  finals: readonly FinalStage[];
}

function build(s: Structure, choices: readonly Choice[]): WorkflowGraph {
  const gates = gateNodes(false);
  const ids = STAGE_NODE_IDS;
  const nodes: WorkflowNode[] = [gates.ticket];
  if (s.planner) nodes.push({ type: 'planner', id: ids.planner, label: 'Planner', ...AGENT });
  nodes.push(gates.planApproval, { type: 'lead', id: ids.lead, label: 'Lead', ...AGENT });
  const helpers: string[] = [];
  for (let k = 1; k <= s.named; k++) {
    const id = `named-${k}`;
    helpers.push(id);
    nodes.push({
      type: 'helper',
      id,
      label: `Named helper ${k}`,
      ...AGENT,
      approvalMode: null,
      description: '',
      maxInstances: 1,
      canStartHelpers: false,
    });
  }
  if (s.pool) {
    helpers.push(ids.pool);
    nodes.push({
      type: 'helper-pool',
      id: ids.pool,
      label: 'Helpers',
      ...AGENT,
      approvalMode: null,
      canStartHelpers: false,
    });
  }
  if (s.reviewer) {
    nodes.push({
      type: 'reviewer',
      id: ids.changeReviewer,
      label: 'Change reviewer',
      scope: 'change',
      ...AGENT,
    });
  }
  nodes.push(gates.checks, gates.ticketMerge);
  const stages: string[] = [];
  const testers: string[] = [];
  s.finals.forEach((kind, i) => {
    const id = `${kind}-${i + 1}`;
    stages.push(id);
    if (kind === 'tester') {
      testers.push(id);
      nodes.push({ type: 'tester', id, label: `Tester ${i + 1}`, ...AGENT, approvalMode: null });
    } else {
      nodes.push({
        type: 'reviewer',
        id,
        label: `Code reviewer ${i + 1}`,
        scope: 'final',
        ...AGENT,
      });
    }
  });
  nodes.push(gates.ownerMerge, gates.done);

  const edges: WorkflowEdge[] = [
    ...planPathEdges(
      GATE_IDS.ticket,
      s.planner ? ids.planner : null,
      GATE_IDS.planApproval,
      ids.lead,
    ),
    ...helpers.map((h) => edge('assigns', ids.lead, h)),
  ];
  if (s.reviewer) edges.push(edge('findings', ids.changeReviewer, ids.lead));
  [...helpers, ...testers].forEach((id, i) => {
    const choice = choices[i] ?? { route: 'none', reworks: 'none' };
    if (choice.route === 'lead' || choice.route === 'both')
      edges.push(edge('review', id, ids.lead));
    if (choice.route === 'reviewer' || choice.route === 'both') {
      edges.push(edge('review', id, ids.changeReviewer));
    }
    if (choice.reworks === 'lead' || choice.reworks === 'both') {
      edges.push(rework(ids.lead, id, LEAD_ROUNDS));
    }
    if (choice.reworks === 'reviewer' || choice.reworks === 'both') {
      edges.push(rework(ids.changeReviewer, id, REVIEWER_ROUNDS));
    }
  });
  edges.push(
    edge('merge', ids.lead, GATE_IDS.checks),
    edge('flow', GATE_IDS.checks, GATE_IDS.ticketMerge),
    ...finalChainEdges(GATE_IDS.ticketMerge, stages, GATE_IDS.ownerMerge, GATE_IDS.done),
  );
  return { version: 2, template: 'custom', nodes, edges };
}

function structureName(s: Structure): string {
  return [
    s.planner ? 'planner' : 'no-planner',
    s.pool ? 'pool' : 'no-pool',
    `named${s.named}`,
    s.reviewer ? 'reviewer' : 'no-reviewer',
    `[${s.finals.join(',')}]`,
  ].join('+');
}

function* structures(): Generator<Structure> {
  for (const planner of [false, true]) {
    for (const pool of [false, true]) {
      for (const named of [0, 1, 2]) {
        for (const reviewer of [false, true]) {
          for (const finals of FINAL_SEQUENCES) yield { planner, pool, named, reviewer, finals };
        }
      }
    }
  }
}

export function* enumerateSmallGraphs(): Generator<EnumeratedGraph> {
  for (const s of structures()) {
    const editorIds = [
      ...Array.from({ length: s.named }, (_, k) => `named-${k + 1}`),
      ...(s.pool ? [STAGE_NODE_IDS.pool] : []),
      ...s.finals.flatMap((kind, i) => (kind === 'tester' ? [`tester-${i + 1}`] : [])),
    ];
    const base = editorIds.map((_, i) => baseline(s.reviewer, i));
    const name = structureName(s);
    yield { name: `${name} baseline`, graph: build(s, base) };
    for (let i = 0; i < editorIds.length; i++) {
      const current = base[i];
      for (const choice of choicesFor(s.reviewer)) {
        if (
          current !== undefined &&
          choice.route === current.route &&
          choice.reworks === current.reworks
        ) {
          continue;
        }
        const varied = base.map((c, j) => (j === i ? choice : c));
        yield {
          name: `${name} ${editorIds[i] ?? '?'}:${choice.route}/${choice.reworks}`,
          graph: build(s, varied),
        };
      }
    }
  }
}
