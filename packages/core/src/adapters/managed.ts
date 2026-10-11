import type { TokenCounts } from '../usage/usage.js';
import type { LeadToolName } from '../orchestration/orchestration.js';

/**
 * Managed execution contract (ADR-0004, ADR-0012). Separate from `ObservationAdapter`: observation
 * reads what happened; managed execution starts and steers runs. The Claude Code implementation
 * wraps the Claude Agent SDK; tests inject a fake.
 */

export interface ManagedAgentSpec {
  agentRunId: string;
  kind: 'lead' | 'worker';
  /** Absolute path of the agent's working directory (a worktree for workers). */
  cwd: string;
  /** First user message. Further messages go through `send`. */
  prompt: string;
  /** Resolved model id, or null for the provider default. */
  model: string | null;
  /** Lead only: the fixed tool set (ADR-0012). Workers never get these tools (depth 1). */
  leadTools?: LeadToolHandler;
}

/** Executes a lead tool call after the engine has validated it; returns text for the model. */
export type LeadToolHandler = (name: LeadToolName, input: unknown) => Promise<string>;

/** A tool use that needs the owner's decision (ADR-0013). */
export interface PermissionRequest {
  agentRunId: string;
  toolName: string;
  toolUseId: string | null;
  /** Short, redacted description for the panel, e.g. "Edit src/app.ts" (max 200 chars). */
  summary: string;
}

export type PermissionDecision = { allow: true } | { allow: false; message: string };

export interface ManagedCallbacks {
  /** Called for every tool use that is not read-only. Must resolve; a timeout resolves to deny. */
  requestPermission(request: PermissionRequest): Promise<PermissionDecision>;
}

export type ManagedAgentEvent =
  | { type: 'started'; providerSessionId: string; model: string | null }
  /** A one-line, content-free description of what the agent did (tool name, target). */
  | { type: 'activity'; summary: string }
  /** Per assistant message; the engine dedups by `messageId` (usage-accounting §4). */
  | { type: 'usage'; messageId: string; tokens: TokenCounts }
  /** Lead only: text for the owner's chat (ADR-0015). Never emitted for workers. */
  | { type: 'lead-text'; text: string }
  | {
      type: 'finished';
      outcome: 'success' | 'error' | 'cancelled';
      /** Provider-reported cost of the run, when given; always an estimate. */
      reportedCostUsd: number | null;
    };

export interface ManagedAgentHandle {
  readonly events: AsyncIterable<ManagedAgentEvent>;
  /** Sends a follow-up user message (chat for the lead, `message_agent` for workers). */
  send(text: string): Promise<void>;
  /** Stops the current turn but keeps the session. */
  interrupt(): Promise<void>;
  /** Ends the run: aborts the SDK query and the underlying process. */
  abort(): void;
}

export interface ManagedExecutionAdapter {
  readonly provider: 'claude-code';
  start(spec: ManagedAgentSpec, callbacks: ManagedCallbacks): ManagedAgentHandle;
}
