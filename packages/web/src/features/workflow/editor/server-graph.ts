import {
  deriveRoles,
  downgradeWorkflowV3,
  migrateWorkflowV2,
  type WorkflowGraph,
  type WorkflowGraphV3,
} from '@acp/core';
import type { V3OnlyPart } from './copy';

/**
 * The one place the editor meets the server's graph version (ADR-0037, AR-5a). The editor works on
 * version 3; until the API takes version 3 (AR-4), the graph comes in as version 2 and goes out as
 * version 2. AR-4 replaces this module: `fromServer` and `toServer` become the identity and
 * `canSaveToServer` always says yes.
 */

/** The graph the server sent, as the editor's version 3 graph (lossless, core's migration). */
export function fromServerGraph(graph: WorkflowGraph): WorkflowGraphV3 {
  return migrateWorkflowV2(graph);
}

/**
 * The parts of `graph` version 2 cannot say, in a fixed order: research or custom arrows, two or
 * more planners, a change sent to more than one reviewer, and arrow labels or purposes.
 */
export function v3OnlyParts(graph: WorkflowGraphV3): V3OnlyPart[] {
  const out: V3OnlyPart[] = [];
  if (graph.edges.some((e) => e.type === 'research')) out.push('research');
  if (graph.edges.some((e) => e.type === 'custom')) out.push('custom');
  const roles = deriveRoles(graph);
  const planners = [...roles.values()].filter((r) => r.ok && r.role.role === 'planner').length;
  if (planners > 1) out.push('planners');
  const reviews = graph.edges.filter((e) => e.type === 'review').map((e) => e.from);
  if (new Set(reviews).size < reviews.length) out.push('fan-out');
  if (graph.edges.some((e) => e.label !== undefined || e.purpose !== undefined)) out.push('words');
  return out;
}

export type SaveCheck = { ok: true } | { ok: false; parts: V3OnlyPart[] };

/**
 * Whether the server can store `graph` now. A graph whose agents lack a single role is refused by
 * the validator first (those are problems to fix), so a refusal here names only version 3 parts.
 */
export function canSaveToServer(graph: WorkflowGraphV3): SaveCheck {
  const parts = v3OnlyParts(graph);
  return parts.length === 0 ? { ok: true } : { ok: false, parts };
}

/** The graph as the server takes it now (version 2), or null when version 2 cannot say it. */
export function toServerGraph(graph: WorkflowGraphV3): WorkflowGraph | null {
  const down = downgradeWorkflowV3(graph);
  return down.ok ? down.graph : null;
}

/**
 * The graph as it comes back after a save: sent as version 2 and migrated again, so fields a role
 * doesn't keep (a helper's description on a block rewired as a reviewer) are gone. The page compares
 * graphs in this form, so a saved graph is not "Unsaved changes" when the refetch brings it back.
 */
export function serverForm(graph: WorkflowGraphV3): WorkflowGraphV3 {
  const down = toServerGraph(graph);
  return down === null ? graph : fromServerGraph(down);
}
