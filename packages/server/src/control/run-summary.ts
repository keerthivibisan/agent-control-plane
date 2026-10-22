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
 * Since v0.3.0 S-C the lead's note is the main text, written like a teammate's ticket update, and
 * the facts follow under `Details:` as short sentences; without a note, one plain sentence says
 * how the run ended (`composeRunSummary`).
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
/**
 * The line before the lead's note (v0.3.0 S-C): the comment's author is `app`, so the plain text
 * says whose words follow; the web shows it as "Lead · Run summary" instead.
 */
export const RUN_SUMMARY_NOTE_HEADING = 'From the lead:';
/** The line before the facts (v0.3.0 S-C); the web folds what follows behind "Details". */
export const RUN_SUMMARY_DETAILS_HEADING = 'Details:';
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

/** Where a change ended up. */
export type ChangeOutcome =
  | 'merged'
  | 'discarded'
  | 'in-review'
  | 'in-rework'
  | 'waiting-for-you'
  | 'waiting-for-review'
  | 'no-changes'
  /** No change was recorded for the agent at all. */
  | 'none';

/** How an agent itself ended, when not normally. */
export type AgentEnding = 'failed' | 'stopped' | 'timed-out' | 'interrupted';

export interface ChangeFact {
  label: string;
  outcome: ChangeOutcome;
  agentEnded: AgentEnding | null;
  files: number | null;
  additions: number | null;
  deletions: number | null;
  checks: CheckTally | null;
  /** Rework rounds by who sent the change back. */
  rework: Readonly<Record<ChangeDecider, number>>;
}

export interface RunSummaryFacts {
  /**
   * The one plain sentence shown instead of a note, e.g. `The run was stopped before the work was
   * handed over.` Used only when `note` is null.
   */
  opening: string;
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
/** Who used the tokens: one agent of the kind, then several. */
const KIND_WORDS: Readonly<Record<AgentRoleKind, readonly [string, string]>> = {
  planner: ['the planner', 'planners'],
  lead: ['the lead', 'leads'],
  worker: ['1 helper', 'helpers'],
  reviewer: ['1 reviewer', 'reviewers'],
  tester: ['1 tester', 'testers'],
};

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

function num(n: number): string {
  return n.toLocaleString('en-US');
}

/** `A`, `A and B`, `A, B and C`. */
function andList(items: readonly string[]): string {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} and ${items.at(-1) ?? ''}`;
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

/** A change's checks in words: `both checks passed`, `1 of 3 checks passed (failed: Lint)`. */
function changeChecksText(t: CheckTally): string {
  const total = t.passed + t.failed.length + t.notRun.length;
  if (t.passed === total) {
    return total === 1
      ? 'the check passed'
      : total === 2
        ? 'both checks passed'
        : `all ${total} checks passed`;
  }
  const why: string[] = [];
  if (t.failed.length > 0) why.push(`failed: ${names(t.failed)}`);
  if (t.notRun.length > 0) why.push(`not run: ${names(t.notRun)}`);
  return `${t.passed} of ${total} ${total === 1 ? 'check' : 'checks'} passed (${why.join('; ')})`;
}

/** `3 files, 42 lines added and 5 removed`; lines only where git could tell and any changed. */
function filesText(c: ChangeFact): string | null {
  if (c.files === null) return null;
  const files = plural(c.files, 'file');
  const add = c.additions;
  const del = c.deletions;
  if (add === null || del === null) return files;
  if (add > 0 && del > 0) return `${files}, ${num(add)} lines added and ${num(del)} removed`;
  if (add > 0) return `${files}, ${num(add)} ${add === 1 ? 'line' : 'lines'} added`;
  if (del > 0) return `${files}, ${num(del)} ${del === 1 ? 'line' : 'lines'} removed`;
  return files;
}

const DECIDER_WORDS: Readonly<Record<ChangeDecider, string>> = {
  lead: 'the lead',
  reviewer: 'the reviewer',
  owner: 'you',
};

/** `2 rework rounds, asked for by the lead (1) and the reviewer (1)`. */
function reworkText(c: ChangeFact): string | null {
  const by = (['lead', 'reviewer', 'owner'] as const).filter((d) => c.rework[d] > 0);
  const rounds = c.rework.lead + c.rework.reviewer + c.rework.owner;
  if (rounds === 0) return null;
  const who = by.map((d) =>
    by.length > 1 ? `${DECIDER_WORDS[d]} (${c.rework[d]})` : DECIDER_WORDS[d],
  );
  return `${plural(rounds, 'rework round')}, asked for by ${andList(who)}`;
}

const OUTCOME_WORDS: Readonly<Record<ChangeOutcome, (label: string) => string>> = {
  merged: (l) => `Merged 1 change from ${l}`,
  discarded: (l) => `Discarded 1 change from ${l}`,
  'in-review': (l) => `1 change from ${l} is still in review`,
  'in-rework': (l) => `1 change from ${l} is back in rework`,
  'waiting-for-you': (l) => `1 change from ${l} is waiting for your decision`,
  'waiting-for-review': (l) => `1 change from ${l} is waiting for your review`,
  'no-changes': (l) => `${l} finished with no changes`,
  none: (l) => `There is no change from ${l}`,
};

const ENDING_WORDS: Readonly<Record<AgentEnding, string>> = {
  failed: 'it failed',
  stopped: 'it was stopped',
  'timed-out': 'it timed out',
  interrupted: 'it was interrupted by a restart',
};

/**
 * One change as a short sentence: `Merged 1 change from Helpers: 2 files, 18 lines added; both
 * checks passed.`
 */
function changeLine(c: ChangeFact): string {
  const facts = [filesText(c), c.checks === null ? null : changeChecksText(c.checks), reworkText(c)]
    .filter((p) => p !== null)
    .join('; ');
  const ended = c.agentEnded === null ? '' : `; ${ENDING_WORDS[c.agentEnded]}`;
  return `- ${OUTCOME_WORDS[c.outcome](c.label)}${facts.length > 0 ? `: ${facts}` : ''}${ended}.`;
}

function planLine(plan: NonNullable<RunSummaryFacts['plan']>): string {
  if (plan.version === null) {
    return `- No plan was approved; ${plural(plan.proposed, 'version was', 'versions were')} proposed.`;
  }
  const n = plan.steps.length;
  return n === 0
    ? `- Plan v${plan.version} was approved with no steps.`
    : `- Plan v${plan.version} was approved with ${plural(n, 'step')}: ${andList(plan.steps)}.`;
}

function ticketBranchLine(branch: NonNullable<RunSummaryFacts['ticketBranch']>): string {
  // S-A2: never just "open".
  const where =
    branch.state === 'merged'
      ? `was merged into ${branch.baseBranch}`
      : branch.state === 'discarded'
        ? 'was discarded'
        : branch.awaitingMerge
          ? 'is waiting for your merge'
          : 'was not merged';
  const merged = branch.merged === 0 ? 'no changes' : plural(branch.merged, 'change');
  const tip = branch.tipChecks === null ? '' : `; ${tipChecksText(branch.tipChecks)}`;
  return `- The ticket branch ${branch.branch} (from ${branch.baseBranch}) has ${merged} merged and ${where}${tip}.`;
}

function tokensLine(tokens: RunSummaryFacts['tokens']): string | null {
  const used = tokens
    .filter((t) => t.agents > 0)
    .map((t) => {
      const [one, many] = KIND_WORDS[t.kind];
      return `${num(t.tokens)} by ${t.agents === 1 ? one : `${t.agents} ${many}`}`;
    });
  return used.length === 0 ? null : `- Budget tokens used: ${andList(used)}.`;
}

/**
 * The comment body (v0.3.0 S-C): plain text that reads like a teammate's comment, at most
 * `COMMENT_BODY_MAX` characters.
 *
 * ```text
 * Run summary                      (or "Run summary (updated)")
 *
 * From the lead:                   (only with a note; without one, the opening sentence)
 * <the lead's note>
 *
 * Details:
 * - <plan>  - <one line per change>  - <ticket branch>  - <budget tokens>
 * ```
 *
 * The web shows the note as the comment and keeps the details behind a disclosure; it finds them
 * by the last `Details:` line, which the facts never contain. When the facts are too long, later
 * change lines give way to a count; the note is kept whole (it is at most 1,500 characters).
 */
export function composeRunSummary(facts: RunSummaryFacts, updated = false): string {
  const heading = updated ? RUN_SUMMARY_UPDATED_HEADING : RUN_SUMMARY_HEADING;
  const main = facts.note === null ? facts.opening : `${RUN_SUMMARY_NOTE_HEADING}\n${facts.note}`;
  const before: string[] = [];
  if (facts.plan !== null) before.push(planLine(facts.plan));
  const after: string[] = [];
  if (facts.ticketBranch !== null) after.push(ticketBranchLine(facts.ticketBranch));
  const tokens = tokensLine(facts.tokens);
  if (tokens !== null) after.push(tokens);

  const build = (shown: number): string => {
    const changes =
      facts.changes.length === 0
        ? ['- No helpers were started.']
        : facts.changes.slice(0, shown).map(changeLine);
    if (shown < facts.changes.length) {
      changes.push(`- …and ${plural(facts.changes.length - shown, 'more change')}.`);
    }
    const details = [RUN_SUMMARY_DETAILS_HEADING, ...before, ...changes, ...after].join('\n');
    return [heading, main, details].join('\n\n');
  };
  let shown = facts.changes.length;
  let body = build(shown);
  while (body.length > COMMENT_BODY_MAX && shown > 0) body = build(--shown);
  // Only a pathological label list could still be too long: cut, never fail.
  return body.length <= COMMENT_BODY_MAX ? body : `${body.slice(0, COMMENT_BODY_MAX - 1)}…`;
}

// ------------------------------------------------------------------ facts from records

const LOOP_OUTCOME: Readonly<Record<string, ChangeOutcome>> = {
  sealing: 'in-review',
  ready: 'in-review',
  reviewing: 'in-review',
  decision: 'in-review',
  rework: 'in-rework',
  'needs-owner': 'waiting-for-you',
  merged: 'merged',
  discarded: 'discarded',
  'no-changes': 'no-changes',
};
const LEGACY_OUTCOME: Readonly<Record<string, ChangeOutcome>> = {
  pending: 'waiting-for-review',
  merged: 'merged',
  discarded: 'discarded',
  'no-changes': 'no-changes',
};
const AGENT_ENDED: Readonly<Partial<Record<EngineAgent['status'], AgentEnding>>> = {
  FAILED: 'failed',
  CANCELLED: 'stopped',
  TIMED_OUT: 'timed-out',
  NEEDS_REVIEW: 'interrupted',
};

export interface FactsInput {
  store: RunStore;
  state: RunState;
  ticketKey: string;
  trigger: SummaryTrigger;
  /** Files and lines per agent run, where git could tell. */
  lines: ReadonlyMap<string, LineCounts>;
}

/** The one plain sentence a summary without the lead's note opens with. */
function openingOf(input: FactsInput, agents: readonly { kind: string; status: string }[]) {
  const t = input.trigger;
  const lead = agents.find((a) => a.kind === 'lead');
  if (t.kind === 'handover') return 'The lead handed the work over without a note.';
  if (t.kind === 'review') {
    return input.state.run.status === 'COMPLETED'
      ? 'The run finished with nothing to review.'
      : 'The agents finished, and their changes are waiting for your review.';
  }
  if (t.outcome === 'failed') return 'The run failed before the work was handed over.';
  if (t.outcome === 'stopped') {
    return lead?.status === 'TIMED_OUT'
      ? 'The run timed out before the work was handed over.'
      : 'The run was stopped before the work was handed over.';
  }
  if (lead?.status === 'FAILED') return 'The lead failed before handing the work over.';
  if (lead?.status === 'CANCELLED') return 'The lead was stopped before handing the work over.';
  return 'The lead ended without handing the work over.';
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
        ? 'none'
        : (LOOP_OUTCOME[stored?.changeState ?? ''] ?? 'in-review')
      : ws === undefined
        ? 'none'
        : (LEGACY_OUTCOME[ws.reviewState] ?? 'waiting-for-review');
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
    opening: openingOf(input, agents),
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
