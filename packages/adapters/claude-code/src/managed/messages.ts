import type { ManagedAgentEvent, ManagedAgentSpec } from '@acp/core';
import { z } from 'zod';
import { emitsChatText } from './permissions.js';
import { summarizeToolUse } from './summary.js';

/**
 * Maps Agent SDK output messages (sdk.d.ts `SDKMessage`, 0.3.296) to `ManagedAgentEvent`s. Each
 * message is validated per field at this boundary; a message that fails is ignored, as are the many
 * informational types (`stream_event`, task, hook, status, ...). Only identifiers, tool names and
 * target paths, token counts and the reported cost are read; worker text, thinking and tool input
 * or output never leave this module (ADR-0009, ADR-0015).
 */

const optString = z.string().min(1).nullable().catch(null);
const tokenCount = z.number().int().nonnegative().nullable().catch(null);

const InitSchema = z.looseObject({
  type: z.literal('system'),
  subtype: z.literal('init'),
  session_id: z.string().min(1),
  model: optString,
});

const UsageSchema = z.looseObject({
  input_tokens: tokenCount,
  output_tokens: tokenCount,
  cache_creation_input_tokens: tokenCount,
  cache_read_input_tokens: tokenCount,
});

const AssistantSchema = z.looseObject({
  type: z.literal('assistant'),
  parent_tool_use_id: z.string().nullable().catch(null),
  message: z.looseObject({
    id: optString,
    content: z.array(z.unknown()).catch([]),
    usage: UsageSchema.nullable().catch(null),
  }),
});

const TextBlockSchema = z.looseObject({ type: z.literal('text'), text: z.string() });
const ToolUseBlockSchema = z.looseObject({
  type: z.literal('tool_use'),
  name: z.string().min(1),
  input: z.unknown(),
});

const ResultSchema = z.looseObject({
  type: z.literal('result'),
  subtype: z.string(),
  is_error: z.boolean().catch(true),
  total_cost_usd: z.number().nonnegative().finite().nullable().catch(null),
  queued_turn_count: z.number().int().nonnegative().optional().catch(undefined),
});

/** The end of one turn, as reported by a `result` message. */
export interface TurnResult {
  outcome: 'success' | 'error';
  /**
   * Cumulative estimated cost of the query so far (the SDK's running total; never summed across
   * results). Null when absent, or when an error result carries the zero the SDK reports for
   * crash and startup errors: a missing cost is unavailable, never 0.
   */
  costUsd: number | null;
  /** Sends still queued behind this turn; null when the CLI did not say. */
  queuedTurns: number | null;
}

export interface MappedMessage {
  events: ManagedAgentEvent[];
  result: TurnResult | null;
}

export interface MapperState {
  /** `started` is emitted once: the CLI re-sends `system/init` on every turn of a headless run. */
  started: boolean;
}

const NOTHING: MappedMessage = { events: [], result: null };

export function mapSdkMessage(
  message: unknown,
  spec: Pick<ManagedAgentSpec, 'kind' | 'cwd'>,
  state: MapperState,
): MappedMessage {
  const init = InitSchema.safeParse(message);
  if (init.success) {
    if (state.started) return NOTHING;
    state.started = true;
    const started: ManagedAgentEvent = {
      type: 'started',
      providerSessionId: init.data.session_id,
      model: init.data.model,
    };
    return { events: [started], result: null };
  }

  const assistant = AssistantSchema.safeParse(message);
  if (assistant.success) return { events: assistantEvents(assistant.data, spec), result: null };

  const result = ResultSchema.safeParse(message);
  if (result.success) {
    const r = result.data;
    const outcome = r.subtype === 'success' && !r.is_error ? 'success' : 'error';
    const zeroOnError = outcome === 'error' && r.total_cost_usd === 0;
    return {
      events: [],
      result: {
        outcome,
        costUsd: zeroOnError ? null : r.total_cost_usd,
        queuedTurns: r.queued_turn_count ?? null,
      },
    };
  }
  return NOTHING;
}

function assistantEvents(
  a: z.infer<typeof AssistantSchema>,
  spec: Pick<ManagedAgentSpec, 'kind' | 'cwd'>,
): ManagedAgentEvent[] {
  const events: ManagedAgentEvent[] = [];
  // Lead text goes to the owner's chat (ADR-0015); subagent frames (`parent_tool_use_id` set) are
  // not the lead talking to the owner, and worker text is never emitted at all.
  const leadMainThread = emitsChatText(spec.kind) && a.parent_tool_use_id === null;
  for (const block of a.message.content) {
    const toolUse = ToolUseBlockSchema.safeParse(block);
    if (toolUse.success) {
      events.push({
        type: 'activity',
        summary: summarizeToolUse(toolUse.data.name, toolUse.data.input, spec.cwd),
      });
      continue;
    }
    if (!leadMainThread) continue;
    const textBlock = TextBlockSchema.safeParse(block);
    if (textBlock.success && textBlock.data.text.trim().length > 0) {
      events.push({ type: 'lead-text', text: textBlock.data.text });
    }
  }
  // Streamed frames of one API message share its id and carry growing, non-final usage; each is
  // reported and the engine keeps one per id (usage-accounting §4).
  const usage = a.message.usage;
  if (a.message.id !== null && usage !== null) {
    events.push({
      type: 'usage',
      messageId: a.message.id,
      tokens: {
        input: usage.input_tokens,
        output: usage.output_tokens,
        cacheCreation: usage.cache_creation_input_tokens,
        cacheRead: usage.cache_read_input_tokens,
      },
    });
  }
  return events;
}
