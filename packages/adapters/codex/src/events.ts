import { emitsChatText } from '@acp/core';
import type { ManagedAgentEvent, ManagedAgentSpec, TokenCounts } from '@acp/core';
import { z } from 'zod';
import { commandActivity, commandCategory, fileChangeActivity, toolActivity } from './summary.js';

/**
 * Maps app-server notifications (CLI 0.166.0) to `ManagedAgentEvent`s. Each one is validated at
 * this boundary; one that fails, and every other method (deltas, rate limits, status), is ignored.
 * Only ids, item kinds, command names, paths, tool names and token counts are read; worker text,
 * reasoning, command output and tool arguments never leave this module (ADR-0009, ADR-0015).
 */

const tokenCount = z.number().int().nonnegative().nullable().catch(null);

const BreakdownSchema = z.looseObject({
  totalTokens: tokenCount,
  inputTokens: tokenCount,
  cachedInputTokens: tokenCount,
  cacheWriteInputTokens: tokenCount,
  outputTokens: tokenCount,
});

const TokenUsageSchema = z.looseObject({
  threadId: z.string().min(1),
  turnId: z.string().min(1),
  tokenUsage: z.looseObject({
    total: BreakdownSchema.nullable().catch(null),
    last: BreakdownSchema.nullable().catch(null),
  }),
});

const ItemSchema = z.looseObject({
  item: z.looseObject({ type: z.string() }),
});
const CommandItemSchema = z.looseObject({
  type: z.literal('commandExecution'),
  command: z.string(),
});
const FileChangeItemSchema = z.looseObject({
  type: z.literal('fileChange'),
  changes: z.array(z.looseObject({ path: z.string() })).catch([]),
});
const ToolItemSchema = z.looseObject({
  type: z.enum(['dynamicToolCall', 'mcpToolCall']),
  tool: z.string(),
});
const AgentMessageItemSchema = z.looseObject({ type: z.literal('agentMessage'), text: z.string() });

const TurnStartedSchema = z.looseObject({ turn: z.looseObject({ id: z.string().min(1) }) });
const TurnCompletedSchema = z.looseObject({
  turn: z.looseObject({
    id: z.string().min(1),
    status: z.enum(['completed', 'interrupted', 'failed', 'inProgress']).catch('failed'),
  }),
});
const ErrorSchema = z.looseObject({ willRetry: z.boolean().catch(false) });

/** What one notification means for the agent's lifecycle, besides its events. */
export type Lifecycle =
  | { kind: 'turn-started'; turnId: string }
  | { kind: 'turn-completed'; turnId: string; status: 'completed' | 'interrupted' | 'failed' }
  /** An error the server will not retry (the turn fails). */
  | { kind: 'error' }
  | null;

export interface MappedNotification {
  events: ManagedAgentEvent[];
  lifecycle: Lifecycle;
}

const NOTHING: MappedNotification = { events: [], lifecycle: null };

/**
 * ADR-0032 (amended after CX-1): one usage record per model request, from `last`, keyed by
 * `<threadId>:<turnId>:<total.totalTokens>`. The cumulative total strictly grows per request and is
 * identical in the notification replayed after `thread/resume`, so the replay dedups on
 * `(provider, messageId)` and nothing is ever summed. Without a total there is no stable key and
 * no event. A field the server omits is null, never 0; `inputTokens` includes the cached part.
 */
export function usageEvent(params: unknown): ManagedAgentEvent | null {
  const parsed = TokenUsageSchema.safeParse(params);
  if (!parsed.success) return null;
  const { threadId, turnId, tokenUsage } = parsed.data;
  const total = tokenUsage.total?.totalTokens ?? null;
  const last = tokenUsage.last;
  if (total === null || last === null) return null;
  const cached = last.cachedInputTokens;
  const input = last.inputTokens;
  const tokens: TokenCounts = {
    input: input !== null && cached !== null && input >= cached ? input - cached : null,
    output: last.outputTokens,
    cacheCreation: last.cacheWriteInputTokens,
    cacheRead: cached,
  };
  return { type: 'usage', messageId: `${threadId}:${turnId}:${total}`, tokens };
}

/**
 * A started item's activity line and its measurement category (CM-2): a command by its name, a
 * file change as `edit`, ACP's `code_map` dynamic tool as `code_map`, any other tool as `other`.
 */
function itemStartedEvents(item: unknown, cwd: string): ManagedAgentEvent[] {
  const command = CommandItemSchema.safeParse(item);
  if (command.success) {
    return [
      { type: 'activity', summary: commandActivity(command.data.command) },
      { type: 'tool-use', category: commandCategory(command.data.command) },
    ];
  }
  const change = FileChangeItemSchema.safeParse(item);
  if (change.success) {
    const paths = change.data.changes.map((c) => c.path);
    return [
      { type: 'activity', summary: fileChangeActivity(paths, cwd) },
      { type: 'tool-use', category: 'edit' },
    ];
  }
  const tool = ToolItemSchema.safeParse(item);
  if (tool.success) {
    const codeMap = tool.data.type === 'dynamicToolCall' && tool.data.tool === 'code_map';
    return [
      { type: 'activity', summary: toolActivity(tool.data.tool) },
      { type: 'tool-use', category: codeMap ? 'code_map' : 'other' },
    ];
  }
  return [];
}

export function mapNotification(
  method: string,
  params: unknown,
  spec: Pick<ManagedAgentSpec, 'kind' | 'cwd'>,
): MappedNotification {
  switch (method) {
    case 'item/started': {
      const parsed = ItemSchema.safeParse(params);
      if (!parsed.success) return NOTHING;
      const events = itemStartedEvents(parsed.data.item, spec.cwd);
      return events.length === 0 ? NOTHING : { events, lifecycle: null };
    }
    case 'item/completed': {
      // Chat text for the owner (ADR-0015) from the lead and the planner only; never a worker's.
      if (!emitsChatText(spec.kind)) return NOTHING;
      const parsed = ItemSchema.safeParse(params);
      if (!parsed.success) return NOTHING;
      const message = AgentMessageItemSchema.safeParse(parsed.data.item);
      if (!message.success || message.data.text.trim() === '') return NOTHING;
      return { events: [{ type: 'lead-text', text: message.data.text }], lifecycle: null };
    }
    case 'thread/tokenUsage/updated': {
      const event = usageEvent(params);
      return event === null ? NOTHING : { events: [event], lifecycle: null };
    }
    case 'turn/started': {
      const parsed = TurnStartedSchema.safeParse(params);
      return parsed.success
        ? { events: [], lifecycle: { kind: 'turn-started', turnId: parsed.data.turn.id } }
        : NOTHING;
    }
    case 'turn/completed': {
      const parsed = TurnCompletedSchema.safeParse(params);
      if (!parsed.success) return NOTHING;
      const { id, status } = parsed.data.turn;
      // `inProgress` in a completion is not a state ACP can act on: read it as a failure.
      const ended = status === 'inProgress' ? 'failed' : status;
      return { events: [], lifecycle: { kind: 'turn-completed', turnId: id, status: ended } };
    }
    case 'error': {
      const parsed = ErrorSchema.safeParse(params ?? {});
      return parsed.success && !parsed.data.willRetry
        ? { events: [], lifecycle: { kind: 'error' } }
        : NOTHING;
    }
    default:
      return NOTHING;
  }
}
