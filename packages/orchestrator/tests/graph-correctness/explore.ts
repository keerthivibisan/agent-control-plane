import { defaultProjectWorkflow, migrateWorkflowV1 } from '@acp/core';
import type { ApprovalMode, CompileContext, PlanStep, WorkflowGraph } from '@acp/core';
import { programOf } from '../../src/index.js';
import { agentModeOf } from './golden.js';
import { endInvariants, stepInvariants } from './invariants.js';
import { SIM_PROJECT, simulate } from './sim.js';
import type { ChoicePoint, Oracle, SimConfig } from './sim.js';

/**
 * Layer 2 (README "Graph correctness"): every behaviour of one graph, explored. A depth-first
 * search over the simulator's choice points (each answer re-runs the simulation from the start,
 * so no engine state is ever copied by hand), checking `stepInvariants` after every step and
 * `endInvariants` at every end. States already explored are recognised by their fingerprint and
 * not explored again, so the search is a small bounded model check. `budget` caps the number of
 * runs; the result says whether the search finished. Synthetic data only.
 */

/** The answers the explorer tries at each kind of choice point (the rest behave alike). */
function explored(point: ChoicePoint): readonly string[] {
  const kind = point.key.split(':')[0] ?? '';
  const round = Number(point.key.split(':')[2] ?? '0');
  switch (kind) {
    case 'plan':
    case 'approval':
    case 'legacy-review':
      return point.options.slice(0, 1);
    case 'turn':
    case 'tester-turn':
      // A first turn may change files, change nothing or fail; a rework turn changes files.
      return round === 0 ? point.options : point.options.slice(0, 1);
    case 'merge':
      return point.options.filter((o) => o === 'merged' || o === 'checks-failed');
    case 'owner-change':
      // The owner may always grant another round; the model owner grants one per change.
      return point.options.filter((o) => o !== 'rework' || round < 1);
    default:
      return point.options;
  }
}

class Pruned extends Error {}

export interface Exploration {
  runs: number;
  /** True when every behaviour was explored within the budget. */
  exhaustive: boolean;
  pruned: number;
  /** The first violation found, with the choices that lead to it. */
  violation: { problems: string[]; choices: string[]; step: number } | null;
}

/**
 * `focus`: the roles (as the choice keys spell them) whose choice points branch; every other
 * role takes the default answer. Undefined: every role branches (the full product).
 */
export function explore(
  config: SimConfig,
  budget: number,
  focus?: ReadonlySet<string>,
): Exploration {
  const seen = new Set<string>();
  let prefix: number[] = [];
  let runs = 0;
  let pruned = 0;
  for (;;) {
    const sizes: number[] = [];
    const chosen: number[] = [];
    const trail: string[] = [];
    let problem: { problems: string[]; step: number } | null = null;
    const oracle: Oracle = (point) => {
      const role = point.key.split(':')[1] ?? '';
      const branching = focus === undefined || focus.has(role);
      const options = branching ? explored(point) : point.options.slice(0, 1);
      const pos = sizes.length;
      if (pos >= prefix.length) {
        const fp = `${point.key}|${point.fingerprint?.() ?? ''}`;
        if (seen.has(fp)) throw new Pruned();
        seen.add(fp);
      }
      const index = prefix[pos] ?? 0;
      sizes.push(options.length);
      chosen.push(index);
      const answer = options[index] ?? options[0] ?? '';
      trail.push(`${point.key}=${answer}`);
      return answer;
    };
    try {
      const result = simulate(config, oracle, {
        modeOf: agentModeOf,
        onStep: (step) => {
          if (problem !== null) return;
          const found = stepInvariants(step);
          if (found.length > 0) problem = { problems: found, step: step.index };
        },
      });
      if (problem === null) {
        const found = endInvariants(result);
        if (found.length > 0) problem = { problems: found, step: result.steps };
      }
    } catch (error) {
      if (!(error instanceof Pruned)) throw error;
      pruned++;
    }
    runs++;
    if (problem !== null) {
      const p: { problems: string[]; step: number } = problem;
      return { runs, exhaustive: false, pruned, violation: { ...p, choices: trail } };
    }
    let i = chosen.length - 1;
    while (i >= 0 && (chosen[i] ?? 0) >= (sizes[i] ?? 1) - 1) i--;
    if (i < 0) return { runs, exhaustive: true, pruned, violation: null };
    if (runs >= budget) return { runs, exhaustive: false, pruned, violation: null };
    prefix = [...chosen.slice(0, i), (chosen[i] ?? 0) + 1];
  }
}

// ------------------------------------------------------------------ graph runs in the simulator

export interface GraphRunSetup {
  projectMode?: ApprovalMode;
  ceilings?: ApprovalMode[];
  reviewer?: 'agent' | 'lead';
  maxReworkRounds?: number;
  maxConcurrentHelpers?: number;
  /** Plan steps name their helper node (`helper`); else the lead resolves roles itself. */
  stepHelpers?: boolean;
}

/**
 * A simulator config for a ticket run of `graph`: one plan step per helper node (a named helper's
 * label as its role, `Store` for the pool), started with the node's helper id.
 */
export function graphSimConfig(graph: WorkflowGraph, o: GraphRunSetup = {}): SimConfig {
  const context: CompileContext = {
    projectMode: o.projectMode ?? 'manual',
    approvalCeilings: o.ceilings ?? [],
    ...(o.reviewer !== undefined ? { reviewer: o.reviewer } : {}),
    ...(o.maxReworkRounds !== undefined ? { maxReworkRounds: o.maxReworkRounds } : {}),
    maxConcurrentHelpers: o.maxConcurrentHelpers ?? 3,
  };
  const program = programOf({ graph, graphContext: context });
  const steps: PlanStep[] = [];
  const helperFor: Record<string, string> = {};
  for (const h of program.helpers) {
    const role = h.type === 'helper' ? h.label : 'Store';
    steps.push({ title: `Work for ${role}`, role, detail: '' });
    helperFor[role] = h.id;
  }
  const base = defaultProjectWorkflow(SIM_PROJECT, '2026-10-11T09:00:00.000Z');
  return {
    // Words the ticket prompts only (planner or not); the run follows the graph.
    workflow: { ...base, plannerMode: program.planner === null ? 'lead' : 'separate' },
    omitWorkflow: true,
    loop: { reviewer: 'agent', rounds: 2 },
    approvals: { mode: context.projectMode, commands: [{ argv: ['ls'], match: 'prefix' }] },
    limits: { maxConcurrentHelpers: context.maxConcurrentHelpers, maxDepth: 1 },
    steps,
    helperFor,
    stepHelpers: o.stepHelpers ?? true,
    extra: { graph, graphContext: context },
  };
}

/** A v1 workflow as the explorer runs it: the migrated graph of `graphSimConfig`. */
export function v1Graph(workflow: Parameters<typeof migrateWorkflowV1>[0]): WorkflowGraph {
  return migrateWorkflowV1(workflow, { projectMode: 'manual' });
}

/** A readable failure: the graph, the setup and the choices that broke an invariant. */
export function describeFailure(
  name: string,
  graph: WorkflowGraph,
  result: Pick<Exploration, 'violation'>,
  setup: GraphRunSetup = {},
): string {
  const v = result.violation;
  if (v === null) return `${name}: ok`;
  return [
    `${name}: ${v.problems.join('; ')} (step ${v.step})`,
    `setup: ${JSON.stringify(setup)}`,
    `choices: ${v.choices.join(' ')}`,
    `graph: ${JSON.stringify({ nodes: graph.nodes.map((n) => [n.type, n.id]), edges: graph.edges.map((e) => [e.type, e.from, e.to, 'maxRounds' in e ? e.maxRounds : '']) })}`,
  ].join('\n');
}

/** How a role is spelled in the simulator's choice keys. */
export function roleToken(role: string): string {
  return role.replace(/[:\s]+/g, '_');
}

export interface GraphExploration {
  runs: number;
  /** Every focus finished within its budget. */
  exhaustive: boolean;
  focuses: number;
  violation: (Exploration['violation'] & { focus: string }) | null;
}

/**
 * Every behaviour of each editing node, one at a time: the full product of a single helper
 * graph, else one exploration per helper node (and one for the testers) in which that node
 * branches and the others take the default answers. Linear in the nodes instead of their product,
 * so many-helper graphs stay affordable; interactions between two misbehaving helpers are
 * covered by the full product on graphs with one helper and by the golden scripts.
 */
export function exploreGraph(
  config: SimConfig,
  budget: number,
  full = false,
  /** Only these editing nodes branch, one at a time (layer 4's varied node). */
  onlyNodes?: readonly string[],
): GraphExploration {
  const roles = [...new Set((config.steps ?? []).map((s) => roleToken(s.role)))];
  const testers = new Set(['tester', 'Tester']);
  let focuses: (ReadonlySet<string> | undefined)[];
  if (onlyNodes !== undefined) {
    const graph = config.extra?.graph;
    focuses = onlyNodes.map((id) => {
      const node = graph?.nodes.find((n) => n.id === id);
      if (node?.type === 'tester') return testers;
      const role = Object.entries(config.helperFor ?? {}).find(([, h]) => h === id)?.[0];
      return new Set([roleToken(role ?? id)]);
    });
  } else {
    focuses =
      full || roles.length <= 1 ? [undefined] : [...roles.map((r) => new Set([r])), testers];
  }
  let runs = 0;
  let exhaustive = true;
  for (const focus of focuses) {
    const r = explore(config, budget, focus === undefined ? undefined : withTesters(focus, config));
    runs += r.runs;
    exhaustive &&= r.exhaustive;
    if (r.violation !== null) {
      return {
        runs,
        exhaustive: false,
        focuses: focuses.length,
        violation: { ...r.violation, focus: focus === undefined ? 'all' : [...focus].join(',') },
      };
    }
  }
  return { runs, exhaustive, focuses: focuses.length, violation: null };
}

/** The tester focus also names every tester node's role as its keys spell it. */
function withTesters(focus: ReadonlySet<string>, config: SimConfig): ReadonlySet<string> {
  if (!focus.has('tester')) return focus;
  const graph = config.extra?.graph;
  const labels = (graph?.nodes ?? [])
    .filter((n) => n.type === 'tester')
    .map((n) => roleToken(n.id === 'unit-tests' ? 'Tester' : n.label.slice(0, 60)));
  return new Set([...focus, ...labels]);
}
