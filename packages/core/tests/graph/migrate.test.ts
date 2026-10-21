// Golden migration tests (README "Graph correctness" layer 5, ADR-0023 §9): every version 1
// workflow migrates to a graph that validates with no issue and compiles to the launch fields
// version 1 gives today. The expected values come from a mirror of
// packages/orchestrator/src/stages.ts (`skillsFor`, `stageModelFor`, `stageAgentFor`,
// `changeReviewerLaunchFields`, `nextStage`), which core cannot import; WG-B can cross-check the
// engine itself. Synthetic data only.
import { describe, expect, it } from 'vitest';
import {
  APPROVAL_MODES,
  WORKFLOW_STAGES,
  WorkflowGraphSchema,
  compileWorkflow,
  migrateWorkflowV1,
  reviewStageOf,
  tightenMode,
  validateWorkflowGraph,
  type ApprovalMode,
  type LegacyWorkflowV1,
  type ProgramAgentNode,
  type ReviewRoute,
} from '../../src/index.js';

// ---------------------------------------------------------------- the version 1 mirror

type Kind = 'planner' | 'lead' | 'worker' | 'reviewer' | 'tester';
type Stage = 'plan' | 'orchestrate' | 'helpers' | 'code-review' | 'unit-tests';
interface Launch {
  model: string | null;
  skills: string[];
  agent: string | null;
}

/** `stagesForRole` */
function stagesFor(kind: Kind, v1: LegacyWorkflowV1): Stage[] {
  if (kind === 'lead')
    return v1.plannerMode === 'separate' ? ['orchestrate'] : ['plan', 'orchestrate'];
  const role: Record<Exclude<Kind, 'lead'>, Stage> = {
    planner: 'plan',
    worker: 'helpers',
    reviewer: 'code-review',
    tester: 'unit-tests',
  };
  return [role[kind]];
}

/** `skillsFor`, `stageModelFor` and `stageAgentFor` for one role. */
function v1Launch(v1: LegacyWorkflowV1, kind: Kind): Launch {
  const stages = stagesFor(kind, v1);
  const skills: string[] = [];
  for (const s of stages) {
    const skill = v1.stages[s].skill;
    if (skill !== null && !skills.includes(skill)) skills.push(skill);
  }
  const reversed = [...stages].reverse();
  const model = reversed.map((s) => v1.stages[s].model).find((m) => m !== null) ?? null;
  const agent = reversed.map((s) => v1.stages[s].agent ?? null).find((a) => a !== null) ?? null;
  return { model, skills, agent };
}

/** `changeReviewerLaunchFields` */
function v1ChangeReviewer(v1: LegacyWorkflowV1): Launch {
  const r = reviewStageOf(v1);
  return { model: r.model, skills: r.skill === null ? [] : [r.skill], agent: r.agent };
}

/** `nextStage`: code-review (when on), then unit-tests (when on). */
function v1FinalStages(v1: LegacyWorkflowV1): Stage[] {
  const out: Stage[] = [];
  if (v1.stages['code-review'].enabled) out.push('code-review');
  if (v1.stages['unit-tests'].enabled) out.push('unit-tests');
  return out;
}

/** Today's review of a helper's (or the tester's) change: who reviews, and the lead's rounds. */
function v1Route(
  v1: LegacyWorkflowV1,
  override: { reviewer?: 'lead'; rounds?: number } = {},
): ReviewRoute {
  const r = reviewStageOf(v1);
  const leadRounds = override.rounds ?? r.maxReworkRounds;
  return r.reviewer === 'agent' && override.reviewer === undefined
    ? { by: 'agent', reviewer: 'review', then: 'lead', leadRounds }
    : { by: 'lead', leadRounds };
}

function launchOf(node: ProgramAgentNode | null | undefined): Launch | null {
  return node === null || node === undefined
    ? null
    : { model: node.model, skills: [...node.skills], agent: node.agent };
}

// ---------------------------------------------------------------- every combination

type Fields = 'none' | 'all' | 'mixed';

function stage(
  fields: Fields,
  name: string,
): { model: string | null; skill: string | null; agent?: string | null } {
  const value =
    fields === 'all'
      ? { model: `model-${name}`, skill: `skill-${name}`, agent: `agent-${name}` }
      : fields === 'mixed'
        ? {
            // plan and orchestrate share a skill (deduplicated for the lead in lead mode); the
            // orchestrate model is unset (the lead falls back to the plan model); both agent
            // files are set (orchestrate wins).
            model: name === 'plan' || name === 'helpers' ? `model-${name}` : null,
            skill: name === 'plan' || name === 'orchestrate' ? 'shared-skill' : null,
            agent:
              name === 'plan' || name === 'orchestrate' || name === 'unit-tests'
                ? `agent-${name}`
                : null,
          }
        : { model: null, skill: null };
  return value;
}

function* combinations(): Generator<{
  name: string;
  v1: LegacyWorkflowV1;
  projectMode: ApprovalMode;
}> {
  for (const plannerMode of ['lead', 'separate'] as const) {
    for (const reviewer of ['agent', 'lead', undefined] as const) {
      for (const rounds of [0, 2, 5, undefined]) {
        for (const codeReview of [false, true]) {
          for (const unitTests of [false, true]) {
            for (const fields of ['none', 'all', 'mixed'] as const) {
              for (const projectMode of APPROVAL_MODES) {
                const review =
                  fields === 'all'
                    ? { model: 'model-review', skill: 'skill-review', agent: 'agent-review' }
                    : fields === 'mixed'
                      ? { skill: 'skill-review' }
                      : {};
                const v1: LegacyWorkflowV1 = {
                  plannerMode,
                  stages: {
                    plan: stage(fields, 'plan'),
                    orchestrate: stage(fields, 'orchestrate'),
                    helpers: stage(fields, 'helpers'),
                    review: {
                      requireChecks: true,
                      ...(reviewer === undefined ? {} : { reviewer }),
                      ...(rounds === undefined ? {} : { maxReworkRounds: rounds }),
                      ...review,
                    },
                    'code-review': { ...stage(fields, 'code-review'), enabled: codeReview },
                    'unit-tests': { ...stage(fields, 'unit-tests'), enabled: unitTests },
                  },
                };
                const name = [
                  plannerMode,
                  reviewer ?? 'default',
                  rounds ?? 'default',
                  codeReview ? 'cr' : '-',
                  unitTests ? 'ut' : '-',
                  fields,
                  projectMode,
                ].join('/');
                yield { name, v1, projectMode };
              }
            }
          }
        }
      }
    }
  }
}

function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null) {
    for (const v of Object.values(value)) deepFreeze(v);
    Object.freeze(value);
  }
  return value;
}

const GATE_IDS = ['ticket', 'plan-approval', 'checks', 'ticket-merge', 'owner-merge', 'done'];

describe('migrateWorkflowV1: every version 1 combination', () => {
  const all = [...combinations()];

  it('covers plannerMode × reviewer × rounds × final stages × fields × project mode', () => {
    expect(all.length).toBe(2 * 3 * 4 * 2 * 2 * 3 * 4);
  });

  it('migrates losslessly to a schema-valid graph with no issue, using the v1 stage ids', () => {
    for (const { name, v1, projectMode } of all) {
      const graph = migrateWorkflowV1(deepFreeze(v1), { projectMode });
      expect(WorkflowGraphSchema.parse(graph), name).toEqual(graph);
      expect(validateWorkflowGraph(graph, { projectMode, maxConcurrentHelpers: 3 }), name).toEqual(
        [],
      );
      expect(graph.template).toBe('custom');
      expect(graph.legacyV1, name).toEqual(JSON.parse(JSON.stringify(v1)));
      for (const node of graph.nodes) {
        expect([...WORKFLOW_STAGES, ...GATE_IDS], name).toContain(node.id);
      }
    }
  });

  it('compiles to the launch fields, routes and stage order version 1 gives today', () => {
    for (const { name, v1, projectMode } of all) {
      const graph = migrateWorkflowV1(v1, { projectMode });
      const program = compileWorkflow(graph, {
        projectMode,
        approvalCeilings: [],
        maxConcurrentHelpers: 3,
      });
      const route = v1Route(v1);

      expect(launchOf(program.lead), name).toEqual(v1Launch(v1, 'lead'));
      expect(launchOf(program.planner), name).toEqual(
        v1.plannerMode === 'separate' ? v1Launch(v1, 'planner') : null,
      );
      expect(
        program.helpers.map((h) => h.id),
        name,
      ).toEqual(['helpers']);
      const pool = program.helpers[0];
      expect(launchOf(pool), name).toEqual(v1Launch(v1, 'worker'));
      expect(pool?.review, name).toEqual(route);
      expect(pool?.maxInstances, name).toBe(3);
      expect(pool?.canStartHelpers, name).toBe(true);

      expect(program.changeReviewers.map(launchOf), name).toEqual(
        reviewStageOf(v1).reviewer === 'agent' ? [v1ChangeReviewer(v1)] : [],
      );
      expect(
        program.finalStages.map((s) => s.id),
        name,
      ).toEqual(v1FinalStages(v1));
      for (const s of program.finalStages) {
        expect(launchOf(s), name).toEqual(
          v1Launch(v1, s.type === 'tester' ? 'tester' : 'reviewer'),
        );
        if (s.type === 'tester') expect(s.review, name).toEqual(route);
      }

      const mode = tightenMode(null, projectMode);
      expect({ ...program.nodeModes }, name).toEqual(
        v1.stages['unit-tests'].enabled ? { helpers: mode, 'unit-tests': mode } : { helpers: mode },
      );
      expect(program.planAutoApprove, name).toBe(projectMode === 'full-auto');
    }
  });

  it('follows the ticket overrides as version 1 does: reviewer lead and rework rounds', () => {
    for (const { name, v1, projectMode } of all) {
      const graph = migrateWorkflowV1(v1, { projectMode });
      const base = { projectMode, approvalCeilings: [], maxConcurrentHelpers: 3 };
      const lead = compileWorkflow(graph, { ...base, reviewer: 'lead' });
      expect(lead.helpers[0]?.review, name).toEqual(v1Route(v1, { reviewer: 'lead' }));
      expect(lead.changeReviewers, name).toEqual([]);
      const rounds = compileWorkflow(graph, { ...base, maxReworkRounds: 4 });
      expect(rounds.helpers[0]?.review, name).toEqual(v1Route(v1, { rounds: 4 }));
    }
  });
});

describe('migrateWorkflowV1: specifics', () => {
  const v1: LegacyWorkflowV1 = {
    plannerMode: 'lead',
    stages: {
      plan: { model: null, skill: null },
      orchestrate: { model: null, skill: null },
      helpers: { model: null, skill: 'react-pages', agent: 'frontend-dev' },
      review: { requireChecks: true, reviewer: 'agent', maxReworkRounds: 3 },
      'code-review': { enabled: true, model: null, skill: null },
      'unit-tests': { enabled: true, model: null, skill: null },
    },
  };

  it('puts the rounds on the lead → helpers (and lead → tester) rework edges: route (b)', () => {
    const graph = migrateWorkflowV1(v1, { projectMode: 'auto' });
    expect(graph.edges.filter((e) => e.type === 'rework')).toEqual([
      {
        type: 'rework',
        id: 'rework-orchestrate-helpers',
        from: 'orchestrate',
        to: 'helpers',
        maxRounds: 3,
      },
      {
        type: 'rework',
        id: 'rework-orchestrate-unit-tests',
        from: 'orchestrate',
        to: 'unit-tests',
        maxRounds: 3,
      },
    ]);
    expect(graph.edges.filter((e) => e.type === 'review').map((e) => [e.from, e.to])).toEqual([
      ['helpers', 'review'],
      ['unit-tests', 'review'],
    ]);
  });

  it('maps skill to skills and keeps the pool on the project mode', () => {
    const graph = migrateWorkflowV1(v1, { projectMode: 'manual' });
    expect(graph.nodes.find((n) => n.id === 'helpers')).toEqual({
      type: 'helper-pool',
      id: 'helpers',
      label: 'Helpers',
      model: null,
      skills: ['react-pages'],
      agent: 'frontend-dev',
      approvalMode: null,
      canStartHelpers: true,
    });
    expect(graph.nodes.find((n) => n.type === 'plan-approval')).toMatchObject({ auto: false });
  });

  it('does not share objects with its input', () => {
    const graph = migrateWorkflowV1(v1, { projectMode: 'auto' });
    expect(graph.legacyV1).toEqual(v1);
    expect(graph.legacyV1).not.toBe(v1);
    expect(graph.legacyV1?.stages).not.toBe(v1.stages);
  });

  it('keeps only plannerMode and stages from a full version 1 workflow', () => {
    const full = { ...v1, projectId: 'p1', updatedAt: '2026-10-17T09:00:00.000Z' };
    expect(Object.keys(migrateWorkflowV1(full, { projectMode: 'auto' }).legacyV1 ?? {})).toEqual([
      'plannerMode',
      'stages',
    ]);
  });
});
