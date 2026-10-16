import path from 'node:path';
import { LEAD_TOOL_NAMES } from '@acp/core';
import type { AgentRoleKind, LeadToolName, ManagedAgentSpec, ManagedCallbacks } from '@acp/core';
import type { CanUseTool, PermissionResult } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
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
  // A follow-up turn of an ended lead answers only (ADR-0020 §2): no control-plane tool at all.
  if (spec.followUp !== undefined) return [];
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
 * and anything but an in-folder read is denied without asking. The lead is read-only too
 * (ADR-0013 §2): its base set has no edit or shell tool (`READ_ONLY_BASE_TOOLS`), so the gate
 * denies those without asking, but a read outside its folder still asks the owner.
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

/**
 * The built-in base set of a reading role (ADR-0019 §7): the lead (read-only in the project root,
 * ADR-0013 §2), the planner and the reviewer. No edit or shell tool is in their context at all.
 */
export const READ_ONLY_BASE_TOOLS: readonly string[] = ['Read', 'Grep', 'Glob'];

/**
 * The built-in base set of a role that changes code in its own worktree (ADR-0019 §7): a worker
 * and the tester. Edits and shell commands still ask the owner (or the project allowlist).
 * - `MultiEdit` and `NotebookEdit` are left out: the R-V real run (SDK 0.3.296) offered no
 *   `MultiEdit`, and no stage edits notebooks (`Edit` and `Write` cover the work);
 * - `BashOutput`/`KillShell` (background shells) are left out, so no approved command keeps
 *   running in the background.
 */
export const EDITING_BASE_TOOLS: readonly string[] = [
  ...READ_ONLY_BASE_TOOLS,
  'Edit',
  'Write',
  'Bash',
];

/**
 * A role's fixed built-in base set (ADR-0019 §7). Everything else the installed Claude Code offers
 * (subagents, web, cron, messaging, remote triggers, notifications, artifacts, worktree and
 * plan-mode tools, as the R-V run's `system/init` listed them) stays out of every role's context.
 */
export function roleBaseTools(kind: AgentRoleKind): readonly string[] {
  return kind === 'worker' || kind === 'tester' ? EDITING_BASE_TOOLS : READ_ONLY_BASE_TOOLS;
}

/**
 * The built-in base set of a follow-up turn (ADR-0020 §2, research 2026-10-16): it reads and
 * answers. Nothing else is in its context, and the gate denies anything else as well.
 */
export const FOLLOW_UP_TOOLS: readonly string[] = READ_ONLY_BASE_TOOLS;

/**
 * Removed from a follow-up turn's context on top of the base set: the read-only roles' list plus
 * subagents (`Agent`, older `Task`), which could otherwise act with tools of their own.
 */
export const FOLLOW_UP_DISALLOWED_TOOLS: readonly string[] = [
  ...READ_ONLY_DISALLOWED_TOOLS,
  'Agent',
  'Task',
];

/** True for a follow-up turn of an ended lead (ADR-0020). */
export function isFollowUp(spec: Pick<ManagedAgentSpec, 'followUp'>): boolean {
  return spec.followUp !== undefined;
}

/**
 * A follow-up turn's SDK `tools` base set: `FOLLOW_UP_TOOLS`, narrowed further by the lead stage's
 * agent file when it lists tools (ADR-0019 §6 only narrows). Never `Skill`: no plugin is given.
 */
export function followUpToolNames(spec: ManagedAgentSpec): readonly string[] {
  return narrowedBy(FOLLOW_UP_TOOLS, spec.profile?.tools ?? null);
}

/** `base` kept only where the stage's agent file lists the tool; a null list keeps all of it. */
function narrowedBy(base: readonly string[], listed: readonly string[] | null): string[] {
  return listed === null ? [...base] : base.filter((name) => listed.includes(name));
}

/** The name of Claude Code's skills tool. */
export const SKILL_TOOL = 'Skill';

/**
 * The SDK `tools` base set of one agent (ADR-0019 §6, §7). It is always set and never widened:
 * - the role's fixed base set (`roleBaseTools`); a follow-up turn's is `followUpToolNames`;
 * - narrowed by the stage's agent file when it lists tools: only names in both stay, so a file
 *   can never add a tool (`Bash` for a reviewer, `Agent`, `WebFetch`). MCP entries in the file
 *   do nothing: the role's `mcp__acp__*` control tools are MCP, unaffected by `tools`, and
 *   `strictMcpConfig` keeps every other server out;
 * - plus `Skill` exactly when the run has a skills plugin, whatever the file lists (skills come
 *   only from the stage's skill mapping, ADR-0019 §4); never for a follow-up turn.
 * Nothing is approved by it, and `allowedTools` is never used.
 */
export function agentToolNames(spec: ManagedAgentSpec): readonly string[] {
  if (isFollowUp(spec)) return followUpToolNames(spec);
  const names = narrowedBy(roleBaseTools(spec.kind), spec.profile?.tools ?? null);
  if (spec.skillPlugin !== undefined) names.push(SKILL_TOOL);
  return names;
}

const MCP_PREFIX = 'mcp__';

/**
 * The input of a `Skill` call as Claude Code sends it (`{ skill, args? }`). Only the name is
 * read; any other shape is not trusted, and the call is denied.
 */
const SkillCallSchema = z.object({ skill: z.string().min(1) });

/**
 * True when a `Skill` call names one of the run's plugin skills (`acp-skills:<name>`, ADR-0019 §4,
 * §7). Bundled skills (`update-config`, `schedule`, …) load even with `settingSources: []`, and the
 * SDK `skills` option did not hide them in the R-V run, so the gate checks the name itself. A
 * leading `/` (the slash-command form) names the same skill.
 */
export function isRunSkillCall(spec: ManagedAgentSpec, input: Record<string, unknown>): boolean {
  const plugin = spec.skillPlugin;
  if (plugin === undefined) return false;
  const parsed = SkillCallSchema.safeParse(input);
  if (!parsed.success) return false;
  const raw = parsed.data.skill;
  return plugin.skills.includes(raw.startsWith('/') ? raw.slice(1) : raw);
}

/**
 * Roles whose input stays open after a turn: the lead (owner chat) and the planner (it revises
 * the plan on the owner's comments). Every other role ends when its turn ends with nothing queued.
 */
export function keepsInputOpen(kind: AgentRoleKind): boolean {
  return kind === 'lead' || kind === 'planner';
}

/** Whether this agent's input stays open after a turn: never for a follow-up turn (one turn). */
export function specKeepsInputOpen(spec: Pick<ManagedAgentSpec, 'kind' | 'followUp'>): boolean {
  return !isFollowUp(spec) && keepsInputOpen(spec.kind);
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
export const DENY_NOT_IN_ROLE = "This tool is not part of this agent's role.";
export const DENY_SKILL = "Only this stage's project skills (acp-skills:…) can be used.";
export const DENY_FOLLOW_UP =
  'This run has ended: you can only read files in the project and answer. New work needs a new run.';

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
 * Why a built-in tool outside the agent's effective set (`agentToolNames`) is denied:
 * - a role tool the stage's agent file does not list: the file narrowed it away;
 * - an edit or shell tool for a reading role (lead, planner, reviewer): it only reads;
 * - anything else (`Skill` without a plugin, `WebFetch`, `Agent`, `SendMessage`, …): not in the
 *   role's base set.
 */
function outsideSetMessage(spec: ManagedAgentSpec, toolName: string): string {
  const base = roleBaseTools(spec.kind);
  if (base.includes(toolName)) return DENY_NOT_IN_AGENT_FILE;
  if (!base.includes('Edit') && READ_ONLY_DISALLOWED_TOOLS.includes(toolName)) {
    return DENY_READ_ONLY;
  }
  return DENY_NOT_IN_ROLE;
}

/**
 * The `canUseTool` callback for one managed agent (ADR-0013 §4 and its 2026-10-13 amendment,
 * ADR-0019 §6 and §7):
 * - the agent's own control-plane tools (`managedToolNames`) from our in-process server, and
 *   in-directory read-only tools, are allowed;
 * - a worker, tester, planner or reviewer calling any other `mcp__acp__*` tool is denied outright
 *   (depth 1, ADR-0012; a depth-2 parent helper never gets `submit_plan` or `request_review`);
 * - a built-in tool outside the agent's effective set (`agentToolNames`: the role's base set,
 *   narrowed by its agent file, `Skill` with a plugin) is denied without asking, a second layer
 *   behind the SDK `tools` base set. So the lead, which is read-only (ADR-0013 §2), is never
 *   asked about edits or shell commands, and no role is asked about web, subagent or messaging
 *   tools;
 * - a `Skill` call is allowed, without asking, only for one of the run's plugin skills
 *   (`isRunSkillCall`); any other skill name or input shape is denied;
 * - a read-only role (planner, reviewer) is denied anything else without asking (ADR-0019);
 * - everything else (an edit or `Bash` of a worker or tester, a lead's read outside its folder)
 *   asks the owner through `callbacks.requestPermission`, with a redacted summary.
 * A rejected or failed request, or an aborted agent, is a deny: the callback never throws. Tool
 * input is never logged.
 */
export function createCanUseTool(spec: ManagedAgentSpec, callbacks: ManagedCallbacks): CanUseTool {
  if (isFollowUp(spec)) return followUpGate(spec);
  const ownTools: ReadonlySet<string> = new Set(managedToolNames(spec));
  const effective: ReadonlySet<string> = new Set(agentToolNames(spec));
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
    if (!toolName.startsWith(MCP_PREFIX)) {
      if (!effective.has(toolName)) {
        return { behavior: 'deny', message: outsideSetMessage(spec, toolName), toolUseID };
      }
      if (toolName === SKILL_TOOL) {
        return isRunSkillCall(spec, input)
          ? { behavior: 'allow', toolUseID }
          : { behavior: 'deny', message: DENY_SKILL, toolUseID };
      }
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

/**
 * The gate of a follow-up turn (ADR-0020 §2): only its read-only tools, and only for targets
 * inside its folder (the project root), are allowed. Everything else is denied without asking the
 * owner: there is no approval for an ended run.
 */
function followUpGate(spec: ManagedAgentSpec): CanUseTool {
  const allowed: ReadonlySet<string> = new Set(followUpToolNames(spec));
  return (toolName, input, options): Promise<PermissionResult> => {
    const toolUseID = options.toolUseID;
    if (allowed.has(toolName) && readsOnlyInside(toolName, input, spec.cwd, options)) {
      return Promise.resolve({ behavior: 'allow', toolUseID });
    }
    return Promise.resolve({ behavior: 'deny', message: DENY_FOLLOW_UP, toolUseID });
  };
}
