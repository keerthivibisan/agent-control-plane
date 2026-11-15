// Shared helpers for the version 3 workflow graph tests (ADR-0037, AR-1). Synthetic data only.
import {
  defaultProjectWorkflow,
  migrateWorkflowV1ToV3,
  validateWorkflowGraphV3,
  workflowTemplateV3,
  type AgentNode,
  type CompileContext,
  type GraphIssue,
  type GraphIssueCode,
  type ValidateGraphContext,
  type WorkflowEdgeV3,
  type WorkflowGraphV3,
  type WorkflowNodeV3,
} from '../../../src/index.js';

export const CTX: CompileContext = {
  projectMode: 'auto-edits',
  approvalCeilings: [],
  maxConcurrentHelpers: 3,
};

export function errorsV3(graph: WorkflowGraphV3, ctx?: ValidateGraphContext): GraphIssue[] {
  return validateWorkflowGraphV3(graph, ctx).filter((i) => i.severity === 'error');
}

export function codesV3(graph: WorkflowGraphV3, ctx?: ValidateGraphContext): GraphIssueCode[] {
  return errorsV3(graph, ctx).map((i) => i.code);
}

export function agent(id: string, label = id, extra: Partial<AgentNode> = {}): AgentNode {
  return { type: 'agent', id, label, model: null, skills: [], agent: null, ...extra };
}

/** An arrow with the id `<type>-<from>-<to>`; a rework arrow gets 2 rounds unless given. */
export function arrow(
  type: WorkflowEdgeV3['type'],
  from: string,
  to: string,
  extra: Partial<{ label: string; purpose: string; maxRounds: number }> = {},
): WorkflowEdgeV3 {
  const id = `${type}-${from}-${to}`.slice(0, 40);
  if (type === 'rework') return { type, id, from, to, maxRounds: extra.maxRounds ?? 2, ...extra };
  const { maxRounds: _rounds, ...notes } = extra;
  return { type, id, from, to, ...notes };
}

/** `lead-only` (the lead plans and reviews the pool) unless another template is named. */
export function baseV3(
  id: Parameters<typeof workflowTemplateV3>[0] = 'lead-only',
  planner = false,
): WorkflowGraphV3 {
  return workflowTemplateV3(id, { planner });
}

export function withNodes(graph: WorkflowGraphV3, ...nodes: WorkflowNodeV3[]): WorkflowGraphV3 {
  return { ...graph, nodes: [...graph.nodes, ...nodes] };
}

export function withArrows(graph: WorkflowGraphV3, ...edges: WorkflowEdgeV3[]): WorkflowGraphV3 {
  return { ...graph, edges: [...graph.edges, ...edges] };
}

export function withoutArrows(graph: WorkflowGraphV3, ...ids: string[]): WorkflowGraphV3 {
  for (const id of ids) {
    if (!graph.edges.some((e) => e.id === id)) throw new Error(`test graph has no arrow ${id}`);
  }
  return { ...graph, edges: graph.edges.filter((e) => !ids.includes(e.id)) };
}

/** `lead-only` with a planner (`plan`) and two researchers feeding it, one Claude, one Codex. */
export function researchedPlan(): WorkflowGraphV3 {
  return withArrows(
    withNodes(
      baseV3('lead-only', true),
      agent('research-claude', 'Claude research', { model: 'haiku' }),
      agent('research-codex', 'Codex research', { provider: 'codex' }),
    ),
    arrow('research', 'research-claude', 'plan', {
      label: 'Code facts',
      purpose: 'Where to look.',
    }),
    arrow('research', 'research-codex', 'plan'),
  );
}

/** Today's setup with the final code review and the unit-test stage switched on (version 1). */
export function finalsV3(): WorkflowGraphV3 {
  const v1 = defaultProjectWorkflow('p', '2026-01-01T00:00:00.000Z');
  const stages = {
    ...v1.stages,
    'code-review': { ...v1.stages['code-review'], enabled: true },
    'unit-tests': { ...v1.stages['unit-tests'], enabled: true },
  };
  return migrateWorkflowV1ToV3({ plannerMode: 'lead', stages }, { projectMode: 'auto-edits' });
}
