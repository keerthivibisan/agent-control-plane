import type {
  ManagedAgentEvent,
  ManagedAgentHandle,
  ManagedAgentSpec,
  ManagedCallbacks,
  ManagedExecutionAdapter,
} from '@acp/core';
import { query as sdkQuery } from '@anthropic-ai/claude-agent-sdk';
import type { Options, SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';
import { createLeadToolServer } from './lead-tools.js';
import { mapSdkMessage } from './messages.js';
import type { MapperState, TurnResult } from './messages.js';
import { createCanUseTool, LEAD_MCP_SERVER_NAME } from './permissions.js';
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
 * SDK options for one agent (ADR-0012, ADR-0013). Never `bypassPermissions`; only project-level
 * settings load; `strictMcpConfig` keeps every MCP server except ours out, and only the lead gets
 * that one. Exported for tests.
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
    mcpServers:
      spec.kind === 'lead' && spec.leadTools !== undefined
        ? { [LEAD_MCP_SERVER_NAME]: createLeadToolServer(spec.leadTools) }
        : {},
  };
  if (spec.model !== null) options.model = spec.model;
  // A copy, so a later change to the caller's object never reaches a running agent.
  if (env !== undefined) options.env = { ...env };
  return options;
}

/**
 * The Claude Code managed execution adapter (ADR-0012): one SDK `query()` per agent with streaming
 * input. Events are produced as soon as the agent starts, buffered until read, and end with exactly
 * one `finished` event.
 *
 * A worker's input is closed after a turn ends with nothing queued, so a worker that finished its
 * task ends (`finished`) and `send` then throws `ManagedAgentEndedError`. The lead's input stays
 * open for the owner's chat until `abort()`.
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
          if (spec.kind === 'worker' && (mapped.result.queuedTurns ?? 0) === 0) input.close();
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
