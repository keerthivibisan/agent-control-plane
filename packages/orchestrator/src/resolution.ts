import { GitCommitSchema, type WorkflowNodeId } from '@acp/core';
import { BRANCH_RULE_LINE } from './agent-note.js';
import { applyCommand } from './commands.js';
import { refusal } from './errors.js';
import { notifyLead } from './loop.js';
import { programOf } from './program.js';
import { launchFieldsFor } from './stages.js';
import type { EngineAgent, EngineContext, EngineResult, RunState } from './state.js';
import { isActiveAgentStatus, isLiveAgentStatus } from './transitions.js';

/**
 * ADR-0030: the resolver of a conflict-resolution operation. The server pins the ticket tip and
 * the target tip, merges them in a worktree it prepares, and, when git leaves conflicts, asks the
 * engine for a resolver: a worker of a helper block (the policy's, else the first) that edits the
 * conflicting content and nothing else. It has no git authority (the adapter's branch guard holds
 * for it as for every helper), no child-management tools, and its turn never enters the review
 * loop: the server commits the merge, checks it and carries the operation on (assessment, policy
 * gate, checks, promotion by compare-and-swap). The engine only tracks the agent and tells the lead.
 */

export const RESOLVER_ROLE = 'Conflict resolver';
const done = { value: undefined } as const;
const MAX_BRIEF_FILES = 40;

export interface StartResolverInput {
  operationId: string;
  ticketBranch: string;
  targetBranch: string;
  ticketCommit: string;
  targetCommit: string;
  conflictFiles: readonly string[];
  attempt: number;
  maxAttempts: number;
  /** Earlier attempts of the operation, so this one does not repeat them blindly. */
  previous: readonly { attempt: number; outcome: string; note: string | null }[];
  /** Checks that failed on the previous candidate, to fix this time. */
  failedChecks: readonly string[];
  /** The policy's helper block; null: the run's first helper block. */
  helperNode: WorkflowNodeId | null;
}

/** The resolver's brief: the ticket's intent is in the ticket branch; this says what to merge. */
export function resolverBrief(input: StartResolverInput): string {
  const files = input.conflictFiles.slice(0, MAX_BRIEF_FILES);
  const more =
    input.conflictFiles.length > files.length
      ? `\n- … and ${input.conflictFiles.length - files.length} more (git status lists them)`
      : '';
  const previous =
    input.previous.length === 0
      ? ''
      : `\n\nEarlier attempts (do not repeat what did not work):\n${input.previous
          .map(
            (p) => `- attempt ${p.attempt}: ${p.outcome}${p.note === null ? '' : ` — ${p.note}`}`,
          )
          .join('\n')}`;
  const failed =
    input.failedChecks.length === 0
      ? ''
      : `\n\nThe previous result failed these checks; fix the cause: ${input.failedChecks.join(', ')}.`;
  return [
    `Resolve a merge conflict (attempt ${input.attempt} of ${input.maxAttempts}). The app merged ${input.targetBranch} (${input.targetCommit.slice(0, 12)}) into the ticket branch ${input.ticketBranch} (${input.ticketCommit.slice(0, 12)}) in this folder, and git left conflicts in:`,
    `${files.map((f) => `- ${f}`).join('\n')}${more}`,
    "Edit each file so it keeps both the ticket's intended behaviour and the target's: do not simply take one side, do not restore what the target deliberately removed, and leave no conflict markers (<<<<<<<, =======, >>>>>>>). You may adjust neighbouring files when the combination needs it. Read both sides with `git diff`, `git log` or `git show <commit>:<path>`." +
      previous +
      failed,
    BRANCH_RULE_LINE,
    "Before you finish, call report_work once: a short note on what you combined and why; `outcome` (`completed`, or `blocked` with what stopped you, or `no-change`); and `assessment` of the whole combined change: its `classification` (prose-only, runtime, configuration or uncertain), whether to run checks (`recommendation`), which check ids are relevant (`proposedCheckIds`) and a short `reason`. The app decides what actually runs by the project's policy.",
  ].join('\n\n');
}

/**
 * Starts the resolver while the run waits for the owner's final step (REVIEW, every change
 * decided, nothing else working). One resolver at a time per run.
 */
export function startResolver(
  state: RunState,
  input: StartResolverInput,
  ctx: EngineContext,
): EngineResult<string> {
  return applyCommand(state, ctx, (d) => {
    const loop = d.integration;
    if (loop === undefined) return refusal('invalid-input', 'This run has no review loop.');
    if (d.isStopping()) return refusal('run-cancelling', 'The run is being stopped.');
    if (d.run.status !== 'REVIEW') {
      return refusal('run-not-active', 'The run is not waiting for its final step.');
    }
    if (loop.ticketBranch === null || loop.ticketBranch !== input.ticketBranch) {
      return refusal('no-ticket-branch', 'The run has no such ticket branch.');
    }
    if (d.agents.some((a) => a.kind !== 'lead' && isActiveAgentStatus(a.status))) {
      return refusal('workers-still-running', 'Some agents are still working.');
    }
    if (
      !GitCommitSchema.safeParse(input.ticketCommit).success ||
      !GitCommitSchema.safeParse(input.targetCommit).success
    ) {
      return refusal('invalid-input', 'The pinned commits are not valid.');
    }
    const program = programOf(d);
    const node =
      input.helperNode === null
        ? program.helpers[0]
        : program.helpers.find((h) => h.id === input.helperNode);
    if (node === undefined) {
      return refusal('invalid-input', 'The workflow has no helper block for the resolver.');
    }
    const lead = d.lead();
    const brief = resolverBrief(input);
    const agent: EngineAgent = {
      id: d.freshId(),
      runId: d.run.id,
      parentAgentRunId: lead?.id ?? null,
      kind: 'worker',
      role: RESOLVER_ROLE,
      task: `Resolve the conflicts of ${input.ticketBranch} with ${input.targetBranch} (attempt ${input.attempt} of ${input.maxAttempts}).`,
      status: 'QUEUED',
      sessionId: null,
      budgetTokensUsed: 0,
      createdAt: d.now,
      endedAt: null,
      budgetLimit: d.run.budget.maxTokensPerAgent,
      latestActivity: null,
      review: null,
      reportedCostUsd: null,
      stage: node.id,
      resolution: { operationId: input.operationId },
    };
    d.agents.push(agent);
    d.setAgentStatus(agent, 'STARTING');
    d.effects.push({
      type: 'start-agent',
      agentRunId: agent.id,
      kind: 'worker',
      role: agent.role,
      ...launchFieldsFor(program, node.id, brief),
      fromBranch: loop.ticketBranch,
      resolution: { operationId: input.operationId },
      ...d.launchModeFields(agent),
    });
    return { value: agent.id };
  });
}

export type ResolverSealOutcome = 'resolved' | 'no-change' | 'markers-left' | 'failed';

const OUTCOME_WORDS: Readonly<Record<ResolverSealOutcome, string>> = {
  resolved: 'resolved the conflicts; the app checks the result by the project policy',
  'no-change': 'made no change, so the conflicts are still there',
  'markers-left': 'left conflict markers in the files, so the result was not used',
  failed: 'could not be saved',
};

/**
 * The server sealed (or could not seal) the resolver's merge (`seal-resolution`). The resolver
 * ends; the lead, when live, is told the outcome with the helper's own report.
 */
export function resolverSealed(
  state: RunState,
  agentRunId: string,
  outcome: ResolverSealOutcome,
  ctx: EngineContext,
): EngineResult {
  return applyCommand(state, ctx, (d) => {
    const agent = d.agent(agentRunId);
    if (agent?.resolution === undefined || agent.status !== 'AWAITING_REVIEW') {
      return refusal('change-not-decidable', 'This resolver is not being sealed.');
    }
    d.setAgentStatus(agent, outcome === 'resolved' ? 'SUCCEEDED' : 'FAILED');
    notifyLead(d, resolverLine(agent, outcome));
    return done;
  });
}

/** The lead's line about a resolver, with its reported outcome and note when it gave one. */
export function resolverLine(agent: EngineAgent, outcome: ResolverSealOutcome | 'stopped'): string {
  const words = outcome === 'stopped' ? 'stopped before finishing' : OUTCOME_WORDS[outcome];
  const reported = agent.reportedOutcome;
  const note =
    reported === undefined
      ? ' It sent no report.'
      : ` It reported ${reported.kind}: ${reported.note}`;
  return `${agent.role} (agentId ${agent.id}) ${words}.${note} You need not act: the app runs the conflict resolution and the owner sees its status on the ticket.`;
}

/**
 * After a restart (ADR-0013 §7): an interrupted resolver's half-done worktree must never be
 * merged as an ordinary change. Marks the agent as a resolver again and discards any change the
 * restart left for it (nothing is relaunched).
 */
export function abandonResolver(
  state: RunState,
  agentRunId: string,
  operationId: string,
  ctx: EngineContext,
): EngineResult {
  return applyCommand(state, ctx, (d) => {
    const agent = d.agent(agentRunId);
    if (agent === undefined) return refusal('unknown-agent', 'Unknown agent.');
    agent.resolution = { operationId };
    if (isLiveAgentStatus(agent.status)) d.endAgent(agent, 'FAILED', true);
    const change = agent.change;
    if (change !== undefined && change.state !== 'discarded') {
      change.state = 'discarded';
      change.merging = false;
      agent.review = 'discarded';
    }
    d.effects.push({ type: 'discard-change', agentRunId: agent.id });
    return done;
  });
}
