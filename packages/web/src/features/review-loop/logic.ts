import {
  COMMAND_TOKEN_PATTERN,
  CommandPatternSchema,
  FINAL_CHANGE_STATES,
  MAX_COMMAND_PATTERN_TOKENS,
  MAX_COMMAND_PATTERNS,
  isSafeCommandToken,
  type ApprovalMode,
  type ChangeReviewerMode,
  type ChangeState,
  type CommandPattern,
  type ProjectAllowlist,
  type ProjectApprovals,
} from '@acp/core';
import type {
  ChangeReviewDto,
  CheckRunDto,
  RunDetailDto,
  StartTicketRequest,
  TicketBranchDto,
} from '@acp/core/api';
import type { PillTone } from '../../components/Pill';
import { REVIEW_LOOP_COPY } from '../../lib/copy';
import { isAgentLive } from '../control/run-state';
import { isFailing } from '../ticket/ticket-state';

/**
 * Pure rules for the review loop's screens (ADR-0021, docs/review-loop/README.md §7). The server
 * and the engine decide what is allowed; these only decide what to show and which buttons to
 * offer, so a refused action still shows the server's reason.
 */

/**
 * A run with the review loop: the server sends `changes` or `ticketBranch` (even null, before
 * plan approval). A run from before ADR-0021 has neither and renders exactly as it always did.
 */
export function isReviewLoopRun(run: Pick<RunDetailDto, 'changes' | 'ticketBranch'>): boolean {
  return run.changes !== undefined || run.ticketBranch !== undefined;
}

/**
 * The Checks tab's "Run again" for a review-loop run (RL-V): the server runs the checks again on
 * the change's sealed commit while it is undecided (its worktree is still there), so it is offered
 * for a sealed change that is not merged, discarded or empty. A live helper (rework) is hidden by
 * the tab itself.
 */
export function canRecheckChange(run: Pick<RunDetailDto, 'changes'>, agentRunId: string): boolean {
  const change = run.changes?.find((c) => c.agentRunId === agentRunId);
  return (
    change !== undefined &&
    change.headCommit !== null &&
    !FINAL_CHANGE_STATES.includes(change.state)
  );
}

/**
 * The legacy allowlist that matches a mode, sent alongside `approvals` because the setup request
 * still requires it: Manual pre-approves nothing; Auto edits and Auto pre-approve both (and
 * `approvalsFromLegacy` maps that back to Auto edits, so the two never disagree).
 */
export function allowlistFor(mode: ApprovalMode): ProjectAllowlist {
  const on = mode !== 'manual';
  return { editInOwnWorktree: on, runHarnessChecks: on };
}

export function sameApprovals(a: ProjectApprovals, b: ProjectApprovals): boolean {
  return (
    a.mode === b.mode &&
    a.commands.length === b.commands.length &&
    a.commands.every(
      (p, i) => p.match === b.commands[i]?.match && commandText(p) === commandText(b.commands[i]),
    )
  );
}

/** "npm run test". */
export function commandText(pattern: Pick<CommandPattern, 'argv'> | undefined): string {
  return pattern === undefined ? '' : pattern.argv.join(' ');
}

export type CommandCheck = { ok: true; pattern: CommandPattern } | { ok: false; error: string };

/**
 * A typed command → an allowlist entry, checked with core's `CommandPatternSchema` (the same rule
 * the server applies), so a refusal shows at once in words: characters that could chain or
 * redirect, absolute paths and `..`, forbidden commands, `git` without a read-only subcommand.
 */
export function checkCommand(
  text: string,
  match: CommandPattern['match'],
  existing: readonly CommandPattern[],
): CommandCheck {
  const E = REVIEW_LOOP_COPY.approvals.errors;
  const argv = text
    .trim()
    .split(/\s+/)
    .filter((t) => t.length > 0);
  if (argv.length === 0) return { ok: false, error: E.empty };
  if (existing.length >= MAX_COMMAND_PATTERNS) {
    return { ok: false, error: E.tooMany(MAX_COMMAND_PATTERNS) };
  }
  if (argv.length > MAX_COMMAND_PATTERN_TOKENS) {
    return { ok: false, error: E.tooManyWords(MAX_COMMAND_PATTERN_TOKENS) };
  }
  // Token rules first, in words of their own: the schema's message names the character set only.
  for (const token of argv) {
    if (!COMMAND_TOKEN_PATTERN.test(token)) return { ok: false, error: E.characters(token) };
    if (!isSafeCommandToken(token)) return { ok: false, error: E.path(token) };
  }
  const parsed = CommandPatternSchema.safeParse({ argv, match });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? E.empty };
  }
  const text2 = commandText(parsed.data);
  if (existing.some((p) => p.match === match && commandText(p) === text2)) {
    return { ok: false, error: E.duplicate };
  }
  return { ok: true, pattern: parsed.data };
}

/** What a run would start with; the Start dialog's choices and the project's defaults. */
export interface StartChoice {
  approvalMode: ApprovalMode;
  reviewer: ChangeReviewerMode;
  maxReworkRounds: number;
}

/**
 * The Start request: only the choices that differ from the project's settings, so a run started
 * without changing anything sends `{}` and snapshots the project's settings, as before.
 */
export function startRequest(choice: StartChoice, defaults: StartChoice): StartTicketRequest {
  return {
    ...(choice.approvalMode === defaults.approvalMode ? {} : { approvalMode: choice.approvalMode }),
    ...(choice.reviewer === defaults.reviewer ? {} : { reviewer: choice.reviewer }),
    ...(choice.maxReworkRounds === defaults.maxReworkRounds
      ? {}
      : { maxReworkRounds: choice.maxReworkRounds }),
  };
}

/** True while the run's lead can still decide (a lead exists and is live). */
export function leadIsLive(run: Pick<RunDetailDto, 'agents'>): boolean {
  return run.agents.some((a) => a.kind === 'lead' && isAgentLive(a.status));
}

export function isFinalChange(state: ChangeState): boolean {
  return FINAL_CHANGE_STATES.includes(state);
}

/**
 * The owner's override buttons on a change card (README §7): only for a change the lead handed to
 * the owner, or any undecided change once the lead has ended. A change still being saved has no
 * commit to decide on yet.
 */
export function ownerMayDecide(
  change: Pick<ChangeReviewDto, 'state'>,
  run: Pick<RunDetailDto, 'agents'>,
): boolean {
  if (change.state === 'needs-owner') return true;
  if (isFinalChange(change.state) || change.state === 'sealing') return false;
  return !leadIsLive(run);
}

/** The chip's tone: warning only when it waits for you, success once merged (DESIGN.md). */
export function changeTone(state: ChangeState): PillTone {
  switch (state) {
    case 'needs-owner':
      return 'warning';
    case 'merged':
      return 'success';
    case 'reviewing':
    case 'rework':
      return 'accent';
    default:
      return 'neutral';
  }
}

const byStartedDesc = (a: CheckRunDto, b: CheckRunDto) =>
  a.startedAt < b.startedAt ? 1 : a.startedAt > b.startedAt ? -1 : 0;

/** The latest run of each check (required first, then by name), whoever's commit it ran on. */
export function latestChecks(checks: readonly CheckRunDto[]): CheckRunDto[] {
  const seen = new Set<string>();
  const latest: CheckRunDto[] = [];
  for (const c of [...checks].sort(byStartedDesc)) {
    if (seen.has(c.checkId)) continue;
    seen.add(c.checkId);
    latest.push(c);
  }
  return latest.sort((a, b) =>
    a.required !== b.required ? (a.required ? -1 : 1) : a.name.localeCompare(b.name),
  );
}

export type ChecksSummary =
  | { kind: 'none' }
  | { kind: 'passed'; passed: number; total: number }
  | { kind: 'failed'; failing: CheckRunDto[] };

export function checksSummary(checks: readonly CheckRunDto[]): ChecksSummary {
  const latest = latestChecks(checks);
  if (latest.length === 0) return { kind: 'none' };
  const failing = latest.filter((c) => c.required && isFailing(c));
  if (failing.length > 0) return { kind: 'failed', failing };
  return {
    kind: 'passed',
    passed: latest.filter((c) => c.status === 'passed').length,
    total: latest.length,
  };
}

/**
 * What the owner may do with the ticket branch now:
 * - `merge`: the run waits for the final merge (REVIEW, or interrupted with an open branch);
 * - `discard-only`: the run stopped or failed and the branch stays open (README §5 "Stops");
 * - `waiting`: agents still work on the ticket;
 * - `closed`: the branch was merged or discarded.
 */
export type TicketBranchMode = 'merge' | 'discard-only' | 'waiting' | 'closed';

export function ticketBranchMode(
  run: Pick<RunDetailDto, 'status'>,
  branch: Pick<TicketBranchDto, 'state'>,
): TicketBranchMode {
  if (branch.state !== 'open') return 'closed';
  if (run.status === 'REVIEW' || run.status === 'NEEDS_REVIEW') return 'merge';
  if (run.status === 'CANCELLED' || run.status === 'FAILED' || run.status === 'COMPLETED') {
    return 'discard-only';
  }
  return 'waiting';
}

/**
 * Who reviews this run's changes: the run's own snapshot (`RunDetailDto.reviewer`, RL-V); for a
 * server without it, what its review rounds show (a review agent's round means the agent), else
 * the project's current setting.
 */
export function runReviewer(
  run: Pick<RunDetailDto, 'changes' | 'reviewer'>,
  fallback: ChangeReviewerMode,
): ChangeReviewerMode {
  if (run.reviewer !== undefined) return run.reviewer;
  const rounds = (run.changes ?? []).flatMap((c) => c.reviews);
  if (rounds.some((r) => r.reviewer === 'agent')) return 'agent';
  if (rounds.some((r) => r.reviewer === 'lead')) return 'lead';
  return fallback;
}

/**
 * The run's rework limit: its own snapshot (`RunDetailDto.maxReworkRounds`, RL-V), else what its
 * changes carry, else the project's current setting.
 */
export function runMaxRounds(
  run: Pick<RunDetailDto, 'changes' | 'maxReworkRounds'>,
  fallback: number,
): number {
  return run.maxReworkRounds ?? run.changes?.[0]?.maxReworkRounds ?? fallback;
}

/** "abc1234": a commit as people read it. */
export function shortCommit(commit: string): string {
  return commit.slice(0, 7);
}
