// Contract tests for editable workflow graphs (ADR-0023, WG-0). Shapes only: whether a graph may
// run is `validateWorkflowGraph`'s job (WG-A). Additive: every earlier shape still parses.
// Synthetic data only.
import { describe, expect, it } from 'vitest';
import {
  NODE_CAPABILITIES,
  PlanStepSchema,
  StoredWorkflowJsonSchema,
  WORKFLOW_NODE_TYPES,
  WorkflowGraphSchema,
  WorkflowNodeIdSchema,
  WorkflowNodeSchema,
  defaultProjectWorkflow,
  isAgentNode,
  isEditorNode,
  isModeWithin,
  stricterMode,
  tightenMode,
  type WorkflowGraph,
} from '../src/index.js';
import {
  RunWorkflowGraphDtoSchema,
  SkillSummaryDtoSchema,
  UpdateWorkflowGraphRequestSchema,
  ValidateWorkflowGraphResultDtoSchema,
} from '../src/api/index.js';

const T = '2026-10-17T09:00:00.000Z';
const agent = { model: null, skills: [], agent: null };

/** Scenario (c): a reviewer reworks the named helper directly, then the lead merges. */
const graph: WorkflowGraph = {
  version: 2,
  template: 'reviewer-helper-loop',
  nodes: [
    { type: 'ticket', id: 'ticket', label: 'Ticket' },
    { type: 'lead', id: 'orchestrate', label: 'Lead', ...agent },
    { type: 'plan-approval', id: 'plan-approval', label: 'Plan approval', auto: false },
    {
      type: 'helper',
      id: 'frontend',
      label: 'Frontend helper',
      ...agent,
      approvalMode: 'auto-edits',
      description: 'React pages',
      maxInstances: 2,
      canStartHelpers: false,
    },
    { type: 'reviewer', id: 'review', label: 'Reviewer', ...agent, scope: 'change' },
    { type: 'checks', id: 'checks', label: 'Checks' },
    { type: 'ticket-merge', id: 'ticket-merge', label: 'Ticket branch' },
    { type: 'owner-merge', id: 'owner-merge', label: 'Your merge' },
    { type: 'done', id: 'done', label: 'Done' },
  ],
  edges: [
    { type: 'flow', id: 'e1', from: 'ticket', to: 'orchestrate' },
    { type: 'flow', id: 'e2', from: 'orchestrate', to: 'plan-approval' },
    { type: 'assigns', id: 'e3', from: 'orchestrate', to: 'frontend' },
    { type: 'review', id: 'e4', from: 'frontend', to: 'review' },
    { type: 'rework', id: 'e5', from: 'review', to: 'frontend', maxRounds: 2 },
    { type: 'findings', id: 'e6', from: 'review', to: 'orchestrate' },
    { type: 'merge', id: 'e7', from: 'orchestrate', to: 'checks' },
    { type: 'flow', id: 'e8', from: 'checks', to: 'ticket-merge' },
    { type: 'flow', id: 'e9', from: 'ticket-merge', to: 'owner-merge' },
    { type: 'flow', id: 'e10', from: 'owner-merge', to: 'done' },
  ],
};

describe('workflow graph shape', () => {
  it('parses a graph with every review edge type', () => {
    expect(WorkflowGraphSchema.parse(graph)).toEqual(graph);
  });

  it('accepts the version 1 stage ids as node ids, so old runs keep parsing', () => {
    for (const id of ['plan', 'orchestrate', 'helpers', 'review', 'code-review', 'unit-tests']) {
      expect(WorkflowNodeIdSchema.safeParse(id).success).toBe(true);
    }
    // agent_runs.stage holds 1..40 characters (migration 0004)
    expect(WorkflowNodeIdSchema.safeParse('a'.repeat(40)).success).toBe(true);
    expect(WorkflowNodeIdSchema.safeParse('a'.repeat(41)).success).toBe(false);
    expect(WorkflowNodeIdSchema.safeParse('Lead').success).toBe(false);
    expect(WorkflowNodeIdSchema.safeParse('1lead').success).toBe(false);
  });

  it('cannot give an approval mode to a read-only node', () => {
    const lead = { type: 'lead', id: 'l', label: 'Lead', ...agent, approvalMode: 'full-auto' };
    // zod strips unknown keys: the mode is not part of a lead node at all
    expect(WorkflowNodeSchema.parse(lead)).not.toHaveProperty('approvalMode');
    const reviewer = { type: 'reviewer', id: 'r', label: 'R', ...agent, scope: 'change' };
    expect(WorkflowNodeSchema.parse({ ...reviewer, approvalMode: 'auto' })).not.toHaveProperty(
      'approvalMode',
    );
  });

  it('limits skills, rework rounds and node count', () => {
    const helper = graph.nodes[3];
    expect(WorkflowNodeSchema.safeParse({ ...helper, skills: ['a', 'b', 'c', 'd'] }).success).toBe(
      false,
    );
    const rework = { type: 'rework', id: 'x', from: 'review', to: 'frontend', maxRounds: 6 };
    expect(WorkflowGraphSchema.safeParse({ ...graph, edges: [rework] }).success).toBe(false);
    const many = Array.from({ length: 41 }, (_, i) => ({
      type: 'done' as const,
      id: `n${i}`,
      label: 'x',
    }));
    expect(WorkflowGraphSchema.safeParse({ ...graph, nodes: many }).success).toBe(false);
  });

  it('stores a version 2 graph or a version 1 workflow', () => {
    expect(StoredWorkflowJsonSchema.parse({ version: 2, graph })).toEqual({ version: 2, graph });
    const { plannerMode, stages } = defaultProjectWorkflow('p1', T);
    expect(StoredWorkflowJsonSchema.parse({ plannerMode, stages })).toEqual({
      plannerMode,
      stages,
    });
  });

  it('fixes capabilities by type: only helpers and testers edit', () => {
    const editors = WORKFLOW_NODE_TYPES.filter((t) => NODE_CAPABILITIES[t].edits);
    expect(editors.sort()).toEqual(['helper', 'helper-pool', 'tester']);
    expect(NODE_CAPABILITIES.lead.kind).toBe('lead');
    expect(NODE_CAPABILITIES.ticket.kind).toBeNull();
    expect(graph.nodes.filter(isEditorNode).map((n) => n.id)).toEqual(['frontend']);
    expect(graph.nodes.filter(isAgentNode).map((n) => n.id)).toEqual([
      'orchestrate',
      'frontend',
      'review',
    ]);
  });
});

describe('approval modes per node', () => {
  it('orders modes from the most careful', () => {
    expect(stricterMode('full-auto', 'manual')).toBe('manual');
    expect(stricterMode('auto', 'auto-edits')).toBe('auto-edits');
    expect(isModeWithin('auto-edits', 'auto')).toBe(true);
    expect(isModeWithin('full-auto', 'auto')).toBe(false);
  });

  it('uses the project mode for a node without one', () => {
    expect(tightenMode(null, 'auto')).toEqual({ mode: 'auto', sandbox: false });
  });

  it('lets a ticket or run tighten a node, never loosen it', () => {
    expect(tightenMode('auto-edits', 'auto', 'full-auto').mode).toBe('auto-edits');
    expect(tightenMode('auto', 'auto', 'manual').mode).toBe('manual');
    expect(tightenMode('full-auto', 'manual', undefined, 'auto').mode).toBe('auto');
    expect(tightenMode('auto', 'manual', 'auto-edits', 'manual').mode).toBe('manual');
  });

  it('keeps the sandbox for a node configured as Full auto, even when tightened', () => {
    expect(tightenMode('full-auto', 'manual', 'manual')).toEqual({ mode: 'manual', sandbox: true });
    expect(tightenMode(null, 'full-auto', 'auto-edits')).toEqual({
      mode: 'auto-edits',
      sandbox: true,
    });
    expect(tightenMode('auto', 'full-auto').sandbox).toBe(false);
  });
});

describe('additive tool and API contracts', () => {
  it('parses the graph DTOs', () => {
    expect(UpdateWorkflowGraphRequestSchema.parse({ graph }).graph).toEqual(graph);
    expect(ValidateWorkflowGraphResultDtoSchema.parse({ ok: false, issues: [] }).ok).toBe(false);
    const issue = { code: 'no-review-route', severity: 'error', message: 'x', nodeId: 'frontend' };
    expect(
      ValidateWorkflowGraphResultDtoSchema.safeParse({ ok: false, issues: [issue] }).success,
    ).toBe(true);
    const run = {
      runId: 'r1',
      graph,
      nodes: [
        { nodeId: 'frontend', state: 'active', agentRunIds: ['a1'], approvalMode: 'auto-edits' },
        { nodeId: 'review', state: 'waiting', agentRunIds: [] },
      ],
    };
    expect(RunWorkflowGraphDtoSchema.parse(run).nodes).toHaveLength(2);
  });

  it('keeps skill summaries from before ADR-0023 valid', () => {
    const skill = {
      name: 'react',
      description: '',
      path: '.claude/skills/react/SKILL.md',
      usedBy: ['helpers'],
      sizeBytes: 1,
      lastCommittedAt: null,
      uncommitted: false,
      problems: [],
    };
    expect(SkillSummaryDtoSchema.safeParse(skill).success).toBe(true);
    const withNodes = { ...skill, usedByNodes: [{ nodeId: 'frontend', label: 'Frontend helper' }] };
    expect(SkillSummaryDtoSchema.parse(withNodes).usedByNodes).toHaveLength(1);
  });
});

describe('plan steps keep their helper node (ADR-0023 §7)', () => {
  it('stores an optional helper node id and still parses older steps', () => {
    const step = { title: 'Page', role: 'Frontend helper', detail: '' };
    expect(PlanStepSchema.parse(step)).toEqual(step);
    expect(PlanStepSchema.parse({ ...step, helper: 'frontend' }).helper).toBe('frontend');
    expect(PlanStepSchema.safeParse({ ...step, helper: 'Frontend' }).success).toBe(false);
  });
});
