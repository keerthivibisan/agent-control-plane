import {
  changeCheckBlockOf,
  checkChangeAction,
  programOf,
  reviewRouteOf,
} from '../../src/index.js';
import type { EngineAgent, RunState } from '../../src/index.js';
import { roleToken } from '../graph-correctness/explore.js';
import { agentModeOf } from '../graph-correctness/golden.js';
import { endInvariants, stepInvariants } from '../graph-correctness/invariants.js';
import { simulate } from '../graph-correctness/sim.js';
import type { ChoicePoint, Oracle, SimConfig, StepRecord } from '../graph-correctness/sim.js';

/**
 * Adversarial invariants for the graph-correctness simulator (T-1), checked after every engine
 * step next to the existing safety invariants. They are about termination and liveness under a
 * persistent lead, and read only the step's states and effects:
 * - `[bounded]` every editing agent is started (first turn plus rework turns) at most
 *   1 + the lead's rounds + a direct reviewer's rounds + its Checks block's rounds + one round the
 *   owner grants (the model owner grants one); the whole run starts at most a fixed multiple of
 *   its editing agents;
 * - `[lead-progress]` a change waiting for the lead always leaves the lead an action the engine
 *   accepts (merge, rework, discard or ask the owner), unless a merge or its checks are under way;
 * - `[owner-progress]` a change waiting for the owner always leaves the owner such an action.
 * Synthetic data only.
 */

const EDITING: readonly EngineAgent['kind'][] = ['worker', 'tester'];
/** The model owner of the explorer grants one extra rework round per change. */
const OWNER_ROUNDS = 1;
const LEAD_ACTIONS = ['merge', 'rework', 'discard', 'ask-owner'] as const;
const OWNER_ACTIONS = ['merge', 'merge-anyway', 'rework', 'discard'] as const;

function startLimit(state: RunState, agent: EngineAgent): number {
  const program = programOf(state);
  const route = reviewRouteOf(program, agent);
  const reviewer = route.by === 'agent' && route.then === 'direct' ? route.reviewerRounds : 0;
  const block = changeCheckBlockOf(program, agent);
  const checks = block?.onFailure === 'helper' ? (block.maxRounds ?? 0) : 0;
  return 1 + route.leadRounds + reviewer + checks + OWNER_ROUNDS;
}

const deciding = (s: RunState) => s.run.status === 'RUNNING' || s.run.status === 'BLOCKED';

/** One run's checker: it counts starts across the run's steps. */
export function adversarialChecker(): (step: StepRecord) => string[] {
  const starts = new Map<string, number>();
  let total = 0;
  return (step) => {
    const out: string[] = [];
    const { after, result } = step;
    const effects = result !== null && result.ok ? result.effects : [];
    for (const e of effects) {
      if (e.type !== 'start-agent') continue;
      total++;
      const n = (starts.get(e.agentRunId) ?? 0) + 1;
      starts.set(e.agentRunId, n);
      const agent = after.agents.find((a) => a.id === e.agentRunId);
      if (agent === undefined || !EDITING.includes(agent.kind)) continue;
      const limit = startLimit(after, agent);
      if (n > limit) out.push(`[bounded] ${agent.role} started ${n} times (limit ${limit})`);
    }
    const editing = after.agents.filter((a) => EDITING.includes(a.kind)).length;
    // Lead, planner, final reviewers (a few), and per editing agent its turns and change reviews.
    const runLimit = 6 + editing * 2 * 8;
    if (total > runLimit)
      out.push(`[bounded] ${total} agent starts in one run (limit ${runLimit})`);

    for (const a of after.agents) {
      const c = a.change;
      if (c === undefined || c.merging || c.checks === 'pending') continue;
      if (c.blockChecks === 'pending') continue;
      const atLead = c.state === 'decision' || (c.state === 'reviewing' && c.reviewer === 'lead');
      if (atLead && deciding(after)) {
        const ok = LEAD_ACTIONS.some((x) => checkChangeAction(after, a.id, x, 'lead') === null);
        if (!ok) out.push(`[lead-progress] the lead has no accepted action on ${a.role}'s change`);
      }
      if (c.state === 'needs-owner' && (deciding(after) || after.run.status === 'REVIEW')) {
        const ok = OWNER_ACTIONS.some((x) => checkChangeAction(after, a.id, x, 'owner') === null);
        if (!ok)
          out.push(`[owner-progress] the owner has no accepted action on ${a.role}'s change`);
      }
    }
    return out;
  };
}

/** The answers explored at each kind of choice point (as graph-correctness/explore.ts does). */
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
      return round === 0 ? point.options : point.options.slice(0, 1);
    case 'merge': {
      // A persistent lead meets blocked merges, a conflict included; a conflict on every later
      // attempt too would only model an owner who clicks "merge anyway" forever (their choice).
      const attempt = Number(point.key.split(':')[3] ?? '0');
      return point.options.filter((o) => o !== 'no-changes' && (o !== 'conflict' || attempt === 0));
    }
    case 'owner-change':
      return point.options.filter((o) => o !== 'rework' || round < OWNER_ROUNDS);
    default:
      return point.options;
  }
}

class Pruned extends Error {}

export interface AdversarialExploration {
  runs: number;
  exhaustive: boolean;
  violation: { problems: string[]; choices: string[]; focus: string } | null;
}

/**
 * Every behaviour of one simulated run (depth first over the choice points, explored states
 * pruned by fingerprint), with the existing step and end invariants and the adversarial ones.
 * `focus`: the roles whose choices branch (the rest answer by default); undefined: all.
 */
function exploreOne(
  config: SimConfig,
  budget: number,
  focus: ReadonlySet<string> | undefined,
): Omit<AdversarialExploration, 'violation'> & {
  violation: { problems: string[]; choices: string[] } | null;
} {
  const seen = new Set<string>();
  let prefix: number[] = [];
  let runs = 0;
  for (;;) {
    const sizes: number[] = [];
    const chosen: number[] = [];
    const trail: string[] = [];
    const check = adversarialChecker();
    let problems: string[] = [];
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
          if (problems.length > 0) return;
          problems = [...stepInvariants(step), ...check(step)];
        },
      });
      if (problems.length === 0) problems = endInvariants(result);
    } catch (error) {
      if (!(error instanceof Pruned)) throw error;
    }
    runs++;
    if (problems.length > 0) {
      return { runs, exhaustive: false, violation: { problems, choices: trail } };
    }
    let i = chosen.length - 1;
    while (i >= 0 && (chosen[i] ?? 0) >= (sizes[i] ?? 1) - 1) i--;
    if (i < 0) return { runs, exhaustive: true, violation: null };
    if (runs >= budget) return { runs, exhaustive: false, violation: null };
    prefix = [...chosen.slice(0, i), (chosen[i] ?? 0) + 1];
  }
}

/** One exploration per helper role (and one for the testers), as `exploreGraph` does. */
export function exploreAdversarial(config: SimConfig, budget: number): AdversarialExploration {
  const roles = [...new Set((config.steps ?? []).map((s) => roleToken(s.role)))];
  const testerRoles = (config.extra?.graph?.nodes ?? [])
    .filter((n) => n.type === 'tester')
    .map((n) => roleToken(n.id === 'unit-tests' ? 'Tester' : n.label.slice(0, 60)));
  const focuses: (ReadonlySet<string> | undefined)[] =
    roles.length <= 1
      ? [undefined]
      : [...roles.map((r) => new Set([r])), new Set(['tester', 'Tester', ...testerRoles])];
  let runs = 0;
  let exhaustive = true;
  for (const focus of focuses) {
    const r = exploreOne(config, budget, focus);
    runs += r.runs;
    exhaustive &&= r.exhaustive;
    if (r.violation !== null) {
      const name = focus === undefined ? 'all' : [...focus].join(',');
      return { runs, exhaustive: false, violation: { ...r.violation, focus: name } };
    }
  }
  return { runs, exhaustive, violation: null };
}
