import path from 'node:path';
import { LEAD_TOOL_NAMES } from '@acp/core';
import type { ManagedAgentSpec, ManagedCallbacks } from '@acp/core';
import type { CanUseTool, PermissionResult } from '@anthropic-ai/claude-agent-sdk';
import { isInside, summarizeToolUse, targetPath } from './summary.js';

/** Name of the lead's in-process MCP server; its tools appear as `mcp__acp__<name>`. */
export const LEAD_MCP_SERVER_NAME = 'acp';
export const LEAD_TOOL_PREFIX = `mcp__${LEAD_MCP_SERVER_NAME}__`;

/**
 * Built-in tools that only read (ADR-0013 §4). They run without asking, but only for targets inside
 * the agent's directory: a read elsewhere (or one Claude Code flags with `blockedPath`) still asks.
 * `LS` is the older name of the directory listing tool.
 */
export const READ_ONLY_TOOLS: ReadonlySet<string> = new Set(['Read', 'Glob', 'Grep', 'LS']);

const LEAD_TOOL_SET: ReadonlySet<string> = new Set(LEAD_TOOL_NAMES);

export const DENY_WORKER_LEAD_TOOL = 'Worker agents cannot use the control-plane tools.';
export const DENY_NO_DECISION = 'The owner did not approve this action.';
export const DENY_ABORTED = 'The agent was stopped.';

/** The lead tool name for `mcp__acp__<name>`, or null when the name is not one of ours. */
export function leadToolName(toolName: string): string | null {
  if (!toolName.startsWith(LEAD_TOOL_PREFIX)) return null;
  const name = toolName.slice(LEAD_TOOL_PREFIX.length);
  return LEAD_TOOL_SET.has(name) ? name : null;
}

type CanUseToolOptions = Parameters<CanUseTool>[2];

/**
 * True when the call comes from our own in-process server. The SDK says to key trust on
 * `mcpServer.source`, not on the name; older CLIs omit the field, and then the prefix is enough
 * because `strictMcpConfig` keeps every other MCP server out of managed runs.
 */
function fromLeadServer(options: CanUseToolOptions): boolean {
  const server = options.mcpServer;
  return server === undefined || (server.source === 'sdk' && server.name === LEAD_MCP_SERVER_NAME);
}

function readsOnlyInside(
  toolName: string,
  input: Record<string, unknown>,
  cwd: string,
  options: CanUseToolOptions,
): boolean {
  if (!READ_ONLY_TOOLS.has(toolName) || options.blockedPath !== undefined) return false;
  const target = targetPath(input);
  return target === null || isInside(path.resolve(cwd, target), cwd);
}

/**
 * The `canUseTool` callback for one managed agent (ADR-0013 §4):
 * - the lead's own tools (lead only) and in-directory read-only tools are allowed;
 * - a worker calling a lead tool is denied outright (depth 1, ADR-0012);
 * - everything else asks the owner through `callbacks.requestPermission`, with a redacted summary.
 * A rejected or failed request, or an aborted agent, is a deny: the callback never throws.
 */
export function createCanUseTool(spec: ManagedAgentSpec, callbacks: ManagedCallbacks): CanUseTool {
  return async (toolName, input, options): Promise<PermissionResult> => {
    const toolUseID = options.toolUseID;
    if (toolName.startsWith(LEAD_TOOL_PREFIX)) {
      if (spec.kind === 'worker') {
        return { behavior: 'deny', message: DENY_WORKER_LEAD_TOOL, toolUseID };
      }
      if (leadToolName(toolName) !== null && fromLeadServer(options)) {
        return { behavior: 'allow', toolUseID };
      }
      // An unknown `mcp__acp__*` name, or one from another server, is not ours: ask like any tool.
    }
    if (readsOnlyInside(toolName, input, spec.cwd, options)) {
      return { behavior: 'allow', toolUseID };
    }
    if (options.signal.aborted) return { behavior: 'deny', message: DENY_ABORTED, toolUseID };
    try {
      const decision = await callbacks.requestPermission({
        agentRunId: spec.agentRunId,
        toolName,
        toolUseId: toolUseID,
        summary: summarizeToolUse(toolName, input, spec.cwd),
      });
      if (options.signal.aborted) return { behavior: 'deny', message: DENY_ABORTED, toolUseID };
      return decision.allow
        ? { behavior: 'allow', toolUseID }
        : { behavior: 'deny', message: decision.message || DENY_NO_DECISION, toolUseID };
    } catch {
      return { behavior: 'deny', message: DENY_NO_DECISION, toolUseID };
    }
  };
}
