import path from 'node:path';
import { LEAD_TOOL_NAMES } from '@acp/core';
import type { LeadToolName, ManagedAgentSpec, ManagedCallbacks } from '@acp/core';
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

/**
 * The tools a depth-2 parent helper gets (ADR-0013 amendment): managing its own children only.
 * Never `submit_plan` or `request_review`: planning and review stay with the lead. The engine
 * scopes each call to the caller's own children; this list only decides what the model sees.
 */
export const HELPER_PARENT_TOOL_NAMES: readonly LeadToolName[] = [
  'start_agent',
  'list_agents',
  'message_agent',
  'stop_agent',
  'agent_status',
];

/**
 * The lead's tools: every lead tool except `post_review`, which only a reviewer gets (ADR-0019,
 * decision B). The engine refuses `post_review` from anyone else as well.
 */
export const LEAD_ROLE_TOOL_NAMES: readonly LeadToolName[] = LEAD_TOOL_NAMES.filter(
  (name) => name !== 'post_review',
);

/**
 * The control-plane tools one agent may use: the lead's set for the lead, the child-management
 * subset for a worker with `canStartHelpers`, none for any other worker (depth 1). The adapter
 * builds the MCP server and `canUseTool` from this one list, so the two cannot disagree.
 */
export function managedToolNames(spec: ManagedAgentSpec): readonly LeadToolName[] {
  if (spec.kind === 'lead') return LEAD_ROLE_TOOL_NAMES;
  return spec.canStartHelpers === true ? HELPER_PARENT_TOOL_NAMES : [];
}

export const DENY_WORKER_LEAD_TOOL = 'Worker agents cannot use the control-plane tools.';
export const DENY_HELPER_LEAD_TOOL =
  'Helper agents can only start, list, message, stop and check their own helpers.';
export const DENY_NOT_YOUR_TOOL = 'This control-plane tool is not available to this agent.';
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
 * The `canUseTool` callback for one managed agent (ADR-0013 §4 and its 2026-10-13 amendment):
 * - the agent's own control-plane tools (`managedToolNames`) from our in-process server, and
 *   in-directory read-only tools, are allowed;
 * - a worker calling any other `mcp__acp__*` tool is denied outright (depth 1, ADR-0012; a depth-2
 *   parent helper never gets `submit_plan` or `request_review`);
 * - everything else asks the owner through `callbacks.requestPermission`, with a redacted summary.
 * A rejected or failed request, or an aborted agent, is a deny: the callback never throws.
 */
export function createCanUseTool(spec: ManagedAgentSpec, callbacks: ManagedCallbacks): CanUseTool {
  const ownTools: ReadonlySet<string> = new Set(managedToolNames(spec));
  return async (toolName, input, options): Promise<PermissionResult> => {
    const toolUseID = options.toolUseID;
    if (toolName.startsWith(LEAD_TOOL_PREFIX)) {
      const name = leadToolName(toolName);
      if (spec.kind === 'worker') {
        if (name !== null && ownTools.has(name) && fromLeadServer(options)) {
          return { behavior: 'allow', toolUseID };
        }
        const message = ownTools.size > 0 ? DENY_HELPER_LEAD_TOOL : DENY_WORKER_LEAD_TOOL;
        return { behavior: 'deny', message, toolUseID };
      }
      if (name !== null && ownTools.has(name) && fromLeadServer(options)) {
        return { behavior: 'allow', toolUseID };
      }
      // One of our tools that is not in this agent's set (the lead's `post_review`): never asked.
      if (name !== null && !ownTools.has(name) && fromLeadServer(options)) {
        return { behavior: 'deny', message: DENY_NOT_YOUR_TOOL, toolUseID };
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
        input,
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
