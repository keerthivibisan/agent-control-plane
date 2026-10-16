import type {
  ManagedAgentEvent,
  ManagedAgentHandle,
  ManagedAgentSpec,
  ManagedCallbacks,
  ManagedExecutionAdapter,
} from '@acp/core';
import { MAX_AGENT_BYTES, MAX_CONTEXT_BYTES, SkillNameSchema } from '@acp/core';
import { query as sdkQuery } from '@anthropic-ai/claude-agent-sdk';
import type { Options, SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';
import { createLeadToolServer } from './lead-tools.js';
import { mapSdkMessage } from './messages.js';
import type { MapperState, TurnResult } from './messages.js';
import {
  createCanUseTool,
  FOLLOW_UP_DISALLOWED_TOOLS,
  followUpToolNames,
  isReadOnlyRole,
  LEAD_MCP_SERVER_NAME,
  managedToolNames,
  profileToolNames,
  READ_ONLY_DISALLOWED_TOOLS,
  specKeepsInputOpen,
} from './permissions.js';
import { AsyncQueue } from './queue.js';

/**
 * The part of the SDK's `Query` the adapter uses. The real `query()` result satisfies it; tests
 * pass a fake. Messages are typed `unknown` because the adapter validates them itself.
 */
export interface ManagedQuery extends AsyncIterable<unknown> {
  interrupt(): Promise<unknown>;
  close?(): void;
}

export type ManagedQueryFn = (params: {
  prompt: AsyncIterable<SDKUserMessage>;
  options: Options;
}) => ManagedQuery;

export interface ManagedClaudeCodeOptions {
  /** Defaults to the Agent SDK's `query`. Tests always inject a fake (ADR-0012). */
  query?: ManagedQueryFn;
  /**
   * The complete environment for the `claude` process (the SDK `env` option, which replaces the
   * inherited environment rather than merging). The server passes `process.env` without `ACP_*`
   * and `GIT_*` variables (ADR-0012), so the hook token never reaches an agent. Omitted: the SDK
   * default (the process inherits `process.env`).
   */
  env?: Readonly<Record<string, string>>;
}

/** Thrown by `send` on a follow-up turn, which takes exactly one message (ADR-0020). */
export class ManagedFollowUpSendError extends Error {
  readonly code = 'managed_follow_up_one_message';
  constructor(agentRunId: string) {
    super(`Follow-up turn of ${agentRunId} takes one message`);
    this.name = 'ManagedFollowUpSendError';
  }
}

/** Thrown by `send` once the agent has finished or been aborted. */
export class ManagedAgentEndedError extends Error {
  readonly code = 'managed_agent_ended';
  constructor(agentRunId: string) {
    super(`Managed agent ${agentRunId} has ended`);
    this.name = 'ManagedAgentEndedError';
  }
}

function userMessage(text: string): SDKUserMessage {
  return { type: 'user', message: { role: 'user', content: text }, parent_tool_use_id: null };
}

/**
 * `text` cut to at most `maxBytes` UTF-8 bytes, never inside a character. The server already caps
 * context (ADR-0012 amendment); this keeps the adapter's own promise if a caller does not.
 */
export function capUtf8(text: string, maxBytes: number): string {
  const bytes = Buffer.from(text, 'utf8');
  if (bytes.length <= maxBytes) return text;
  let end = maxBytes;
  // Back up over continuation bytes (10xxxxxx) to the start of the character that does not fit.
  while (end > 0 && ((bytes[end] ?? 0) & 0xc0) === 0x80) end -= 1;
  return bytes.subarray(0, end).toString('utf8');
}

/**
 * The heading before a stage agent file's instructions in the system prompt, naming the file so
 * the agent (and anyone reading the prompt) can tell the owner's file from the project context.
 */
export function agentFileHeading(name: string): string {
  const file = SkillNameSchema.safeParse(name).success ? `.claude/agents/${name}.md` : 'agent file';
  return `=== Stage agent file ${file} (the owner's instructions for this stage) ===`;
}

/**
 * The SDK system prompt for one agent: always Claude Code's own prompt (coordinator decision
 * 2026-10-13 — leaving it unset makes SDK 0.3.296 send an empty prompt, so agents would lack
 * Claude Code's tool and safety guidance), with appended, in this order:
 * - the project context when there is any (ADR-0012 amendment), capped at `MAX_CONTEXT_BYTES`;
 * - the stage agent file's instructions (ADR-0019 §6) under a heading naming the file, capped at
 *   `MAX_AGENT_BYTES`.
 * The stage brief is the first user message, so it follows both.
 */
export function systemPromptFor(spec: ManagedAgentSpec): NonNullable<Options['systemPrompt']> {
  const parts: string[] = [];
  const context = spec.context ?? '';
  if (context.trim() !== '') parts.push(capUtf8(context, MAX_CONTEXT_BYTES));
  const profile = spec.profile;
  if (profile !== undefined && profile.instructions.trim() !== '') {
    parts.push(
      `${agentFileHeading(profile.name)}\n${capUtf8(profile.instructions, MAX_AGENT_BYTES)}`,
    );
  }
  if (parts.length === 0) return { type: 'preset', preset: 'claude_code' };
  return { type: 'preset', preset: 'claude_code', append: parts.join('\n\n') };
}

/**
 * SDK options for one agent (ADR-0012, ADR-0013, ADR-0019). Never `bypassPermissions`; no
 * settings files load; `strictMcpConfig` keeps every MCP server except ours out. Ours carries the
 * role's tools (`managedToolNames`): the lead's set, the planner's `submit_plan`, the reviewer's
 * `post_review`, or child management for a worker with `canStartHelpers`; other workers and the
 * tester get none. Exported for tests.
 */
export function buildOptions(
  spec: ManagedAgentSpec,
  callbacks: ManagedCallbacks,
  abortController: AbortController,
  env?: Readonly<Record<string, string>>,
): Options {
  const options: Options = {
    cwd: spec.cwd,
    abortController,
    permissionMode: 'default',
    // SDK isolation mode (ADR-0012 amendment, 2026-10-11): no user/project/local settings, so a
    // repository's permission rules or hooks can neither skip the owner's approval nor run shell
    // commands (ADR-0013). The project's CLAUDE.md is therefore not loaded either.
    settingSources: [],
    canUseTool: createCanUseTool(spec, callbacks),
    strictMcpConfig: true,
    mcpServers: {},
  };
  const toolNames = managedToolNames(spec);
  if (spec.leadTools !== undefined && toolNames.length > 0) {
    options.mcpServers = {
      [LEAD_MCP_SERVER_NAME]: createLeadToolServer(spec.leadTools, toolNames),
    };
  }
  // The planner and the reviewer only read (ADR-0019): no edit or shell tools in their context.
  if (isReadOnlyRole(spec.kind)) options.disallowedTools = [...READ_ONLY_DISALLOWED_TOOLS];
  // A stage agent file's `tools` only narrow the built-in base set (ADR-0019 §6). Never
  // `allowedTools`, which would auto-approve calls before the gate.
  const fileTools = profileToolNames(spec);
  if (fileTools !== null) options.tools = [...fileTools];
  // Project skills arrive as a run-scoped, skills-only local plugin (ADR-0019 §4, decision E);
  // filesystem settings stay off, so nothing else from the repository loads.
  const plugin = spec.skillPlugin;
  if (plugin !== undefined) {
    options.plugins = [{ type: 'local', path: plugin.path }];
    options.skills = [...plugin.skills];
  }
  if (spec.followUp !== undefined) applyFollowUp(options, spec, spec.followUp.resumeSessionId);
  options.systemPrompt = systemPromptFor(spec);
  if (spec.model !== null) options.model = spec.model;
  // A copy, so a later change to the caller's object never reaches a running agent.
  if (env !== undefined) options.env = { ...env };
  return options;
}

/**
 * A follow-up turn of an ended lead (ADR-0020, docs/research/sdk-session-resume-2026-10-16.md):
 * - `resume` the lead's saved session, never forked (`forkSession: false`), so the session keeps
 *   its id and usage keeps flowing to the lead through its session link; `cwd` is the lead's own
 *   folder (the caller passes the project root), where the session is stored;
 * - answers only: the `tools` base set is `Read`, `Grep`, `Glob` (narrowed further by the lead
 *   stage's agent file), with the read-only `disallowedTools` plus subagents; no MCP server at all
 *   (no control-plane tools); no skills plugin;
 * - the options are passed again in full, since a resumed process restores none of them.
 * `allowedTools` is never set. The input closes after the one turn (`specKeepsInputOpen`).
 */
function applyFollowUp(options: Options, spec: ManagedAgentSpec, resumeSessionId: string): void {
  options.resume = resumeSessionId;
  options.forkSession = false;
  options.tools = [...followUpToolNames(spec)];
  options.disallowedTools = [...FOLLOW_UP_DISALLOWED_TOOLS];
  options.mcpServers = {};
  delete options.plugins;
  delete options.skills;
}

/**
 * The Claude Code managed execution adapter (ADR-0012): one SDK `query()` per agent with streaming
 * input. Events are produced as soon as the agent starts, buffered until read, and end with exactly
 * one `finished` event.
 *
 * A worker's (and the tester's and reviewer's) input is closed after a turn ends with nothing
 * queued, so an agent that finished its task ends (`finished`) and `send` then throws
 * `ManagedAgentEndedError`. The lead's input stays open for the owner's chat, and the planner's for
 * the owner's plan comments, until `abort()`. A follow-up turn of an ended lead (ADR-0020) takes
 * its one message and ends after that turn.
 */
export function createManagedClaudeCode(
  options: ManagedClaudeCodeOptions = {},
): ManagedExecutionAdapter {
  const run: ManagedQueryFn = options.query ?? sdkQuery;
  const env = options.env;
  return {
    provider: 'claude-code',
    start(spec, callbacks) {
      return startAgent(run, spec, callbacks, env);
    },
  };
}

function startAgent(
  run: ManagedQueryFn,
  spec: ManagedAgentSpec,
  callbacks: ManagedCallbacks,
  env: Readonly<Record<string, string>> | undefined,
): ManagedAgentHandle {
  const abortController = new AbortController();
  const input = new AsyncQueue<SDKUserMessage>();
  const events = new AsyncQueue<ManagedAgentEvent>();
  const state: MapperState = { started: false };
  let lastResult: TurnResult | null = null;

  input.push(userMessage(spec.prompt));
  const q = run({ prompt: input, options: buildOptions(spec, callbacks, abortController, env) });

  const finish = (outcome: 'success' | 'error' | 'cancelled'): void => {
    if (events.isClosed) return;
    input.close();
    events.push({ type: 'finished', outcome, reportedCostUsd: lastResult?.costUsd ?? null });
    events.close();
  };

  const pump = async (): Promise<void> => {
    try {
      for await (const message of q) {
        if (events.isClosed) break;
        const mapped = mapSdkMessage(message, spec, state);
        for (const event of mapped.events) events.push(event);
        if (mapped.result !== null) {
          lastResult = mapped.result;
          if (!specKeepsInputOpen(spec) && (mapped.result.queuedTurns ?? 0) === 0) input.close();
        }
      }
      finish(abortController.signal.aborted ? 'cancelled' : (lastResult?.outcome ?? 'error'));
    } catch {
      // The SDK throws AbortError after abort(); any other failure ends the agent as an error.
      // No message text is kept: it may quote model or tool output.
      finish(abortController.signal.aborted ? 'cancelled' : 'error');
    }
  };
  void pump();

  return {
    events,
    send(text) {
      if (spec.followUp !== undefined) {
        return Promise.reject(new ManagedFollowUpSendError(spec.agentRunId));
      }
      if (!input.push(userMessage(text))) {
        return Promise.reject(new ManagedAgentEndedError(spec.agentRunId));
      }
      return Promise.resolve();
    },
    async interrupt() {
      if (events.isClosed) return;
      await q.interrupt();
    },
    abort() {
      if (events.isClosed) return;
      abortController.abort();
      // The iterator ends now, not when the SDK process has wound down.
      finish('cancelled');
      q.close?.();
    },
  };
}
