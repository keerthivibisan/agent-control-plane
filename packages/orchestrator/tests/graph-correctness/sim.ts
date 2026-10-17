import type {
  ApprovalMode,
  ChangeReviewerMode,
  PlanStep,
  ProjectApprovals,
  ProjectWorkflow,
} from '@acp/core';
import {
  agentEvent,
  allowlistTarget,
  approvedPlan,
  beginChangeMerge,
  cancelRun,
  changeMergeBlocked,
  changeSealed,
  checkChangeAction,
  checkTicketBranchAction,
  completeCancellation,
  continueStages,
  createRun,
  decideApproval,
  decidePlan,
  evaluateAllowlist,
  isActiveAgentStatus,
  isLiveAgentStatus,
  isTerminalRunStatus,
  leadToolCall,
  ownerChat,
  pendingPlan,
  recordChangeDecision,
  recordReview,
  recordTicketBranchDecision,
  recoverAfterRestart,
  requestPermission,
  ticketBranchCreated,
  ticketRunPrompts,
  undecidedChanges,
} from '../../src/index.js';
import type {
  AllowlistVerdict,
  CreateRunInput,
  EngineAgent,
  EngineContext,
  EngineEffect,
  EngineResult,
  RunLimits,
  RunState,
} from '../../src/index.js';

/**
 * A deterministic run simulator (README "Graph correctness", layers 1, 2 and 5). It drives the
 * REAL engine commands with scripted fake agents, a fake server (seal, ticket branch, merge) and a
 * fake owner, and calls `onStep` after every engine call. No I/O, no clock, no real agent.
 *
 * Every behaviour that could differ between runs is a choice point answered by an `Oracle`: the
 * owner's plan decision, each helper turn's outcome, each change reviewer's verdict, each lead and
 * owner decision on a change, and each merge's outcome. A golden script answers by name; the
 * explorer (layer 2) enumerates every answer. The fake agents only read what a real one could
 * see (their own status, their change's state, the run's status) and the messages the engine
 * sends them: the lead is reactive, so a run where nothing wakes it is found stuck. Synthetic
 * data only.
 */

export interface ChoicePoint {
  /** `<what>:<role>:<round>[:<attempt>]`, stable across engines for the same script. */
  key: string;
  /** Non-empty; the oracle must return one of them. */
  options: readonly string[];
}
export type Oracle = (point: ChoicePoint) => string;

export interface PermissionStep {
  toolName: 'Edit' | 'Bash';
  /** Edit: a path inside the agent's worktree. */
  file?: string;
  command?: string;
}

export interface SimConfig {
  /** Phase 3 control-panel run: no ticket; the owner's first chat message starts the lead. */
  controlPanel?: boolean;
  workflow?: ProjectWorkflow;
  /** The review loop (ADR-0021); absent: the legacy flow. */
  loop?: { reviewer: ChangeReviewerMode; rounds: number };
  approvals?: ProjectApprovals;
  limits?: RunLimits;
  /** The plan's steps; the lead starts one helper per distinct role (or per helper node). */
  steps?: readonly PlanStep[];
  /** Tool uses every helper asks for in its first turn. */
  permissions?: readonly PermissionStep[];
  /** Interrupt the run once: a server restart or the owner's Stop all. */
  interrupt?: { when: 'first-ready' | 'first-helper'; kind: 'restart' | 'stop-all' };
  /** `workflow` only words the ticket prompts; the run gets none (graph runs). */
  omitWorkflow?: boolean;
  /** Extra `createRun` fields (the graph and its context). */
  extra?: Partial<CreateRunInput>;
  /** `start_agent.helper` per plan role (named helpers). */
  helperFor?: Readonly<Record<string, string>>;
  /** Plan steps carry their role's `helper` id too. */
  stepHelpers?: boolean;
}

export interface StepRecord {
  index: number;
  actor: string;
  action: string;
  before: RunState;
  after: RunState;
  /** Null for a step the fake server decided without the engine (a Full auto gate denial). */
  result: EngineResult<unknown> | null;
}

export interface SimHooks {
  /** The approval mode the server's gate and allowlist apply to this agent. */
  modeOf: (state: RunState, agent: EngineAgent) => ApprovalMode | undefined;
  onStep?: (step: StepRecord) => void;
}

export type SimOutcome =
  /** The run ended (completed, cancelled, failed). */
  | 'ended'
  /** The run waits on the owner in a state the fake owner has no answer for. */
  | 'owner-idle'
  /** Nothing can make progress and nobody is asked: the deadlock class. */
  | 'stuck'
  | 'step-limit';

export interface SimResult {
  state: RunState;
  outcome: SimOutcome;
  steps: number;
}

export const SIM_RUN = 'run-1';
export const SIM_LEAD = 'lead-1';
export const SIM_PROJECT = 'proj-1';
export const SIM_TICKET = 'ticket-1';
export const SIM_KEY = 'WEB-12';
export const SIM_BRANCH = 'acp/WEB-12';
const T0 = Date.parse('2026-10-11T10:00:00.000Z');

export const DEFAULT_STEPS: readonly PlanStep[] = [
  { title: 'Theme store', role: 'Store', detail: 'Persist the theme.' },
  { title: 'Toggle', role: 'UI', detail: 'Add the switch.' },
];

/** The project's harness checks the fake server knows (one exact command). */
const HARNESS = [{ id: 'test', argv: ['pnpm', 'test'] }];

type Ev =
  | { k: 'started'; id: string }
  | { k: 'turn'; id: string }
  | { k: 'resume'; id: string; perms: readonly PermissionStep[] }
  | { k: 'lead' }
  | { k: 'planner' }
  | { k: 'seal'; id: string }
  | { k: 'branch' }
  | { k: 'merge'; id: string; by: string; anyway: boolean };

/** The first option the oracle allows, guarding against an answer outside the options. */
function choose(oracle: Oracle, key: string, options: readonly string[]): string {
  const answer = oracle({ key, options });
  if (!options.includes(answer)) {
    throw new Error(`oracle answered ${answer} for ${key}, not one of ${options.join('|')}`);
  }
  return answer;
}

/** Runs one simulated ticket (or control-panel) run to its end, or until it is stuck. */
export function simulate(
  config: SimConfig,
  oracle: Oracle,
  hooks: SimHooks,
  maxSteps = 600,
): SimResult {
  let idCounter = 0;
  let clock = 0;
  const ctx = (): EngineContext => {
    clock += 1000;
    return { now: new Date(T0 + clock), newId: () => `gid-${++idCounter}` };
  };
  const limits = config.limits ?? { maxConcurrentHelpers: 3, maxDepth: 1 };
  const steps = config.steps ?? DEFAULT_STEPS;
  const queue: Ev[] = [];
  /** Approval id → the helper's remaining tool uses once it is decided. */
  const parked = new Map<string, { id: string; perms: readonly PermissionStep[] }>();
  /** Agent id → its last turn's outcome, for the seal. */
  const turnOutcome = new Map<string, string>();
  const mergeAttempts = new Map<string, number>();
  let index = 0;
  let interrupted = false;
  let state: RunState;

  const record = (
    actor: string,
    action: string,
    before: RunState,
    result: EngineResult<unknown> | null,
  ): void => {
    index++;
    hooks.onStep?.({ index, actor, action, before, after: state, result });
  };

  const agentOf = (id: string): EngineAgent | undefined => state.agents.find((a) => a.id === id);
  const lead = (): EngineAgent | undefined => state.agents.find((a) => a.kind === 'lead');
  const planner = (): EngineAgent | undefined => state.agents.find((a) => a.kind === 'planner');
  const roleKey = (a: EngineAgent): string => a.role.replace(/[:\s]+/g, '_');

  const enqueue = (ev: Ev): void => {
    if ((ev.k === 'lead' || ev.k === 'planner') && queue.some((q) => q.k === ev.k)) return;
    queue.push(ev);
  };

  const onEffects = (effects: readonly EngineEffect[]): void => {
    for (const e of effects) {
      switch (e.type) {
        case 'start-agent':
          enqueue({ k: 'started', id: e.agentRunId });
          break;
        case 'send-to-agent': {
          const to = agentOf(e.agentRunId);
          if (to?.kind === 'lead') enqueue({ k: 'lead' });
          else if (to?.kind === 'planner') enqueue({ k: 'planner' });
          break;
        }
        case 'seal-change':
          enqueue({ k: 'seal', id: e.agentRunId });
          break;
        case 'create-ticket-branch':
          enqueue({ k: 'branch' });
          break;
        case 'merge-change':
          enqueue({ k: 'merge', id: e.agentRunId, by: e.by, anyway: e.anyway });
          break;
        case 'resolve-permission': {
          const p = parked.get(e.approvalId);
          if (p !== undefined) {
            parked.delete(e.approvalId);
            enqueue({ k: 'resume', id: p.id, perms: p.perms });
          }
          break;
        }
        case 'abort-agent': {
          // The process is gone: drop what it would still have done.
          for (let i = queue.length - 1; i >= 0; i--) {
            const q = queue[i];
            if (q !== undefined && 'id' in q && q.id === e.agentRunId && q.k !== 'seal') {
              queue.splice(i, 1);
            }
          }
          break;
        }
        default:
          break;
      }
    }
  };

  const apply = <T>(
    actor: string,
    action: string,
    fn: (s: RunState, c: EngineContext) => EngineResult<T>,
  ): EngineResult<T> => {
    const before = state;
    const result = fn(state, ctx());
    if (result.ok) state = result.state;
    record(actor, action, before, result);
    if (result.ok) onEffects(result.effects);
    return result;
  };

  const tool = (caller: EngineAgent, actor: string, name: string, input: unknown) =>
    apply(actor, `${name} ${JSON.stringify(input)}`, (s, c) =>
      leadToolCall(
        s,
        { callerAgentRunId: caller.id, name, input, registeredProjectIds: [SIM_PROJECT] },
        c,
      ),
    );

  const planInput = () => ({
    summary: 'Add a theme store and a settings toggle.',
    steps: steps.map((s) =>
      config.stepHelpers === true && config.helperFor?.[s.role] !== undefined
        ? { ...s, helper: config.helperFor[s.role] }
        : s,
    ),
  });

  // ---------------------------------------------------------------- create

  const ticketFields = (() => {
    if (config.controlPanel === true) return {};
    const prompts = ticketRunPrompts(
      {
        key: SIM_KEY,
        title: 'Dark mode',
        type: 'feature',
        priority: 'medium',
        description: 'Add dark mode.',
      },
      limits,
      config.workflow,
      { fullAuto: config.approvals?.mode === 'full-auto' },
    );
    return { ticket: { ticketId: SIM_TICKET, ...prompts } };
  })();
  const input: CreateRunInput = {
    runId: SIM_RUN,
    leadAgentRunId: SIM_LEAD,
    projectId: SIM_PROJECT,
    title: 'WEB-12 Dark mode',
    budget: { maxTokensPerAgent: 100_000, softCostUsdPerRun: null },
    limits,
    ...ticketFields,
    ...(config.workflow !== undefined && config.omitWorkflow !== true
      ? { workflow: config.workflow }
      : {}),
    ...(config.loop !== undefined
      ? {
          reviewLoop: {
            ticketKey: SIM_KEY,
            reviewer: config.loop.reviewer,
            maxReworkRounds: config.loop.rounds,
          },
        }
      : {}),
    ...(config.approvals !== undefined ? { approvals: config.approvals } : {}),
    ...config.extra,
    registeredProjectIds: [SIM_PROJECT],
  };
  const created = createRun(input, ctx());
  if (!created.ok) {
    throw new Error(`createRun refused: ${created.refusal.code}: ${created.refusal.message}`);
  }
  state = created.state;
  const empty: RunState = { ...state, agents: [] };
  record('owner', 'create run', empty, created);
  onEffects(created.effects);
  if (config.controlPanel === true) {
    apply('owner', 'chat', (s, c) => ownerChat(s, 'Build the dark mode.', c));
  }

  // ---------------------------------------------------------------- fake agents

  const helperRoles = (): string[] => [...new Set(steps.map((s) => s.role))];
  const startedRoles = (): Set<string> => {
    const leadId = lead()?.id;
    return new Set(
      state.agents
        .filter((a) => a.kind === 'worker' && a.parentAgentRunId === leadId)
        .map((a) => a.role),
    );
  };

  const leadAct = (): void => {
    const l = lead();
    if (l === undefined || l.status !== 'RUNNING') return;
    const status = state.run.status;
    // 1. Plan (lead mode).
    if (status === 'PLANNING') {
      if (planner() === undefined && pendingPlan(state) === undefined) {
        const r = tool(l, 'lead', 'submit_plan', planInput());
        if (r.ok) enqueue({ k: 'lead' });
      }
      return;
    }
    // 2. Decide one change (review loop).
    if (state.integration !== undefined) {
      for (const a of state.agents) {
        const c = a.change;
        if (c === undefined || c.merging || c.checks === 'pending') continue;
        const atLead = c.state === 'decision' || (c.state === 'reviewing' && c.reviewer === 'lead');
        if (!atLead) continue;
        const options = (['merge', 'rework', 'discard', 'ask-owner'] as const).filter(
          (o) => checkChangeAction(state, a.id, o, 'lead') === null,
        );
        if (options.length === 0) continue;
        const choice = choose(oracle, `lead:${roleKey(a)}:${c.round}`, options);
        const r =
          choice === 'merge'
            ? tool(l, 'lead', 'merge_change', { agentId: a.id })
            : choice === 'rework'
              ? tool(l, 'lead', 'request_rework', { agentId: a.id, comments: 'Fix the edge case.' })
              : choice === 'discard'
                ? tool(l, 'lead', 'discard_change', { agentId: a.id, reason: 'Not needed.' })
                : tool(l, 'lead', 'ask_owner', { agentId: a.id, question: 'Should this go in?' });
        // A merge's reply comes once the server merged; anything else returns at once.
        if (choice !== 'merge' || !r.ok) enqueue({ k: 'lead' });
        return;
      }
    }
    // 3. Start the next helper the plan needs.
    const planned = config.controlPanel === true || approvedPlan(state) !== undefined;
    const active = status === 'RUNNING' || status === 'BLOCKED';
    if (active && planned && state.integration?.handedOver !== true) {
      const started = startedRoles();
      const role = helperRoles().find((r) => !started.has(r));
      if (role !== undefined) {
        const helper = config.helperFor?.[role];
        const r = tool(l, 'lead', 'start_agent', {
          role,
          task: `Build the ${role}.`,
          ...(helper !== undefined ? { helper } : {}),
        });
        if (r.ok) enqueue({ k: 'lead' });
        // Refused (no slot yet, branch pending): try again on the next message.
        return;
      }
    }
    if (!active) return;
    const allStarted = startedRoles().size >= helperRoles().length;
    const othersActive = state.agents.some(
      (a) => a.kind !== 'lead' && isActiveAgentStatus(a.status),
    );
    // 4. Hand over (review loop): every change decided, nobody else working.
    if (state.integration !== undefined) {
      if (
        !state.integration.handedOver &&
        allStarted &&
        !othersActive &&
        undecidedChanges(state).length === 0
      ) {
        const r = tool(l, 'lead', 'request_review', {});
        if (r.ok) enqueue({ k: 'lead' });
      }
      return;
    }
    // 5. Legacy: the helpers are done; the owner reviews.
    if (allStarted && !othersActive) tool(l, 'lead', 'request_review', {});
  };

  const plannerAct = (): void => {
    const p = planner();
    if (p === undefined || p.status !== 'RUNNING') return;
    if (state.run.status === 'PLANNING' && pendingPlan(state) === undefined) {
      tool(p, 'planner', 'submit_plan', planInput());
    }
  };

  const permission = (a: EngineAgent, step: PermissionStep): 'parked' | 'go' => {
    const toolInput =
      step.toolName === 'Edit'
        ? {
            file_path: `/wt/${a.id}/${step.file ?? 'src/app.ts'}`,
            old_string: 'a',
            new_string: 'b',
          }
        : { command: step.command ?? 'ls' };
    const target = allowlistTarget(step.toolName, toolInput);
    const mode = hooks.modeOf(state, a);
    const policy = state.approvalPolicy;
    let verdict: AllowlistVerdict | undefined;
    if (target !== null && policy !== undefined && mode !== undefined) {
      verdict = evaluateAllowlist({
        policy: { ...policy, mode },
        agentKind: a.kind,
        target,
        resolvedPath: target.kind === 'edit' ? target.path : null,
        worktreeRoot: `/wt/${a.id}`,
        checks: HARNESS,
      });
    }
    const label = `${step.toolName} ${step.file ?? step.command ?? ''}`.trim();
    // ADR-0022: in Full auto nothing waits for the owner; a request the rules do not allow is
    // denied by the server's gate without reaching the engine.
    if (mode === 'full-auto' && verdict?.allowed !== true) {
      const before = state;
      record('server', `full-auto gate denies ${label} for ${a.id}`, before, null);
      return 'go';
    }
    const r = apply(roleKey(a), `ask ${label}`, (s, c) =>
      requestPermission(
        s,
        { agentRunId: a.id, toolName: step.toolName, toolUseId: `tu-${index}`, summary: label },
        c,
        verdict === undefined ? {} : { allowlist: verdict },
      ),
    );
    if (r.ok && r.value.status === 'pending') return 'parked';
    return 'go';
  };

  const finishTurn = (a: EngineAgent): void => {
    const loop = state.integration !== undefined;
    const round = a.change?.round ?? 0;
    const options = loop ? ['changed', 'no-changes', 'error'] : ['success', 'error'];
    const outcome =
      a.kind === 'tester'
        ? choose(oracle, `tester-turn:${round}`, options)
        : choose(oracle, `turn:${roleKey(a)}:${round}`, options);
    turnOutcome.set(a.id, outcome);
    apply(roleKey(a), `finish ${outcome}`, (s, c) =>
      agentEvent(
        s,
        a.id,
        {
          type: 'finished',
          outcome: outcome === 'error' ? 'error' : 'success',
          reportedCostUsd: null,
        },
        c,
      ),
    );
  };

  const workTurn = (id: string, perms: readonly PermissionStep[]): void => {
    for (let i = 0; i < perms.length; i++) {
      const a = agentOf(id);
      const step = perms[i];
      if (a === undefined || a.status !== 'RUNNING' || step === undefined) return;
      if (permission(a, step) === 'parked') {
        const approval = state.approvals.find(
          (p) => p.agentRunId === id && p.status === 'pending' && p.kind === 'tool-use',
        );
        if (approval !== undefined) parked.set(approval.id, { id, perms: perms.slice(i + 1) });
        return;
      }
    }
    const a = agentOf(id);
    if (a !== undefined && a.status === 'RUNNING') finishTurn(a);
  };

  const turn = (id: string): void => {
    const a = agentOf(id);
    if (a === undefined || a.status !== 'RUNNING') return;
    switch (a.kind) {
      case 'lead':
        enqueue({ k: 'lead' });
        return;
      case 'planner':
        enqueue({ k: 'planner' });
        return;
      case 'worker':
      case 'tester': {
        const first = a.change === undefined && !turnOutcome.has(a.id);
        workTurn(id, first && a.kind === 'worker' ? (config.permissions ?? []) : []);
        return;
      }
      case 'reviewer': {
        if (a.reviewsAgentRunId !== undefined) {
          const helper = agentOf(a.reviewsAgentRunId);
          const round = helper?.change?.round ?? 0;
          const role = helper === undefined ? 'unknown' : roleKey(helper);
          const verdict = choose(oracle, `verdict:${role}:${round}`, ['approve', 'rework']);
          tool(a, roleKey(a), 'submit_review', {
            verdict,
            findings: verdict === 'approve' ? 'Looks right.' : 'Handle the empty case.',
          });
        } else {
          tool(a, roleKey(a), 'post_review', { text: 'Consider a test for the toggle.' });
        }
        const now = agentOf(id);
        if (now !== undefined && now.status === 'RUNNING') {
          apply(roleKey(now), 'finish success', (s, c) =>
            agentEvent(s, id, { type: 'finished', outcome: 'success', reportedCostUsd: null }, c),
          );
        }
        return;
      }
    }
  };

  // ---------------------------------------------------------------- fake server

  const seal = (id: string): void => {
    const a = agentOf(id);
    if (a?.change?.state !== 'sealing') return;
    const outcome = turnOutcome.get(id) ?? 'changed';
    const changed = outcome !== 'no-changes';
    apply('server', `seal ${changed ? 'changed' : 'unchanged'}`, (s, c) =>
      changeSealed(
        s,
        id,
        {
          changed,
          headCommit: changed ? `c0ffee${(a.change?.round ?? 0).toString(16)}` : null,
          changedFiles: changed ? 2 : 0,
        },
        c,
      ),
    );
  };

  const merge = (id: string, by: string, anyway: boolean): void => {
    const a = agentOf(id);
    const c = a?.change;
    if (a === undefined || c === undefined || !c.merging) return;
    const key = `${id}:${c.round}`;
    const attempt = mergeAttempts.get(key) ?? 0;
    mergeAttempts.set(key, attempt + 1);
    const options = anyway
      ? ['merged', 'conflict', 'no-changes']
      : ['merged', 'checks-failed', 'conflict', 'no-changes'];
    const role = a.kind === 'tester' ? 'tester' : roleKey(a);
    const outcome = choose(oracle, `merge:${role}:${c.round}:${attempt}`, options);
    const decider = by === 'owner' ? 'owner' : 'lead';
    if (outcome === 'merged' || outcome === 'no-changes') {
      apply('server', `merged ${outcome}`, (s, cx) =>
        recordChangeDecision(
          s,
          id,
          {
            decision: anyway ? 'merge-anyway' : 'merge',
            by: decider,
            outcome,
            ...(outcome === 'merged' ? { headCommit: 'beef0001' } : {}),
          },
          cx,
        ),
      );
    } else {
      apply('server', `merge blocked ${outcome}`, (s, cx) =>
        changeMergeBlocked(
          s,
          id,
          outcome === 'conflict'
            ? { reason: 'merge-conflict', files: ['src/app.ts'] }
            : { reason: 'checks-failed', failed: ['test'] },
          cx,
        ),
      );
    }
    if (decider === 'lead') enqueue({ k: 'lead' });
  };

  // ---------------------------------------------------------------- fake owner

  const ownerAct = (): boolean => {
    const status = state.run.status;
    if (status === 'CANCELLING') {
      apply('server', 'cancellation complete', (s, c) => completeCancellation(s, c));
      return true;
    }
    if (isTerminalRunStatus(status)) return false;
    for (const p of state.approvals) {
      if (p.status !== 'pending') continue;
      const a = agentOf(p.agentRunId);
      if (p.kind === 'budget-raise') {
        apply('owner', 'raise budget', (s, c) => decideApproval(s, p.id, 'approve', c));
        return true;
      }
      const role = a === undefined ? 'unknown' : roleKey(a);
      const d = choose(oracle, `approval:${role}:${p.toolName ?? ''}`, ['approve', 'deny']);
      apply('owner', `${d} ${p.toolName ?? ''}`, (s, c) =>
        decideApproval(s, p.id, d === 'approve' ? 'approve' : 'deny', c),
      );
      return true;
    }
    const plan = pendingPlan(state);
    if (status === 'PLAN_REVIEW' && plan !== undefined) {
      const d = choose(oracle, `plan:${plan.version}`, ['approve', 'request-changes']);
      apply('owner', `plan ${d}`, (s, c) =>
        d === 'approve'
          ? decidePlan(s, plan.id, 'approve', c)
          : decidePlan(s, plan.id, 'request-changes', c, 'Split the work differently.'),
      );
      return true;
    }
    if (state.integration !== undefined) {
      for (const a of state.agents) {
        const c = a.change;
        if (c?.state !== 'needs-owner' || c.merging) continue;
        const options = (['merge', 'merge-anyway', 'rework', 'discard'] as const).filter(
          (o) => checkChangeAction(state, a.id, o, 'owner') === null,
        );
        if (options.length === 0) continue;
        const role = a.kind === 'tester' ? 'tester' : roleKey(a);
        const d = choose(oracle, `owner-change:${role}:${c.round}`, options);
        if (d === 'merge' || d === 'merge-anyway') {
          apply('owner', d, (s, cx) =>
            beginChangeMerge(s, a.id, { by: 'owner', anyway: d === 'merge-anyway' }, cx),
          );
        } else {
          apply('owner', d, (s, cx) =>
            recordChangeDecision(
              s,
              a.id,
              d === 'rework'
                ? { decision: 'rework', by: 'owner', comments: 'Please fix the toggle.' }
                : { decision: 'discard', by: 'owner', comments: 'Not this time.' },
              cx,
            ),
          );
        }
        return true;
      }
    } else if (status === 'REVIEW' || status === 'NEEDS_REVIEW') {
      for (const a of state.agents) {
        if (a.kind !== 'worker' && a.kind !== 'tester') continue;
        if (isLiveAgentStatus(a.status) || a.review !== 'pending') continue;
        const role = a.kind === 'tester' ? 'tester' : roleKey(a);
        const d = choose(oracle, `legacy-review:${role}`, ['merged', 'discarded', 'no-changes']);
        apply('owner', `review ${d}`, (s, c) =>
          recordReview(s, a.id, d as 'merged' | 'discarded' | 'no-changes', c),
        );
        return true;
      }
    }
    if (state.stagesHeld === true && status === 'REVIEW') {
      const r = apply('owner', 'continue', (s, c) => continueStages(s, c));
      if (r.ok) return true;
    }
    if (state.integration !== undefined) {
      if (status === 'REVIEW' && checkTicketBranchAction(state, 'merge') === null) {
        apply('owner', 'merge ticket branch', (s, c) => recordTicketBranchDecision(s, 'merged', c));
        return true;
      }
      if (status === 'NEEDS_REVIEW' && checkTicketBranchAction(state, 'discard') === null) {
        apply('owner', 'discard ticket branch', (s, c) =>
          recordTicketBranchDecision(s, 'discarded', c),
        );
        return true;
      }
    }
    return false;
  };

  // ---------------------------------------------------------------- interrupts

  const maybeInterrupt = (): void => {
    const spec = config.interrupt;
    if (spec === undefined || interrupted) return;
    const hit =
      spec.when === 'first-ready'
        ? state.agents.some((a) => a.change !== undefined && a.change.state !== 'sealing')
        : state.agents.some((a) => a.kind === 'worker' && a.status === 'RUNNING');
    if (!hit) return;
    interrupted = true;
    if (spec.kind === 'restart') {
      apply('server', 'restart', (s, c) => recoverAfterRestart(s, c));
      // Every process is gone; nothing relaunches.
      queue.length = 0;
      parked.clear();
    } else {
      apply('owner', 'stop all', (s, c) => cancelRun(s, c));
    }
  };

  // ---------------------------------------------------------------- the loop

  while (index < maxSteps) {
    const ev = queue.shift();
    if (ev === undefined) {
      if (!ownerAct()) break;
      maybeInterrupt();
      continue;
    }
    switch (ev.k) {
      case 'started': {
        const a = agentOf(ev.id);
        if (a === undefined || a.status !== 'STARTING') break;
        apply(roleKey(a), 'started', (s, c) =>
          agentEvent(
            s,
            ev.id,
            { type: 'started', providerSessionId: `sess:${ev.id}`, model: null },
            c,
          ),
        );
        enqueue({ k: 'turn', id: ev.id });
        break;
      }
      case 'turn':
        turn(ev.id);
        break;
      case 'resume':
        workTurn(ev.id, ev.perms);
        break;
      case 'lead':
        leadAct();
        // Legacy leads poll their helpers; loop leads only act on messages.
        break;
      case 'planner':
        plannerAct();
        break;
      case 'seal':
        seal(ev.id);
        break;
      case 'branch':
        if (state.integration?.ticketBranch === null && !isTerminalRunStatus(state.run.status)) {
          apply('server', 'ticket branch created', (s, c) => ticketBranchCreated(s, SIM_BRANCH, c));
          enqueue({ k: 'lead' });
        }
        break;
      case 'merge':
        merge(ev.id, ev.by, ev.anyway);
        break;
    }
    // A legacy lead polls: it looks again after anything else happened.
    if (state.integration === undefined && ev.k !== 'lead' && lead()?.status === 'RUNNING') {
      enqueue({ k: 'lead' });
    }
    maybeInterrupt();
  }

  const status = state.run.status;
  let outcome: SimOutcome;
  if (index >= maxSteps) outcome = 'step-limit';
  else if (isTerminalRunStatus(status)) outcome = 'ended';
  else if (status === 'REVIEW' || status === 'NEEDS_REVIEW' || status === 'PLAN_REVIEW') {
    outcome = 'owner-idle';
  } else outcome = 'stuck';
  return { state, outcome, steps: index };
}
