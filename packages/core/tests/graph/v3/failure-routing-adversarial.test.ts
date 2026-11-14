// Failure routing, adversarial (FR-7, ADR-0038 §4; docs/testing/adversarial.md, "Failure
// routing", F-1). A When arrow never gives a role or edit rights: aimed at a read-only agent
// (planner, researcher, change or final reviewer, tester) or a block without a role, it is
// refused and the compiler will not run the graph; aimed at a helper, every block keeps the role
// and approval mode it had without the arrow. Synthetic data only.
import { describe, expect, it } from 'vitest';
import {
  WorkflowGraphInvalidError,
  compileWorkflow,
  deriveRoles,
  type FailureEvent,
  type WorkflowEdgeV3,
  type WorkflowGraphV3,
  type WorkflowNodeV3,
} from '../../../src/index.js';
import { CTX, agent, codesV3, finalsV3, researchedPlan, withArrows, withNodes } from './helpers.js';

function when(from: string, to: string, on: FailureEvent[]): WorkflowEdgeV3 {
  return { type: 'when', id: `when-${from}-${to}`.slice(0, 40), from, to, on, maxRounds: 5 };
}

const AUTHOR: WorkflowNodeV3 = { type: 'author', id: 'author', label: 'Author' };

/** Pool, change reviewer `review`, Checks `checks`, final reviewer `code-review`, tester `unit-tests`. */
function finals(...edges: WorkflowEdgeV3[]): WorkflowGraphV3 {
  return withArrows(finalsV3(), ...edges);
}

/** A planner `plan` fed by two researchers, plus the finals' sources. */
function planned(...edges: WorkflowEdgeV3[]): WorkflowGraphV3 {
  return withArrows(researchedPlan(), ...edges);
}

function roles(graph: WorkflowGraphV3): Record<string, unknown> {
  return Object.fromEntries(deriveRoles(graph));
}

describe('F-1: a When arrow gives no role and no edit rights', () => {
  const readOnly: [string, () => WorkflowGraphV3][] = [
    ['the change reviewer', () => finals(when('unit-tests', 'review', ['tests-failed']))],
    ['the final reviewer', () => finals(when('checks', 'code-review', ['checks-failed']))],
    ['the tester itself', () => finals(when('unit-tests', 'unit-tests', ['tests-failed']))],
    [
      'the tester, from the merge',
      () => finals(when('ticket-merge', 'unit-tests', ['merge-conflict'])),
    ],
    ['the planner', () => planned(when('ticket-merge', 'plan', ['merge-conflict']))],
    ['a researcher', () => planned(when('ticket-merge', 'research-claude', ['merge-conflict']))],
    [
      'a block with no other arrow',
      () => withNodes(finals(when('ticket-merge', 'idle', ['merge-conflict'])), agent('idle')),
    ],
  ];

  it.each(readOnly)('refuses a When arrow into %s; the compiler will not run it', (_n, build) => {
    const graph = build();
    // The tester into itself is also an arrow to itself (`self-edge`).
    expect(
      codesV3(graph).filter((c) => c === 'when-target-invalid' || c === 'self-edge'),
    ).not.toEqual([]);
    expect(() => compileWorkflow(graph, CTX)).toThrow(WorkflowGraphInvalidError);
  });

  it('the derived roles are the same with and without the refused arrow', () => {
    for (const [, build] of readOnly.slice(0, 6)) {
      const graph = build();
      const without = { ...graph, edges: graph.edges.filter((e) => e.type !== 'when') };
      expect(roles(graph)).toEqual(roles(without));
    }
  });

  it('into a helper or Author: same roles, kinds and approval modes as without the arrow', () => {
    const base = withNodes(finalsV3(), AUTHOR);
    const graph = withArrows(
      base,
      when('unit-tests', 'helpers', ['tests-failed']),
      when('checks', 'author', ['checks-failed', 'harness-failed']),
      when('review', 'orchestrate', ['review-rework']),
    );
    expect(codesV3(graph)).toEqual([]);
    const a = compileWorkflow(graph, { ...CTX, projectMode: 'full-auto' });
    // The Author block alone is unreachable; give it its old arrow-less graph without it.
    const b = compileWorkflow(finalsV3(), { ...CTX, projectMode: 'full-auto' });
    const { failureRoutes: _a, ...restA } = a;
    const { failureRoutes: _b, ...restB } = b;
    expect(restA).toEqual(restB);
    expect(roles(graph)).toEqual({ ...roles(finalsV3()), author: roles(graph)['author'] });
  });
});
