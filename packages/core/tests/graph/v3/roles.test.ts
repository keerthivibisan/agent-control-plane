// deriveRoles, the version 3 contracts and the arrow matrix (ADR-0037 §1, §2; AR-1). Synthetic data.
import { describe, expect, it } from 'vitest';
import {
  MAX_EDGE_LABEL,
  MAX_EDGE_PURPOSE,
  StoredWorkflowJsonSchema,
  WorkflowEdgeV3Schema,
  WorkflowGraphV3Schema,
  canConnectV3,
  deriveRoles,
  type WorkflowGraphV3,
} from '../../../src/index.js';
import {
  agent,
  arrow,
  baseV3,
  researchedPlan,
  withArrows,
  withNodes,
  finalsV3,
} from './helpers.js';
import { containing } from '../helpers.js';

function roleOf(graph: WorkflowGraphV3, id: string) {
  const r = deriveRoles(graph).get(id);
  return r?.ok === true ? r.role : r;
}

describe('deriveRoles: one role from each arrow type', () => {
  it('research out → researcher; plan to Plan approval → planner', () => {
    const g = researchedPlan();
    expect(roleOf(g, 'research-claude')).toEqual({ role: 'researcher' });
    expect(roleOf(g, 'plan')).toEqual({ role: 'planner' });
  });

  it('implement in from the lead → helper, the pool flag kept', () => {
    const g = baseV3();
    expect(roleOf(g, 'helpers')).toEqual({ role: 'worker', pool: true });
    const named = withArrows(
      withNodes(g, agent('fe', 'Frontend helper')),
      arrow('implement', 'orchestrate', 'fe'),
    );
    expect(roleOf(named, 'fe')).toEqual({ role: 'worker', pool: false });
  });

  it('review in → change reviewer; flow in on the final chain → final reviewer', () => {
    const g = baseV3('reviewer-helper-loop');
    expect(roleOf(g, 'review')).toEqual({ role: 'reviewer', scope: 'change' });
    const t = finalsV3();
    expect(roleOf(t, 'code-review')).toEqual({ role: 'reviewer', scope: 'final' });
  });

  it('test in → tester; the lead is the lead; gates have no role', () => {
    const t = finalsV3();
    expect(roleOf(t, 'unit-tests')).toEqual({ role: 'tester' });
    expect(roleOf(t, 'orchestrate')).toEqual({ role: 'lead' });
    expect(deriveRoles(t).has('ticket')).toBe(false);
  });

  it('a custom arrow gives no role, at either end', () => {
    const g = withArrows(withNodes(baseV3(), agent('a'), agent('b')), arrow('custom', 'a', 'b'));
    expect(deriveRoles(g).get('a')).toEqual({ ok: false, code: 'agent-without-role', claims: [] });
    expect(deriveRoles(g).get('b')).toEqual({ ok: false, code: 'agent-without-role', claims: [] });
  });

  it('two roles are mixed, listed in a fixed order', () => {
    const g = withArrows(
      baseV3('reviewer-helper-loop'),
      arrow('implement', 'orchestrate', 'review'),
    );
    expect(deriveRoles(g).get('review')).toEqual({
      ok: false,
      code: 'agent-mixed-roles',
      claims: ['worker', 'change-reviewer'],
    });
  });

  it('extra arrows count as drawn, and the graph is not changed', () => {
    const g = withNodes(baseV3(), agent('x'));
    const before = JSON.stringify(g);
    expect(
      deriveRoles(g, [{ type: 'implement', from: 'orchestrate', to: 'x' }]).get('x'),
    ).toMatchObject({
      ok: true,
      role: { role: 'worker' },
    });
    expect(JSON.stringify(g)).toBe(before);
  });
});

describe('version 3 contracts', () => {
  const base = { id: 'e', from: 'a', to: 'b' };

  it('arrows take a label up to 40 and a purpose up to 300 characters, trimmed', () => {
    expect(
      WorkflowEdgeV3Schema.parse({ type: 'custom', ...base, label: '  Notes  ', purpose: ' Why ' }),
    ).toEqual({ type: 'custom', ...base, label: 'Notes', purpose: 'Why' });
    const longLabel = 'x'.repeat(MAX_EDGE_LABEL + 1);
    const longPurpose = 'x'.repeat(MAX_EDGE_PURPOSE + 1);
    expect(
      WorkflowEdgeV3Schema.safeParse({ type: 'flow', ...base, label: longLabel }).success,
    ).toBe(false);
    expect(
      WorkflowEdgeV3Schema.safeParse({ type: 'flow', ...base, purpose: longPurpose }).success,
    ).toBe(false);
    expect(WorkflowEdgeV3Schema.safeParse({ type: 'flow', ...base, label: '   ' }).success).toBe(
      false,
    );
    expect(
      WorkflowEdgeV3Schema.safeParse({ type: 'research', ...base, purpose: 'x'.repeat(300) })
        .success,
    ).toBe(true);
  });

  it('assigns is not a version 3 arrow; implement is', () => {
    expect(WorkflowEdgeV3Schema.safeParse({ type: 'assigns', ...base }).success).toBe(false);
    expect(WorkflowEdgeV3Schema.safeParse({ type: 'implement', ...base }).success).toBe(true);
  });

  it('a graph is version 3 with agent blocks; version 2 block types are refused', () => {
    expect(WorkflowGraphV3Schema.safeParse(researchedPlan()).success).toBe(true);
    const old = {
      ...baseV3(),
      nodes: [...baseV3().nodes, { type: 'helper', id: 'h', label: 'H' }],
    };
    expect(WorkflowGraphV3Schema.safeParse(old).success).toBe(false);
    expect(WorkflowGraphV3Schema.safeParse({ ...baseV3(), version: 2 }).success).toBe(false);
  });

  it('an agent description is at most 500 characters', () => {
    const g = withNodes(baseV3(), agent('x', 'X', { description: 'd'.repeat(501) }));
    expect(WorkflowGraphV3Schema.safeParse(g).success).toBe(false);
  });

  it('the stored JSON takes version 3, version 2 and version 1', () => {
    expect(
      StoredWorkflowJsonSchema.safeParse({ version: 3, graph: researchedPlan() }).success,
    ).toBe(true);
    expect(
      StoredWorkflowJsonSchema.safeParse({ version: 3, graph: { ...baseV3(), version: 2 } })
        .success,
    ).toBe(false);
  });
});

describe('canConnectV3: the arrow matrix on derived roles', () => {
  const g = withNodes(researchedPlan(), agent('idle'));

  it('research: a researcher (or a new one) to an agent or the lead, never from a gate', () => {
    expect(canConnectV3(g, 'idle', 'orchestrate', 'research').ok).toBe(true);
    expect(canConnectV3(g, 'idle', 'helpers', 'research').ok).toBe(true);
    expect(canConnectV3(g, 'research-claude', 'research-codex', 'research').ok).toBe(true);
    expect(canConnectV3(g, 'ticket', 'orchestrate', 'research')).toMatchObject({
      ok: false,
      code: 'edge-not-allowed',
    });
    expect(canConnectV3(g, 'idle', 'plan-approval', 'research').ok).toBe(false);
  });

  it('plan: an agent to Plan approval only', () => {
    expect(canConnectV3(g, 'idle', 'plan-approval', 'plan').ok).toBe(true);
    expect(canConnectV3(g, 'idle', 'orchestrate', 'plan').ok).toBe(false);
  });

  it('implement: the lead to an agent only', () => {
    expect(canConnectV3(g, 'orchestrate', 'idle', 'implement').ok).toBe(true);
    expect(canConnectV3(g, 'research-claude', 'idle', 'implement').ok).toBe(false);
  });

  it('an arrow that would give an agent a second role is refused, naming both', () => {
    expect(canConnectV3(g, 'orchestrate', 'research-claude', 'implement')).toMatchObject({
      ok: false,
      code: 'edge-not-allowed',
      message: containing('already a researcher'),
    });
    expect(canConnectV3(g, 'helpers', 'orchestrate', 'research').ok).toBe(false);
  });

  it('review: a helper or tester to a change reviewer or the lead; never from a researcher', () => {
    expect(canConnectV3(g, 'helpers', 'idle', 'review').ok).toBe(true);
    expect(canConnectV3(g, 'research-claude', 'idle', 'review').ok).toBe(false);
    expect(canConnectV3(g, 'idle', 'orchestrate', 'review').ok).toBe(false);
  });

  it('findings and rework follow the change reviewer', () => {
    const r = baseV3('reviewer-helper-loop');
    expect(canConnectV3(r, 'review', 'orchestrate', 'findings')).toMatchObject({
      ok: false,
      code: 'duplicate-edge',
    });
    expect(canConnectV3(r, 'helpers', 'orchestrate', 'findings').ok).toBe(false);
    expect(canConnectV3(r, 'orchestrate', 'helpers', 'rework').ok).toBe(true);
  });

  it('test: from the final chain into a tester; flow into an agent there makes a final reviewer', () => {
    const t = withNodes(finalsV3(), agent('t2'), agent('fr'));
    expect(canConnectV3(t, 'unit-tests', 't2', 'test').ok).toBe(true);
    expect(canConnectV3(t, 'ticket-merge', 'fr', 'flow').ok).toBe(true);
    expect(canConnectV3(t, 'helpers', 't2', 'test').ok).toBe(false);
    expect(canConnectV3(t, 'orchestrate', 'fr', 'flow').ok).toBe(false);
  });

  it('custom: agent to agent only, whatever their roles', () => {
    expect(canConnectV3(g, 'research-claude', 'helpers', 'custom').ok).toBe(true);
    expect(canConnectV3(g, 'helpers', 'idle', 'custom').ok).toBe(true);
    expect(canConnectV3(g, 'helpers', 'orchestrate', 'custom').ok).toBe(false);
    expect(canConnectV3(g, 'ticket', 'helpers', 'custom').ok).toBe(false);
  });

  it('the plan path follows the planners; flow and merge as in version 2', () => {
    expect(canConnectV3(g, 'ticket', 'orchestrate', 'flow')).toMatchObject({
      ok: false,
      message: containing('planners first'),
    });
    const lead = baseV3();
    expect(canConnectV3(lead, 'plan-approval', 'orchestrate', 'flow').ok).toBe(false);
    expect(canConnectV3(lead, 'orchestrate', 'ticket-merge', 'merge').ok).toBe(false);
    expect(canConnectV3(lead, 'helpers', 'helpers', 'review')).toMatchObject({ code: 'self-edge' });
    expect(canConnectV3(lead, 'nope', 'helpers', 'custom')).toMatchObject({
      code: 'edge-unknown-node',
    });
  });
});
