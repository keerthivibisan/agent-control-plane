import type {
  ManagedAgentEvent,
  ManagedAgentSpec,
  ManagedCallbacks,
  PermissionRequest,
} from '@acp/core';
import type * as Sdk from '@anthropic-ai/claude-agent-sdk';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { createManagedClaudeCode, ManagedAgentEndedError } from '../../src/index.js';
import { assistant, fakeQuery, idle, init, result, SESSION_ID } from './fake-query.js';
import type { FakeContext } from './fake-query.js';

// The real SDK `query` must never run in tests: replace it with a spy that fails loudly.
const realQuery = vi.hoisted(() => {
  const spy = {
    calls: 0,
    fn: (): never => {
      spy.calls += 1;
      throw new Error('the real Agent SDK query() was called');
    },
  };
  return spy;
});
vi.mock('@anthropic-ai/claude-agent-sdk', async (importOriginal) => ({
  ...(await importOriginal<typeof Sdk>()),
  query: realQuery.fn,
}));

const CWD = '/work/acp/worktrees/run-1/agent-1';
const SECRET = 'TOP-SECRET-WORKER-TEXT';

function spec(kind: 'lead' | 'worker', extra: Partial<ManagedAgentSpec> = {}): ManagedAgentSpec {
  return {
    agentRunId: `agent-${kind}`,
    kind,
    cwd: CWD,
    prompt: 'First task',
    model: null,
    ...(kind === 'lead' ? { leadTools: () => Promise.resolve('ok') } : {}),
    ...extra,
  };
}

function callbacks(
  decide: (
    r: PermissionRequest,
  ) => Promise<{ allow: true } | { allow: false; message: string }> = () =>
    Promise.resolve({ allow: true }),
): ManagedCallbacks & { requests: PermissionRequest[] } {
  const requests: PermissionRequest[] = [];
  return {
    requests,
    requestPermission(r) {
      requests.push(r);
      return decide(r);
    },
  };
}

async function collect(events: AsyncIterable<ManagedAgentEvent>): Promise<ManagedAgentEvent[]> {
  const out: ManagedAgentEvent[] = [];
  for await (const e of events) out.push(e);
  return out;
}

afterAll(() => {
  // Only the "default query" test reaches it, and there it is the mock above.
  expect(realQuery.calls).toBe(1);
});

describe('P3-B createManagedClaudeCode: SDK options (ADR-0012, ADR-0013)', () => {
  it('passes cwd, default permissions, project settings only, strict MCP and an abort controller', async () => {
    const { query, calls } = fakeQuery(async function* (ctx) {
      await ctx.nextInput();
      yield result();
    });
    const handle = createManagedClaudeCode({ query }).start(spec('worker'), callbacks());
    await collect(handle.events);
    const options = calls[0]?.options;
    expect(options?.cwd).toBe(CWD);
    expect(options?.permissionMode).toBe('default');
    expect(options?.settingSources).toEqual([]);
    expect(options?.strictMcpConfig).toBe(true);
    expect(options?.abortController).toBeInstanceOf(AbortController);
    expect(typeof options?.canUseTool).toBe('function');
    expect(options?.allowDangerouslySkipPermissions).toBeUndefined();
    expect(options?.allowedTools).toBeUndefined();
    expect(options).not.toHaveProperty('model');
  });

  it('never uses bypassPermissions for either kind', () => {
    for (const kind of ['lead', 'worker'] as const) {
      const { query, calls } = fakeQuery(async function* (ctx) {
        await idle(ctx);
        yield* [];
      });
      const handle = createManagedClaudeCode({ query }).start(spec(kind), callbacks());
      handle.abort();
      expect(calls[0]?.options.permissionMode).not.toBe('bypassPermissions');
      expect(calls[0]?.options.permissionMode).toBe('default');
    }
  });

  it('passes the given environment as the SDK env option, as a copy (ADR-0012)', async () => {
    const { query, calls } = fakeQuery(async function* (ctx) {
      await ctx.nextInput();
      yield result();
    });
    const env: Record<string, string> = { PATH: '/usr/bin', HOME: '/home/tester' };
    const handle = createManagedClaudeCode({ query, env }).start(spec('worker'), callbacks());
    env['ACP_HOOK_TOKEN'] = 'added-after-start';
    await collect(handle.events);
    expect(calls[0]?.options.env).toEqual({ PATH: '/usr/bin', HOME: '/home/tester' });
  });

  it('leaves the SDK env option unset when no environment is given', async () => {
    const { query, calls } = fakeQuery(async function* (ctx) {
      await ctx.nextInput();
      yield result();
    });
    await collect(createManagedClaudeCode({ query }).start(spec('worker'), callbacks()).events);
    expect(calls[0]?.options).not.toHaveProperty('env');
  });

  it('passes the resolved model when one is given', async () => {
    const { query, calls } = fakeQuery(async function* (ctx) {
      await ctx.nextInput();
      yield result();
    });
    const handle = createManagedClaudeCode({ query }).start(
      spec('worker', { model: 'claude-x' }),
      callbacks(),
    );
    await collect(handle.events);
    expect(calls[0]?.options.model).toBe('claude-x');
  });

  it('gives the lead exactly one in-process MCP server, "acp"', () => {
    const { query, calls } = fakeQuery(async function* (ctx) {
      await idle(ctx);
      yield* [];
    });
    const handle = createManagedClaudeCode({ query }).start(spec('lead'), callbacks());
    const servers = calls[0]?.options.mcpServers ?? {};
    expect(Object.keys(servers)).toEqual(['acp']);
    expect(servers['acp']).toMatchObject({ type: 'sdk', name: 'acp' });
    handle.abort();
  });

  it('never gives a worker the lead tools, even when a handler is passed by mistake', async () => {
    const { query, calls } = fakeQuery(async function* (ctx) {
      await ctx.nextInput();
      yield result();
    });
    const handle = createManagedClaudeCode({ query }).start(
      spec('worker', { leadTools: () => Promise.resolve('nope') }),
      callbacks(),
    );
    await collect(handle.events);
    expect(calls[0]?.options.mcpServers).toEqual({});
  });

  it('uses the SDK query by default (mocked here)', () => {
    const adapter = createManagedClaudeCode();
    expect(adapter.provider).toBe('claude-code');
    expect(() => adapter.start(spec('worker'), callbacks())).toThrow('real Agent SDK');
  });
});

describe('P3-B message mapping', () => {
  it('sends the prompt as the first streamed user message', async () => {
    const { query, calls } = fakeQuery(async function* (ctx) {
      await ctx.nextInput();
      yield result();
    });
    await collect(createManagedClaudeCode({ query }).start(spec('worker'), callbacks()).events);
    expect(calls[0]?.inputs).toEqual(['First task']);
  });

  it('emits started once from the init message, with the session id and model', async () => {
    const { query } = fakeQuery(async function* (ctx) {
      await ctx.nextInput();
      yield init('claude-a');
      yield init('claude-b');
      yield result();
    });
    const events = await collect(
      createManagedClaudeCode({ query }).start(spec('worker'), callbacks()).events,
    );
    expect(events.filter((e) => e.type === 'started')).toEqual([
      { type: 'started', providerSessionId: SESSION_ID, model: 'claude-a' },
    ]);
  });

  it('emits content-free activity for tool uses (tool name and target only)', async () => {
    const { query } = fakeQuery(async function* (ctx) {
      await ctx.nextInput();
      yield assistant('m1', [
        { type: 'thinking', thinking: SECRET },
        {
          type: 'tool_use',
          id: 't1',
          name: 'Edit',
          input: { file_path: `${CWD}/src/app.ts`, old_string: SECRET, new_string: SECRET },
        },
        {
          type: 'tool_use',
          id: 't2',
          name: 'Bash',
          input: { command: `API_KEY=${SECRET} git commit -m "${SECRET}"` },
        },
        { type: 'tool_use', id: 't3', name: 'WebFetch', input: { url: `https://x/${SECRET}` } },
      ]);
      yield result();
    });
    const events = await collect(
      createManagedClaudeCode({ query }).start(spec('worker'), callbacks()).events,
    );
    expect(events.filter((e) => e.type === 'activity')).toEqual([
      { type: 'activity', summary: 'Edit src/app.ts' },
      { type: 'activity', summary: 'Bash git' },
      { type: 'activity', summary: 'WebFetch' },
    ]);
    expect(JSON.stringify(events)).not.toContain(SECRET);
  });

  it('emits usage per assistant message id; missing categories are null, never 0', async () => {
    const { query } = fakeQuery(async function* (ctx) {
      await ctx.nextInput();
      yield assistant('m1', [], { input_tokens: 3, output_tokens: 1 });
      yield assistant('m1', [], {
        input_tokens: 3,
        output_tokens: 9,
        cache_creation_input_tokens: 100,
        cache_read_input_tokens: 2000,
      });
      yield assistant('m2', [], null);
      yield result();
    });
    const events = await collect(
      createManagedClaudeCode({ query }).start(spec('worker'), callbacks()).events,
    );
    expect(events.filter((e) => e.type === 'usage')).toEqual([
      {
        type: 'usage',
        messageId: 'm1',
        tokens: { input: 3, output: 1, cacheCreation: null, cacheRead: null },
      },
      {
        type: 'usage',
        messageId: 'm1',
        tokens: { input: 3, output: 9, cacheCreation: 100, cacheRead: 2000 },
      },
    ]);
  });

  it('never emits worker text, thinking, or result text', async () => {
    const { query } = fakeQuery(async function* (ctx) {
      await ctx.nextInput();
      yield assistant('m1', [{ type: 'text', text: SECRET }]);
      yield { type: 'user', message: { role: 'user', content: SECRET }, parent_tool_use_id: null };
      yield result();
    });
    const events = await collect(
      createManagedClaudeCode({ query }).start(spec('worker'), callbacks()).events,
    );
    expect(events.some((e) => e.type === 'lead-text')).toBe(false);
    expect(JSON.stringify(events)).not.toContain(SECRET);
    expect(JSON.stringify(events)).not.toContain('SECRET RESULT TEXT');
  });

  it("emits the lead's main-thread text, but not its subagents' text", async () => {
    const { query } = fakeQuery(async function* (ctx) {
      await ctx.nextInput();
      yield assistant('m1', [{ type: 'text', text: 'Starting two agents.' }]);
      yield assistant('m2', [{ type: 'text', text: SECRET }], null, 'toolu_parent');
      yield assistant('m3', [{ type: 'text', text: '   ' }]);
      yield result();
      await idle(ctx);
    });
    const handle = createManagedClaudeCode({ query }).start(spec('lead'), callbacks());
    const seen: ManagedAgentEvent[] = [];
    for await (const e of handle.events) {
      seen.push(e);
      if (e.type === 'lead-text') handle.abort();
    }
    expect(seen.filter((e) => e.type === 'lead-text')).toEqual([
      { type: 'lead-text', text: 'Starting two agents.' },
    ]);
    expect(JSON.stringify(seen)).not.toContain(SECRET);
  });

  it('ignores malformed and unknown messages', async () => {
    const { query } = fakeQuery(async function* (ctx) {
      await ctx.nextInput();
      yield null;
      yield 'text';
      yield { type: 'stream_event', event: { delta: SECRET } };
      yield { type: 'system', subtype: 'init' };
      yield { type: 'assistant', message: 'bad' };
      yield result();
    });
    const events = await collect(
      createManagedClaudeCode({ query }).start(spec('worker'), callbacks()).events,
    );
    expect(events).toEqual([{ type: 'finished', outcome: 'success', reportedCostUsd: 0.25 }]);
  });
});

describe('P3-B lifecycle: finished, send, interrupt, abort', () => {
  it('ends a worker after a turn with nothing queued; send then rejects', async () => {
    const { query } = fakeQuery(async function* (ctx) {
      await ctx.nextInput();
      yield init();
      yield result({ total_cost_usd: 0.5, queued_turn_count: 0 });
      await idle(ctx); // returns once the adapter closes the input
    });
    const handle = createManagedClaudeCode({ query }).start(spec('worker'), callbacks());
    const events = await collect(handle.events);
    expect(events.at(-1)).toEqual({ type: 'finished', outcome: 'success', reportedCostUsd: 0.5 });
    await expect(handle.send('more')).rejects.toBeInstanceOf(ManagedAgentEndedError);
  });

  it('keeps a worker running while sends are queued behind the turn', async () => {
    const { query, calls } = fakeQuery(async function* (ctx) {
      await ctx.nextInput();
      yield result({ queued_turn_count: 1, total_cost_usd: 0.1 });
      await ctx.nextInput();
      yield result({ queued_turn_count: 0, total_cost_usd: 0.3 });
      await idle(ctx);
    });
    const handle = createManagedClaudeCode({ query }).start(spec('worker'), callbacks());
    await handle.send('Also add tests');
    const events = await collect(handle.events);
    expect(calls[0]?.inputs).toEqual(['First task', 'Also add tests']);
    // The cost is the latest running total, never a sum of results.
    expect(events.at(-1)).toEqual({ type: 'finished', outcome: 'success', reportedCostUsd: 0.3 });
  });

  it("keeps the lead's input open across turns and delivers chat messages", async () => {
    let seenSecondTurn: (() => void) | undefined;
    const secondTurn = new Promise<void>((resolve) => (seenSecondTurn = resolve));
    const { query, calls } = fakeQuery(async function* (ctx: FakeContext) {
      await ctx.nextInput();
      yield result();
      await ctx.nextInput();
      seenSecondTurn?.();
      yield result();
      await idle(ctx);
    });
    const handle = createManagedClaudeCode({ query }).start(spec('lead'), callbacks());
    await handle.send('Spin up two agents');
    await secondTurn;
    expect(calls[0]?.inputs).toEqual(['First task', 'Spin up two agents']);
    handle.abort();
    const events = await collect(handle.events);
    expect(events.at(-1)).toEqual({
      type: 'finished',
      outcome: 'cancelled',
      reportedCostUsd: 0.25,
    });
  });

  it('abort ends the iterator, signals the SDK, closes the query, and is idempotent', async () => {
    const { query, calls } = fakeQuery(async function* (ctx) {
      await idle(ctx);
      yield* [];
    });
    const handle = createManagedClaudeCode({ query }).start(spec('worker'), callbacks());
    handle.abort();
    handle.abort();
    const events = await collect(handle.events);
    expect(events).toEqual([{ type: 'finished', outcome: 'cancelled', reportedCostUsd: null }]);
    expect(calls[0]?.options.abortController?.signal.aborted).toBe(true);
    expect(calls[0]?.closed).toBe(true);
    await expect(handle.send('late')).rejects.toBeInstanceOf(ManagedAgentEndedError);
  });

  it('interrupt calls the SDK interrupt and keeps the agent', async () => {
    const { query, calls } = fakeQuery(async function* (ctx) {
      await idle(ctx);
      yield* [];
    });
    const handle = createManagedClaudeCode({ query }).start(spec('lead'), callbacks());
    await handle.interrupt();
    expect(calls[0]?.interrupts).toBe(1);
    await handle.send('still here');
    handle.abort();
    await handle.interrupt(); // no-op once ended
    expect(calls[0]?.interrupts).toBe(1);
  });

  it('reports an SDK failure as an error, with no message text', async () => {
    const { query } = fakeQuery(async function* (ctx) {
      await ctx.nextInput();
      yield init();
      throw new Error(SECRET);
    });
    const events = await collect(
      createManagedClaudeCode({ query }).start(spec('worker'), callbacks()).events,
    );
    expect(events.at(-1)).toEqual({ type: 'finished', outcome: 'error', reportedCostUsd: null });
    expect(JSON.stringify(events)).not.toContain(SECRET);
  });

  it('maps error results to error; a zero cost on an error result is unavailable', async () => {
    const { query } = fakeQuery(async function* (ctx) {
      await ctx.nextInput();
      yield result({ subtype: 'error_during_execution', is_error: true, total_cost_usd: 0 });
    });
    const events = await collect(
      createManagedClaudeCode({ query }).start(spec('worker'), callbacks()).events,
    );
    expect(events).toEqual([{ type: 'finished', outcome: 'error', reportedCostUsd: null }]);
  });

  it('maps an is_error success result to error and keeps a non-zero cost', async () => {
    const { query } = fakeQuery(async function* (ctx) {
      await ctx.nextInput();
      yield result({ is_error: true, total_cost_usd: 0.07 });
    });
    const events = await collect(
      createManagedClaudeCode({ query }).start(spec('worker'), callbacks()).events,
    );
    expect(events).toEqual([{ type: 'finished', outcome: 'error', reportedCostUsd: 0.07 }]);
  });

  it('treats a stream that ends without any result as an error', async () => {
    const { query } = fakeQuery(async function* (ctx) {
      await ctx.nextInput();
      yield init();
    });
    const events = await collect(
      createManagedClaudeCode({ query }).start(spec('worker'), callbacks()).events,
    );
    expect(events.at(-1)).toEqual({ type: 'finished', outcome: 'error', reportedCostUsd: null });
  });
});
