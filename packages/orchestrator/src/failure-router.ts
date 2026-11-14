import type {
  FailureContext,
  FailureEvent,
  ProgramFailureRoute,
  WorkflowNodeId,
  WorkflowProgram,
} from '@acp/core';
import { AGENT_NOTE_LINE } from './agent-note.js';
import { OWNER_NOTE_DATA, inlineLabel, noteNodeName, quote } from './arrow-notes.js';
import type { Draft } from './draft.js';
import { renderFailureContext } from './failure-context.js';
import {
  nodeFixBlocked,
  reopenForFix,
  reworkBlocked,
  reworkForFix,
  startNodeFix,
} from './fix-turn.js';
import { applyCommand } from './commands.js';
import { refusal } from './errors.js';
import { isFinalChangeState, notifyLead } from './loop.js';
import { helperNodeLines, programOf, sameLabel } from './program.js';
import { stageOf } from './stages.js';
import type { EngineAgent, EngineContext, EngineFix, EngineResult, RunState } from './state.js';
import { isActiveAgentStatus } from './transitions.js';

/**
 * ADR-0038 §4 (FR-5): the failure router. Every failure event (a tester's failing tests, a Checks
 * block's failing checks or harness, a change reviewer's rework, a merge conflict) asks
 * `routeFailure` first. Only the owner's When arrows route here; without one (`none`), and for
 * the routes read from today's settings (`derived`: rework arrows, "back to the helper"), the
 * caller keeps today's engine path, so those runs behave exactly as before.
 *
 * - Target a helper block: a fix turn on it. When the failing change is not decided and belongs
 *   to that block's helper, the helper reworks it (same worktree and session); otherwise a new
 *   helper of the block starts from the ticket branch with the block's settings.
 * - Target Author: `findAuthors` in the failure context; exactly one known author gets a fix turn
 *   on its block as above; several or none go to the lead with the reason.
 * - Target the Lead: the lead gets the context and the arrow's purpose, and decides.
 *
 * Rounds count per When arrow and failure lineage (the failing change, or the ticket branch for a
 * merge conflict without one; a fixer's change keeps the lineage of the fix it was started for):
 * a fix turn uses one; once `maxRounds` are used the failure goes to the lead ("rounds used up").
 * A fix that cannot start now (no helper slot, no room in the block, the helper over budget or
 * busy, the run not going) is not queued: it goes to the lead with the reason, like today's direct
 * rework. The lead is told about every fix with the context, and may move it (`reroute_fix`, once
 * per round to a helper; moving uses no round) or stop it.
 */

/** The owner's When route for `event` at `sourceNodeId` (any source when undefined), if any. */
export function whenRouteFor(
  program: WorkflowProgram,
  event: FailureEvent,
  sourceNodeId: WorkflowNodeId | undefined,
): ProgramFailureRoute | undefined {
  return program.failureRoutes?.find(
    (r) =>
      r.derived !== true &&
      r.events.includes(event) &&
      (sourceNodeId === undefined || r.sourceNodeId === sourceNodeId),
  );
}

/** One failure, as the caller saw it. */
export interface FailureInput {
  /** The failure context (without rounds; the router adds the route's). */
  context: FailureContext;
  /** The block where it happened; undefined matches any source (a merge conflict). */
  sourceNodeId: WorkflowNodeId | undefined;
  /** The agent whose change failed, when the failure is about one. */
  change?: EngineAgent;
  /** The failure's lineage for rounds: the failing change's agent id, or `ticket`. */
  lineage: string;
  /** The lead's first sentence: what failed. */
  headline: string;
  /** What the lead may do when it decides (its tools for this kind of failure). */
  decideLine: string;
}

export type RouteOutcome =
  /** No When arrow routes it: the caller does what it did before ADR-0038 §4. */
  | { kind: 'none' }
  /** The lead decides (route to the lead, rounds used up, or the fix could not start). */
  | { kind: 'lead' }
  /** A fix turn started: the failing change's own helper reworks it, or a new helper. */
  | { kind: 'fixing'; fix: EngineFix; fixer: EngineAgent };

const EVENT_NAMES: Readonly<Record<FailureEvent, string>> = {
  'tests-failed': 'failing tests',
  'checks-failed': 'failing checks',
  'review-rework': 'a review asking for rework',
  'harness-failed': 'a harness that could not run',
  'merge-conflict': 'a merge conflict',
};

/** The When arrow's name in a sentence: `When arrow "label"`, or `When arrow`. */
function arrowName(route: Pick<ProgramFailureRoute, 'label'>): string {
  return route.label === undefined ? 'When arrow' : `When arrow "${inlineLabel(route.label)}"`;
}

/** The arrow's purpose as a quoted owner note, or nothing. */
export function purposeBlocks(route: Pick<ProgramFailureRoute, 'label' | 'purpose'>): string[] {
  if (route.purpose === undefined) return [];
  return [
    `Owner's note on this ${arrowName(route)} (${OWNER_NOTE_DATA}):\n${quote(route.purpose)}`,
  ];
}

/**
 * The failure's lineage for rounds (FR-7): a fixer's own change inherits the lineage of the fix
 * it was started for, so a chain of fixers (a fixer's change failing again, moved or not) keeps
 * counting the same rounds instead of starting fresh ones.
 */
function lineageOf(d: Draft, input: FailureInput): string {
  const changeId = input.change?.id;
  if (changeId === undefined) return input.lineage;
  const fix = d.fixes?.find((f) => f.fixerAgentRunId === changeId);
  return fix?.lineage ?? input.lineage;
}

function roundsKeyOf(route: ProgramFailureRoute, lineage: string): string {
  return `${route.edgeId ?? `${route.sourceNodeId}:${route.events.join(',')}`}#${lineage}`;
}

function eventOf(input: FailureInput): FailureEvent {
  return input.context.event;
}

/** The lead decides: the reason, the context, the arrow's purpose and its tools. */
function toLead(
  d: Draft,
  input: FailureInput,
  route: ProgramFailureRoute,
  why: string,
  reason: 'target-lead' | 'rounds-used' | 'blocked' | 'author-unclear',
  rounds: { used: number; max: number } | undefined,
): RouteOutcome {
  notifyLead(
    d,
    [
      `${input.headline} ${why}`,
      renderFailureContext({ ...input.context, ...(rounds !== undefined ? { rounds } : {}) }),
      ...purposeBlocks(route),
      input.decideLine,
    ].join('\n\n'),
  );
  d.effects.push({
    type: 'failure-routed',
    kind: 'to-lead',
    event: eventOf(input),
    fixId: null,
    fixerAgentRunId: null,
    targetNodeId: null,
    sourceNodeId: input.sourceNodeId ?? null,
    round: rounds?.used ?? null,
    maxRounds: rounds?.max ?? null,
    reason,
  });
  return { kind: 'lead' };
}

/** The one known author's block and role, when there is exactly one. */
function soleAuthorOf(
  d: Draft,
  context: FailureContext,
): { soleAuthor?: NonNullable<EngineFix['soleAuthor']> } {
  const first = context.authors[0];
  if (!context.authorsKnown || context.authors.length !== 1 || first === undefined) return {};
  const agent = d.agent(first.agentId);
  return {
    soleAuthor: {
      nodeId: agent === undefined ? first.nodeId : stageOf(agent),
      role: agent?.role ?? first.label,
    },
  };
}

/** Who fixes, after resolving Author: a helper node, or why the lead decides instead. */
type Resolved =
  | { ok: true; nodeId: WorkflowNodeId; role: string }
  | { ok: false; why: string; reason: 'author-unclear' | 'blocked' };

function resolveTarget(d: Draft, input: FailureInput, route: ProgramFailureRoute): Resolved {
  const program = programOf(d);
  if (route.target.kind === 'node') {
    const nodeId = route.target.nodeId;
    const node = program.helpers.find((h) => h.id === nodeId);
    if (node === undefined) {
      return { ok: false, why: 'its target is not a helper block', reason: 'blocked' };
    }
    return { ok: true, nodeId, role: node.label };
  }
  const { authors, authorsKnown } = input.context;
  const first = authors[0];
  if (!authorsKnown || authors.length !== 1 || first === undefined) {
    return {
      ok: false,
      reason: 'author-unclear',
      why:
        authors.length === 0
          ? 'no helper change is known'
          : authorsKnown
            ? 'several helpers changed the failing files'
            : "no helper's change matches the failing files",
    };
  }
  const agent = d.agent(first.agentId);
  const nodeId = agent === undefined ? first.nodeId : stageOf(agent);
  if (!program.helpers.some((h) => h.id === nodeId)) {
    return { ok: false, why: "the author's block is not a helper block", reason: 'blocked' };
  }
  return { ok: true, nodeId, role: agent?.role ?? first.label };
}

/**
 * Routes one failure by the owner's When arrows. `none`: no When arrow routes it, nothing changed.
 * Otherwise the lead was told (always), and a fix turn may have started.
 */
export function routeFailure(d: Draft, input: FailureInput): RouteOutcome {
  const program = programOf(d);
  const route = whenRouteFor(program, eventOf(input), input.sourceNodeId);
  if (route === undefined) return { kind: 'none' };
  const arrow = arrowName(route);
  if (route.target.kind === 'lead') {
    return toLead(
      d,
      input,
      route,
      `This workflow's ${arrow} sends it to you: you decide.`,
      'target-lead',
      undefined,
    );
  }
  const lineage = lineageOf(d, input);
  const roundsKey = roundsKeyOf(route, lineage);
  const used = d.failureRounds?.[roundsKey] ?? 0;
  if (used >= route.maxRounds) {
    return toLead(
      d,
      input,
      route,
      `This workflow's ${arrow} has no fix round left for it (${used} of ${route.maxRounds} used), so you decide.`,
      'rounds-used',
      { used, max: route.maxRounds },
    );
  }
  const target = resolveTarget(d, input, route);
  if (!target.ok) {
    return toLead(
      d,
      input,
      route,
      `This workflow's ${arrow} sends it to ${route.target.kind === 'author' ? 'its author' : 'a helper'}, but ${target.why}, so you decide.`,
      target.reason,
      { used, max: route.maxRounds },
    );
  }
  const own = input.change;
  const rework =
    own !== undefined &&
    own.kind === 'worker' &&
    own.resolution === undefined &&
    own.change !== undefined &&
    !isFinalChangeState(own.change.state) &&
    stageOf(own) === target.nodeId;
  const why =
    rework && own !== undefined ? reworkBlocked(d, own) : nodeFixBlocked(d, target.nodeId);
  if (why !== null) {
    return toLead(
      d,
      input,
      route,
      `This workflow's ${arrow} sends it to ${noteNodeName(program, target.nodeId)}, but ${why}, so you decide.`,
      'blocked',
      { used, max: route.maxRounds },
    );
  }
  const round = used + 1;
  const rounds = { used: round, max: route.maxRounds };
  const context = renderFailureContext({ ...input.context, rounds });
  const roundText = `fix round ${round} of ${route.maxRounds}`;
  const where = inlineLabel(input.context.source.label);
  const notes = purposeBlocks(route);
  let fixer: EngineAgent;
  if (rework && own !== undefined) {
    fixer = own;
    reworkForFix(
      d,
      own,
      [
        `This workflow sends ${EVENT_NAMES[eventOf(input)]} at ${where} back to you to fix (${roundText}). The failure context below says what failed.`,
        context,
        ...notes,
        'Fix what makes it fail; do not weaken or delete tests or checks.',
        `Work in the same copy of the project as before. Your task was: ${own.task ?? '(no task text)'}`,
        'When you are done, end your turn: your change is checked and reviewed again.',
        AGENT_NOTE_LINE,
      ].join('\n\n'),
      eventOf(input) === 'review-rework',
    );
  } else {
    fixer = startNodeFix(
      d,
      target.nodeId,
      target.role.slice(0, 60),
      `Fix ${EVENT_NAMES[eventOf(input)]} at ${where} (${roundText}). The failure context below says what failed. Do not weaken or delete tests or checks.`,
      [context, ...notes],
    );
    // The failing change waits for the lead's decision while the fix is made.
    const change = own?.change;
    if (change !== undefined && !isFinalChangeState(change.state) && !change.merging) {
      change.state = 'decision';
    }
  }
  d.failureRounds = { ...(d.failureRounds ?? {}), [roundsKey]: round };
  const fix: EngineFix = {
    id: d.freshId(),
    event: eventOf(input),
    sourceNodeId: input.sourceNodeId ?? null,
    roundsKey,
    lineage,
    ...(own !== undefined ? { changeAgentId: own.id } : {}),
    fixerAgentRunId: fixer.id,
    targetNodeId: target.nodeId,
    mode: rework ? 'rework' : 'new',
    round,
    maxRounds: route.maxRounds,
    status: 'running',
    context: renderFailureContext(input.context),
    ...soleAuthorOf(d, input.context),
    ...(route.target.kind === 'author' ? { viaAuthor: true as const } : {}),
    ...(route.label !== undefined ? { label: route.label } : {}),
    ...(route.purpose !== undefined ? { purpose: route.purpose } : {}),
  };
  d.fixes = [...(d.fixes ?? []), fix];
  notifyLead(d, fixingNotice(input.headline, arrow, fix, fixer, context, notes));
  d.effects.push({
    type: 'failure-routed',
    kind: 'fix-started',
    event: fix.event,
    fixId: fix.id,
    fixerAgentRunId: fixer.id,
    targetNodeId: fix.targetNodeId,
    sourceNodeId: fix.sourceNodeId,
    round,
    maxRounds: route.maxRounds,
    reason: null,
  });
  return { kind: 'fixing', fix, fixer };
}

/** The lead's notice of a fix under way (ADR-0038 §4: the lead is told about every fix). */
function fixingNotice(
  headline: string,
  arrow: string,
  fix: EngineFix,
  fixer: EngineAgent,
  context: string,
  notes: readonly string[],
): string {
  const who =
    fix.mode === 'rework'
      ? `${fixer.role} (agentId ${fixer.id}) is fixing it in its own change`
      : `${fixer.role} (agentId ${fixer.id}), a new helper from the ticket branch, is fixing it`;
  return [
    `${headline} This workflow's ${arrow} sends it straight to a fixer: ${who} (round ${fix.round} of ${fix.maxRounds}, fixId ${fix.id}).`,
    fix.mode === 'rework'
      ? 'You get the change again once it is checked and reviewed.'
      : "Decide the fixer's change as usual once it is reviewed; the failing change waits for your decision.",
    'To move the fix, call reroute_fix (fixId, to: a helper block, author or lead); stop_agent stops it.',
    context,
    ...notes,
  ].join('\n\n');
}

// ------------------------------------------------------------------ reroute_fix

/** A fix the lead may still move: running, its fixer still working on it. */
export function isRunningFix(d: { agents: readonly EngineAgent[] }, fix: EngineFix): boolean {
  if (fix.status !== 'running') return false;
  const fixer = d.agents.find((a) => a.id === fix.fixerAgentRunId);
  return fixer !== undefined && isActiveAgentStatus(fixer.status);
}

/** The fix `reroute_fix` names: by its id, else the newest one of that change or fixer. */
export function findFix(
  fixes: readonly EngineFix[] | undefined,
  by: { fixId?: string | undefined; changeId?: string | undefined },
): EngineFix | undefined {
  const all = fixes ?? [];
  if (by.fixId !== undefined) return all.find((f) => f.id === by.fixId);
  return [...all]
    .reverse()
    .find((f) => f.changeAgentId === by.changeId || f.fixerAgentRunId === by.changeId);
}

/** What `reroute_fix` takes (the core schema checked it). */
export interface RerouteInput {
  fixId?: string | undefined;
  changeId?: string | undefined;
  to: string;
  note?: string | undefined;
}

/**
 * The lead's `reroute_fix` (ADR-0038 §4): stops the running fix turn, then starts the fix on
 * another helper block (a new helper from the ticket branch, the same round: moving a fix uses no
 * round) or hands it to the lead. Refused, with nothing changed, for an unknown fix, one that is
 * no longer running, an unknown target, or a target with no room now.
 */
export function rerouteFix(
  state: RunState,
  input: RerouteInput,
  ctx: EngineContext,
): EngineResult<string> {
  return applyCommand(state, ctx, (d) => {
    if (d.integration === undefined) {
      return refusal('run-not-active', 'This run has no review loop, so this tool is unavailable.');
    }
    const fix = findFix(d.fixes, input);
    if (fix === undefined) {
      return refusal(
        'unknown-agent',
        'No fix in this run has that id. The engine names each fix (fixId) in its notice.',
      );
    }
    if (!isRunningFix(d, fix)) {
      return refusal(
        'agent-not-live',
        'That fix is not running any more (it finished, was moved or was stopped). Decide its change instead.',
      );
    }
    const program = programOf(d);
    const to = input.to.trim();
    // FR-7: moving uses no round, so a fix moves to a helper at most once per round; otherwise
    // moves could start fixers without end. Taking it over stays possible.
    if (fix.moved === true && to.toLowerCase() !== 'lead') {
      return refusal(
        'invalid-input',
        'This fix was already moved once in this round. Take it over (to: lead), stop it, or let it finish.',
      );
    }
    let target: { nodeId: WorkflowNodeId; role: string } | 'lead';
    if (to.toLowerCase() === 'lead') target = 'lead';
    else if (to.toLowerCase() === 'author') {
      if (fix.soleAuthor === undefined) {
        return refusal(
          'invalid-input',
          'The author of this failure is not one known helper; name a helper block, or lead.',
        );
      }
      target = fix.soleAuthor;
    } else {
      const node =
        program.helpers.find((h) => h.id === to) ??
        program.helpers.find((h) => sameLabel(h.label, to));
      if (node === undefined) {
        return refusal(
          'invalid-input',
          `There is no helper block "${inlineLabel(to)}" in this workflow. The helper nodes are:\n${helperNodeLines(program).join('\n')}`,
        );
      }
      target = { nodeId: node.id, role: node.label };
    }
    const fixer = d.agent(fix.fixerAgentRunId);
    if (fixer !== undefined) d.endAgentTree(fixer, 'CANCELLED', true);
    const self = d.fixes?.find((f) => f.id === fix.id);
    if (target === 'lead') {
      if (self !== undefined) self.status = 'taken-over';
      reopenForFix(d);
      d.effects.push({
        type: 'failure-routed',
        kind: 'rerouted',
        event: fix.event,
        fixId: fix.id,
        fixerAgentRunId: null,
        targetNodeId: null,
        sourceNodeId: fix.sourceNodeId,
        round: fix.round,
        maxRounds: fix.maxRounds,
        reason: null,
      });
      return {
        value: [
          `You took the fix over: ${fixer?.role ?? 'its fixer'} was stopped. Start a helper with start_agent for it (give it the failure context), or decide the change; its stopped work waits for your decision.`,
          fix.context,
        ].join('\n\n'),
      };
    }
    const why = nodeFixBlocked(d, target.nodeId);
    if (why !== null) {
      return refusal('too-many-agents', `The fix cannot move there now: ${why}.`);
    }
    const route = {
      ...(fix.label !== undefined ? { label: fix.label } : {}),
      ...(fix.purpose !== undefined ? { purpose: fix.purpose } : {}),
    };
    const moved = startNodeFix(
      d,
      target.nodeId,
      target.role.slice(0, 60),
      `Fix ${EVENT_NAMES[fix.event]} (fix round ${fix.round} of ${fix.maxRounds}); the lead moved this fix to you. The failure context below says what failed. Do not weaken or delete tests or checks.`,
      [
        fix.context,
        ...purposeBlocks(route),
        ...(input.note !== undefined ? [`The lead's note: ${input.note}`] : []),
      ],
    );
    if (self !== undefined) self.status = 'rerouted';
    const { viaAuthor: _was, ...rest } = fix;
    const next: EngineFix = {
      ...rest,
      ...(to.toLowerCase() === 'author' ? { viaAuthor: true as const } : {}),
      id: d.freshId(),
      fixerAgentRunId: moved.id,
      targetNodeId: target.nodeId,
      mode: 'new',
      status: 'running',
      moved: true,
    };
    d.fixes = [...(d.fixes ?? []), next];
    d.effects.push({
      type: 'failure-routed',
      kind: 'rerouted',
      event: fix.event,
      fixId: next.id,
      fixerAgentRunId: moved.id,
      targetNodeId: target.nodeId,
      sourceNodeId: fix.sourceNodeId,
      round: fix.round,
      maxRounds: fix.maxRounds,
      reason: null,
    });
    return {
      value: `Moved the fix: ${fixer?.role ?? 'its fixer'} was stopped, and ${moved.role} (agentId ${moved.id}) is fixing it now from the ticket branch (fixId ${next.id}, round ${fix.round} of ${fix.maxRounds}). Decide its change as usual; the stopped work waits for your decision.`,
    };
  });
}
