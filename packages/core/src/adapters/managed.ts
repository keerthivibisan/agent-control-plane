import type { TokenCounts } from '../usage/usage.js';
import type { AgentRoleKind, LeadToolName } from '../orchestration/orchestration.js';

/**
 * Managed execution contract (ADR-0004, ADR-0012). Separate from `ObservationAdapter`: observation
 * reads what happened; managed execution starts and steers runs. The Claude Code implementation
 * wraps the Claude Agent SDK; tests inject a fake.
 */

export interface ManagedAgentSpec {
  agentRunId: string;
  /**
   * The agent's role (ADR-0019). The adapter gives each role its toolset: `lead` and `planner` are
   * read-only with lead tools; `reviewer` is read-only with `post_review` only; `worker` and
   * `tester` edit in their own worktree.
   */
  kind: AgentRoleKind;
  /** Absolute path of the agent's working directory (a worktree for workers). */
  cwd: string;
  /** First user message. Further messages go through `send`. */
  prompt: string;
  /** Resolved model id, or null for the provider default. */
  model: string | null;
  /** Lead only: the fixed tool set (ADR-0012). Workers never get these tools (depth 1). */
  leadTools?: LeadToolHandler;
  /**
   * Project context (ADR-0012 amendment): the chosen context files' text, read by the server from
   * the repository, appended to the system prompt. At most `MAX_CONTEXT_BYTES`.
   */
  context?: string;
  /**
   * A worker allowed to start its own helpers (depth 2, ADR-0013 amendment) gets `leadTools`
   * restricted to child management (`start_agent`, `list_agents`, `message_agent`, `stop_agent`,
   * `agent_status`); never `submit_plan` or `request_review`.
   */
  canStartHelpers?: boolean;
  /**
   * Project skills for this agent (ADR-0019 §4, amended 2026-10-16). With `settingSources: []`
   * Claude Code loads no filesystem skills, so the server builds a skills-only plugin directory for
   * the run (copies of the mapped skills from the project's checkout, front matter reduced to
   * `name` and `description`; no hooks, MCP or settings) and the adapter passes it as a local
   * plugin, allowing only the listed skills (namespaced `<plugin>:<skill>`).
   */
  skillPlugin?: { path: string; skills: readonly string[] };
  /**
   * The stage's project agent file, read by the server from the project checkout (redesign §6a,
   * ADR-0019 amendment). `instructions` (the file body, at most 64 KiB) is appended to the system
   * prompt after the project context. `tools`, when set, can only NARROW the role's tools: the
   * adapter removes role tools that are not listed and never adds or auto-approves any. Null means
   * the role's normal set. The file's `model` is resolved by the engine, not here.
   */
  profile?: { name: string; instructions: string; tools: readonly string[] | null };
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
  /**
   * The tool's raw input, only so the project allowlist can see which file an edit targets or
   * which command runs (ADR-0013 amendment). It is held in memory while the request is decided,
   * and never stored, logged or sent to the UI (ADR-0009).
   */
  input?: unknown;
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
