import type {
  AgentRoleKind,
  AgentRun,
  AllowRule,
  ApprovalKindSchema,
  ApprovalStatus,
  ChangeDecider,
  ChangeDecision,
  ChangeReviewerKind,
  ChangeReviewerMode,
  ChangeState,
  ChangeVerdict,
  OrchestrationRun,
  PermissionDecision,
  ProjectApprovals,
  ProjectWorkflow,
  ReviewScope,
  ReviewState,
  TicketPlan,
  WorkflowStageId,
} from '@acp/core';
import type { z } from 'zod';
import type { Refusal } from './errors.js';
import type { UsageLedger } from './budget.js';

export type ApprovalKind = z.infer<typeof ApprovalKindSchema>;

/**
 * An agent as the engine tracks it: the persisted `AgentRun` plus the bookkeeping the panel needs
 * (`AgentRunDto.budget.limit`, `latestActivity`, `review`). Holds no conversation content
 * (ADR-0009/0015): `task` is the owner-facing task text, `latestActivity` is content-free.
 */
export interface EngineAgent extends AgentRun {
  /** Soft cap in budget tokens (ADR-0014); starts at the run's `maxTokensPerAgent`, owner may raise. */
  budgetLimit: number;
  /** Latest content-free activity line from the adapter, redacted and capped at 200 characters. */
  latestActivity: string | null;
  /** Null for the lead and for live workers; `pending` once a worker ends, until the owner decides. */
  review: ReviewState | null;
  /** Provider-reported cost of this agent's query; always an estimate, never summed. */
  reportedCostUsd: number | null;
  /**
   * Depth 2: a parent helper whose own query ended successfully while its helpers still work. It
   * stays RUNNING (its subtree is still working) until the last descendant ends, then SUCCEEDED.
   * Its process has ended, so nothing can be sent to it. Absent/false for everyone else.
   */
  awaitingHelpers?: boolean;
  /**
   * The workflow stage this agent works in (ADR-0019), set for every agent of a ticket run:
   * `plan` (planner), `orchestrate` (lead), `helpers` (workers at any depth), `code-review`
   * (reviewer), `unit-tests` (tester). Absent for Phase 3 control-panel runs (`agent_runs.stage`
   * null). In `lead` planner mode the lead also covers `plan`; `deriveRunWorkflow` shows that.
   */
  stage?: WorkflowStageId;
  /** Reviewer only: how many findings it posted with `post_review` (a count, never the text). */
  reviewPosts?: number;
  /**
   * The review loop (ADR-0021): this helper's or tester's change, from the moment its turn ends.
   * Absent for runs without the loop, for agents with no change, and while a helper works its
   * first turn.
   */
  change?: EngineChange;
  /**
   * A change reviewer (kind `reviewer`, stage `review`, ADR-0021 §3): the helper or tester whose
   * change it reviews. Absent for the final code reviewer (stage `code-review`).
   */
  reviewsAgentRunId?: string;
}

/**
 * One helper's (or the tester's) change in the review loop (ADR-0021 §3). Holds no diff and no
 * conversation text: commits, counts, states and file names only. `state`, `round` and
 * `headCommit` are persisted (`managed_workspaces`); the rest lives with the live run, since a
 * restart puts every undecided change in `needs-owner` (ADR-0013 §7).
 */
export interface EngineChange {
  state: ChangeState;
  /** Rework rounds used so far; also the current review round (0 = the first review). */
  round: number;
  /** This round's review-agent verdict: advice for the lead, never a gate. */
  verdict: ChangeVerdict | null;
  /** Who reviews this round: a review agent, the lead, or the owner; null until assigned. */
  reviewer: ChangeReviewerKind | null;
  /** This round's review agent; null when the lead or owner reviews, or none was assigned. */
  reviewerAgentRunId: string | null;
  /** The sealed commit; null before sealing (or for a stopped helper's unsealed work). */
  headCommit: string | null;
  changedFiles: number | null;
  /** When the change became `ready`: reviewers take the oldest first. */
  readyAt: string | null;
  /** The required harness checks on the change, as the server last reported them. */
  checks: 'pending' | 'passed' | 'failed' | null;
  /** Files that conflicted with the ticket branch on the last merge attempt. */
  conflictFiles: readonly string[];
  /** A `merge-change` effect is out and the server has not reported back yet. */
  merging: boolean;
  /** The helper's last turn ended with an error; its change still goes through the loop. */
  turnFailed: boolean;
}

/**
 * The review loop's run settings (ADR-0021), snapshotted when the run is created. When a run has
 * none it follows the legacy flow: the owner reviews and merges each change into the base branch.
 */
export interface RunIntegration {
  /** Who reviews each change before the lead decides. */
  reviewer: ChangeReviewerMode;
  /** Rework rounds the lead may ask for per change (the owner may grant more). */
  maxReworkRounds: number;
  /** The lead called `request_review`: every change was decided; no new helper starts. */
  handedOver: boolean;
  /** The ticket's key (`WEB-12`), for `create-ticket-branch`. */
  ticketKey: string;
  /** The ticket branch the server created (`acp/WEB-12`); null until `ticketBranchCreated`. */
  ticketBranch: string | null;
}

/** An owner decision request (ADR-0013 §4, ADR-0014). The summary is redacted, ≤ 200 characters. */
export interface EngineApproval {
  id: string;
  runId: string;
  agentRunId: string;
  kind: ApprovalKind;
  /** The tool for `tool-use`; null for `budget-raise`. */
  toolName: string | null;
  toolUseId: string | null;
  summary: string;
  status: ApprovalStatus;
  requestedAt: string;
  decidedAt: string | null;
  /**
   * Who decided (ApprovalDto.decidedBy, ADR-0013 amendment): the owner, the project allowlist, or
   * the timeout. Null while pending and when the engine closed it because the agent or run stopped.
   * Optional so Phase 3 rows loaded without it stay valid.
   */
  decidedBy?: ApprovalDecider | null;
  /**
   * The rule that approved it without asking (ADR-0021 §1): set on approvals decided by
   * `allowlist` in runs with an approval policy. Absent otherwise.
   */
  allowRule?: AllowRule | null;
}

export type ApprovalDecider = 'owner' | 'allowlist' | 'timeout';

/**
 * Per-run agent-tree limits (ADR-0013 amendment), taken from the project's agent setup when the
 * run is created and validated against `HARD_MAX_HELPERS` / `HARD_MAX_DEPTH`.
 */
export interface RunLimits {
  /** Live helpers (workers at any depth) allowed at once in the run. */
  maxConcurrentHelpers: number;
  /** Deepest helper allowed: 1 = only the lead starts helpers; 2 = helpers may start helpers. */
  maxDepth: number;
}

/**
 * Everything the engine decides over for one run. Plain data: the server persists it (or the parts
 * P3-C stores) before carrying out any effect (orchestration-lifecycle §1).
 *
 * The usage ledger is only needed while agents are live; after a restart live agents become
 * NEEDS_REVIEW, so the server may keep it in memory and start from `EMPTY_LEDGER`.
 */
export interface RunState {
  run: OrchestrationRun;
  agents: readonly EngineAgent[];
  approvals: readonly EngineApproval[];
  ledger: UsageLedger;
  /**
   * Limits for this run. Absent means the Phase 3 defaults (`MAX_CONCURRENT_CHILD_AGENTS` helpers,
   * depth `MAX_DELEGATION_DEPTH`), so runs loaded without them keep the M1 behaviour.
   */
  limits?: RunLimits;
  /**
   * Plan versions of a ticket run (ADR-0016), oldest first. Owner-facing text, stored per
   * ADR-0016. Absent or empty for Phase 3 runs.
   */
  plans?: readonly TicketPlan[];
  /**
   * The project's workflow, snapshotted when the run was created (ADR-0019). Absent means the
   * Phase 4 flow, which `defaultProjectWorkflow()` also gives: one lead plans and orchestrates, and
   * no code-review or unit-tests stage runs.
   */
  workflow?: ProjectWorkflow;
  /**
   * Separate planner mode: the lead's brief (ticket and instructions), kept until the owner
   * approves a plan; the lead then starts with this brief plus the approved plan. In memory only,
   * like the ledger; owner text only (ADR-0016).
   */
  leadBrief?: string;
  /**
   * Set by `recoverAfterRestart` when a restart interrupted this run and the workflow has a
   * code-review or unit-tests stage: no new stage starts until the owner's `continueStages`
   * (nothing relaunches automatically, ADR-0013 §7). Keep it with the live run.
   */
  stagesHeld?: boolean;
  /**
   * The chat with the lead after it ended (ADR-0020). In memory only, like the ledger: a restart
   * forgets it, so an interrupted turn just ends and a gone session is found again on the next try.
   * Absent until the owner's first follow-up message.
   */
  followUp?: FollowUpState;
  /**
   * The review loop (ADR-0021), snapshotted at creation. Absent: the legacy flow, unchanged.
   */
  integration?: RunIntegration;
  /**
   * Loop runs (RL-F): the lead was told that every change is decided and it should hand over.
   * Cleared when a helper or reviewer works again or a change is undecided, so the next such
   * point tells it once more. In memory only, like the ledger: after a restart the lead is gone.
   */
  handoverPrompted?: boolean;
  /**
   * The run's approval mode and command allowlist (ADR-0021 §1), snapshotted at creation; the
   * engine re-checks each pre-approval against it. Absent: the legacy project allowlist.
   */
  approvalPolicy?: ProjectApprovals;
}

/** Follow-up turns of an ended lead (ADR-0020). One turn at a time per run. */
export interface FollowUpState {
  /** A resume failed (ADR-0020 §5): the saved conversation is gone, so no turn starts any more. */
  sessionGone: boolean;
  /** The turn under way, or null between turns. */
  turn: FollowUpTurn | null;
}

export interface FollowUpTurn {
  /** The lead's linked provider session the turn resumes (never forked). */
  resumeSessionId: string;
  /** Budget tokens this turn may use (ADR-0014 measure), from the run's per-agent budget. */
  budgetLimit: number;
  /**
   * This turn's own usage, deduplicated by message id like every ledger. Kept apart from the run's
   * ledger so the lead's own budget (stored with the agent) never changes after it ended.
   */
  ledger: UsageLedger;
  budgetTokensUsed: number;
  /** The session answered (usage or a reply arrived): the resume worked. */
  resumed: boolean;
  /** The turn was asked to stop (budget, Stop, Stop all); its `finished` is still to come. */
  aborting: boolean;
}

/** Injected so the engine stays pure and testable (AGENTS.md §6). */
export interface EngineContext {
  now: Date;
  /** Ids for new agents and approvals; the server passes `crypto.randomUUID`. */
  newId: () => string;
}

/**
 * What the server must do after persisting the new state, in this order. The engine never performs
 * I/O itself. Effects carry ids and engine-generated text only, except `send-to-agent`/`start-agent`
 * (the owner's chat, a lead's message or task for a worker) and `chat-message` (ADR-0015).
 */
export type EngineEffect =
  | {
      type: 'start-agent';
      agentRunId: string;
      kind: AgentRoleKind;
      role: string;
      /** First user message: the owner's first chat message or the ticket brief (lead), or the task (worker). */
      prompt: string;
      /**
       * Set (true) only for a worker that may start helpers of its own (depth 2, ADR-0013
       * amendment); the server then gives it the child-management tools (`ManagedAgentSpec`).
       */
      canStartHelpers?: boolean;
      /**
       * The stage's model from the run's workflow (ADR-0019), present only when the stage sets
       * one. Absent: the stage's agent file's model, else the project's default model, as in
       * Phase 4 (`resolveAgentModel`).
       */
      model?: string;
      /**
       * The project skills mapped to this agent's stages (bare names, ADR-0019 §4 as amended),
       * present only when a stage maps one. The server copies them into the run's skills plugin
       * and sets `ManagedAgentSpec.skillPlugin = { path, skills: skills.map(pluginSkillName) }`.
       * The prompt already names each as `acp-skills:<name>`.
       */
      skills?: string[];
      /**
       * The project agent file (`.claude/agents/<name>.md`) of this agent's stage (ADR-0019 §6),
       * present only when the stage names one. The server reads it from the project checkout and
       * sets `ManagedAgentSpec.profile`; its `model` applies only when `model` above is absent
       * (`resolveAgentModel`). A missing or unsafe file never blocks the start.
       */
      agent?: string;
      /**
       * A rework turn (ADR-0021 §3): the helper works again in its own worktree on the comments in
       * `prompt`, resuming `resumeSessionId` (null: a fresh session). Never with `canStartHelpers`.
       */
      rework?: { resumeSessionId: string | null };
      /** A reviewer: `change` (one helper's change, `submit_review`) or `final` (`post_review`). */
      reviewScope?: ReviewScope;
      /**
       * Review loop (ADR-0021 §4): create the worker's or tester's worktree from the tip of this
       * ticket branch instead of the project's base branch.
       */
      fromBranch?: string;
    }
  /**
   * Before a reviewer's `start-agent` (ADR-0019): create a temporary detached checkout and start
   * the reviewer in it, read-only.
   * - neither field: the project's main branch (the "Run checks now" mechanism, ADR-0017);
   * - `commit` and `reviewsAgentRunId` (ADR-0021 change reviewer): the sealed commit of that
   *   helper's change; the server appends the change's diff (at most 64 KiB, sent, never stored)
   *   to the reviewer's brief;
   * - `ticketBranch` (ADR-0021 final reviewer): the ticket branch's tip.
   */
  | {
      type: 'create-review-checkout';
      agentRunId: string;
      commit?: string;
      reviewsAgentRunId?: string;
      ticketBranch?: string;
    }
  /** The reviewer ended (or a restart found it interrupted): remove its temporary checkout. */
  | { type: 'remove-review-checkout'; agentRunId: string }
  /**
   * Store a reviewer finding as a ticket comment (author `reviewer`, ADR-0019; ADR-0016's stored
   * scope). `body` is the reviewer's plain text, redacted and capped to the comment limit.
   */
  | {
      type: 'review-comment';
      agentRunId: string;
      body: string;
      /** A change reviewer's findings (ADR-0021): whose change, which round, and the verdict. */
      changeOf?: string;
      round?: number;
      verdict?: ChangeVerdict;
    }
  /**
   * Review loop (ADR-0021 §3): the helper's (or tester's) turn ended; commit its worktree, then
   * report with `changeSealed`.
   */
  | { type: 'seal-change'; agentRunId: string }
  /**
   * Plan approval in a review-loop run (ADR-0021 §4): create `acp/<KEY>` (or `-r<n>`) from the
   * base branch tip, then report the name with `ticketBranchCreated`. Always before any helper.
   */
  | { type: 'create-ticket-branch'; ticketKey: string }
  /**
   * Merge the change into the ticket branch (seal, integrate, require the checks on that commit,
   * advance by compare-and-swap), then report with `recordChangeDecision` or `changeMergeBlocked`.
   * `anyway`: the owner's merge past a failed required check.
   */
  | { type: 'merge-change'; agentRunId: string; by: ChangeDecider; anyway: boolean }
  /** The change was discarded: remove the helper's worktree (idempotent). */
  | { type: 'discard-change'; agentRunId: string }
  /**
   * The `change_reviews` row for (agentRunId, round), emitted whenever it changes: the reviewer is
   * assigned, the verdict arrives, or the round is decided. Upsert by (agentRunId, round).
   */
  | {
      type: 'change-round';
      agentRunId: string;
      round: number;
      reviewer: ChangeReviewerKind;
      reviewerAgentRunId: string | null;
      verdict: ChangeVerdict | null;
      decision: ChangeDecision | null;
      decidedBy: ChangeDecider | null;
    }
  /**
   * The lead's or owner's note on a change (rework comments, discard reason, question for the
   * owner), stored as a ticket comment by that author and linked to the round's row (ADR-0021 §6).
   */
  | {
      type: 'change-comment';
      agentRunId: string;
      round: number;
      author: 'lead' | 'owner';
      kind: 'rework' | 'discard' | 'ask-owner';
      body: string;
    }
  | { type: 'send-to-agent'; agentRunId: string; text: string }
  /** Stop the current turn but keep the session (budget cap reached). */
  | { type: 'interrupt-agent'; agentRunId: string }
  /** End the agent's query. Cancellation emits workers first, then the lead. */
  | { type: 'abort-agent'; agentRunId: string }
  | { type: 'approval-requested'; approvalId: string }
  /** Resolve the adapter's pending `requestPermission` promise. */
  | { type: 'resolve-permission'; approvalId: string; decision: PermissionDecision }
  /** Store and publish a chat line (ADR-0015). Only owner text and the lead's replies. */
  | { type: 'chat-message'; role: 'owner' | 'lead'; text: string }
  | { type: 'link-session'; agentRunId: string; providerSessionId: string }
  /**
   * A follow-up turn of the ended lead (ADR-0020): resume its saved session `resumeSessionId` in
   * the project root, answers-only (read-only tools, no control tools), for this one message.
   * `prompt` is the app's preface plus the owner's message. `model` and `agent` are the lead's
   * stage model and agent file, as for its `start-agent` (no skills: answers only).
   */
  | {
      type: 'start-follow-up';
      agentRunId: string;
      resumeSessionId: string;
      prompt: string;
      model?: string;
      agent?: string;
    }
  /** End the follow-up turn under way (budget reached, the owner's Stop, Stop all). */
  | { type: 'abort-follow-up'; agentRunId: string }
  /** A new plan version waits for the owner (run → PLAN_REVIEW). The plan is in `state.plans`. */
  | { type: 'plan-submitted'; planId: string }
  /** The owner approved a plan (run → RUNNING) or asked for changes (run → PLANNING). */
  | { type: 'plan-decided'; planId: string; status: 'approved' | 'changes-requested' }
  /** Usage passed the soft cap; report how far (ADR-0014). */
  | { type: 'budget-overshoot'; agentRunId: string; used: number; limit: number; overshoot: number }
  /** Content-free diagnostics: count them, never log the payload. */
  | {
      type: 'diagnostic';
      code:
        | 'worker-text-dropped'
        | 'invalid-usage'
        | 'event-after-end'
        | 'follow-up-session-changed'
        | 'follow-up-over-budget'
        /** ADR-0022: a Full auto agent ended because auto mode or the sandbox was unavailable. */
        | 'full-auto-unavailable';
      agentRunId: string;
    };

export type EngineResult<T = undefined> =
  | { ok: true; state: RunState; effects: readonly EngineEffect[]; value: T }
  | { ok: false; refusal: Refusal };
