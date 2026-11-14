import { MAX_REWORK_ROUNDS } from '../../workflow.js';
import type { WorkflowGraphV3 } from '../../workflow-graph.js';
import type { GraphRunDefaults } from '../run-defaults.js';
import { deriveRoles } from './roles.js';

/**
 * `graphRunDefaults` for a version 3 graph: the reviewer is `agent` when some agent is a change
 * reviewer by its arrows, else `lead`; the rounds are the most any reviewer's or the lead's
 * `rework` arrow allows (a Checks block's are left out), capped at `MAX_REWORK_ROUNDS`. For a
 * migrated valid version 2 graph the answer equals `graphRunDefaults` of the original.
 */
export function graphRunDefaultsV3(
  graph: Pick<WorkflowGraphV3, 'nodes' | 'edges'>,
): GraphRunDefaults {
  const roles = deriveRoles(graph);
  const changeReviewer = [...roles.values()].some(
    (r) => r.ok && r.role.role === 'reviewer' && r.role.scope === 'change',
  );
  const blocks = new Set(graph.nodes.filter((n) => n.type === 'checks').map((n) => n.id));
  const rounds = graph.edges.reduce(
    (max, e) => (e.type === 'rework' && !blocks.has(e.from) ? Math.max(max, e.maxRounds) : max),
    0,
  );
  return {
    reviewer: changeReviewer ? 'agent' : 'lead',
    maxReworkRounds: Math.min(rounds, MAX_REWORK_ROUNDS),
  };
}
