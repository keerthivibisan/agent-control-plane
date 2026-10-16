import type {
  AgentRoleKind,
  AgentRun,
  ApprovalKindSchema,
  ApprovalStatus,
  OrchestrationRun,
  PermissionDecision,
  ProjectWorkflow,
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
       * one. Absent: the project's default model, as in Phase 4.
       */
      model?: string;
      /**
       * The project skills mapped to this agent's stages (bare names, ADR-0019 §4 as amended),
       * present only when a stage maps one. The server copies them into the run's skills plugin
       * and sets `ManagedAgentSpec.skillPlugin = { path, skills: skills.map(pluginSkillName) }`.
       * The prompt already names each as `acp-skills:<name>`.
       */
      skills?: string[];
    }
  /**
   * Before a reviewer's `start-agent` (ADR-0019): create a temporary detached checkout of the
   * project's main branch (the "Run checks now" mechanism, ADR-0017) and start the reviewer in it,
   * read-only. The reviewer reads the merged result there.
   */
  | { type: 'create-review-checkout'; agentRunId: string }
  /** The reviewer ended (or a restart found it interrupted): remove its temporary checkout. */
  | { type: 'remove-review-checkout'; agentRunId: string }
  /**
   * Store a reviewer finding as a ticket comment (author `reviewer`, ADR-0019; ADR-0016's stored
   * scope). `body` is the reviewer's plain text, redacted and capped to the comment limit.
   */
  | { type: 'review-comment'; agentRunId: string; body: string }
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
  /** A new plan version waits for the owner (run → PLAN_REVIEW). The plan is in `state.plans`. */
  | { type: 'plan-submitted'; planId: string }
  /** The owner approved a plan (run → RUNNING) or asked for changes (run → PLANNING). */
  | { type: 'plan-decided'; planId: string; status: 'approved' | 'changes-requested' }
  /** Usage passed the soft cap; report how far (ADR-0014). */
  | { type: 'budget-overshoot'; agentRunId: string; used: number; limit: number; overshoot: number }
  /** Content-free diagnostics: count them, never log the payload. */
  | {
      type: 'diagnostic';
      code: 'worker-text-dropped' | 'invalid-usage' | 'event-after-end';
      agentRunId: string;
    };

export type EngineResult<T = undefined> =
  | { ok: true; state: RunState; effects: readonly EngineEffect[]; value: T }
  | { ok: false; refusal: Refusal };
