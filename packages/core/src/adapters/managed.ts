import type { TokenCounts } from '../usage/usage.js';
import type {
  AgentRoleKind,
  LeadToolName,
  ToolUseCategory,
} from '../orchestration/orchestration.js';
import type { ManagedProviderId } from '../domain/provider.js';
import type { ApprovalMode } from '../workspace/workspace.js';

/**
 * Managed execution contract (ADR-0004, ADR-0012). Separate from `ObservationAdapter`: observation
 * reads what happened; managed execution starts and steers runs. One adapter per managed provider
 * (ADR-0031): the Claude Code implementation wraps the Claude Agent SDK, the Codex one the Codex
 * app-server; tests inject a fake.
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
  /**
   * Absolute folders outside `cwd` that the agent may READ without asking the owner (ADR-0026 §4:
   * the read-only copies of the owner's attachments that a lead or planner gets in the run's data
   * folder). Reads only: it never allows an edit or a command, and never widens a role's tools.
   */
  readOnlyDirs?: readonly string[];
  /** Resolved model id, or null for the provider default. */
  model: string | null;
  /**
   * ADR-0028 §1: the node's reasoning effort, passed to the provider's reasoning-effort setting
   * (for Claude: the Agent SDK's `effort` option). Absent: the model's default.
   */
  effort?: 'low' | 'medium' | 'high';
  /**
   * ADR-0024: the session's display title, set when the session starts, e.g. `WEB-12 · Frontend
   * helper`. App data only (ticket key and block or role names), at most `MAX_SESSION_TITLE`
   * characters. For Claude: the Agent SDK's `title` option, which also skips Claude Code's
   * automatic title request; absent, Claude Code titles the session as before. Ignored for
   * follow-ups, whose resumed session keeps its title.
   */
  title?: string;
  /** Lead only: the fixed tool set (ADR-0012). Workers never get these tools (depth 1). */
  leadTools?: LeadToolHandler;
  /**
   * Project context (ADR-0012 amendment): the chosen context files' text, read by the server from
   * the repository, appended to the system prompt. At most `MAX_CONTEXT_BYTES`.
   */
  context?: string;
  /**
   * ADR-0034 §4: the short repository map of the run's base commit (`renderRepoMap`, at most
   * `MAX_REPO_MAP_BYTES`), when a ready map exists for it. The adapter puts it first, before the
   * project context and the agent file, so every agent of a run shares the same prompt prefix
   * (provider prompt caching). Paths in it are data, never instructions.
   */
  repoMap?: string;
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
  /**
   * A follow-up turn of an ended lead (ADR-0020): the adapter resumes `resumeSessionId` (never
   * forked, so usage keeps flowing to the original session; for Claude: SDK `resume`) in the same
   * `cwd`, with the read-only toolset and no control-plane tools, and closes the input after one
   * turn. The session is always one of this adapter's provider (ADR-0031 §7). Since ADR-0034 §4
   * its one control-plane tool is the read-only `code_map` (`managedToolNames`), when the server
   * passes a handler.
   */
  followUp?: { resumeSessionId: string };
  /**
   * A rework turn of a helper or tester (ADR-0021 §3): the agent works again in its own worktree on
   * the lead's or owner's comments. `resumeSessionId` resumes its earlier session of this
   * adapter's provider (never forked; for Claude: SDK `resume`); null starts a fresh session with
   * the comments in the prompt. A rework turn never gets `canStartHelpers`.
   */
  rework?: { resumeSessionId: string | null };
  /**
   * What a `reviewer` reviews (ADR-0021 §3, §5): `change` is one helper's sealed change on a
   * detached checkout of that commit, with `submit_review` as its only control tool; `final` is the
   * ticket branch tip after every change is decided, with `post_review` (ADR-0019's code review).
   * Absent: `final`, as before ADR-0021.
   */
  reviewScope?: ReviewScope;
  /**
   * Full auto (ADR-0022), for a `worker` or `tester` only: the agent runs in Claude Code's auto
   * mode (SDK `permissionMode: 'auto'`, a classifier model reviews risky actions) and every shell
   * command runs in the operating-system sandbox, which fails closed when it cannot start. Sandboxed
   * commands may write only in `cwd` and `tempDir` and cannot read `denyRead` (absolute paths the
   * server resolves from the user's home and its data folder). If auto mode or the sandbox is
   * unavailable the agent ends with `finished.failure` and never runs unprotected. Ignored for the
   * lead, planner and reviewers, which always keep the default mode.
   */
  fullAuto?: FullAutoSpec;
  /**
   * ADR-0023 §5, for a `worker` or `tester` only: its workflow block is configured as Full auto but
   * a ticket or run tightened it. The same operating-system sandbox, deny rules and temp folder as
   * `fullAuto`, while the session stays in `permissionMode: 'default'`, so the server's gate
   * decides every request by the tightened mode: tightening never removes a protection. Never set
   * together with `fullAuto`. If the sandbox cannot start, the agent ends with `finished.failure`.
   * Ignored for the lead, planner and reviewers, and for follow-ups.
   */
  sandbox?: FullAutoSpec;
  /**
   * CX-3, for a `worker` or `tester`: the node's effective approval mode, already tightened by the
   * ticket or run (ADR-0023 §5). The server sets it. An adapter whose provider enforces approvals
   * itself (Codex maps it to a sandbox and approval policy) reads it, and absent means `manual`
   * there. The Claude Code adapter ignores it: its gate is the server's `requestPermission`.
   */
  approvalMode?: ApprovalMode;
  /**
   * CX-3b, for any agent: absolute paths the agent may not read (the user's secret folders, the
   * app's data folder, Claude's and Codex's config), resolved by the server. Enforced by providers
   * that can (capability `denyRead`): Codex through a per-agent permission profile that denies
   * each path. The server sets it only for such an adapter. The Claude Code adapter ignores it and
   * keeps using `fullAuto.denyRead` and `sandbox.denyRead` as before.
   */
  denyRead?: readonly string[];
}

/** The sandbox paths of a Full auto agent (`ManagedAgentSpec.fullAuto`, ADR-0022). */
export interface FullAutoSpec {
  /** Absolute path of the run's temporary folder: writable, readable, and the agent's TMPDIR. */
  tempDir: string;
  /** Absolute paths sandboxed commands may not read (secrets, the app's data, Claude's config). */
  denyRead: readonly string[];
  /**
   * F-1: the agent's worktree's git directories (its private `--git-dir` and the repository's
   * `--git-common-dir`, absolute and resolved through symlinks), which sandboxed commands and the
   * file tools may not write: only the app commits and moves refs. Claude Code itself makes a
   * linked worktree's common git directory writable in the sandbox. Absent from servers before F-1.
   */
  gitDirs?: readonly string[];
}

/**
 * Why an agent could not run, or not run protected. The agent ends with outcome `error` and never
 * runs with weaker guarantees (ADR-0022, ADR-0031 §5).
 * - `auto-mode-unavailable`: Claude Code did not start in auto mode (the model or the account does
 *   not offer it).
 * - `sandbox-unavailable`: the operating-system sandbox could not start.
 * - `provider-unavailable`: the provider itself could not start (its program is missing, too old,
 *   or not signed in; `checkAvailable` says why).
 * - `unsafe-git-location`: the repository's git directory sits where the agent's sandbox can write
 *   (CX-1: Codex's workspace-write sandbox leaves /tmp and $TMPDIR writable), so the agent could
 *   commit or move refs itself, which only the app may do (F-1).
 */
export type ManagedFailureCode =
  'auto-mode-unavailable' | 'sandbox-unavailable' | 'provider-unavailable' | 'unsafe-git-location';

/** What a reviewer agent reviews (`ManagedAgentSpec.reviewScope`). */
export type ReviewScope = 'change' | 'final';

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
  /**
   * ADR-0034 (CM-2): the agent called a tool of this category; counted per agent run for
   * measurement. Never the tool's name or input.
   */
  | { type: 'tool-use'; category: ToolUseCategory }
  /**
   * Per model response; the engine dedups by `(provider, messageId)` (usage-accounting §4,
   * ADR-0032), so ids of two providers never collide.
   */
  | { type: 'usage'; messageId: string; tokens: TokenCounts }
  /** Lead only: text for the owner's chat (ADR-0015). Never emitted for workers. */
  | { type: 'lead-text'; text: string }
  | {
      type: 'finished';
      outcome: 'success' | 'error' | 'cancelled';
      /** Provider-reported cost of the run, when given; always an estimate. */
      reportedCostUsd: number | null;
      /**
       * Set when a Full auto agent ended because its protections were unavailable (ADR-0022); the
       * outcome is then `error`. Absent for every other end.
       */
      failure?: ManagedFailureCode;
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

/**
 * What a provider's adapter can honour (ADR-0031 owner decision 3). The server refuses a node that
 * needs a missing capability rather than running it with weaker guarantees.
 */
export interface ManagedCapabilities {
  /** Project skills (`ManagedAgentSpec.skillPlugin`). */
  skills: boolean;
  /** An agent file's `tools` narrowing the role's tools (`ManagedAgentSpec.profile.tools`). */
  profileTools: boolean;
  /** Full auto and the tightened sandbox (`ManagedAgentSpec.fullAuto`, `sandbox`). */
  fullAuto: boolean;
  /** Read denial for every agent (`ManagedAgentSpec.denyRead`), enforced by the provider. */
  denyRead: boolean;
  /** The lead's control tools (`ManagedAgentSpec.leadTools`). */
  leadTools: boolean;
  /** Follow-up turns resuming a saved session (`ManagedAgentSpec.followUp`). */
  followUp: boolean;
}

export interface ManagedExecutionAdapter {
  readonly provider: ManagedProviderId;
  readonly capabilities: ManagedCapabilities;
  start(spec: ManagedAgentSpec, callbacks: ManagedCallbacks): ManagedAgentHandle;
  /**
   * Whether the provider can start agents now (installed, a supported version, signed in). Never
   * reads or returns credentials; `reason` is a short owner-facing sentence. Absent: always
   * available.
   */
  checkAvailable?(): Promise<{ ok: true } | { ok: false; reason: string }>;
}
