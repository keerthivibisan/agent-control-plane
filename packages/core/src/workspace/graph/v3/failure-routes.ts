import type { FailureEvent } from '../../../orchestration/failure-context.js';
import type {
  FailureRouteTarget,
  ProgramFailureRoute,
  WorkflowEdgeV3,
  WorkflowNodeId,
  WorkflowNodeV3,
} from '../../workflow-graph.js';
import { checkBlockOf, isCheckBlockAt } from '../check-blocks.js';
import { edgesOfTypeV3, isChangeReviewerV3, isClaim, type NodeIndexV3 } from './graph-index.js';

/**
 * Failure routing in the graph (ADR-0038 §4). Pure; the validator, the compiler and
 * `describeWorkflow` share it, so the rules, the program and the words agree.
 *
 * - Which block raises which events: a tester `tests-failed`; a Checks block `checks-failed` and
 *   `harness-failed` (a tester's own change checks are a Checks block it flows into, so they are
 *   that block's events); a change reviewer `review-rework`; the ticket merge `merge-conflict`.
 * - Who may fix: a helper (named or the pool), the Lead, or the Author block. A When arrow never
 *   gives a role, so its target must already be one of these.
 * - Today's settings read as routes (`derived`): a change reviewer's `rework` arrows and a change
 *   Checks block's `onFailure: 'helper'` send the failure back to the change's author.
 *   `onFailure: 'lead'` is the default (no route; a When arrow may route it); `'owner'` is a block
 *   setting that wins: no When arrow may route that block's failures.
 */

/** The blocks that raise failure events. */
export type FailureSourceKind = 'tester' | 'checks' | 'change-reviewer' | 'ticket-merge';

export const FAILURE_SOURCE_EVENTS: Readonly<Record<FailureSourceKind, readonly FailureEvent[]>> =
  Object.freeze({
    tester: ['tests-failed'],
    checks: ['checks-failed', 'harness-failed'],
    'change-reviewer': ['review-rework'],
    'ticket-merge': ['merge-conflict'],
  });

/** What the owner and the lead read for each event, after "When" ("When tests fail at …"). */
export const FAILURE_EVENT_NAMES: Readonly<Record<FailureEvent, string>> = Object.freeze({
  'tests-failed': 'tests fail',
  'checks-failed': 'checks fail',
  'review-rework': 'a reviewer asks for rework',
  'harness-failed': 'the harness cannot run',
  'merge-conflict': 'a merge conflicts',
});

export const FAILURE_SOURCE_NAMES: Readonly<Record<FailureSourceKind, string>> = Object.freeze({
  tester: 'a tester',
  checks: 'a Checks block',
  'change-reviewer': 'a change reviewer',
  'ticket-merge': 'the ticket merge',
});

/** The kind of failure source `node` is, or undefined when it raises no failure event. */
export function failureSourceKind(
  index: NodeIndexV3,
  node: WorkflowNodeV3,
): FailureSourceKind | undefined {
  if (node.type === 'checks') return 'checks';
  if (node.type === 'ticket-merge') return 'ticket-merge';
  if (isClaim(index, node, 'tester')) return 'tester';
  if (isChangeReviewerV3(index, node)) return 'change-reviewer';
  return undefined;
}

/** A helper, the Lead or the Author block: what a When arrow may point to. */
export function isWhenTarget(index: NodeIndexV3, node: WorkflowNodeV3): boolean {
  return node.type === 'lead' || node.type === 'author' || isClaim(index, node, 'worker');
}

function targetOf(node: WorkflowNodeV3 | undefined, id: WorkflowNodeId): FailureRouteTarget {
  if (node?.type === 'lead') return { kind: 'lead' };
  if (node?.type === 'author') return { kind: 'author' };
  return { kind: 'node', nodeId: id };
}

/** The When arrows among `edges` as routes, in graph order (their ends must exist). */
export function whenFailureRoutes(
  index: NodeIndexV3,
  edges: readonly WorkflowEdgeV3[],
): ProgramFailureRoute[] {
  return edgesOfTypeV3(edges, 'when').flatMap((e): ProgramFailureRoute[] => {
    if (!index.byId.has(e.from) || !index.byId.has(e.to)) return [];
    return [
      {
        sourceNodeId: e.from,
        events: [...e.on],
        target: targetOf(index.byId.get(e.to), e.to),
        maxRounds: e.maxRounds,
        ...(e.label !== undefined ? { label: e.label } : {}),
        ...(e.purpose !== undefined ? { purpose: e.purpose } : {}),
        edgeId: e.id,
      },
    ];
  });
}

export interface DerivedRouteOptions {
  /** The run's reviewer: `lead` sends every change to the lead, so no reviewer reworks one. */
  reviewer?: 'agent' | 'lead';
  /** The run's rework rounds: replaces a rework arrow's rounds, as in the review route. */
  maxReworkRounds?: number;
}

/**
 * Today's settings as routes, flagged `derived` (see the module comment), for every helper and
 * tester in graph order: first its reviewers' rework (the `direct` review route: every change
 * reviewer of the change has a rework arrow back, with the smallest of their rounds, as
 * `ReviewRoute.reviewerRounds`), then its change block's "back to the helper" (the block's rework
 * arrow's rounds, never replaced by the run's).
 */
export function derivedFailureRoutes(
  index: NodeIndexV3,
  edges: readonly WorkflowEdgeV3[],
  opts: DerivedRouteOptions = {},
): ProgramFailureRoute[] {
  const out: ProgramFailureRoute[] = [];
  const reworks = edgesOfTypeV3(edges, 'rework');
  const reworkOf = (from: WorkflowNodeId, to: WorkflowNodeId) =>
    reworks.find((e) => e.from === from && e.to === to);
  for (const editor of index.unique) {
    if (!isClaim(index, editor, 'worker') && !isClaim(index, editor, 'tester')) continue;
    if (opts.reviewer !== 'lead') {
      const targets = edges
        .filter((e) => e.type === 'review' && e.from === editor.id)
        .map((e) => index.byId.get(e.to));
      const reviewers = targets.filter(
        (t): t is WorkflowNodeV3 => t !== undefined && isChangeReviewerV3(index, t),
      );
      const rounds = reviewers.map((r) => reworkOf(r.id, editor.id)?.maxRounds);
      if (
        reviewers.length > 0 &&
        reviewers.length === targets.length &&
        rounds.every((r) => r !== undefined)
      ) {
        const min = Math.min(...rounds.map((r) => opts.maxReworkRounds ?? r ?? 0));
        for (const reviewer of reviewers) {
          out.push({
            sourceNodeId: reviewer.id,
            events: ['review-rework'],
            target: { kind: 'author' },
            maxRounds: min,
            derived: true,
            editorNodeId: editor.id,
          });
        }
      }
    }
    const into = edges.find((e) => {
      if (e.type !== 'flow' || e.from !== editor.id) return false;
      const to = index.byId.get(e.to);
      return to !== undefined && isCheckBlockAt(to, 'change');
    });
    const block = into === undefined ? undefined : index.byId.get(into.to);
    if (block?.type !== 'checks' || checkBlockOf(block).onFailure !== 'helper') continue;
    const rework = reworkOf(block.id, editor.id);
    if (rework === undefined) continue;
    out.push({
      sourceNodeId: block.id,
      events: ['checks-failed', 'harness-failed'],
      target: { kind: 'author' },
      maxRounds: rework.maxRounds,
      derived: true,
      editorNodeId: editor.id,
    });
  }
  return out;
}
