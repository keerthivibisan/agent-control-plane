import type { Options, SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';
import type { ManagedQuery, ManagedQueryFn } from '../../src/managed/index.js';

/**
 * A scripted stand-in for the Agent SDK's `query()` (synthetic; never calls Claude). The script
 * receives a context to read the agent's streamed input and yields SDK-shaped messages. Every call
 * is recorded so tests can check the options the adapter passed.
 */
export interface FakeContext {
  options: Options;
  /** Next user message text from the streaming input, or null when the input was closed. */
  nextInput(): Promise<string | null>;
  /** Text of every user message read so far. */
  inputs: string[];
}

export interface FakeCall {
  options: Options;
  inputs: string[];
  interrupts: number;
  closed: boolean;
}

export type Script = (ctx: FakeContext) => AsyncGenerator<unknown, void, undefined>;

export function fakeQuery(script: Script): { query: ManagedQueryFn; calls: FakeCall[] } {
  const calls: FakeCall[] = [];
  const query: ManagedQueryFn = ({ prompt, options }) => {
    const iterator = prompt[Symbol.asyncIterator]();
    const call: FakeCall = { options, inputs: [], interrupts: 0, closed: false };
    calls.push(call);
    const ctx: FakeContext = {
      options,
      inputs: call.inputs,
      async nextInput() {
        const next = await iterator.next();
        if (next.done === true) return null;
        const text = textOf(next.value);
        call.inputs.push(text);
        return text;
      },
    };
    const generator = script(ctx);
    const signal = options.abortController?.signal;
    const q: ManagedQuery = {
      async *[Symbol.asyncIterator]() {
        for await (const message of generator) {
          if (signal?.aborted === true) throw new Error('aborted');
          yield message;
        }
      },
      interrupt() {
        call.interrupts += 1;
        return Promise.resolve(undefined);
      },
      close() {
        call.closed = true;
      },
    };
    return q;
  };
  return { query, calls };
}

function textOf(message: SDKUserMessage): string {
  const content = message.message.content;
  return typeof content === 'string' ? content : JSON.stringify(content);
}

export const SESSION_ID = 'c0ffee00-0000-4000-8000-0000000000aa';

export function init(model = 'claude-test-model'): unknown {
  return { type: 'system', subtype: 'init', session_id: SESSION_ID, model, cwd: '/x', tools: [] };
}

export function assistant(
  id: string,
  content: unknown[],
  usage: Record<string, number> | null = { input_tokens: 10, output_tokens: 5 },
  parentToolUseId: string | null = null,
): unknown {
  return {
    type: 'assistant',
    parent_tool_use_id: parentToolUseId,
    session_id: SESSION_ID,
    uuid: `u-${id}`,
    message: { id, role: 'assistant', model: 'claude-test-model', content, usage },
  };
}

export function result(
  extra: Partial<{
    subtype: string;
    is_error: boolean;
    total_cost_usd: number;
    queued_turn_count: number;
  }> = {},
): unknown {
  return {
    type: 'result',
    subtype: 'success',
    is_error: false,
    total_cost_usd: 0.25,
    result: 'SECRET RESULT TEXT',
    session_id: SESSION_ID,
    ...extra,
  };
}

/** Never resolves until the input closes: a session idling between turns. */
export async function idle(ctx: FakeContext): Promise<void> {
  while ((await ctx.nextInput()) !== null) {
    // keep reading
  }
}
