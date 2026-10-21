import type { AgentRoleKind, ChangeDecider, CheckRun, TicketComment } from '@acp/core';
import type { StreamNoticeDto } from '@acp/core/api';
import {
  isActiveAgentStatus,
  programNode,
  programOf,
  resolveHelper,
  type EngineAgent,
  type RunState,
} from '@acp/orchestrator';
import { errorFields, type Logger } from '../logger.js';
import type { LineCounts } from '../workspace/index.js';
import { hasReviewableChange } from './roles.js';
import { agentName, ROLE_WORDS } from './session-names.js';
import type { RunStore } from './store.js';

/**
 * The run summary comment (ADR-0024 §3, v0.3.0 S-A): one ticket comment by author `app`, composed
 * by the server from records it already keeps (the plan, each change, checks, the ticket branch,
 * budget tokens), plus the lead's handover note when it gave one. No prompt, reply, task, diff,
 * finding or tool output is ever read for it: labels are workflow block labels, numbers are
 * counts, and the only free text is the lead's note (redacted and capped by the engine).
 *
 * When one is written (at most one per trigger, and never twice for the same moment):
 * - **handover** (`handover-summary` effect): every review-loop handover. The first is headed
 *   `Run summary`; a later one, after the owner's "Request changes" and a second handover, is
 *   headed `Run summary (updated)`, so the ticket keeps both.
 * - **review**: a legacy (pre-review-loop) run moves from working to REVIEW (or straight to
 *   COMPLETED): facts only, once per run.
 * - **ended**: a run fails, is stopped or times out, or a review-loop run reaches REVIEW without
 *   a handover (the lead ended first): facts only, and only when the run has no summary yet.
 *
 * The comment is written after the transition is committed (the line counts come from git), one
 * at a time per run; the duplicate check reads the stored comments, so neither a restart nor a
 * recovery can add one twice. A crash between the transition and the write loses that summary
 * (nothing replays effects); it never duplicates one.
 */

/** The first line of every run summary comment; S-B recognises it by author `app` and this. */
export const RUN_SUMMARY_HEADING = 'Run summary';
/** The first line of a later handover's summary of the same run. */
export const RUN_SUMMARY_UPDATED_HEADING = 'Run summary (updated)';
/** `TicketCommentSchema.body`. */
export const COMMENT_BODY_MAX = 8000;
/** Check names listed per change at most. */
const MAX_CHECK_NAMES = 5;

export type SummaryTrigger =
  | { kind: 'handover'; note: string | null }
  | { kind: 'review' }
  | { kind: 'ended'; outcome: 'failed' | 'stopped' | 'lead-ended' };

/** True for a comment the app wrote as a run summary. */
export function isRunSummaryComment(comment: Pick<TicketComment, 'author' | 'body'>): boolean {
  if (comment.author !== 'app') return false;
  const first = comment.body.split('\n', 1)[0] ?? '';
  return first === RUN_SUMMARY_HEADING || first === RUN_SUMMARY_UPDATED_HEADING;
}

export interface MergeLineOptions {
  /** The required checks on the merged tip, when known (`tally` of its latest results). */
  tipChecks?: CheckTally | null;
  /** The owner merged past a failed required check, giving a reason (never quoted here). */
  anyway?: boolean;
}

/**
 * The `app` line after the owner's single merge of the ticket branch (ADR-0024 §3), with the
 * tip's checks when known: `Merged acp/WEB-12 into main at abc1234; checks passed on the tip (2).`
 * A merge past a failed check says so, without the owner's reason (that is the owner's comment).
 */
export function mergeLine(
  branch: string,
  baseBranch: string,
  commit: string,
  options: MergeLineOptions = {},
): string {
  const anyway = options.anyway === true ? ' (merged anyway, with a reason)' : '';
  const tip = options.tipChecks ?? null;
  return `Merged ${branch} into ${baseBranch} at ${commit.slice(0, 7)}${anyway}${tip === null ? '' : `; ${tipChecksText(tip)}`}.`;
}

// ------------------------------------------------------------------ facts

export interface CheckTally {
  passed: number;
  /** Names of checks that failed, timed out or errored. */
  failed: string[];
  /** Names of checks that were skipped or interrupted. */
  notRun: string[];
}

export interface ChangeFact {
  label: string;
  /** Where the change ended up, in plain words (`merged`, `discarded`, `waiting for you`, …). */
  outcome: string;
  /** How the agent itself ended, when not normally (`failed`, `stopped`, …). */
  agentEnded: string | null;
  files: number | null;
  additions: number | null;
  deletions: number | null;
  checks: CheckTally | null;
  /** Rework rounds by who sent the change back. */
  rework: Readonly<Record<ChangeDecider, number>>;
}

export interface RunSummaryFacts {
  ticketKey: string;
  /** The opening line after the key, e.g. `the lead handed the work over.` */
  headline: string;
  plan:
    { version: number; steps: string[] } | { version: null; steps: null; proposed: number } | null;
  changes: ChangeFact[];
  ticketBranch: {
    branch: string;
    baseBranch: string;
    state: 'open' | 'merged' | 'discarded';
    /** Open and the owner's merge comes next (a handover, or a lead that ended in review). */
    awaitingMerge: boolean;
    merged: number;
    tipChecks: CheckTally | null;
  } | null;
  tokens: { kind: AgentRoleKind; agents: number; tokens: number }[];
  note: string | null;
}

const KIND_ORDER: readonly AgentRoleKind[] = ['planner', 'lead', 'worker', 'reviewer', 'tester'];
const KIND_WORDS: Readonly<Record<AgentRoleKind, string>> = {
  planner: 'planner',
  lead: 'lead',
  worker: 'helpers',
  reviewer: 'reviewers',
  tester: 'testers',
};

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

function num(n: number): string {
  return n.toLocaleString('en-US');
}

/** The latest result per check id, counted (null when no check ran). */
export function tally(runs: readonly CheckRun[]): CheckTally | null {
  // The latest result per check id.
  const latest = new Map<string, CheckRun>();
  for (const run of runs) latest.set(run.checkId, run);
  if (latest.size === 0) return null;
  const out: CheckTally = { passed: 0, failed: [], notRun: [] };
  for (const run of [...latest.values()].sort((a, b) => a.checkId.localeCompare(b.checkId))) {
    if (run.status === 'passed') out.passed++;
    else if (run.status === 'skipped' || run.status === 'interrupted') out.notRun.push(run.name);
    else out.failed.push(run.name);
  }
  return out;
}

function names(list: readonly string[]): string {
  const shown = list.slice(0, MAX_CHECK_NAMES).join(', ');
  return list.length > MAX_CHECK_NAMES
    ? `${shown} and ${list.length - MAX_CHECK_NAMES} more`
    : shown;
}

function checksText(t: CheckTally): string {
  const total = t.passed + t.failed.length + t.notRun.length;
  if (t.passed === total) return `checks passed (${total})`;
  const parts = [`checks: ${t.passed} of ${total} passed`];
  if (t.failed.length > 0) parts.push(`failed: ${names(t.failed)}`);
  if (t.notRun.length > 0) parts.push(`not run: ${names(t.notRun)}`);
  return parts.join('; ');
}

/** The ticket branch tip's checks: `checks passed on the tip (2)`, or the counts and names. */
function tipChecksText(t: CheckTally): string {
  const total = t.passed + t.failed.length + t.notRun.length;
  if (t.passed === total) return `checks passed on the tip (${total})`;
  return checksText(t).replace(/^checks: /, 'checks on the tip: ');
}

function changeLine(c: ChangeFact): string {
  const parts = [c.agentEnded === null ? c.outcome : `${c.outcome} (${c.agentEnded})`];
  if (c.files !== null) {
    const lines =
      c.additions !== null && c.deletions !== null
        ? `, +${num(c.additions)} -${num(c.deletions)} lines`
        : '';
    parts.push(`${plural(c.files, 'file')}${lines}`);
  }
  if (c.checks !== null) parts.push(checksText(c.checks));
  const by = (['lead', 'reviewer', 'owner'] as const)
    .filter((d) => c.rework[d] > 0)
    .map((d) => `${d === 'owner' ? 'you' : d} ${c.rework[d]}`);
  const rounds = c.rework.lead + c.rework.reviewer + c.rework.owner;
  if (rounds > 0) parts.push(`${plural(rounds, 'rework round')} (${by.join(', ')})`);
  return `- ${c.label}: ${parts.join('; ')}.`;
}

/**
 * The comment body: plain text, readable as is, at most `COMMENT_BODY_MAX` characters. When the
 * facts are too long, later change lines give way to a count; the note is kept whole (it is at most
 * 1,500 characters).
 */
export function composeRunSummary(facts: RunSummaryFacts, updated = false): string {
  const head = [
    updated ? RUN_SUMMARY_UPDATED_HEADING : RUN_SUMMARY_HEADING,
    `${facts.ticketKey}: ${facts.headline}`,
  ].join('\n');
  const sections: string[] = [];
  const plan = facts.plan;
  if (plan !== null) {
    sections.push(
      plan.version === null
        ? `Plan: none approved (${plural(plan.proposed, 'version')} proposed).`
        : `Plan v${plan.version}: ${plural(plan.steps.length, 'step')}${plan.steps.length > 0 ? ` (${plan.steps.join(', ')})` : ''}.`,
    );
  }
  const branch = facts.ticketBranch;
  const tail: string[] = [];
  if (branch !== null) {
    const where =
      branch.state === 'merged'
        ? `merged into ${branch.baseBranch}`
        : branch.state === 'discarded'
          ? 'discarded'
          : branch.awaitingMerge
            ? 'waiting for your merge'
            : 'not merged';
    const parts = [
      `Ticket branch ${branch.branch} (from ${branch.baseBranch}): ${plural(branch.merged, 'change')} merged`,
      where,
    ];
    if (branch.tipChecks !== null) parts.push(tipChecksText(branch.tipChecks));
    tail.push(`${parts.join('; ')}.`);
  }
  const tokens = facts.tokens
    .filter((t) => t.agents > 0)
    .map(
      (t) =>
        `${KIND_WORDS[t.kind]} ${num(t.tokens)}${t.agents > 1 ? ` (${plural(t.agents, 'agent')})` : ''}`,
    );
  if (tokens.length > 0) tail.push(`Budget tokens: ${tokens.join('; ')}.`);
  if (facts.note !== null) tail.push(`Lead's note:\n${facts.note}`);

  const build = (shown: number): string => {
    const lines = facts.changes.slice(0, shown).map(changeLine);
    if (shown < facts.changes.length) {
      lines.push(`- …and ${plural(facts.changes.length - shown, 'more change')}.`);
    }
    const changes =
      facts.changes.length === 0
        ? ['Changes: none.']
        : [`Changes (${facts.changes.length}):\n${lines.join('\n')}`];
    return [head, ...sections, ...changes, ...tail].join('\n\n');
  };
  let shown = facts.changes.length;
  let body = build(shown);
  while (body.length > COMMENT_BODY_MAX && shown > 0) body = build(--shown);
  // Only a pathological note or label list could still be too long: cut, never fail.
  return body.length <= COMMENT_BODY_MAX ? body : `${body.slice(0, COMMENT_BODY_MAX - 1)}…`;
}

// ------------------------------------------------------------------ facts from records

const LOOP_OUTCOME: Readonly<Record<string, string>> = {
  sealing: 'in review',
  ready: 'in review',
  reviewing: 'in review',
  decision: 'in review',
  rework: 'in rework',
  'needs-owner': 'waiting for you',
  merged: 'merged',
  discarded: 'discarded',
  'no-changes': 'no changes',
};
const LEGACY_OUTCOME: Readonly<Record<string, string>> = {
  pending: 'waiting for your review',
  merged: 'merged',
  discarded: 'discarded',
  'no-changes': 'no changes',
};
const AGENT_ENDED: Readonly<Partial<Record<EngineAgent['status'], string>>> = {
  FAILED: 'it failed',
  CANCELLED: 'it was stopped',
  TIMED_OUT: 'it timed out',
  NEEDS_REVIEW: 'interrupted by a restart',
};

export interface FactsInput {
  store: RunStore;
  state: RunState;
  ticketKey: string;
  trigger: SummaryTrigger;
  /** Files and lines per agent run, where git could tell. */
  lines: ReadonlyMap<string, LineCounts>;
}

function headlineOf(input: FactsInput, agents: readonly { kind: string; status: string }[]) {
  const t = input.trigger;
  const lead = agents.find((a) => a.kind === 'lead');
  if (t.kind === 'handover') return 'the lead handed the work over.';
  if (t.kind === 'review') {
    return input.state.run.status === 'COMPLETED'
      ? 'the run finished with nothing to review.'
      : 'the agents finished; their changes wait for your review.';
  }
  if (t.outcome === 'failed') return 'the run failed before the lead handed over.';
  if (t.outcome === 'stopped') {
    return lead?.status === 'TIMED_OUT'
      ? 'the run timed out before the lead handed over.'
      : 'the run was stopped before the lead handed over.';
  }
  if (lead?.status === 'FAILED') return 'the lead failed before handing over.';
  if (lead?.status === 'CANCELLED') return 'the lead was stopped before handing over.';
  return 'the lead ended without handing over.';
}

/** Every fact from the database (and the run's workflow snapshot for the labels). */
export function gatherRunFacts(input: FactsInput): RunSummaryFacts {
  const { store, state } = input;
  const runId = state.run.id;
  const loop = state.integration !== undefined;
  const agents = store.repos.agentRuns.listForRun(runId);
  const reviews = loop ? store.loopRepos.changeReviews.listForRun(runId) : [];
  const reviewed = new Map<string, string>();
  for (const r of reviews)
    if (r.reviewerAgentRunId !== null) reviewed.set(r.reviewerAgentRunId, r.agentRunId);
  const label = (id: string) =>
    agentName({
      state,
      agentRunId: id,
      ticketKey: input.ticketKey,
      reviewedAgentRunId: (rid) => reviewed.get(rid),
    })?.label ?? 'Agent';

  let program;
  try {
    program = programOf(state);
  } catch {
    program = undefined;
  }
  const plans = store.workspaceRepos.plans.listForRun(runId);
  const approved = plans.filter((p) => p.status === 'approved').at(-1);
  let plan: RunSummaryFacts['plan'] = null;
  if (approved !== undefined) {
    plan = {
      version: approved.version,
      // The block of each step: its stored helper node, else the one the role resolves to (the
      // role text itself is never shown).
      steps: approved.steps.map((step) => {
        if (program === undefined) return ROLE_WORDS.worker;
        if (step.helper !== undefined) {
          return programNode(program, step.helper)?.label ?? ROLE_WORDS.worker;
        }
        const resolved = resolveHelper(program, { role: step.role });
        return resolved.ok ? resolved.node.label : ROLE_WORDS.worker;
      }),
    };
  } else if (plans.length > 0) {
    plan = { version: null, steps: null, proposed: plans.length };
  }

  const changes: ChangeFact[] = [];
  for (const agent of agents) {
    if (!hasReviewableChange(agent.kind)) continue;
    const ws = store.repos.workspaces.getByAgentRun(agent.id);
    const stored = loop ? store.loopRepos.workspaceChanges.getByAgentRun(agent.id) : undefined;
    const outcome = loop
      ? (stored?.changeState ?? null) === null
        ? 'no change'
        : (LOOP_OUTCOME[stored?.changeState ?? ''] ?? 'in review')
      : ws === undefined
        ? 'no change'
        : (LEGACY_OUTCOME[ws.reviewState] ?? 'waiting for your review');
    const lines = input.lines.get(agent.id);
    const head = stored?.headCommit ?? null;
    const checks = loop
      ? head === null
        ? null
        : tally(store.loopRepos.checkCommits.latestForCommit(runId, agent.id, head))
      : tally(store.workspaceRepos.checkRuns.latestForAgentRun(agent.id));
    const rework: Record<ChangeDecider, number> = { lead: 0, reviewer: 0, owner: 0 };
    const counted = new Set<string>();
    for (const r of reviews) {
      if (r.agentRunId !== agent.id || r.decision !== 'rework' || r.decidedBy === null) continue;
      const key = `${r.round}:${r.decidedBy}`;
      if (counted.has(key)) continue;
      counted.add(key);
      rework[r.decidedBy]++;
    }
    const ended = isActiveAgentStatus(agent.status) ? null : (AGENT_ENDED[agent.status] ?? null);
    changes.push({
      label: label(agent.id),
      outcome,
      agentEnded: ended,
      files: lines?.files ?? ws?.changedFiles ?? null,
      additions: lines?.additions ?? null,
      deletions: lines?.deletions ?? null,
      checks,
      rework,
    });
  }

  const row = loop ? store.loopRepos.ticketBranches.getByRun(runId) : undefined;
  const ticketBranch: RunSummaryFacts['ticketBranch'] =
    row === undefined
      ? null
      : {
          branch: row.branch,
          baseBranch: row.baseBranch,
          state: row.state,
          awaitingMerge:
            row.state === 'open' &&
            (input.trigger.kind === 'handover' ||
              (input.trigger.kind === 'ended' && input.trigger.outcome === 'lead-ended')),
          merged: agents.filter(
            (a) => store.loopRepos.workspaceChanges.getByAgentRun(a.id)?.changeState === 'merged',
          ).length,
          tipChecks: tally(
            store.loopRepos.checkCommits.latestForCommit(runId, null, row.headCommit),
          ),
        };

  const tokens = KIND_ORDER.map((kind) => {
    const of = agents.filter((a) => a.kind === kind);
    return { kind, agents: of.length, tokens: of.reduce((n, a) => n + a.budgetTokensUsed, 0) };
  });

  return {
    ticketKey: input.ticketKey,
    headline: headlineOf(input, agents),
    plan,
    changes,
    ticketBranch,
    tokens,
    note: input.trigger.kind === 'handover' ? input.trigger.note : null,
  };
}

// ------------------------------------------------------------------ writing

export interface SummaryLive {
  state: RunState;
}

export interface RunSummariesContext {
  store: RunStore;
  logger: Logger;
  publish: (notice: StreamNoticeDto) => void;
  lastEventId: () => number;
  /** The files and lines of each agent's change, where git can tell (never rejects). */
  lineCounts: (live: SummaryLive) => Promise<Map<string, LineCounts>>;
  track: (promise: Promise<unknown>) => void;
  countDiagnostic: (code: string) => void;
}

export function createRunSummaries(ctx: RunSummariesContext) {
  const { store, logger } = ctx;
  const chains = new Map<string, Promise<void>>();

  function ticketKeyOf(state: RunState): string | null {
    if (state.integration !== undefined) return state.integration.ticketKey;
    const ticketId = state.run.ticketId;
    return ticketId === null ? null : (store.workspaceRepos.tickets.getById(ticketId)?.key ?? null);
  }

  function summariesOf(ticketId: string, runId: string): TicketComment[] {
    return store.workspaceRepos.comments
      .listForTicket(ticketId)
      .filter((c) => c.runId === runId && isRunSummaryComment(c));
  }

  async function write(live: SummaryLive, trigger: SummaryTrigger): Promise<void> {
    const runId = live.state.run.id;
    const ticketId = live.state.run.ticketId;
    if (ticketId === null) return;
    try {
      // Facts-only summaries come once per run, and never after a handover's.
      if (trigger.kind !== 'handover' && summariesOf(ticketId, runId).length > 0) return;
      const lines = await ctx.lineCounts(live);
      const state = live.state;
      const ticketKey = ticketKeyOf(state);
      if (ticketKey === null) return;
      const existing = summariesOf(ticketId, runId);
      if (trigger.kind !== 'handover' && existing.length > 0) return;
      const body = composeRunSummary(
        gatherRunFacts({ store, state, ticketKey, trigger, lines }),
        existing.length > 0,
      );
      store.workspaceRepos.comments.insert({ ticketId, runId, author: 'app', body });
      logger.log('info', 'run summary stored', {
        runId,
        trigger: trigger.kind,
        updated: existing.length > 0,
        note: trigger.kind === 'handover' && trigger.note !== null,
      });
      ctx.publish({
        kind: 'tickets-changed',
        lastEventId: ctx.lastEventId(),
        sessionIds: [],
        projectIds: [state.run.projectId],
        runIds: [runId],
        ticketIds: [ticketId],
      });
    } catch (error) {
      ctx.countDiagnostic('run-summary-failed');
      logger.log('error', 'run summary not stored', { runId, ...errorFields(error) });
    }
  }

  return {
    /** Writes the summary for `trigger` after the current transition, one at a time per run. */
    schedule(live: SummaryLive, trigger: SummaryTrigger): void {
      const runId = live.state.run.id;
      const prev = chains.get(runId) ?? Promise.resolve();
      const next = prev.catch(() => undefined).then(() => write(live, trigger));
      chains.set(runId, next);
      ctx.track(
        next.finally(() => {
          if (chains.get(runId) === next) chains.delete(runId);
        }),
      );
    },
  };
}

export type RunSummaries = ReturnType<typeof createRunSummaries>;

const WORKING: readonly string[] = ['QUEUED', 'PLANNING', 'PLAN_REVIEW', 'RUNNING', 'BLOCKED'];

/**
 * Which facts-only summary a committed transition calls for, if any (the handover's own comes
 * from the engine's `handover-summary` effect). Ticket runs only.
 */
export function endTrigger(prev: RunState, next: RunState): SummaryTrigger | null {
  if (next.run.ticketId === null) return null;
  const from = prev.run.status;
  const to = next.run.status;
  if (from === to) return null;
  if (to === 'FAILED') return { kind: 'ended', outcome: 'failed' };
  if (to === 'CANCELLED') return { kind: 'ended', outcome: 'stopped' };
  if ((to === 'REVIEW' || to === 'COMPLETED') && WORKING.includes(from)) {
    if (next.integration === undefined) return { kind: 'review' };
    return next.integration.handedOver ? null : { kind: 'ended', outcome: 'lead-ended' };
  }
  return null;
}
