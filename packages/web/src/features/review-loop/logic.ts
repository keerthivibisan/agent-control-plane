import {
  COMMAND_TOKEN_PATTERN,
  CommandPatternSchema,
  FINAL_CHANGE_STATES,
  MAX_COMMAND_PATTERN_TOKENS,
  MAX_COMMAND_PATTERNS,
  RUN_OPTION_KEYS,
  approvalsOf,
  checkRunWasInterrupted,
  graphRunDefaults,
  isEditorNode,
  isModeWithin,
  isSafeCommandToken,
  ticketOptionsDiffer,
  type ApprovalMode,
  type ChangeReviewerMode,
  type ChangeState,
  type CommandPattern,
  type ProjectAllowlist,
  type ProjectApprovals,
  type RunOptions,
  type TicketRunOptions,
  type WorkflowGraph,
} from '@acp/core';
import type {
  ChangeReviewDto,
  CheckRunDto,
  RunDetailDto,
  StartTicketRequest,
  TicketBranchDto,
  TicketBranchReviewDto,
  TicketRunOptionsPatch,
  WorkflowGraphDto,
} from '@acp/core/api';
import type { PillTone } from '../../components/Pill';
import { REVIEW_LOOP_COPY, TICKET_OPTIONS_COPY } from '../../lib/copy';
import { isAgentLive } from '../control/run-state';
import { isFailing } from '../ticket/ticket-state';

/**
 * Pure rules for the review loop's screens (ADR-0021, docs/history/review-loop/README.md §7). The
 * server and the engine decide what is allowed; these only decide what to show and which buttons to
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

/** Recovered helpers may be resumed only when the server proves they are eligible. */
export function ownerMayRework(
  change: Pick<ChangeReviewDto, 'state'> &
    Partial<Pick<ChangeReviewDto, 'agentRunId' | 'canReworkAfterRestart'>>,
  run: Pick<RunDetailDto, 'agents'>,
): boolean {
  if (!ownerMayDecide(change, run)) return false;
  const agent = run.agents.find((a) => a.id === change.agentRunId);
  return agent?.status === 'NEEDS_REVIEW' ? change.canReworkAfterRestart === true : true;
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
  | { kind: 'failed'; failing: CheckRunDto[] }
  /** WG-F3: a required check has no result because the app stopped; the merge runs it again. */
  | { kind: 'stopped'; stopped: CheckRunDto[] };

/**
 * The commit's checks as the server's merge gate counts them (ADR-0021): a required check that
 * failed blocks; one the app's shutdown stopped is not run yet, as the gate counts it (WG-F3).
 */
export function checksSummary(checks: readonly CheckRunDto[]): ChecksSummary {
  const latest = latestChecks(checks);
  if (latest.length === 0) return { kind: 'none' };
  const failing = latest.filter((c) => c.required && !checkRunWasInterrupted(c) && isFailing(c));
  if (failing.length > 0) return { kind: 'failed', failing };
  const stopped = latest.filter((c) => c.required && checkRunWasInterrupted(c));
  if (stopped.length > 0) return { kind: 'stopped', stopped };
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
 * The ticket has nothing to merge: the combined change lists no files, or, before it has loaded,
 * the branch tip is still the commit it was created at. Merge and Push & open PR have nothing to
 * ship then (an empty merge, and `gh` refuses a pull request without commits).
 */
export function branchHasNoChanges(
  branch: Pick<TicketBranchDto, 'baseCommit' | 'headCommit'>,
  review: Pick<TicketBranchReviewDto, 'files'> | undefined,
): boolean {
  return review !== undefined ? review.files.length === 0 : branch.headCommit === branch.baseCommit;
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

// ---------------------------------------------------------------- ticket run options (RL-H)

/**
 * The project's run settings a ticket's "Project default" follows: its approval mode, and what its
 * graph amounts to (`graphRunDefaults`, the same core function the server's run start uses). The
 * graph comes from `GET /workflow-graph`, which answers for every project, stored as a graph or
 * not (WG-F: the version 1 `GET /workflow` answers 409 once a project stores a graph).
 */
export function projectRunDefaults(dto: Pick<WorkflowGraphDto, 'setup' | 'graph'>): RunOptions {
  return { approvalMode: approvalsOf(dto.setup).mode, ...graphRunDefaults(dto.graph) };
}

/**
 * The PATCH body for the ticket page's Run options: every option, either set or `null` (back to
 * the project default), so the saved options are exactly what the form shows.
 */
export function runOptionsPatch(draft: TicketRunOptions): TicketRunOptionsPatch {
  return {
    approvalMode: draft.approvalMode ?? null,
    reviewer: draft.reviewer ?? null,
    maxReworkRounds: draft.maxReworkRounds ?? null,
  };
}

/**
 * The board card's badge ("Manual", "Full auto · Lead reviews"): the ticket's options that differ
 * from the project's settings now. While the project's settings are unknown, every set option
 * shows. Null when the ticket follows the project.
 */
export function optionsBadge(
  options: TicketRunOptions | undefined,
  defaults: RunOptions | null,
): string | null {
  const keys =
    defaults === null
      ? RUN_OPTION_KEYS.filter((k) => options?.[k] !== undefined)
      : ticketOptionsDiffer(defaults, options);
  const B = TICKET_OPTIONS_COPY.badge;
  const parts = keys.flatMap((k): string[] => {
    if (k === 'approvalMode' && options?.approvalMode !== undefined) {
      return [REVIEW_LOOP_COPY.modes.word[options.approvalMode]];
    }
    if (k === 'reviewer' && options?.reviewer !== undefined) return [B.reviewer[options.reviewer]];
    if (k === 'maxReworkRounds' && options?.maxReworkRounds !== undefined) {
      return [TICKET_OPTIONS_COPY.roundsValue(options.maxReworkRounds)];
    }
    return [];
  });
  return parts.length === 0 ? null : parts.join(' · ');
}

// ---------------------------------------------------------------- run options as a limit (WG-E)

/**
 * What the run options need to know about the project's workflow (ADR-0023): each editing block
 * runs with its own mode (or the project's), and a ticket's or run's mode is only a limit on it.
 */
export interface BlockModes {
  /** The project's mode, which blocks set to "Project default" use. */
  projectMode: ApprovalMode;
  /** The loosest mode any editing block runs with; null when the workflow has none. */
  loosest: ApprovalMode | null;
}

/** The loosest mode of the graph's editing blocks: each block's own, else the project's. */
export function loosestBlockMode(
  graph: Pick<WorkflowGraph, 'nodes'>,
  projectMode: ApprovalMode,
): ApprovalMode | null {
  let loosest: ApprovalMode | null = null;
  for (const node of graph.nodes) {
    if (!isEditorNode(node)) continue;
    const mode = node.approvalMode ?? projectMode;
    if (loosest === null || !isModeWithin(mode, loosest)) loosest = mode;
  }
  return loosest;
}

export function blockModesOf(dto: Pick<WorkflowGraphDto, 'graph' | 'setup'>): BlockModes {
  const projectMode = approvalsOf(dto.setup).mode;
  return { projectMode, loosest: loosestBlockMode(dto.graph, projectMode) };
}

/**
 * True when a limit of `mode` changes nothing: it is looser than every editing block, so no block
 * runs differently. Unknown blocks (a server without graphs) never say so.
 */
export function limitHasNoEffect(mode: ApprovalMode, blocks: BlockModes | undefined): boolean {
  return blocks !== undefined && blocks.loosest !== null && !isModeWithin(mode, blocks.loosest);
}

/** Why a run's limit changes nothing: the ticket's own limit, or the blocks, is stricter. */
export type NoEffectReason =
  { by: 'ticket'; limit: ApprovalMode } | { by: 'blocks'; loosest: ApprovalMode };

/**
 * Each block runs with the strictest of its own mode, the ticket's limit and the run's limit
 * (ADR-0023 refinement 5), so a run limit looser than the stricter of the ticket's limit and the
 * loosest block changes nothing. The ticket is named when its limit is the stricter one (or the
 * blocks are unknown).
 */
export function runLimitNoEffect(
  mode: ApprovalMode,
  blocks: BlockModes | undefined,
  ticketLimit: ApprovalMode | undefined,
): NoEffectReason | null {
  const loosest = blocks?.loosest ?? undefined;
  if (ticketLimit !== undefined && (loosest === undefined || isModeWithin(ticketLimit, loosest))) {
    return isModeWithin(mode, ticketLimit) ? null : { by: 'ticket', limit: ticketLimit };
  }
  if (loosest === undefined) return null;
  return isModeWithin(mode, loosest) ? null : { by: 'blocks', loosest };
}

/**
 * Distinct rounds of a change that this decider sent back for rework: `reviewer` is the review
 * agent's direct rework (ADR-0023 route "direct"), `lead` the lead's. A decider's note on a round
 * is a second row with the same decision, so rounds are counted once.
 */
export function reworkRoundsBy(
  change: Pick<ChangeReviewDto, 'reviews'>,
  decider: 'reviewer' | 'lead',
): number {
  return new Set(
    change.reviews
      .filter((r) => r.decision === 'rework' && r.decidedBy === decider)
      .map((r) => r.round),
  ).size;
}
