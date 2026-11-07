// Contract tests for the managed provider per agent block and per project (ADR-0031, CX-2).
// Additive: graphs, setups and agent runs saved before it still parse, and read as Claude Code.
// Synthetic data only.
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MANAGED_PROVIDER,
  MANAGED_PROVIDERS,
  ManagedProviderIdSchema,
  ProjectAgentSetupSchema,
  WorkflowGraphSchema,
  WorkflowNodeSchema,
  compileWorkflow,
  modelMatchesProvider,
  validateWorkflowGraph,
  workflowTemplate,
  type CompileContext,
  type WorkflowGraph,
  type WorkflowNode,
} from '../src/index.js';
import { AgentRunDtoSchema, UpdateProjectSetupRequestSchema } from '../src/api/index.js';

const T = '2026-11-07T09:00:00.000Z';

const lead = {
  type: 'lead',
  id: 'orchestrate',
  label: 'Lead',
  model: null,
  skills: [],
  agent: null,
};

const ctx: CompileContext = {
  projectMode: 'auto-edits',
  approvalCeilings: [],
  maxConcurrentHelpers: 3,
};

function withLead(graph: WorkflowGraph, change: Partial<WorkflowNode>): WorkflowGraph {
  return {
    ...graph,
    nodes: graph.nodes.map((n) => (n.type === 'lead' ? ({ ...n, ...change } as WorkflowNode) : n)),
  };
}

function mismatches(graph: WorkflowGraph, projectProvider?: 'claude-code' | 'codex') {
  return validateWorkflowGraph(graph, projectProvider === undefined ? {} : { projectProvider })
    .filter((i) => i.code === 'model-provider-mismatch')
    .map((i) => ({ severity: i.severity, nodeId: i.nodeId }));
}

describe('managed providers', () => {
  it('are Claude Code and Codex, Claude Code by default; demo never runs managed agents', () => {
    expect(MANAGED_PROVIDERS).toEqual(['claude-code', 'codex']);
    expect(DEFAULT_MANAGED_PROVIDER).toBe('claude-code');
    expect(ManagedProviderIdSchema.safeParse('demo').success).toBe(false);
  });
});

describe('provider per agent block', () => {
  it('keeps older blocks and reads a chosen provider', () => {
    expect(WorkflowNodeSchema.parse(lead)).not.toHaveProperty('provider');
    expect(WorkflowNodeSchema.parse({ ...lead, provider: 'codex' })).toMatchObject({
      provider: 'codex',
    });
    expect(WorkflowNodeSchema.safeParse({ ...lead, provider: 'demo' }).success).toBe(false);
  });

  it('round-trips a whole graph with and without providers', () => {
    const graph = workflowTemplate('lead-only', { planner: true });
    expect(WorkflowGraphSchema.parse(graph)).toEqual(graph);
    const mixed = withLead(graph, { provider: 'codex' });
    expect(WorkflowGraphSchema.parse(JSON.parse(JSON.stringify(mixed)))).toEqual(mixed);
  });

  it('compiles the node provider, else the project provider, else none', () => {
    const graph = workflowTemplate('lead-only', { planner: true });
    const plain = compileWorkflow(graph, ctx);
    expect(plain.lead).not.toHaveProperty('provider');
    expect(plain.planner).not.toHaveProperty('provider');

    const codexLead = compileWorkflow(withLead(graph, { provider: 'codex' }), ctx);
    expect(codexLead.lead.provider).toBe('codex');
    expect(codexLead.planner).not.toHaveProperty('provider');

    const projectCodex = compileWorkflow(withLead(graph, { provider: 'claude-code' }), {
      ...ctx,
      projectProvider: 'codex',
    });
    expect(projectCodex.lead.provider).toBe('claude-code');
    expect(projectCodex.planner?.provider).toBe('codex');
  });
});

describe('modelMatchesProvider', () => {
  it('knows Claude aliases and claude- ids', () => {
    for (const model of ['sonnet', 'opus', 'haiku', 'inherit', 'claude-sonnet-4-5', ' Opus ']) {
      expect(modelMatchesProvider(model, 'claude-code'), model).toBe(true);
      expect(modelMatchesProvider(model, 'codex'), model).toBe(false);
    }
  });

  it('knows gpt-, o3, o4 and codex ids', () => {
    for (const model of ['gpt-5-codex', 'o3', 'o4-mini', 'codex-mini-latest', 'GPT-5']) {
      expect(modelMatchesProvider(model, 'codex'), model).toBe(true);
      expect(modelMatchesProvider(model, 'claude-code'), model).toBe(false);
    }
  });

  it('is null for a name it cannot place', () => {
    for (const model of ['my-custom-model', 'llama-3', 'sonnet-ish']) {
      expect(modelMatchesProvider(model, 'claude-code'), model).toBeNull();
      expect(modelMatchesProvider(model, 'codex'), model).toBeNull();
    }
  });
});

describe('model-provider-mismatch warning', () => {
  const graph = workflowTemplate('lead-only');
  const leadId = graph.nodes.find((n) => n.type === 'lead')?.id;

  it('warns, never refuses, when a Codex block names a Claude model', () => {
    const issues = validateWorkflowGraph(withLead(graph, { provider: 'codex', model: 'sonnet' }));
    const warning = issues.find((i) => i.code === 'model-provider-mismatch');
    expect(warning).toMatchObject({ severity: 'warning', nodeId: leadId });
    expect(warning?.message).toContain('runs on Codex');
    expect(warning?.message).toContain('"sonnet"');
    expect(issues.every((i) => i.severity === 'warning')).toBe(true);
  });

  it('uses the project provider for a block without one, else Claude Code', () => {
    const gpt = withLead(graph, { model: 'gpt-5-codex' });
    expect(mismatches(gpt)).toEqual([{ severity: 'warning', nodeId: leadId }]);
    expect(mismatches(gpt, 'claude-code')).toEqual([{ severity: 'warning', nodeId: leadId }]);
    expect(mismatches(gpt, 'codex')).toEqual([]);
  });

  it('stays quiet for matching, unknown and absent models', () => {
    expect(mismatches(withLead(graph, { model: 'opus' }))).toEqual([]);
    expect(mismatches(withLead(graph, { provider: 'codex', model: 'o3' }))).toEqual([]);
    expect(mismatches(withLead(graph, { provider: 'codex', model: 'custom-1' }))).toEqual([]);
    expect(mismatches(withLead(graph, { provider: 'codex', model: null }))).toEqual([]);
  });
});

describe('project default provider', () => {
  const setup = {
    projectId: 'p1',
    projectKey: 'WEB',
    planFirst: true,
    maxConcurrentHelpers: 3,
    maxDepth: 1,
    defaultBudgetTokensPerAgent: 500_000,
    model: null,
    allowlist: { editInOwnWorktree: true, runHarnessChecks: true },
    contextFiles: [],
    updatedAt: T,
  };

  it('round-trips with and without a provider', () => {
    expect(ProjectAgentSetupSchema.parse(setup)).not.toHaveProperty('provider');
    expect(ProjectAgentSetupSchema.parse({ ...setup, provider: 'codex' }).provider).toBe('codex');
    expect(ProjectAgentSetupSchema.safeParse({ ...setup, provider: 'demo' }).success).toBe(false);
  });

  it('is kept, set or removed by the setup request', () => {
    const request = {
      projectKey: 'WEB',
      maxConcurrentHelpers: 3,
      maxDepth: 1,
      defaultBudgetTokensPerAgent: 500_000,
      model: null,
      contextFiles: [],
    };
    expect(UpdateProjectSetupRequestSchema.parse(request)).not.toHaveProperty('provider');
    expect(UpdateProjectSetupRequestSchema.parse({ ...request, provider: 'codex' }).provider).toBe(
      'codex',
    );
    expect(UpdateProjectSetupRequestSchema.parse({ ...request, provider: null }).provider).toBe(
      null,
    );
  });
});

describe('agent run provider', () => {
  const agent = {
    id: 'a1',
    runId: 'r1',
    parentAgentRunId: null,
    kind: 'lead',
    role: 'Lead',
    task: null,
    status: 'RUNNING',
    sessionId: null,
    budget: { used: 0, limit: 10 },
    latestActivity: null,
    review: null,
    branch: null,
    createdAt: T,
    endedAt: null,
  };

  it('is optional on the DTO (servers before ADR-0031) and round-trips when present', () => {
    expect(AgentRunDtoSchema.parse(agent)).not.toHaveProperty('provider');
    expect(AgentRunDtoSchema.parse({ ...agent, provider: 'codex' }).provider).toBe('codex');
  });
});
