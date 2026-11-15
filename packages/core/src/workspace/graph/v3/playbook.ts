import type {
  AnyWorkflowGraph,
  WorkflowEdgeId,
  WorkflowEdgeV3,
  WorkflowNodeId,
  WorkflowNodeV3,
} from '../../workflow-graph.js';
import { checkBlockOf } from '../check-blocks.js';
import {
  describeWorkflow,
  failureSentences,
  nameOf,
  notesText,
  quoteInline,
  rounds,
  typeList,
  WORKFLOW_WORDS_NOTE,
  type DescribeWorkflowOptions,
  type WorkflowFailureRouting,
} from './describe.js';
import { indexNodesV3, type NodeIndexV3 } from './graph-index.js';
import { toWorkflowGraphV3 } from './migrate.js';
import { isChainStepV3 } from './validate.js';

/**
 * ADR-0040: the lead's playbook, the workflow in the order a run follows it. Each stage lists what
 * happens and who does it, each failure under the stage where it happens; the editor shows it
 * beside the canvas and Tidy layout puts each stage in its own column, and the lead's brief gets
 * the same text, so the owner reads exactly what the lead reads. Pure; any graph, valid or not.
 * Every text the owner typed is quoted on one line (`quoteInline`), as in `describeWorkflow`.
 */

export const PLAYBOOK_STAGES = [
  'start',
  'plan',
  'build',
  'review',
  'merge',
  'final',
  'finish',
] as const;
export type PlaybookStageKey = (typeof PLAYBOOK_STAGES)[number];

export const PLAYBOOK_STAGE_TITLES: Readonly<Record<PlaybookStageKey, string>> = Object.freeze({
  start: 'Ticket and research',
  plan: 'Plan',
  build: 'Build',
  review: 'Review each change',
  merge: 'Merge',
  final: 'Final checks',
  finish: 'Finish',
});

export interface PlaybookStep {
  text: string;
  /** The blocks and links the step is about, for the editor to highlight. */
  nodeIds: WorkflowNodeId[];
  edgeIds: WorkflowEdgeId[];
  /** Failures only: how it is routed ("Lead decides (default)" is `default`). */
  routing?: WorkflowFailureRouting;
}

export interface PlaybookStage {
  /** 1, 2, … over the stages this workflow has. */
  n: number;
  key: PlaybookStageKey;
  title: string;
  steps: PlaybookStep[];
}

/** The researchers that run before the plan: they research for a planning block, or for one. */
function prePlanResearchers(index: NodeIndexV3, edges: readonly WorkflowEdgeV3[]): Set<string> {
  const planners = index.unique.filter((n) => roleOf(index, n) === 'planner').map((n) => n.id);
  const lead = index.unique.find((n) => n.type === 'lead');
  const planning = new Set(planners.length > 0 ? planners : lead !== undefined ? [lead.id] : []);
  const pre = new Set<string>();
  for (let grew = true; grew;) {
    grew = false;
    for (const e of edges) {
      if (e.type !== 'research' || pre.has(e.from)) continue;
      if (planning.has(e.to) || pre.has(e.to)) {
        pre.add(e.from);
        grew = true;
      }
    }
  }
  return pre;
}

type Role =
  'lead' | 'planner' | 'researcher' | 'worker' | 'change-reviewer' | 'final-reviewer' | 'tester';

function roleOf(index: NodeIndexV3, node: WorkflowNodeV3): Role | undefined {
  if (node.type === 'lead') return 'lead';
  const r = index.roles.get(node.id);
  if (r?.ok !== true) return undefined;
  switch (r.role.role) {
    case 'reviewer':
      return r.role.scope === 'change' ? 'change-reviewer' : 'final-reviewer';
    case 'lead':
    case 'planner':
    case 'researcher':
    case 'worker':
    case 'tester':
      return r.role.role;
  }
}

/** The stage a block belongs to, for the playbook and the editor's stage columns. */
export function stageOfNode(graph: AnyWorkflowGraph, nodeId: WorkflowNodeId): PlaybookStageKey {
  const v3 = toWorkflowGraphV3(graph);
  const index = indexNodesV3(v3);
  return stagesOf(index, v3.edges).get(nodeId) ?? 'build';
}

/** Every block's stage (see `stageOfNode`). */
export function playbookStages(graph: AnyWorkflowGraph): Map<WorkflowNodeId, PlaybookStageKey> {
  const v3 = toWorkflowGraphV3(graph);
  return stagesOf(indexNodesV3(v3), v3.edges);
}

function stagesOf(index: NodeIndexV3, edges: readonly WorkflowEdgeV3[]) {
  const pre = prePlanResearchers(index, edges);
  const out = new Map<WorkflowNodeId, PlaybookStageKey>();
  for (const node of index.unique) out.set(node.id, stageOf(index, node, pre));
  return out;
}

function stageOf(index: NodeIndexV3, node: WorkflowNodeV3, pre: Set<string>): PlaybookStageKey {
  switch (node.type) {
    case 'ticket':
      return 'start';
    case 'plan-approval':
      return 'plan';
    case 'ticket-merge':
      return 'merge';
    case 'owner-merge':
    case 'done':
      return 'finish';
    case 'author':
      return 'final';
    case 'checks': {
      const place = checkBlockOf(node).place;
      return place === 'change' ? 'review' : place === 'merge' ? 'merge' : 'final';
    }
    case 'lead':
      return 'build';
    case 'agent':
      switch (roleOf(index, node)) {
        case 'researcher':
          return pre.has(node.id) ? 'start' : 'build';
        case 'planner':
          return 'plan';
        case 'change-reviewer':
          return 'review';
        case 'final-reviewer':
        case 'tester':
          return 'final';
        default:
          return 'build';
      }
  }
}

function typesNote(node: WorkflowNodeV3 | undefined): string {
  return node?.type === 'agent' && node.ticketTypes !== undefined
    ? ` (${typeList(node.ticketTypes)} tickets only)`
    : '';
}

function ownText(node: WorkflowNodeV3 | undefined): string | undefined {
  return node?.type === 'agent' && node.description !== undefined && node.description !== ''
    ? node.description
    : undefined;
}

function names(index: NodeIndexV3, ids: readonly WorkflowNodeId[]): string {
  const list = ids.map((id) => nameOf(index, id));
  if (list.length <= 1) return list.join('');
  return `${list.slice(0, -1).join(', ')} and ${list[list.length - 1] ?? ''}`;
}

/**
 * What starts an agent that the lead does not choose, in words: "Runs before the plan", "Reviews
 * each change of "Developer"", "Tests the ticket branch after the merge". Undefined for the lead
 * and helpers (the lead picks a helper for a step by its "When to use"), and an agent without a role.
 */
export function whenToUse(graph: AnyWorkflowGraph, nodeId: WorkflowNodeId): string | undefined {
  const v3 = toWorkflowGraphV3(graph);
  const index = indexNodesV3(v3);
  const node = index.byId.get(nodeId);
  if (node === undefined) return undefined;
  return trigger(index, v3.edges, node, prePlanResearchers(index, v3.edges));
}

function trigger(
  index: NodeIndexV3,
  edges: readonly WorkflowEdgeV3[],
  node: WorkflowNodeV3,
  pre: Set<string>,
): string | undefined {
  const into = (type: WorkflowEdgeV3['type']) =>
    edges.filter((e) => e.type === type && e.to === node.id).map((e) => e.from);
  const outTo = (type: WorkflowEdgeV3['type']) =>
    edges.filter((e) => e.type === type && e.from === node.id).map((e) => e.to);
  switch (roleOf(index, node)) {
    case 'researcher':
      return pre.has(node.id)
        ? `Runs before the plan, for ${names(index, outTo('research'))}`
        : `Runs when the lead asks, for ${names(index, outTo('research'))}`;
    case 'planner':
      return 'Writes the plan when a ticket starts';
    case 'change-reviewer':
      return `Reviews each change of ${names(index, into('review'))}`;
    case 'final-reviewer':
      return 'Reviews the merged ticket';
    case 'tester':
      return 'Tests the ticket branch after the merge';
    default:
      return undefined;
  }
}

/** The final chain from the ticket merge, in order (flow and test steps). */
function chainOrder(index: NodeIndexV3, edges: readonly WorkflowEdgeV3[]): WorkflowNodeV3[] {
  const out: WorkflowNodeV3[] = [];
  const seen = new Set<string>();
  let current: WorkflowNodeV3 | undefined = index.unique.find((n) => n.type === 'ticket-merge');
  while (current !== undefined && !seen.has(current.id)) {
    seen.add(current.id);
    const from: string = current.id;
    const next: WorkflowEdgeV3 | undefined = edges.find(
      (e) => e.from === from && isChainStepV3(index, e),
    );
    current = next === undefined ? undefined : index.byId.get(next.to);
    if (current !== undefined && current.type !== 'owner-merge' && current.type !== 'done') {
      out.push(current);
    }
  }
  return out;
}

/** The playbook: the stages this workflow has, numbered, each with its steps. */
export function workflowPlaybook(
  graph: AnyWorkflowGraph,
  _opts: DescribeWorkflowOptions = {},
): PlaybookStage[] {
  const v3 = toWorkflowGraphV3(graph);
  const index = indexNodesV3(v3);
  const edges = v3.edges;
  const pre = prePlanResearchers(index, edges);
  const stages = stagesOf(index, edges);
  const steps = new Map<PlaybookStageKey, PlaybookStep[]>(PLAYBOOK_STAGES.map((s) => [s, []]));
  const add = (stage: PlaybookStageKey, step: PlaybookStep) => steps.get(stage)?.push(step);
  const lead = index.unique.find((n) => n.type === 'lead');
  const leadName = lead === undefined ? '"Lead"' : nameOf(index, lead.id);
  const leadIds = lead === undefined ? [] : [lead.id];
  const agents = (role: Role) => index.unique.filter((n) => roleOf(index, n) === role);
  const edgesOf = (type: WorkflowEdgeV3['type'], f: (e: WorkflowEdgeV3) => boolean) =>
    edges.filter((e) => e.type === type && f(e));
  const notes = (list: readonly WorkflowEdgeV3[]) => list.map((e) => notesText(e)).join('');
  const own = (node: WorkflowNodeV3) => {
    const text = ownText(node);
    return text === undefined ? '' : ` When to use: ${quoteInline(text)}.`;
  };

  // 1. The ticket and the research before the plan.
  const ticket = index.unique.find((n) => n.type === 'ticket');
  if (ticket !== undefined) {
    add('start', { text: 'A ticket starts the run.', nodeIds: [ticket.id], edgeIds: [] });
  }
  for (const r of agents('researcher').filter((n) => pre.has(n.id))) {
    const out = edgesOf('research', (e) => e.from === r.id);
    add('start', {
      text: `${nameOf(index, r.id)} researches before the plan, for ${names(
        index,
        out.map((e) => e.to),
      )}${typesNote(r)}.${notes(out)}${own(r)}`,
      nodeIds: [r.id],
      edgeIds: out.map((e) => e.id),
    });
  }

  // 2. The plan and its approval.
  const planners = agents('planner');
  const planEdges = edgesOf('plan', () => true);
  if (planners.length === 0) {
    add('plan', { text: `${leadName} writes the plan.`, nodeIds: leadIds, edgeIds: [] });
  } else {
    const who = names(
      index,
      planners.map((p) => p.id),
    );
    add('plan', {
      text:
        planners.length === 1
          ? `${who} writes the plan${typesNote(planners[0])}; ${leadName} runs it.${own(planners[0] as WorkflowNodeV3)}`
          : `${who} each write a plan; you pick one, and ${leadName} runs it.`,
      nodeIds: planners.map((p) => p.id),
      edgeIds: planEdges.map((e) => e.id),
    });
  }
  const gate = index.unique.find((n) => n.type === 'plan-approval');
  if (gate?.type === 'plan-approval') {
    add('plan', {
      text: gate.auto ? 'The plan is approved at once.' : 'You approve the plan.',
      nodeIds: [gate.id],
      edgeIds: [],
    });
  }

  // 3. Build: the helpers the lead starts for the plan's steps.
  const workers = agents('worker');
  const implement = edgesOf('implement', () => true);
  if (workers.length > 0) {
    add('build', {
      text: `${leadName} starts a helper for each plan step, several at the same time when the steps allow; it picks each helper by its "When to use":`,
      nodeIds: leadIds,
      edgeIds: implement.map((e) => e.id),
    });
  }
  for (const w of workers) {
    const to = edgesOf('implement', (e) => e.to === w.id);
    const pool = w.type === 'agent' && w.pool === true;
    const text = ownText(w);
    const use = pool
      ? 'takes any step no named helper takes'
      : text !== undefined
        ? `use for ${quoteInline(text)}`
        : 'no "When to use" yet: the lead goes by its name';
    add('build', {
      text: `- ${nameOf(index, w.id)}${typesNote(w)}: ${use}.${notes(to)}`,
      nodeIds: [w.id],
      edgeIds: to.map((e) => e.id),
    });
  }
  for (const r of agents('researcher').filter((n) => !pre.has(n.id))) {
    const out = edgesOf('research', (e) => e.from === r.id);
    add('build', {
      text: `${nameOf(index, r.id)} researches for ${names(
        index,
        out.map((e) => e.to),
      )} when ${leadName} asks${typesNote(r)}.${notes(out)}${own(r)}`,
      nodeIds: [r.id],
      edgeIds: out.map((e) => e.id),
    });
  }
  for (const e of edgesOf('custom', () => true)) {
    add('build', {
      text: `${nameOf(index, e.from)} hands off to ${nameOf(index, e.to)} when it finishes.${notesText(e)}`,
      nodeIds: [e.from, e.to],
      edgeIds: [e.id],
    });
  }

  // 4. Each change: its checks, its review, its rework (testers' changes under final checks).
  for (const editor of index.unique) {
    const role = roleOf(index, editor);
    if (role !== 'worker') continue;
    changeSteps(editor, 'review');
  }
  function changeSteps(editor: WorkflowNodeV3, stage: PlaybookStageKey): void {
    const checks = edges.filter(
      (e) => e.type === 'flow' && e.from === editor.id && stages.get(e.to) === 'review',
    );
    for (const c of checks) {
      add(stage, {
        text: `${nameOf(index, c.to)} runs checks on each change of ${nameOf(index, editor.id)}.`,
        nodeIds: [c.to],
        edgeIds: [c.id],
      });
    }
    const review = edgesOf('review', (e) => e.from === editor.id);
    if (review.length === 0) return;
    const back = edgesOf('rework', (e) => e.to === editor.id);
    const reviewers = review.map((e) => e.to);
    const byLead = lead !== undefined && reviewers.includes(lead.id);
    const reworkText = back
      .map(
        (e) =>
          ` ${nameOf(index, e.from)} can send it back (${rounds(e.type === 'rework' ? e.maxRounds : 0)}).`,
      )
      .join('');
    add(stage, {
      text: byLead
        ? `${leadName} reviews each change of ${nameOf(index, editor.id)}.${reworkText}${notes(review)}`
        : `Each change of ${nameOf(index, editor.id)} goes to ${names(index, reviewers)} for review.${reworkText}${notes(review)}`,
      nodeIds: [editor.id, ...reviewers],
      edgeIds: [...review, ...back].map((e) => e.id),
    });
  }
  for (const e of edgesOf('findings', () => true)) {
    add('review', {
      text: `${nameOf(index, e.from)} sends its findings to ${nameOf(index, e.to)}, who decides.${notesText(e)}`,
      nodeIds: [e.from, e.to],
      edgeIds: [e.id],
    });
  }

  // 5. Merge.
  const merge = edgesOf('merge', () => true);
  const ticketMerge = index.unique.find((n) => n.type === 'ticket-merge');
  for (const e of merge) {
    const through = index.byId.get(e.to);
    add('merge', {
      text:
        through?.type === 'checks'
          ? `${leadName} merges each approved change through ${nameOf(index, e.to)} into the ticket branch.`
          : `${leadName} merges each approved change into the ticket branch.`,
      nodeIds: [e.to, ...(ticketMerge !== undefined ? [ticketMerge.id] : [])],
      edgeIds: [e.id],
    });
  }

  // 6. Final checks, in chain order.
  for (const step of chainOrder(index, edges)) {
    const into = edges.filter((e) => e.to === step.id && isChainStepV3(index, e));
    const role = roleOf(index, step);
    const text =
      role === 'tester'
        ? `${nameOf(index, step.id)} tests the ticket branch${typesNote(step)}.`
        : role === 'final-reviewer'
          ? `${nameOf(index, step.id)} reviews the merged ticket${typesNote(step)}.`
          : `${nameOf(index, step.id)} runs checks on the ticket branch.`;
    add('final', {
      text: `${text}${notes(into)}${step.type === 'agent' ? own(step) : ''}`,
      nodeIds: [step.id],
      edgeIds: into.map((e) => e.id),
    });
    if (role === 'tester') changeSteps(step, 'final');
  }

  // 7. Finish.
  const owner = index.unique.find((n) => n.type === 'owner-merge');
  if (owner !== undefined) {
    add('finish', {
      text: 'You merge the ticket branch into your target branch, or open a pull request.',
      nodeIds: [owner.id],
      edgeIds: [],
    });
  }

  // Failures, each under the stage of the block where it happens.
  for (const s of failureSentences(index, edges)) {
    const stage = s.nodeId === undefined ? 'final' : (stages.get(s.nodeId) ?? 'final');
    add(stage, {
      text: `If ${s.text.charAt(0).toLowerCase()}${s.text.slice(1)}`.replace(/^If when /, 'If '),
      nodeIds: s.nodeId !== undefined ? [s.nodeId] : [],
      edgeIds: s.edgeId !== undefined ? [s.edgeId] : [],
      ...(s.routing !== undefined ? { routing: s.routing } : {}),
    });
  }

  let n = 0;
  return PLAYBOOK_STAGES.flatMap((key) => {
    const list = steps.get(key) ?? [];
    if (list.length === 0) return [];
    n += 1;
    return [{ n, key, title: PLAYBOOK_STAGE_TITLES[key], steps: list }];
  });
}

/**
 * The playbook as plain text for the lead: the data note, the numbered stages, then the agents
 * with their provider and model (`describeWorkflow`'s agent sentences).
 */
export function renderPlaybook(
  graph: AnyWorkflowGraph,
  opts: DescribeWorkflowOptions = {},
): string {
  const stages = workflowPlaybook(graph, opts);
  const agents = describeWorkflow(graph, opts).filter((s) => s.section === 'agents');
  const parts = [WORKFLOW_WORDS_NOTE];
  for (const stage of stages) {
    parts.push(
      [
        `${stage.n}. ${stage.title}`,
        ...stage.steps.map((s) => (s.text.startsWith('- ') ? `  ${s.text}` : `- ${s.text}`)),
      ].join('\n'),
    );
  }
  if (agents.length > 0) parts.push(['Agents:', ...agents.map((s) => `- ${s.text}`)].join('\n'));
  return parts.join('\n\n');
}
