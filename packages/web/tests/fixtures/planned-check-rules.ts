import type * as Core from '@acp/core';
import type { WorkflowNode } from '@acp/core';

/*
 * H-D: ADR-0027's link rules for the Checks blocks, which H-A is adding to core's `canConnect` in
 * parallel. Tests that wire blocks on a change or on the branch mock `@acp/core` with these rules
 * on top of today's, so they pass before and after H-A's change:
 * - `flow`: a helper, the pool or a tester → a change block;
 * - `rework`: a change block → a helper, the pool or a tester;
 * - `flow` on the final chain into or out of a branch block (ticket merge, final reviewers,
 *   testers, branch blocks → final stages, branch blocks or your merge).
 * Every other answer is core's own.
 *
 *   vi.mock('@acp/core', async (importOriginal) =>
 *     (await import('../fixtures/planned-check-rules')).withPlannedCheckRules(importOriginal));
 */

type CoreModule = typeof Core;

const editing = (n: WorkflowNode | undefined) =>
  n?.type === 'helper' || n?.type === 'helper-pool' || n?.type === 'tester';
const place = (n: WorkflowNode | undefined) => (n?.type === 'checks' ? (n.place ?? 'merge') : null);
const onChain = (n: WorkflowNode | undefined) =>
  place(n) === 'branch' || n?.type === 'tester' || (n?.type === 'reviewer' && n.scope === 'final');

export async function withPlannedCheckRules(
  importOriginal: <T>() => Promise<T>,
): Promise<CoreModule> {
  const core = await importOriginal<CoreModule>();
  const canConnect: CoreModule['canConnect'] = (graph, from, to, type) => {
    const today = core.canConnect(graph, from, to, type);
    if (today.ok) return today;
    const a = graph.nodes.find((n) => n.id === from);
    const b = graph.nodes.find((n) => n.id === to);
    const allowed =
      (type === 'flow' && editing(a) && place(b) === 'change') ||
      (type === 'rework' && place(a) === 'change' && editing(b)) ||
      (type === 'flow' &&
        (place(a) === 'branch' || place(b) === 'branch') &&
        (a?.type === 'ticket-merge' || onChain(a)) &&
        (onChain(b) || b?.type === 'owner-merge'));
    const duplicate = graph.edges.some((e) => e.type === type && e.from === from && e.to === to);
    return allowed && !duplicate ? { ok: true } : today;
  };
  return { ...core, canConnect };
}
