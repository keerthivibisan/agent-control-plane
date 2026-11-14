import path from 'node:path';
import {
  AGENT_NOTE_TOOL_NAMES,
  CHANGE_REVIEWER_ROLE_TOOL_NAMES,
  emitsChatText,
  HELPER_PARENT_TOOL_NAMES,
  isChangeReviewer,
  isFollowUp,
  isReadOnlyRole,
  keepsInputOpen,
  LEAD_ROLE_TOOL_NAMES,
  LEAD_TOOL_NAMES,
  managedToolNames,
  PLANNER_TOOL_NAMES,
  RESEARCHER_TOOL_NAMES,
  REVIEWER_TOOL_NAMES,
  specKeepsInputOpen,
} from '@acp/core';
import type { AgentRoleKind, ManagedAgentSpec, ManagedCallbacks } from '@acp/core';
import type { CanUseTool, PermissionResult } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import { gitGuardDenialFor, gitGuardMessage } from './branch-guard.js';
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
 * The role tool sets and role facts are provider-neutral and live in core
 * (`orchestration/role-tools.ts`, shared with the Codex adapter); re-exported here for this
 * adapter's callers and tests. How they reach Claude (the `mcp__acp__` server, the gate) stays here.
 * Read-only roles (`isReadOnlyRole`: planner, reviewer, researcher) get no edit or shell tools at all
 * (`READ_ONLY_DISALLOWED_TOOLS`), and anything but an in-folder read is denied without asking.
 */
export {
  AGENT_NOTE_TOOL_NAMES,
  CHANGE_REVIEWER_ROLE_TOOL_NAMES,
  emitsChatText,
  HELPER_PARENT_TOOL_NAMES,
  isChangeReviewer,
  isFollowUp,
  isReadOnlyRole,
  keepsInputOpen,
  LEAD_ROLE_TOOL_NAMES,
  managedToolNames,
  PLANNER_TOOL_NAMES,
  RESEARCHER_TOOL_NAMES,
  REVIEWER_TOOL_NAMES,
  specKeepsInputOpen,
};

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
 * ADR-0013 §2), the planner, the reviewer and the researcher (ADR-0037 §3). No edit or shell tool is in their context at all.
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

const DENY_ROLE_TOOL: Readonly<Record<'planner' | 'reviewer' | 'researcher', string>> = {
  planner: 'The planner can only submit the plan.',
  reviewer: 'The reviewer can only post its findings.',
  researcher: 'The researcher can only report its findings (report_findings) or ask the lead.',
};
export const DENY_CHANGE_REVIEWER_TOOL = 'The change reviewer can only submit its review.';

export const DENY_WORKER_LEAD_TOOL =
  'Worker agents can only report their work (report_work); they cannot use the other control-plane tools.';
export const DENY_HELPER_LEAD_TOOL =
  'Helper agents can only start, list, message, stop and check their own helpers, and report their work.';
export const DENY_NOT_YOUR_TOOL = 'This control-plane tool is not available to this agent.';
/** ADR-0035: the project assistant never reaches ticket agents or other roles' tools. */
export const DENY_ASSISTANT_TOOL =
  'The project assistant can only use ticket_status, project_info, propose_skill, propose_agent and code_map.';
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

/**
 * A read-only tool whose target is inside the agent's folder, or inside one of the folders it may
 * also read (`spec.readOnlyDirs`, ADR-0026 §4: its attachment copies).
 */
function readsOnlyInside(
  toolName: string,
  input: Record<string, unknown>,
  spec: ManagedAgentSpec,
  options: CanUseToolOptions,
): boolean {
  if (!READ_ONLY_TOOLS.has(toolName) || options.blockedPath !== undefined) return false;
  const target = targetPath(input);
  if (target === null) return true;
  const resolved = path.resolve(spec.cwd, target);
  return (
    isInside(resolved, spec.cwd) ||
    (spec.readOnlyDirs ?? []).some((dir) => path.isAbsolute(dir) && isInside(resolved, dir))
  );
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
 * - a read-only role (planner, reviewer, researcher) is denied anything else without asking (ADR-0019);
 * - a read in one of `spec.readOnlyDirs` (the lead's or planner's attachment copies) is allowed;
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
        const message = isChangeReviewer(spec)
          ? DENY_CHANGE_REVIEWER_TOOL
          : kind === 'assistant'
            ? DENY_ASSISTANT_TOOL
            : kind === 'planner' || kind === 'reviewer' || kind === 'researcher'
              ? DENY_ROLE_TOOL[kind]
              : spec.canStartHelpers === true && kind === 'worker'
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
    if (readsOnlyInside(toolName, input, spec, options)) {
      return { behavior: 'allow', toolUseID };
    }
    if (isReadOnlyRole(spec.kind)) return { behavior: 'deny', message: DENY_READ_ONLY, toolUseID };
    // F-1: a branch-managing git command is denied without asking the owner, in every mode: only
    // the app moves branches (the PreToolUse hook denies it first; this is the gate's layer).
    const branchCommand = gitGuardDenialFor(toolName, input);
    if (branchCommand !== null) {
      return { behavior: 'deny', message: gitGuardMessage(branchCommand), toolUseID };
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

/**
 * The gate of a follow-up turn (ADR-0020 §2): only its read-only tools, and only for targets
 * inside its folder (the project root), are allowed. Everything else is denied without asking the
 * owner: there is no approval for an ended run.
 */
function followUpGate(spec: ManagedAgentSpec): CanUseTool {
  const allowed: ReadonlySet<string> = new Set(followUpToolNames(spec));
  // ADR-0034 §4: the read-only `code_map` from our server, when the server gave a handler.
  const ownTools: ReadonlySet<string> = new Set(
    spec.leadTools === undefined ? [] : managedToolNames(spec),
  );
  return (toolName, input, options): Promise<PermissionResult> => {
    const toolUseID = options.toolUseID;
    const own = leadToolName(toolName);
    if (own !== null && ownTools.has(own) && fromLeadServer(options)) {
      return Promise.resolve({ behavior: 'allow', toolUseID });
    }
    if (allowed.has(toolName) && readsOnlyInside(toolName, input, spec, options)) {
      return Promise.resolve({ behavior: 'allow', toolUseID });
    }
    return Promise.resolve({ behavior: 'deny', message: DENY_FOLLOW_UP, toolUseID });
  };
}
