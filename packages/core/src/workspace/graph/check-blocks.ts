import {
  CHECK_FAILURE_ROUTES,
  type CheckBlockPlace,
  type CheckFailureRoute,
  type CheckSelection,
  type WorkflowNode,
  type WorkflowNodeOf,
} from '../workflow-graph.js';

/**
 * A Checks block's settings with the defaults filled in (ADR-0027 §5). A `checks` node saved
 * before ADR-0027 has none of the fields: it is the block before the lead's merge that runs every
 * required check and lets the lead decide, so old graphs keep today's behaviour.
 */
export interface CheckBlockConfig {
  place: CheckBlockPlace;
  select: CheckSelection;
  onFailure: CheckFailureRoute;
}

/**
 * The node's block settings: place `merge`, selection `required`, and the place's first (default)
 * failure route when a field is absent. The failure route is returned as stored even when the
 * place does not allow it; `validateWorkflowGraph` refuses that (`check-failure-route`).
 */
export function checkBlockOf(node: WorkflowNodeOf<'checks'>): CheckBlockConfig {
  const place = node.place ?? 'merge';
  return {
    place,
    select: node.select ?? { kind: 'required' },
    onFailure: node.onFailure ?? defaultFailureRoute(place),
  };
}

/** The failure route a block at `place` gets when it names none: the lead where it can decide. */
export function defaultFailureRoute(place: CheckBlockPlace): CheckFailureRoute {
  return CHECK_FAILURE_ROUTES[place][0] ?? 'owner';
}

/** A copy that shares no arrays with the graph, so a program never aliases its input. */
export function copySelection(select: CheckSelection): CheckSelection {
  switch (select.kind) {
    case 'required':
      return { kind: 'required' };
    case 'ids':
      return { kind: 'ids', ids: [...select.ids] };
    case 'labels':
      return { kind: 'labels', labels: [...select.labels] };
  }
}

/** True when the node is a Checks block at `place` (a `checks` node without one is at `merge`). */
export function isCheckBlockAt(node: WorkflowNode, place: CheckBlockPlace): boolean {
  return node.type === 'checks' && (node.place ?? 'merge') === place;
}

/** What the owner calls each place in messages. */
export const CHECK_PLACE_NAMES: Readonly<Record<CheckBlockPlace, string>> = Object.freeze({
  change: 'on a helper’s change',
  merge: 'before the Lead’s merge',
  branch: 'on the ticket branch',
});

/** What the owner calls each failure route in messages. */
export const CHECK_FAILURE_ROUTE_NAMES: Readonly<Record<CheckFailureRoute, string>> = Object.freeze(
  {
    lead: 'the Lead decides',
    owner: 'ask me',
    helper: 'back to the helper',
  },
);
