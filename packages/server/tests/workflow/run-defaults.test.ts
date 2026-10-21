// `projectRunDefaults` (WG-F): the project-level run options a ticket run starts from. It now reads
// the effective graph with core's `graphRunDefaults`, which the web uses too; these tests pin that
// the answer is unchanged from before: `reviewStageOf(v1)` for a version 1 or default workflow,
// and the graph's routes for a stored graph. Synthetic data only.
import {
  APPROVAL_MODES,
  MAX_REWORK_ROUNDS,
  WORKFLOW_TEMPLATE_IDS,
  defaultProjectWorkflow,
  reviewStageOf,
  workflowTemplate,
  type ApprovalMode,
  type ProjectWorkflow,
  type RunOptions,
  type WorkflowGraph,
} from '@acp/core';
import { describe, expect, it } from 'vitest';
import { effectiveWorkflow, projectRunDefaults } from '../../src/workflow/graph.js';

const NOW = '2026-10-21T09:00:00.000Z';

/** The rule `board/service.ts` had before WG-F, kept here as the reference. */
function before(
  workflow: { v1?: ProjectWorkflow; graph: WorkflowGraph },
  approvalMode: ApprovalMode,
): RunOptions {
  if (workflow.v1 !== undefined) {
    const review = reviewStageOf(workflow.v1);
    return { approvalMode, reviewer: review.reviewer, maxReworkRounds: review.maxReworkRounds };
  }
  const reviewers = workflow.graph.nodes.some((n) => n.type === 'reviewer' && n.scope === 'change');
  const rounds = workflow.graph.edges.reduce(
    (max, e) => (e.type === 'rework' ? Math.max(max, e.maxRounds) : max),
    0,
  );
  return {
    approvalMode,
    reviewer: reviewers ? 'agent' : 'lead',
    maxReworkRounds: Math.min(rounds, MAX_REWORK_ROUNDS),
  };
}

function* v1Workflows(): Generator<{ name: string; workflow: ProjectWorkflow }> {
  const rounds = [...Array.from({ length: MAX_REWORK_ROUNDS + 1 }, (_, i) => i), undefined];
  for (const plannerMode of ['lead', 'separate'] as const) {
    for (const reviewer of ['agent', 'lead', undefined] as const) {
      for (const r of rounds) {
        for (const codeReview of [false, true]) {
          for (const unitTests of [false, true]) {
            const base = defaultProjectWorkflow('p1', NOW);
            const workflow: ProjectWorkflow = {
              ...base,
              plannerMode,
              stages: {
                ...base.stages,
                review: {
                  requireChecks: true,
                  ...(reviewer === undefined ? {} : { reviewer }),
                  ...(r === undefined ? {} : { maxReworkRounds: r }),
                  ...(reviewer === 'agent' ? { model: 'model-review', skill: 'review-skill' } : {}),
                },
                'code-review': { ...base.stages['code-review'], enabled: codeReview },
                'unit-tests': { ...base.stages['unit-tests'], enabled: unitTests },
              },
            };
            const name = [plannerMode, reviewer ?? '-', r ?? '-', codeReview, unitTests].join('/');
            yield { name, workflow };
          }
        }
      }
    }
  }
}

describe('projectRunDefaults: parity with the rule before WG-F', () => {
  const all = [...v1Workflows()];

  it('covers every version 1 reviewer, rounds and final-stage combination', () => {
    expect(all.length).toBe(2 * 3 * (MAX_REWORK_ROUNDS + 2) * 2 * 2);
  });

  it('a stored version 1 workflow: reviewStageOf(v1), in every project mode', () => {
    for (const { name, workflow } of all) {
      for (const mode of APPROVAL_MODES) {
        const effective = effectiveWorkflow({ kind: 'v1', workflow }, mode);
        const review = reviewStageOf(workflow);
        expect(projectRunDefaults(effective, mode), `${name}/${mode}`).toEqual({
          approvalMode: mode,
          reviewer: review.reviewer,
          maxReworkRounds: review.maxReworkRounds,
        });
        expect(projectRunDefaults(effective, mode)).toEqual(before(effective, mode));
      }
    }
  });

  it('the default workflow (nothing stored): agent reviewer, 2 rounds', () => {
    for (const mode of APPROVAL_MODES) {
      const effective = effectiveWorkflow(
        { kind: 'default', workflow: defaultProjectWorkflow('p1', NOW) },
        mode,
      );
      expect(projectRunDefaults(effective, mode)).toEqual({
        approvalMode: mode,
        reviewer: 'agent',
        maxReworkRounds: 2,
      });
      expect(projectRunDefaults(effective, mode)).toEqual(before(effective, mode));
    }
  });

  it('a stored graph: its routes, as before, for every template and a stale legacyV1', () => {
    const legacy = defaultProjectWorkflow('p1', NOW);
    for (const id of WORKFLOW_TEMPLATE_IDS) {
      for (const planner of [false, true]) {
        for (const legacyV1 of [
          undefined,
          { plannerMode: legacy.plannerMode, stages: legacy.stages },
        ]) {
          const graph: WorkflowGraph = {
            ...workflowTemplate(id, { planner }),
            ...(legacyV1 === undefined ? {} : { legacyV1 }),
          };
          const effective = effectiveWorkflow(
            { kind: 'v2', graph: { projectId: 'p1', graph, updatedAt: NOW } },
            'auto',
          );
          expect(projectRunDefaults(effective, 'auto'), id).toEqual(before(effective, 'auto'));
        }
      }
    }
    // The lead-only template keeps a stale version 1 setup (agent reviewer) after a template
    // change; the graph's answer (the lead) is the one that counts.
    const leadOnly = effectiveWorkflow(
      {
        kind: 'v2',
        graph: {
          projectId: 'p1',
          graph: {
            ...workflowTemplate('lead-only'),
            legacyV1: { plannerMode: legacy.plannerMode, stages: legacy.stages },
          },
          updatedAt: NOW,
        },
      },
      'manual',
    );
    expect(projectRunDefaults(leadOnly, 'manual')).toEqual({
      approvalMode: 'manual',
      reviewer: 'lead',
      maxReworkRounds: 2,
    });
  });
});
