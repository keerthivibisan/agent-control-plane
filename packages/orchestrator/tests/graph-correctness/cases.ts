import { defaultProjectWorkflow } from '@acp/core';
import type {
  ApprovalMode,
  ChangeReviewerMode,
  ProjectApprovals,
  ProjectWorkflow,
} from '@acp/core';
import type { ScriptName } from './scripts.js';
import type { PermissionStep, SimConfig } from './sim.js';
import { SIM_PROJECT } from './sim.js';

/**
 * The golden v1 cases (README "Graph correctness", layer 5): every version 1 workflow combination
 * that changes what the engine does, each with the scripts that exercise it, plus legacy runs,
 * the four approval modes and interrupted runs. Recorded on the engine before WG-B changed it;
 * the program-driven engine must give the same traces. Synthetic data only.
 */

export interface GoldenCase {
  name: string;
  config: SimConfig;
  script: ScriptName;
  /**
   * The whole trace is pinned in the snapshot; otherwise only its digest (a hash of the whole
   * trace, the outcome and the final states), which proves the same identity in less space.
   */
  full?: boolean;
}

const WF_TIME = '2026-10-11T09:00:00.000Z';

interface WorkflowOptions {
  plannerMode: 'lead' | 'separate';
  reviewer: ChangeReviewerMode;
  rounds: number;
  codeReview: boolean;
  unitTests: boolean;
  /** Every stage sets a model, a skill and an agent file. */
  rich?: boolean;
}

export function v1Workflow(o: WorkflowOptions): ProjectWorkflow {
  const wf = defaultProjectWorkflow(SIM_PROJECT, WF_TIME);
  const rich = o.rich === true;
  const stage = (name: string) =>
    rich
      ? { model: `model-${name}`, skill: `skill-${name}`, agent: `agent-${name}` }
      : { model: null, skill: null };
  return {
    ...wf,
    plannerMode: o.plannerMode,
    stages: {
      plan: stage('plan'),
      orchestrate: stage('orchestrate'),
      helpers: stage('helpers'),
      review: {
        requireChecks: true,
        reviewer: o.reviewer,
        maxReworkRounds: o.rounds,
        ...(rich ? { model: 'model-review', skill: 'skill-review', agent: 'agent-review' } : {}),
      },
      'code-review': { enabled: o.codeReview, ...stage('code-review') },
      'unit-tests': { enabled: o.unitTests, ...stage('unit-tests') },
    },
  };
}

function wfName(o: WorkflowOptions): string {
  return [
    o.plannerMode === 'lead' ? 'lead-plans' : 'planner',
    `rev-${o.reviewer}`,
    `r${o.rounds}`,
    o.codeReview ? 'cr' : 'no-cr',
    o.unitTests ? 'ut' : 'no-ut',
    ...(o.rich === true ? ['rich'] : []),
  ].join('/');
}

function loopCase(o: WorkflowOptions, script: ScriptName, extra: Partial<SimConfig> = {}) {
  return {
    name: `loop ${wfName(o)} ${script}${extra.approvals !== undefined ? ` mode-${extra.approvals.mode}` : ''}`,
    config: {
      workflow: v1Workflow(o),
      loop: { reviewer: o.reviewer, rounds: o.rounds },
      ...extra,
    },
    script,
  } satisfies GoldenCase;
}

const MATRIX_SCRIPTS: ScriptName[] = [
  'approve',
  'rework-then-approve',
  'discard',
  'ask-owner',
  'failed-check',
  'failing-helper',
];
const EXTRA_SCRIPTS: ScriptName[] = ['conflict', 'no-changes', 'plan-changes', 'ask-owner-rework'];

const approvals = (mode: ApprovalMode): ProjectApprovals => ({
  mode,
  commands: [{ argv: ['ls'], match: 'prefix' }],
});

/** Tool uses each helper asks for: a plain edit, a protected file, a check, allowed and unknown commands. */
export const PERMISSIONS: readonly PermissionStep[] = [
  { toolName: 'Edit', file: 'src/app.ts' },
  { toolName: 'Edit', file: '.git/config' },
  { toolName: 'Bash', command: 'pnpm test' },
  { toolName: 'Bash', command: 'ls -la' },
  { toolName: 'Bash', command: 'curl example.com' },
];

function buildCases(): GoldenCase[] {
  const cases: GoldenCase[] = [];
  for (const plannerMode of ['lead', 'separate'] as const) {
    for (const reviewer of ['agent', 'lead'] as const) {
      for (const rounds of [0, 2]) {
        for (const codeReview of [false, true]) {
          for (const unitTests of [false, true]) {
            const o = { plannerMode, reviewer, rounds, codeReview, unitTests };
            const pinned = rounds === 2 && codeReview && unitTests;
            for (const script of MATRIX_SCRIPTS) {
              cases.push({ ...loopCase(o, script), full: pinned });
            }
          }
        }
      }
      const full = { plannerMode, reviewer, rounds: 2, codeReview: true, unitTests: true };
      for (const script of EXTRA_SCRIPTS) cases.push(loopCase(full, script));
      cases.push(loopCase({ ...full, rich: true }, 'approve'));
      cases.push(loopCase({ ...full, rich: true }, 'rework-then-approve'));
    }
  }

  // The ticket's reviewer overrides the workflow's (`StartTicketRequest.reviewer`).
  for (const [stageReviewer, runReviewer] of [
    ['lead', 'agent'],
    ['agent', 'lead'],
  ] as const) {
    const o = {
      plannerMode: 'lead' as const,
      reviewer: stageReviewer,
      rounds: 1,
      codeReview: false,
      unitTests: true,
    };
    cases.push({
      name: `loop ${wfName(o)} run-reviewer-${runReviewer} rework-then-approve`,
      config: { workflow: v1Workflow(o), loop: { reviewer: runReviewer, rounds: 2 } },
      script: 'rework-then-approve',
    });
  }

  // A loop run with no workflow snapshot (the Phase 4 default).
  cases.push({
    name: 'loop no-workflow approve',
    config: { loop: { reviewer: 'agent', rounds: 2 } },
    script: 'approve',
  });

  // The four approval modes, with tool uses; Full auto approves the plan itself.
  for (const mode of ['manual', 'auto-edits', 'auto', 'full-auto'] as const) {
    for (const plannerMode of ['lead', 'separate'] as const) {
      const o = {
        plannerMode,
        reviewer: 'agent' as const,
        rounds: 2,
        codeReview: true,
        unitTests: true,
      };
      const extra = { approvals: approvals(mode), permissions: PERMISSIONS };
      cases.push(loopCase(o, 'approve', extra));
      cases.push({ ...loopCase(o, 'owner-denies', extra), full: false });
    }
  }

  // Legacy runs (no review loop): the owner reviews each change.
  for (const plannerMode of ['lead', 'separate'] as const) {
    for (const codeReview of [false, true]) {
      for (const unitTests of [false, true]) {
        const o = { plannerMode, reviewer: 'agent' as const, rounds: 2, codeReview, unitTests };
        for (const script of ['approve', 'legacy-discard', 'legacy-failing-helper'] as const) {
          cases.push({
            name: `legacy ${wfName(o)} ${script}`,
            config: { workflow: v1Workflow(o) },
            script,
            full: codeReview && unitTests,
          });
        }
      }
    }
  }
  cases.push({ name: 'legacy no-workflow approve', config: {}, script: 'approve' });
  cases.push({
    name: 'legacy no-workflow mode-auto-edits approve',
    config: { approvals: approvals('auto-edits'), permissions: PERMISSIONS },
    script: 'approve',
  });
  cases.push({ name: 'control-panel approve', config: { controlPanel: true }, script: 'approve' });
  cases.push({
    name: 'control-panel legacy-failing-helper',
    config: { controlPanel: true },
    script: 'legacy-failing-helper',
  });

  // Interrupted runs: a restart (nothing relaunches; the owner continues) and Stop all.
  const full = {
    plannerMode: 'lead' as const,
    reviewer: 'agent' as const,
    rounds: 2,
    codeReview: true,
    unitTests: true,
  };
  for (const kind of ['restart', 'stop-all'] as const) {
    const interrupted = loopCase(full, 'approve', { interrupt: { when: 'first-ready', kind } });
    cases.push({ ...interrupted, name: `${interrupted.name} interrupt-${kind}` });
    cases.push({
      name: `legacy ${wfName(full)} approve interrupt-${kind}`,
      config: { workflow: v1Workflow(full), interrupt: { when: 'first-helper', kind } },
      script: 'approve',
    });
  }
  return cases;
}

export const GOLDEN_CASES: readonly GoldenCase[] = buildCases();
