// `graphRunDefaults` (WG-F): the run options a project's graph amounts to, which the server's run
// start and the web's "Project default" both read. Synthetic data only.
import { describe, expect, it } from 'vitest';
import {
  APPROVAL_MODES,
  MAX_REWORK_ROUNDS,
  WORKFLOW_TEMPLATE_IDS,
  defaultProjectWorkflow,
  graphRunDefaults,
  migrateWorkflowV1,
  reviewStageOf,
  workflowTemplate,
  type LegacyWorkflowV1,
  type WorkflowGraph,
} from '../../src/index.js';
import {
  base,
  changeReviewer,
  e,
  finalReviewer,
  rw,
  withEdges,
  withNamedHelper,
  withNodes,
  withoutEdges,
} from './helpers.js';

function v1Of(opts: {
  plannerMode: 'lead' | 'separate';
  reviewer: 'agent' | 'lead' | undefined;
  rounds: number | undefined;
  codeReview: boolean;
  unitTests: boolean;
}): LegacyWorkflowV1 {
  const stages = defaultProjectWorkflow('p1', '2026-10-21T09:00:00.000Z').stages;
  return {
    plannerMode: opts.plannerMode,
    stages: {
      ...stages,
      review: {
        requireChecks: true,
        ...(opts.reviewer === undefined ? {} : { reviewer: opts.reviewer }),
        ...(opts.rounds === undefined ? {} : { maxReworkRounds: opts.rounds }),
      },
      'code-review': { ...stages['code-review'], enabled: opts.codeReview },
      'unit-tests': { ...stages['unit-tests'], enabled: opts.unitTests },
    },
  };
}

function* v1Combinations(): Generator<{ name: string; v1: LegacyWorkflowV1 }> {
  const rounds = [...Array.from({ length: MAX_REWORK_ROUNDS + 1 }, (_, i) => i), undefined];
  for (const plannerMode of ['lead', 'separate'] as const) {
    for (const reviewer of ['agent', 'lead', undefined] as const) {
      for (const r of rounds) {
        for (const codeReview of [false, true]) {
          for (const unitTests of [false, true]) {
            const v1 = v1Of({ plannerMode, reviewer, rounds: r, codeReview, unitTests });
            const name = [
              plannerMode,
              reviewer ?? 'default',
              r ?? 'default',
              codeReview ? 'cr' : '-',
              unitTests ? 'ut' : '-',
            ].join('/');
            yield { name, v1 };
          }
        }
      }
    }
  }
}

describe('graphRunDefaults: templates', () => {
  const expected = {
    'lead-only': { reviewer: 'lead', maxReworkRounds: 2 },
    'todays-setup': { reviewer: 'agent', maxReworkRounds: 2 },
    'reviewer-helper-loop': { reviewer: 'agent', maxReworkRounds: 2 },
  } as const;
  for (const id of WORKFLOW_TEMPLATE_IDS) {
    for (const planner of [false, true]) {
      it(`${id}${planner ? ' with a planner' : ''}`, () => {
        expect(graphRunDefaults(workflowTemplate(id, { planner }))).toEqual(expected[id]);
      });
    }
  }
});

describe('graphRunDefaults: a graph migrated from version 1', () => {
  const all = [...v1Combinations()];

  it('covers plannerMode × reviewer × every rounds value × final stages', () => {
    expect(all.length).toBe(2 * 3 * (MAX_REWORK_ROUNDS + 2) * 2 * 2);
  });

  it('equals reviewStageOf(v1), in every project mode', () => {
    for (const { name, v1 } of all) {
      const review = reviewStageOf(v1);
      for (const projectMode of APPROVAL_MODES) {
        const graph = migrateWorkflowV1(v1, { projectMode });
        expect(graphRunDefaults(graph), `${name}/${projectMode}`).toEqual({
          reviewer: review.reviewer,
          maxReworkRounds: review.maxReworkRounds,
        });
      }
    }
  });

  it('gives the version 1 defaults (agent, 2 rounds) when the review stage sets neither', () => {
    const v1 = v1Of({
      plannerMode: 'lead',
      reviewer: undefined,
      rounds: undefined,
      codeReview: true,
      unitTests: true,
    });
    expect(graphRunDefaults(migrateWorkflowV1(v1, { projectMode: 'auto-edits' }))).toEqual({
      reviewer: 'agent',
      maxReworkRounds: 2,
    });
  });
});

describe('graphRunDefaults: hand-built graphs', () => {
  it('reads the graph, not a stale legacyV1 the editor kept after a template', () => {
    const legacy = v1Of({
      plannerMode: 'lead',
      reviewer: 'agent',
      rounds: 5,
      codeReview: false,
      unitTests: false,
    });
    const graph: WorkflowGraph = { ...base('lead-only'), legacyV1: legacy };
    expect(graphRunDefaults(graph)).toEqual({ reviewer: 'lead', maxReworkRounds: 2 });
  });

  it('a final reviewer alone is not a change reviewer: the lead reviews', () => {
    const graph = withNodes(base('lead-only'), finalReviewer('code-review'));
    expect(graphRunDefaults(graph).reviewer).toBe('lead');
  });

  it('a change reviewer makes it agent, wherever it sits in the graph', () => {
    const graph = withNodes(base('lead-only'), changeReviewer('second-review'));
    expect(graphRunDefaults(graph).reviewer).toBe('agent');
  });

  it('no rework edge: 0 rounds', () => {
    const lead = base('lead-only');
    const reworkIds = lead.edges.filter((x) => x.type === 'rework').map((x) => x.id);
    expect(reworkIds.length).toBeGreaterThan(0);
    expect(graphRunDefaults(withoutEdges(lead, ...reworkIds))).toEqual({
      reviewer: 'lead',
      maxReworkRounds: 0,
    });
  });

  it('takes the most rounds of any rework edge: lead, reviewer or named helper', () => {
    const lead = base('lead-only');
    const reworkIds = lead.edges.filter((x) => x.type === 'rework').map((x) => x.id);
    const one = withEdges(withoutEdges(lead, ...reworkIds), rw('orchestrate', 'helpers', 1));
    expect(graphRunDefaults(one).maxReworkRounds).toBe(1);

    const named = withEdges(
      withNamedHelper(one, 'frontend', 'Frontend helper'),
      rw('orchestrate', 'frontend', 4),
    );
    expect(graphRunDefaults(named).maxReworkRounds).toBe(4);

    const loop = withEdges(
      withNodes(one, changeReviewer('second-review')),
      e('review', 'helpers', 'second-review'),
      rw('second-review', 'helpers', 3),
    );
    expect(graphRunDefaults(loop)).toEqual({ reviewer: 'agent', maxReworkRounds: 3 });
  });

  it('caps the rounds at MAX_REWORK_ROUNDS', () => {
    const lead = base('lead-only');
    // The schema caps an edge at MAX_REWORK_ROUNDS too; this checks the function's own cap.
    const graph: WorkflowGraph = {
      ...lead,
      edges: lead.edges.map((x) =>
        x.type === 'rework' ? { ...x, maxRounds: MAX_REWORK_ROUNDS + 4 } : x,
      ),
    };
    expect(graphRunDefaults(graph).maxReworkRounds).toBe(MAX_REWORK_ROUNDS);
  });
});
