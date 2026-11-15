import { describe, expect, it } from 'vitest';
import type { FailureEvent, WorkflowEdgeV3, WorkflowGraphV3 } from '@acp/core';
import { ValidateWorkflowGraphResultDtoSchema, WorkflowGraphDtoSchema } from '@acp/core/api';
import { agentV3, arrowV3, putGraph, templateV3, withV3 } from '../board/graph-helpers.js';
import { setupBoard } from '../board/helpers.js';
import type { Board } from '../board/loop-helpers.js';

/*
 * Failure routing, adversarial (FR-7, ADR-0038 §4; docs/testing/adversarial.md, "Failure
 * routing", F-1). Through `PUT …/workflow-graph`: a When arrow aimed at a read-only agent (a
 * planner, a researcher, a change reviewer, a tester) or the lead's own source is refused with
 * 422 and the stored graph is unchanged; a When arrow into a helper is stored. Synthetic data only.
 */

const graphPath = (s: Board) => `/api/projects/${s.project.id}/workflow-graph`;

function when(from: string, to: string, on: FailureEvent[]): WorkflowEdgeV3 {
  return { type: 'when', id: `when-${from}-${to}`.slice(0, 40), from, to, on, maxRounds: 2 };
}

/** A researcher for the planner, the pool reviewed by `review`, and a tester `qa` after the merge. */
function example(): WorkflowGraphV3 {
  const base = templateV3('lead-only', true);
  const g: WorkflowGraphV3 = {
    ...base,
    edges: base.edges.filter(
      (e) =>
        !(e.type === 'review' && e.to === 'orchestrate') &&
        !(e.type === 'flow' && e.from === 'ticket-merge'),
    ),
  };
  return withV3(
    g,
    [agentV3('scout', 'Scout'), agentV3('review', 'Review'), agentV3('qa', 'QA')],
    [
      arrowV3('research', 'scout', 'plan'),
      arrowV3('review', 'helpers', 'review'),
      arrowV3('findings', 'review', 'orchestrate'),
      arrowV3('test', 'ticket-merge', 'qa'),
      arrowV3('flow', 'qa', 'owner-merge'),
      arrowV3('review', 'qa', 'orchestrate'),
    ],
  );
}

describe('F-1: When arrows at PUT …/workflow-graph', () => {
  const refused: [string, WorkflowEdgeV3][] = [
    ['into the planner', when('ticket-merge', 'plan', ['merge-conflict'])],
    ['into a researcher', when('ticket-merge', 'scout', ['merge-conflict'])],
    ['into the change reviewer', when('qa', 'review', ['tests-failed'])],
    ['into the tester', when('review', 'qa', ['review-rework'])],
    ['from a helper (no failure source)', when('helpers', 'orchestrate', ['tests-failed'])],
    ['an event its source never raises', when('qa', 'helpers', ['merge-conflict'])],
  ];

  it.each(refused)('%s: 422, the stored graph unchanged', async (_name, arrow) => {
    const s = await setupBoard();
    const kept = await putGraph(s, example());
    const graph = withV3(example(), [], [arrow]);
    const res = await s.send('put', graphPath(s), { graph });
    expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBe(422);
    expect((res.body as { error: { code: string } }).error.code).toBe('workflow_invalid');
    const check = ValidateWorkflowGraphResultDtoSchema.parse(
      (await s.post(`${graphPath(s)}/validate`, { graph })).body,
    );
    expect(check.ok).toBe(false);
    expect(WorkflowGraphDtoSchema.parse((await s.get(graphPath(s))).body).graph).toEqual(
      kept.graph,
    );
  });

  it('a When arrow into a helper or the lead is stored', async () => {
    const s = await setupBoard();
    const graph = withV3(
      example(),
      [],
      [when('qa', 'helpers', ['tests-failed']), when('review', 'orchestrate', ['review-rework'])],
    );
    const stored = await putGraph(s, graph);
    expect(stored.graph.edges.filter((e) => e.type === 'when')).toHaveLength(2);
  });
});
