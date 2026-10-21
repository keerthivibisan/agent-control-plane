import { MAX_REWORK_ROUNDS } from '../workflow.js';
import type { RunOptions } from '../workspace.js';
import type { WorkflowGraph } from '../workflow-graph.js';

/** The review part of a project's run options; the approval mode comes from its setup. */
export type GraphRunDefaults = Pick<RunOptions, 'reviewer' | 'maxReworkRounds'>;

/**
 * What a project's graph amounts to as run options (ADR-0023; WG-F): the reviewer is `agent` when
 * the graph has a change reviewer, else `lead`, and the rework rounds are the most any `rework`
 * edge allows, capped at `MAX_REWORK_ROUNDS`. The server's run start fills "from the project"
 * with this, and the web's "Project default" shows it, so the two cannot disagree.
 *
 * It reads the graph only, never `legacyV1`: the editor keeps `legacyV1` after a template or an
 * edit (for "Restore my earlier setup"), so it can describe a different workflow than the graph.
 * For a graph migrated from version 1 (`migrateWorkflowV1`, which the server serves for `stored`
 * `v1` and `default`), the answer equals `reviewStageOf(v1)`: the change reviewer is there exactly
 * when version 1's reviewer is an agent, and every rework edge carries its rounds.
 */
export function graphRunDefaults(graph: Pick<WorkflowGraph, 'nodes' | 'edges'>): GraphRunDefaults {
  const changeReviewer = graph.nodes.some((n) => n.type === 'reviewer' && n.scope === 'change');
  const rounds = graph.edges.reduce(
    (max, e) => (e.type === 'rework' ? Math.max(max, e.maxRounds) : max),
    0,
  );
  return {
    reviewer: changeReviewer ? 'agent' : 'lead',
    maxReworkRounds: Math.min(rounds, MAX_REWORK_ROUNDS),
  };
}
