import { migrateWorkflowV2 } from '@acp/core';
import type { AgentNode, WorkflowEdgeV3, WorkflowGraphV3 } from '@acp/core';
import { createRun, programOf } from '../src/index.js';
import type { EngineResult, RunState } from '../src/index.js';
import { graphContext, testGraph } from './graph-helpers.js';
import type { GraphOptions, GraphRunOptions } from './graph-helpers.js';
import { LEAD, PROJECT, REGISTERED, RUN, TICKET, makeCtx } from './helpers.js';
import { KEY } from './loop-helpers.js';

/** Version 3 workflow graphs for the AR-3 engine tests (ADR-0037). Synthetic data only. */

export interface Arrow {
  from: string;
  to: string;
  label?: string;
  purpose?: string;
}

export interface V3Options extends GraphOptions {
  /** More planners after the template's (`planner: true` gives the first, `plan`). */
  planners?: readonly { id: string; label: string }[];
  /** Researcher agents, each with its research arrows. */
  researchers?: readonly { id: string; label: string; to: readonly Omit<Arrow, 'from'>[] }[];
  /** Custom arrows. */
  custom?: readonly Arrow[];
  /** More change reviewers of the Frontend helper (a fan-out), with their own rework arrow on route "direct". */
  fanOut?: readonly { id: string; label: string; rounds?: number }[];
}

function agent(id: string, label: string): AgentNode {
  return { type: 'agent', id, label, model: null, skills: [], agent: null };
}

function notes(a: { label?: string; purpose?: string }) {
  return {
    ...(a.label !== undefined ? { label: a.label } : {}),
    ...(a.purpose !== undefined ? { purpose: a.purpose } : {}),
  };
}

/** `testGraph` migrated to version 3, plus researchers, planners, custom arrows and a fan-out. */
export function v3Graph(o: V3Options = {}): WorkflowGraphV3 {
  const base = migrateWorkflowV2(testGraph(o));
  const nodes = [...base.nodes];
  const edges: WorkflowEdgeV3[] = [...base.edges];
  for (const p of o.planners ?? []) {
    nodes.push(agent(p.id, p.label));
    edges.push({ type: 'flow', id: `flow-ticket-${p.id}`, from: 'ticket', to: p.id });
    edges.push({ type: 'plan', id: `plan-${p.id}`, from: p.id, to: 'plan-approval' });
  }
  for (const r of o.researchers ?? []) {
    nodes.push(agent(r.id, r.label));
    for (const t of r.to) {
      edges.push({
        type: 'research',
        id: `research-${r.id}-${t.to}`,
        from: r.id,
        to: t.to,
        ...notes(t),
      });
    }
  }
  for (const f of o.fanOut ?? []) {
    nodes.push(agent(f.id, f.label));
    edges.push({ type: 'review', id: `review-frontend-${f.id}`, from: 'frontend', to: f.id });
    edges.push({ type: 'findings', id: `findings-${f.id}`, from: f.id, to: 'orchestrate' });
    if (o.route === 'direct') {
      edges.push({
        type: 'rework',
        id: `rework-${f.id}-frontend`,
        from: f.id,
        to: 'frontend',
        maxRounds: f.rounds ?? 2,
      });
    }
  }
  for (const c of o.custom ?? []) {
    edges.push({
      type: 'custom',
      id: `custom-${c.from}-${c.to}`,
      from: c.from,
      to: c.to,
      ...notes(c),
    });
  }
  return { ...base, template: 'custom', nodes, edges };
}

/** A loop ticket run following a version 3 graph (PLANNING). */
export function createV3Run(
  graph: WorkflowGraphV3,
  o: GraphRunOptions = {},
): EngineResult<RunState> {
  const context = graphContext(o);
  const program = programOf({ graph, graphContext: context });
  const planner = program.planners.length > 0;
  return createRun(
    {
      runId: RUN,
      leadAgentRunId: LEAD,
      projectId: PROJECT,
      title: 'WEB-12 Dark mode',
      budget: { maxTokensPerAgent: o.budget ?? 1000, softCostUsdPerRun: null },
      limits: o.limits ?? { maxConcurrentHelpers: 3, maxDepth: 1 },
      ticket: {
        ticketId: TICKET,
        leadPrompt: planner ? 'Lead brief for WEB-12' : 'Ticket WEB-12: plan first',
        ...(planner ? { plannerPrompt: 'Plan ticket WEB-12' } : {}),
        researcherPrompt: 'Ticket WEB-12: dark mode',
      },
      ...(o.legacy === true
        ? {}
        : { reviewLoop: { ticketKey: KEY, reviewer: o.reviewer ?? 'agent', maxReworkRounds: 2 } }),
      ...(o.approvals !== undefined ? { approvals: o.approvals } : {}),
      graph,
      graphContext: context,
      registeredProjectIds: REGISTERED,
    },
    makeCtx(),
  );
}
