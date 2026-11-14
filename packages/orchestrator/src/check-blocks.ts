import { GitCommitSchema } from '@acp/core';
import type { CheckRunStatus, ProgramChangeCheckBlock } from '@acp/core';
import { AGENT_NOTE_LINE } from './agent-note.js';
import { editorNoteBlocks, reworkNoteBlocks, withOwnerNotes } from './arrow-notes.js';
import { checksFailedContext, renderFailureContext } from './failure-context.js';
import { reopenForFix, startAuthorFix } from './fix-turn.js';
import { routeFailure as routeByWhen } from './failure-router.js';
import type { FailureCheck } from '@acp/core';
import { isOverBudget } from './budget.js';
import { applyCommand } from './commands.js';
import type { Draft } from './draft.js';
import { refusal } from './errors.js';
import { runLimits } from './limits.js';
import { activeHelperCount, enterReview, nodeHasRoom, notifyLead } from './loop.js';
import { changeCheckBlockOf } from './program.js';
import { hasReviewableChange, launchFieldsFor, stageOf } from './stages.js';
import { cleanSummary } from './summary.js';
import type { EngineAgent, EngineChange, EngineContext, EngineResult, RunState } from './state.js';

/**
 * The harness in the workflow, engine half (ADR-0027, docs/history/v0.3.0/README.md part 5, H-C):
 *
 * - a Checks block on a helper's or tester's change runs on its sealed commit before its review
 *   (`run-change-checks`, reported with `changeChecksFinished`); on failure the block's route
 *   decides: back to the helper (within the block's `maxRounds`, the lead told each round), the
 *   lead decides, or the owner is asked;
 * - an editing agent whose new worktree could not be set up never starts (`agentSetupFailed`).
 *
 * The engine never runs a command: the server runs the checks and the setup, and reports back.
 * Failure details hold check names, exit codes and the last 4 KiB of each check's output (the
 * project's tool output, redacted by the server; never conversation content, ADR-0009).
 */

/** The most of one failing check's output that reaches a helper or the lead, in UTF-8 bytes. */
export const CHECK_FAILURE_TAIL_MAX_BYTES = 4 * 1024;
/** The most failing checks quoted in one note. */
const MAX_FAILED_QUOTED = 5;

/** One failing check of a block, as the server reports it. */
export interface FailedCheck {
  name: string;
  status: CheckRunStatus;
  exitCode: number | null;
  /** The last ≤ 4 KiB of its output, redacted. */
  outputTail: string;
}

/** What the server reports after `run-change-checks`. */
export interface ChangeChecksResult {
  /** The commit the block ran on: the change's sealed commit. */
  commit: string;
  /** Every selected check passed (true when the block selected none). */
  passed: boolean;
  /** The checks that did not pass, in the block's order; empty when `passed`. */
  failed: readonly FailedCheck[];
}

type Body<T> = ReturnType<typeof refusal> | { value: T };
const done = { value: undefined } as const;

/** The last `max` UTF-8 bytes of `text` (never splits a character). */
function lastUtf8(text: string, max: number): string {
  const chars = [...text];
  let n = 0;
  let start = chars.length;
  while (start > 0) {
    const c = chars[start - 1]?.codePointAt(0) ?? 0;
    const len = c < 0x80 ? 1 : c < 0x800 ? 2 : c < 0x10000 ? 3 : 4;
    if (n + len > max) break;
    n += len;
    start--;
  }
  return chars.slice(start).join('');
}

function names(failed: readonly FailedCheck[]): string {
  if (failed.length === 0) return '';
  const shown = failed.slice(0, MAX_FAILED_QUOTED).map((f) => f.name);
  const more = failed.length - shown.length;
  return `: ${shown.join(', ')}${more > 0 ? ` and ${more} more` : ''}`;
}

function how(f: FailedCheck): string {
  switch (f.status) {
    case 'failed':
      return f.exitCode === null ? 'failed' : `exit ${f.exitCode}`;
    case 'timed-out':
      return 'timed out';
    case 'skipped':
      return 'not run';
    case 'interrupted':
      return 'interrupted';
    case 'error':
      return 'could not run';
    case 'passed':
      return 'passed';
  }
}

/** Each failing check's name, how it ended and the end of its output (at most 4 KiB). */
export function failureDetails(failed: readonly FailedCheck[]): string {
  const lines = failed.slice(0, MAX_FAILED_QUOTED).map((f) => {
    const tail = lastUtf8(f.outputTail, CHECK_FAILURE_TAIL_MAX_BYTES).trimEnd();
    return `- ${f.name} (${how(f)})${tail === '' ? ': no output.' : `, last output:\n${tail}`}`;
  });
  if (failed.length > MAX_FAILED_QUOTED) {
    lines.push(`- and ${failed.length - MAX_FAILED_QUOTED} more failing check(s).`);
  }
  return lines.join('\n\n');
}

/** The failing checks as the failure context lists them (ADR-0038 §2), output capped as above. */
export function failureChecks(failed: readonly FailedCheck[]): FailureCheck[] {
  return failed.slice(0, MAX_FAILED_QUOTED).map((f) => ({
    name: f.name,
    how: how(f),
    outputTail: lastUtf8(f.outputTail, CHECK_FAILURE_TAIL_MAX_BYTES),
  }));
}

/**
 * ADR-0038 §2: a harness that cannot run, as opposed to failing checks: no failing check ran to
 * an exit (each one `could not run` or `not run`: invalid, its command could not start, no
 * checkout, no result), and at least one could not run.
 */
export function isHarnessFailure(failed: readonly FailedCheck[]): boolean {
  return (
    failed.some((f) => f.status === 'error') &&
    failed.every((f) => f.status === 'error' || f.status === 'skipped')
  );
}

/** The rendered failure context of a failed Checks block on the agent's change. */
function blockContext(
  d: Draft,
  agent: EngineAgent,
  block: ProgramChangeCheckBlock,
  failed: readonly FailedCheck[],
  rounds?: { used: number; max: number },
): string {
  return renderFailureContext(
    checksFailedContext(
      d,
      agent,
      { nodeId: block.nodeId, label: block.label },
      failureChecks(failed),
      isHarnessFailure(failed),
      rounds,
    ),
  );
}

const DECIDE_LINE =
  'Decide with request_rework (with comments), discard_change (with a reason), ask_owner (with a question) or merge_change; view_change shows the change.';

/**
 * `changeSealed`: the change was sealed with a commit. When its node flows into a Checks block,
 * the block runs on the commit before the review (the change waits in `ready`).
 */
export function startChangeChecks(d: Draft, agent: EngineAgent, change: EngineChange): void {
  const block = changeCheckBlockOf(d.program(), agent);
  if (block === undefined || change.headCommit === null) return;
  change.blockChecks = 'pending';
  d.effects.push({
    type: 'run-change-checks',
    agentRunId: agent.id,
    commit: change.headCommit,
    blockNodeId: block.nodeId,
    select: block.select,
  });
}

/**
 * The server ran the change's Checks block (ADR-0027 §5) after `run-change-checks`. Passed: the
 * change goes on to its review route. Failed: the block's route (back to the helper while its
 * rounds, the helper's budget and a slot allow, else the lead; the lead; or the owner). A result
 * for a commit the change is no longer at, or a change decided meanwhile, changes nothing.
 */
export function changeChecksFinished(
  state: RunState,
  agentRunId: string,
  result: ChangeChecksResult,
  ctx: EngineContext,
): EngineResult {
  if (!GitCommitSchema.safeParse(result.commit).success) {
    return { ok: false, refusal: refusal('invalid-input', 'The checked commit id is not valid.') };
  }
  return applyCommand(state, ctx, (d): Body<undefined> => {
    if (d.integration === undefined) {
      return refusal(
        'legacy-review',
        'This run has no review loop; the owner reviews each change.',
      );
    }
    const agent = d.agent(agentRunId);
    const change = agent?.change;
    if (agent === undefined || change === undefined) {
      return refusal('change-not-found', 'No change in this run belongs to that agent.');
    }
    if (
      change.blockChecks !== 'pending' ||
      change.state !== 'ready' ||
      change.merging ||
      change.headCommit !== result.commit
    ) {
      return done;
    }
    const block = changeCheckBlockOf(d.program(), agent);
    if (block === undefined || result.passed) {
      // `reconcile` now assigns the change its reviewer, oldest first.
      change.blockChecks = 'passed';
      return done;
    }
    change.blockChecks = 'failed';
    routeFailure(d, agent, change, block, result.failed);
    return done;
  });
}

function routeFailure(
  d: Draft,
  agent: EngineAgent,
  change: EngineChange,
  block: ProgramChangeCheckBlock,
  failed: readonly FailedCheck[],
): void {
  const who = `${agent.role}'s change (agentId ${agent.id})`;
  // ADR-0038 §4 (FR-5): the owner's When arrow from this block routes it first ("ask me" wins:
  // such a block has no When arrow). Without one, the block's own setting below.
  if (block.onFailure !== 'owner') {
    const routed = routeByWhen(d, {
      context: checksFailedContext(
        d,
        agent,
        { nodeId: block.nodeId, label: block.label },
        failureChecks(failed),
        isHarnessFailure(failed),
      ),
      sourceNodeId: block.nodeId,
      change: agent,
      lineage: agent.id,
      headline: `The checks on ${who} failed${names(failed)}.`,
      decideLine: agent.kind === 'tester' ? TESTER_FAILURE_LINE : DECIDE_LINE,
    });
    if (routed.kind === 'lead') {
      change.state = 'decision';
      if (agent.kind === 'tester') reopenForFix(d);
      return;
    }
    if (routed.kind === 'fixing') return;
  }
  // ADR-0038 §3: a tester's failures never go back to the tester.
  if (agent.kind === 'tester' && block.onFailure !== 'owner') {
    testerFailure(d, agent, change, block, failed, who);
    return;
  }
  switch (block.onFailure) {
    case 'helper': {
      const limit = block.maxRounds ?? 0;
      const used = change.checkRounds ?? 0;
      if (used < limit && canReworkNow(d, agent, change)) {
        reworkForChecks(d, agent, change, failed, used + 1, limit);
        return;
      }
      change.state = 'decision';
      const why =
        used >= limit
          ? `its Checks block has no rework round left (${used} of ${limit} used)`
          : `${agent.role} cannot rework it now`;
      notifyLead(
        d,
        [
          `The checks on ${who} failed${names(failed)}, and ${why}, so you decide.`,
          blockContext(d, agent, block, failed, { used, max: limit }),
          DECIDE_LINE,
        ].join('\n\n'),
      );
      return;
    }
    case 'lead':
      change.state = 'decision';
      notifyLead(
        d,
        [
          `The checks on ${who} failed${names(failed)}. You decide.`,
          blockContext(d, agent, block, failed),
          DECIDE_LINE,
        ].join('\n\n'),
      );
      return;
    case 'owner':
      change.state = 'needs-owner';
      notifyLead(
        d,
        [
          `The checks on ${who} failed${names(failed)}. This workflow sends it to the owner, who decides; you will get a message when they do.`,
          blockContext(d, agent, block, failed),
        ].join('\n\n'),
      );
      return;
  }
}

/** What the lead may do about a tester's failure (ADR-0038 §3). */
export const TESTER_FAILURE_LINE =
  "The tester never fixes product code. To fix it, start a helper with start_agent (give it the failure context), decide that helper's change, then call request_review again. Decide the tester's change as usual: merge_change, request_rework, discard_change or ask_owner.";

/**
 * ADR-0038 §3: the checks on a tester's change failed. `onFailure: 'helper'` means the author:
 * exactly one known author gets a fix turn (`startAuthorFix`); several, none, or a fix that
 * cannot start now go to the lead. `lead`: the lead. Either way the lead gets the context, and
 * the tester's change waits for its decision; the tester is never sent back.
 */
function testerFailure(
  d: Draft,
  tester: EngineAgent,
  change: EngineChange,
  block: ProgramChangeCheckBlock,
  failed: readonly FailedCheck[],
  who: string,
): void {
  change.state = 'decision';
  const ctx = checksFailedContext(
    d,
    tester,
    { nodeId: block.nodeId, label: block.label },
    failureChecks(failed),
    isHarnessFailure(failed),
  );
  const context = renderFailureContext(ctx);
  let why: string | null = null;
  if (block.onFailure === 'helper') {
    const first = ctx.authors[0];
    const only =
      ctx.authorsKnown && ctx.authors.length === 1 && first !== undefined
        ? d.agent(first.agentId)
        : undefined;
    if (only !== undefined) {
      const fix = startAuthorFix(
        d,
        only,
        `Fix the code that makes the checks on ${tester.role}'s tests fail; your block's earlier change touched the files they point at. The failure context below says what failed. Do not weaken or delete the tests.`,
        context,
      );
      if (fix.ok) {
        notifyLead(
          d,
          [
            `The checks on ${who} failed${names(failed)}. This workflow sends a tester's failures to their author, so ${only.role} is fixing it: a new helper (agentId ${fix.agent.id}) started from the ticket branch. Decide its change as usual, then decide ${tester.role}'s change and call request_review again.`,
            context,
          ].join('\n\n'),
        );
        return;
      }
      why = fix.why;
    } else {
      why =
        ctx.authors.length === 0
          ? 'no helper change is known'
          : ctx.authorsKnown
            ? 'several helpers changed the failing files'
            : "no helper's change matches the failing files";
    }
  }
  reopenForFix(d);
  notifyLead(
    d,
    [
      why === null
        ? `The checks on ${who} failed${names(failed)}. You decide.`
        : `The checks on ${who} failed${names(failed)}. This workflow sends a tester's failures to their author, but ${why}, so you decide.`,
      context,
      TESTER_FAILURE_LINE,
    ].join('\n\n'),
  );
}

/**
 * Like the reviewer's direct rework (ADR-0023 §4): the run is going, the helper waits within its
 * budget, and a helper slot and room in its node are free.
 */
function canReworkNow(d: Draft, agent: EngineAgent, change: EngineChange): boolean {
  if (!['RUNNING', 'BLOCKED', 'REVIEW'].includes(d.run.status)) return false;
  if (agent.status !== 'AWAITING_REVIEW' || change.merging) return false;
  if (isOverBudget(agent.budgetTokensUsed, agent.budgetLimit)) return false;
  if (activeHelperCount(d) >= runLimits(d).maxConcurrentHelpers) return false;
  return nodeHasRoom(d, agent);
}

function checkReworkPrompt(
  agent: EngineAgent,
  failed: readonly FailedCheck[],
  roundText: string,
): string {
  return [
    `The project's checks failed on your change (${roundText}):`,
    failureDetails(failed),
    'Fix what makes them fail. You may run the same check commands yourself to confirm.',
    `Work in the same copy of the project as before. Your task was: ${agent.task ?? '(no task text)'}`,
    'When you are done, end your turn: your change is checked again, then reviewed.',
    AGENT_NOTE_LINE,
  ].join('\n\n');
}

/** "Back to the helper": the same helper, same worktree and session, with the failing checks. */
function reworkForChecks(
  d: Draft,
  agent: EngineAgent,
  change: EngineChange,
  failed: readonly FailedCheck[],
  round: number,
  limit: number,
): void {
  change.checkRounds = round;
  change.state = 'rework';
  change.verdict = null;
  change.reviewer = null;
  change.reviewerAgentRunId = null;
  change.readyAt = null;
  change.checks = null;
  change.merging = false;
  change.conflictFiles = [];
  delete change.blockChecks;
  const roundText = `check round ${round} of ${limit}`;
  d.setAgentStatus(agent, 'STARTING');
  d.effects.push({
    type: 'start-agent',
    agentRunId: agent.id,
    kind: agent.kind,
    role: agent.role,
    ...launchFieldsFor(
      d.program(),
      stageOf(agent),
      // ADR-0037 §2 (amended 2026-11-14): with the notes on its role arrow and the block's rework
      // arrow.
      withOwnerNotes(checkReworkPrompt(agent, failed, roundText), [
        ...editorNoteBlocks(d.program(), stageOf(agent)),
        ...reworkNoteBlocks(d.program(), stageOf(agent), [
          changeCheckBlockOf(d.program(), agent)?.nodeId ?? '',
        ]),
      ]),
    ),
    rework: { resumeSessionId: agent.sessionId },
    ...d.launchModeFields(agent),
    // ADR-0034 §4 (CM-3): only a fresh session needs its starting points again.
    ...(agent.sessionId === null && agent.startingPoints !== undefined
      ? { startingPoints: agent.startingPoints }
      : {}),
  });
  // Like the reviewer loop's direct route: the lead is told each round, with the failure context
  // (ADR-0038 §2: the lead always gets it).
  const block = changeCheckBlockOf(d.program(), agent);
  notifyLead(
    d,
    [
      `The checks on ${agent.role}'s change (agentId ${agent.id}) failed${names(failed)}; it went back to ${agent.role} for rework (${roundText}). You get the change once its checks pass and it is reviewed, or its rounds run out.`,
      ...(block === undefined
        ? []
        : [blockContext(d, agent, block, failed, { used: round, max: limit })]),
    ].join('\n\n'),
  );
}

/** Why an editing agent's setup did not pass, as the server reports it. */
export interface SetupFailure {
  /** The server's plain sentence, e.g. "Setup step 'Install' failed (exit 1)." */
  reason: string;
  /** The end of the step's output (redacted by the server); at most 4 KiB reaches the lead. */
  outputTail?: string;
}

/**
 * ADR-0027 §1: the setup of a new helper's or tester's worktree failed, timed out or was refused
 * (a network step while the project's switch is off), so the agent never starts. Its Latest line
 * says why (the reason), the lead is told with the end of the step's output, and it ends like a
 * failed turn (a loop run seals its empty worktree). Ignored for an agent no longer starting
 * (stopped meanwhile).
 */
export function agentSetupFailed(
  state: RunState,
  agentRunId: string,
  failure: string | SetupFailure,
  ctx: EngineContext,
): EngineResult {
  const { reason, outputTail = '' } = typeof failure === 'string' ? { reason: failure } : failure;
  return applyCommand(state, ctx, (d): Body<undefined> => {
    const agent = d.agent(agentRunId);
    if (agent === undefined) return refusal('unknown-agent', 'Unknown agent.');
    if (!hasReviewableChange(agent.kind)) {
      return refusal('invalid-input', 'Only helpers and testers have a setup.');
    }
    if (agent.status !== 'STARTING') return done;
    const text = cleanSummary(reason, 'Setup failed');
    agent.latestActivity = text;
    const tail = lastUtf8(outputTail, CHECK_FAILURE_TAIL_MAX_BYTES).trimEnd();
    notifyLead(
      d,
      [
        `${agent.role} (agentId ${agent.id}) did not start: ${text} The project's setup prepares each helper's copy of the project before it starts, so it did no work. A helper started now would most likely fail the same way; the owner can see the setup's output on the ticket.`,
        ...(tail === '' ? [] : [`The end of the step's output:\n${tail}`]),
      ].join('\n\n'),
    );
    if (d.integration !== undefined) enterReview(d, agent, true);
    else d.endAgent(agent, 'FAILED', false);
    return done;
  });
}
