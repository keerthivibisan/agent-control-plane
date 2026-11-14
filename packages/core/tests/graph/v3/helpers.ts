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
  type WorkflowProgram,
  type ProgramFailureRoute,
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
  type: Exclude<WorkflowEdgeV3['type'], 'when'>,
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

/** A program without `failureRoutes` (ADR-0038): the fields the version 2 compiler also gives. */
export function oldFields(program: WorkflowProgram): WorkflowProgram {
  const { failureRoutes: _routes, ...rest } = program;
  return rest;
}

/**
 * Where the program's derived failure routes disagree with the fields the engine runs today
 * (ADR-0038 §4): one `review-rework` route per reviewer of a `direct` review route, with its
 * `reviewerRounds`, and one `checks-failed`/`harness-failed` route per change block that sends a
 * failure back to the helper, with its `maxRounds`; nothing else is derived.
 */
export function derivedRouteMismatch(program: WorkflowProgram): string | null {
  const expected: ProgramFailureRoute[] = [];
  const editors = [
    ...program.helpers,
    ...program.finalStages.flatMap((s) => (s.type === 'tester' ? [s] : [])),
  ];
  for (const editor of editors) {
    const r = editor.review;
    if (r.by === 'agent' && r.then === 'direct') {
      for (const reviewer of r.reviewers) {
        expected.push({
          sourceNodeId: reviewer,
          events: ['review-rework'],
          target: { kind: 'author' },
          maxRounds: r.reviewerRounds,
          derived: true,
          editorNodeId: editor.id,
        });
      }
    }
    const block = program.checkBlocks.change[editor.id];
    if (block !== undefined && block.onFailure === 'helper' && block.maxRounds !== null) {
      expected.push({
        sourceNodeId: block.nodeId,
        events: ['checks-failed', 'harness-failed'],
        target: { kind: 'author' },
        maxRounds: block.maxRounds,
        derived: true,
        editorNodeId: editor.id,
      });
    }
  }
  const key = (r: ProgramFailureRoute) => JSON.stringify(r);
  const want = expected.map(key).sort();
  const got = (program.failureRoutes ?? [])
    .filter((r) => r.derived === true)
    .map(key)
    .sort();
  return JSON.stringify(want) === JSON.stringify(got)
    ? null
    : `derived routes ${JSON.stringify(got)} ≠ ${JSON.stringify(want)}`;
}
