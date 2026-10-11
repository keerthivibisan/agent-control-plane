import type {
  AgentRoleKind,
  AgentRun,
  ApprovalKindSchema,
  ApprovalStatus,
  OrchestrationRun,
  PermissionDecision,
  ReviewState,
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
      /** First user message: the owner's first chat message (lead) or the task (worker). */
      prompt: string;
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
