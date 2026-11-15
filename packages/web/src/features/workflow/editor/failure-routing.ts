import {
  FAILURE_SOURCE_EVENTS,
  type FailureEvent,
  type FailureSourceKind,
  type WorkflowEdgeV3,
  type WorkflowGraphV3,
  type WorkflowNodeId,
} from '@acp/core';
import { blockKind } from './roles';

type WorkflowGraph = WorkflowGraphV3;

/**
 * Failure routing in the editor (ADR-0038 §4): which events a block raises, read with the editor's
 * block kinds so it agrees with core's `failureSourceKind` (a tester; a Checks block; a change
 * reviewer; the ticket merge). Whether a When arrow may exist is still core's `canConnectV3`, and
 * whether its events are right is core's validator; this only picks what the panel offers.
 */

/** The kind of failure source block `id` is, or undefined when it raises no failure event. */
export function failureSourceOf(
  graph: WorkflowGraph,
  id: WorkflowNodeId,
): FailureSourceKind | undefined {
  const node = graph.nodes.find((n) => n.id === id);
  if (node === undefined) return undefined;
  if (node.type === 'checks') return 'checks';
  if (node.type === 'ticket-merge') return 'ticket-merge';
  const kind = blockKind(graph, node);
  if (kind === 'tester') return 'tester';
  if (kind === 'reviewer-change') return 'change-reviewer';
  return undefined;
}

/** The events block `id` raises, in core's order (none for a block that raises none). */
export function sourceEvents(graph: WorkflowGraph, id: WorkflowNodeId): readonly FailureEvent[] {
  const kind = failureSourceOf(graph, id);
  return kind === undefined ? [] : FAILURE_SOURCE_EVENTS[kind];
}

/**
 * The events a new When arrow from `from` starts with: the source's events no other When arrow
 * from it routes yet, else all of them (the problems list then names the second route).
 */
export function newWhenEvents(graph: WorkflowGraph, from: WorkflowNodeId): FailureEvent[] {
  const all = sourceEvents(graph, from);
  const routed = new Set(
    graph.edges.flatMap((e) => (e.type === 'when' && e.from === from ? e.on : [])),
  );
  const free = all.filter((e) => !routed.has(e));
  const events = free.length > 0 ? free : all;
  // A block that raises nothing never gets a When arrow (core refuses it); keep the schema's one.
  return events.length > 0 ? [...events] : ['tests-failed'];
}

/** A When arrow's events after the owner ticks or unticks one; never empty, in core's order. */
export function toggledEvents(
  edge: Extract<WorkflowEdgeV3, { type: 'when' }>,
  event: FailureEvent,
  on: boolean,
  order: readonly FailureEvent[],
): FailureEvent[] {
  const next = new Set(edge.on);
  if (on) next.add(event);
  else next.delete(event);
  if (next.size === 0) return [...edge.on];
  // The source's own events first, in core's order, then any foreign ones the owner still has.
  return [
    ...order.filter((e) => next.has(e)),
    ...edge.on.filter((e) => next.has(e) && !order.includes(e)),
  ];
}
