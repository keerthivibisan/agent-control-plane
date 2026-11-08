import { checkGitCommand, isFollowUp, isReadOnlyRole } from '@acp/core';
import type { ManagedAgentEvent, ManagedAgentSpec, ManagedCallbacks } from '@acp/core';
import { z } from 'zod';
import { callLeadTool } from './lead-tools.js';
import { cleanFreeText, commandApprovalSummary, unwrapShellCommand } from './summary.js';
import type { ServerRequestReply } from './transport.js';

/**
 * Answers the app-server's own requests (CLI 0.166.0). Every write Codex asks about goes through
 * the server's gate (`callbacks.requestPermission`), with the tool names the gate and the project
 * allowlist already know (`Bash` with `input.command`, `Edit`), so they work unchanged. What ACP
 * cannot screen is refused. Nothing a request carries is logged or kept (ADR-0009).
 */

export interface ApprovalContext {
  spec: ManagedAgentSpec;
  callbacks: ManagedCallbacks;
  emit(event: ManagedAgentEvent): void;
  /** True once the agent was aborted or ended: nothing more is asked of the owner. */
  ended(): boolean;
}

const CommandApprovalSchema = z.looseObject({
  itemId: z.string().min(1).nullable().catch(null),
  command: z.string().nullable().optional().catch(null),
});

const FileChangeApprovalSchema = z.looseObject({
  itemId: z.string().min(1).nullable().catch(null),
  reason: z.string().nullable().optional().catch(null),
});

const accept = { result: { decision: 'accept' } } as const;
const decline = { result: { decision: 'decline' } } as const;

/** A reason short enough to show after "Edit files" in the approval panel. */
const MAX_REASON_LENGTH = 120;

/** Agents that never ask the owner: a reading role or a follow-up only reads (`codexModes`). */
function neverAsks(spec: ManagedAgentSpec): boolean {
  return isReadOnlyRole(spec.kind) || spec.kind === 'lead' || isFollowUp(spec);
}

async function ask(
  ctx: ApprovalContext,
  request: { toolName: string; toolUseId: string | null; summary: string; input: unknown },
): Promise<ServerRequestReply> {
  if (ctx.ended() || neverAsks(ctx.spec)) return decline;
  try {
    const decision = await ctx.callbacks.requestPermission({
      agentRunId: ctx.spec.agentRunId,
      ...request,
    });
    return decision.allow && !ctx.ended() ? accept : decline;
  } catch {
    // A rejected or timed-out request is a deny (ManagedCallbacks).
    return decline;
  }
}

async function commandApproval(ctx: ApprovalContext, params: unknown): Promise<ServerRequestReply> {
  const parsed = CommandApprovalSchema.safeParse(params);
  // A command ACP cannot read cannot be screened.
  if (!parsed.success) return decline;
  const command = parsed.data.command ?? null;
  if (command === null || command.trim() === '') return decline;
  const inner = unwrapShellCommand(command);
  // F-1: a git write is refused without asking, in every mode. An approved escalation runs outside
  // Codex's sandbox, so this check must come first. Both forms are read: the guard also follows
  // `sh -c` itself, and the wrapper may not be the one `unwrapShellCommand` knows.
  const denial = checkGitCommand(inner) ?? checkGitCommand(command);
  if (denial !== null) {
    ctx.emit({ type: 'activity', summary: refusedSummary(denial.command) });
    return decline;
  }
  return ask(ctx, {
    toolName: 'Bash',
    toolUseId: parsed.data.itemId,
    summary: commandApprovalSummary(inner),
    input: { command: inner },
  });
}

/**
 * The activity line for a refused git command. A Codex `decline` carries no message, so the agent
 * learns the rule from its instructions (`gitGuardMessage` wording, `instructions.ts`).
 */
function refusedSummary(command: string): string {
  return cleanFreeText(`Refused ${command}: the app owns branches`, 200) ?? 'Refused a git command';
}

async function fileChangeApproval(
  ctx: ApprovalContext,
  params: unknown,
): Promise<ServerRequestReply> {
  const parsed = FileChangeApprovalSchema.safeParse(params);
  if (!parsed.success) return decline;
  const reason = cleanFreeText(parsed.data.reason ?? '', MAX_REASON_LENGTH + 1);
  const summary =
    reason !== null && Array.from(reason).length <= MAX_REASON_LENGTH
      ? `Edit files: ${reason}`
      : 'Edit files';
  return ask(ctx, { toolName: 'Edit', toolUseId: parsed.data.itemId, summary, input: {} });
}

/**
 * The reply to one server request:
 * - `item/commandExecution/requestApproval`: the git guard, then the owner (`Bash`);
 * - `item/fileChange/requestApproval`: the owner (`Edit`);
 * - `item/tool/call`: the role's control-plane tools (`callLeadTool`);
 * - extra permissions, user input, MCP elicitation and the legacy approvals: refused;
 * - anything else: a JSON-RPC "method not found" error.
 */
export async function answerServerRequest(
  ctx: ApprovalContext,
  method: string,
  params: unknown,
): Promise<ServerRequestReply> {
  switch (method) {
    case 'item/commandExecution/requestApproval':
      return commandApproval(ctx, params);
    case 'item/fileChange/requestApproval':
      return fileChangeApproval(ctx, params);
    case 'item/tool/call':
      return { result: await callLeadTool(ctx.spec, params) };
    case 'item/permissions/requestApproval':
      // Grants nothing, for this turn only.
      return { result: { permissions: {}, scope: 'turn' } };
    case 'item/tool/requestUserInput':
      return { result: { answers: {} } };
    case 'mcpServer/elicitation/request':
      return { result: { action: 'decline', content: null, _meta: null } };
    case 'applyPatchApproval':
    case 'execCommandApproval':
      return { result: { decision: { denied: { rejection: REFUSED_IN_MANAGED_RUN } } } };
    default:
      return { error: { code: -32601, message: 'Not supported by the control plane.' } };
  }
}

export const REFUSED_IN_MANAGED_RUN = 'Not allowed in a managed run.';
