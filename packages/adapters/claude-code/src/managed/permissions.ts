import path from 'node:path';
import { LEAD_TOOL_NAMES } from '@acp/core';
import type { AgentRoleKind, LeadToolName, ManagedAgentSpec, ManagedCallbacks } from '@acp/core';
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

/** The planner's one tool (ADR-0019): it writes and revises the plan, nothing else. */
export const PLANNER_TOOL_NAMES: readonly LeadToolName[] = ['submit_plan'];
/** The reviewer's one tool (ADR-0019, decision B): its findings become ticket comments. */
export const REVIEWER_TOOL_NAMES: readonly LeadToolName[] = ['post_review'];

/**
 * The control-plane tools one agent may use (ADR-0019):
 * - lead: the lead's set (every lead tool except `post_review`);
 * - planner: `submit_plan`; reviewer: `post_review`;
 * - worker: the child-management subset with `canStartHelpers`, else none (depth 1);
 * - tester: none (it is a worker that never starts helpers).
 * The adapter builds the MCP server and `canUseTool` from this one list, so the two cannot
 * disagree. The engine checks every call again (`leadToolCall`).
 */
export function managedToolNames(spec: ManagedAgentSpec): readonly LeadToolName[] {
  switch (spec.kind) {
    case 'lead':
      return LEAD_ROLE_TOOL_NAMES;
    case 'planner':
      return PLANNER_TOOL_NAMES;
    case 'reviewer':
      return REVIEWER_TOOL_NAMES;
    case 'worker':
      return spec.canStartHelpers === true ? HELPER_PARENT_TOOL_NAMES : [];
    case 'tester':
      return [];
  }
}

/**
 * Roles that only read (ADR-0019): the planner reads the owner's tree, the reviewer a detached
 * checkout of the merged result. They get no edit or shell tools at all (`READ_ONLY_DISALLOWED_TOOLS`),
 * and anything but an in-folder read is denied without asking. The lead is read-only too, but
 * keeps the Phase 3 behaviour: the server denies its tool uses (ADR-0013 §2).
 */
export function isReadOnlyRole(kind: AgentRoleKind): boolean {
  return kind === 'planner' || kind === 'reviewer';
}

/** Built-in tools removed from a read-only role's context (SDK `disallowedTools`). */
export const READ_ONLY_DISALLOWED_TOOLS: readonly string[] = [
  'Bash',
  'BashOutput',
  'KillShell',
  'Edit',
  'MultiEdit',
  'Write',
  'NotebookEdit',
];

const MCP_PREFIX = 'mcp__';

/** A built-in tool name as an agent file lists it (`Read`, `Bash`), not an MCP one (`mcp__…`). */
function isBuiltInToolName(name: string): boolean {
  return /^[A-Za-z][A-Za-z0-9_]*$/.test(name) && !name.startsWith(MCP_PREFIX);
}

/** `Task` is the older name of `Agent` (Claude Code 2.1.63); either name means the same tool. */
const TOOL_ALIASES: Readonly<Record<string, string>> = { Task: 'Agent', Agent: 'Task' };

/**
 * The built-in tools a stage's agent file narrows this agent to (ADR-0019 §6,
 * docs/research/sdk-tool-narrowing-2026-10-16.md), or null when it does not narrow (no profile,
 * or a profile whose file lists no `tools`). The list is the SDK `tools` base set:
 * - only the file's built-in names: MCP entries are dropped, because the role's own
 *   `mcp__acp__*` control tools always stay (they are the stage's contract) and no other MCP
 *   server runs (`strictMcpConfig`);
 * - only where the role allows them: a read-only role (planner, reviewer) never gets
 *   `READ_ONLY_DISALLOWED_TOOLS`, whatever the file lists;
 * - `Skill` exactly when the run has a skills plugin (skills come only from the stage's skill
 *   mapping, ADR-0019 §4).
 * It only narrows: nothing is approved by it, and `allowedTools` is never used.
 */
export function profileToolNames(spec: ManagedAgentSpec): readonly string[] | null {
  const listed = spec.profile?.tools ?? null;
  if (listed === null) return null;
  const roleDenied: ReadonlySet<string> = new Set(
    isReadOnlyRole(spec.kind) ? READ_ONLY_DISALLOWED_TOOLS : [],
  );
  const names: string[] = [];
  for (const name of listed) {
    if (!isBuiltInToolName(name) || name === 'Skill' || roleDenied.has(name)) continue;
    if (!names.includes(name)) names.push(name);
  }
  if (spec.skillPlugin !== undefined) names.push('Skill');
  return names;
}

/**
 * Roles whose input stays open after a turn: the lead (owner chat) and the planner (it revises
 * the plan on the owner's comments). Every other role ends when its turn ends with nothing queued.
 */
export function keepsInputOpen(kind: AgentRoleKind): boolean {
  return kind === 'lead' || kind === 'planner';
}

/** Roles whose main-thread text is chat for the owner (ADR-0015): the lead, and the planner. */
export function emitsChatText(kind: AgentRoleKind): boolean {
  return kind === 'lead' || kind === 'planner';
}

const DENY_ROLE_TOOL: Readonly<Record<'planner' | 'reviewer', string>> = {
  planner: 'The planner can only submit the plan.',
  reviewer: 'The reviewer can only post its findings.',
};

export const DENY_WORKER_LEAD_TOOL = 'Worker agents cannot use the control-plane tools.';
export const DENY_HELPER_LEAD_TOOL =
  'Helper agents can only start, list, message, stop and check their own helpers.';
export const DENY_NOT_YOUR_TOOL = 'This control-plane tool is not available to this agent.';
export const DENY_READ_ONLY = 'This agent only reads files inside its folder.';
export const DENY_NO_DECISION = 'The owner did not approve this action.';
export const DENY_ABORTED = 'The agent was stopped.';
export const DENY_NOT_IN_AGENT_FILE = "This stage's agent file does not list this tool.";

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
 * - a worker, tester, planner or reviewer calling any other `mcp__acp__*` tool is denied outright
 *   (depth 1, ADR-0012; a depth-2 parent helper never gets `submit_plan` or `request_review`);
 * - with a stage agent file that lists tools (ADR-0019 §6), a built-in tool not in that list
 *   (`profileToolNames`) is denied without asking, a second layer behind the SDK `tools` base set;
 * - a read-only role (planner, reviewer) is denied anything else without asking (ADR-0019);
 * - everything else asks the owner through `callbacks.requestPermission`, with a redacted summary.
 * A rejected or failed request, or an aborted agent, is a deny: the callback never throws.
 */
export function createCanUseTool(spec: ManagedAgentSpec, callbacks: ManagedCallbacks): CanUseTool {
  const ownTools: ReadonlySet<string> = new Set(managedToolNames(spec));
  const narrowed = profileToolNames(spec);
  // The gate accepts a listed tool under either of its names (`Task`/`Agent`).
  const fileTools: ReadonlySet<string> | null =
    narrowed === null
      ? null
      : new Set(
          narrowed.flatMap((name) => {
            const alias = TOOL_ALIASES[name];
            return alias === undefined ? [name] : [name, alias];
          }),
        );
  return async (toolName, input, options): Promise<PermissionResult> => {
    const toolUseID = options.toolUseID;
    if (toolName.startsWith(LEAD_TOOL_PREFIX)) {
      const name = leadToolName(toolName);
      const kind = spec.kind;
      if (kind !== 'lead') {
        if (name !== null && ownTools.has(name) && fromLeadServer(options)) {
          return { behavior: 'allow', toolUseID };
        }
        const message =
          kind === 'planner' || kind === 'reviewer'
            ? DENY_ROLE_TOOL[kind]
            : ownTools.size > 0
              ? DENY_HELPER_LEAD_TOOL
              : DENY_WORKER_LEAD_TOOL;
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
    if (fileTools !== null && !toolName.startsWith(MCP_PREFIX) && !fileTools.has(toolName)) {
      return { behavior: 'deny', message: DENY_NOT_IN_AGENT_FILE, toolUseID };
    }
    if (readsOnlyInside(toolName, input, spec.cwd, options)) {
      return { behavior: 'allow', toolUseID };
    }
    if (isReadOnlyRole(spec.kind)) return { behavior: 'deny', message: DENY_READ_ONLY, toolUseID };
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
