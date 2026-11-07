import { mkdirSync, mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { ManagedAgentEvent, ManagedAgentSpec } from '@acp/core';
import { AsyncQueue } from '../../src/queue.js';
import type { CodexExit, CodexTransport } from '../../src/transport.js';

/*
 * SYNTHETIC test double: a scripted, in-memory `codex app-server` (CLI 0.166.0 message shapes from
 * docs/research/codex-app-server-2026-11-07.md). No real Codex process, account or data is used;
 * every id, model name and count below is made up.
 */

export interface RpcMessage {
  jsonrpc?: string;
  id?: number | string;
  method?: string;
  params?: Record<string, unknown>;
  result?: unknown;
  error?: { code: number; message: string };
}

/** A request handler: returns the result, or throws `{ code, message }` for an error answer. */
export type Handler = (params: Record<string, unknown>, server: FakeAppServer) => unknown;

export class RpcFailure extends Error {
  constructor(
    readonly code: number,
    message: string,
  ) {
    super(message);
  }
}

export class FakeAppServer implements CodexTransport {
  readonly incoming = new AsyncQueue<string>();
  readonly sent: RpcMessage[] = [];
  readonly exited: Promise<CodexExit>;
  closed = false;
  private resolveExit: (exit: CodexExit) => void = () => undefined;
  private turnCount = 0;
  private serverRequestId = 0;
  private readonly replies = new Map<string, (message: RpcMessage) => void>();
  readonly handlers: Record<string, Handler> = {
    initialize: () => ({ userAgent: 'fake-codex/0.0.0' }),
    'account/read': () => ({ account: { type: 'chatgpt', email: null }, requiresOpenaiAuth: true }),
    'thread/start': () => ({ thread: { id: 'thr-synthetic' }, model: 'model-synthetic' }),
    'thread/resume': (params) => ({ thread: { id: params['threadId'] }, model: 'model-synthetic' }),
    'turn/start': () => {
      this.turnCount += 1;
      return { turn: { id: `turn-${this.turnCount}`, status: 'inProgress' } };
    },
    'turn/steer': (params) => ({ turnId: params['expectedTurnId'] }),
    'turn/interrupt': () => ({}),
  };

  constructor() {
    this.exited = new Promise((resolve) => {
      this.resolveExit = resolve;
    });
  }

  send(line: string): void {
    if (this.closed) return;
    const message = JSON.parse(line) as RpcMessage;
    this.sent.push(message);
    if (message.method !== undefined && message.id !== undefined) {
      void this.answer(message);
    } else if (message.id !== undefined && message.method === undefined) {
      const reply = this.replies.get(String(message.id));
      this.replies.delete(String(message.id));
      reply?.(message);
    }
  }

  private async answer(message: RpcMessage): Promise<void> {
    const handler = this.handlers[message.method ?? ''];
    if (handler === undefined) {
      this.write({ jsonrpc: '2.0', id: message.id, error: { code: -32601, message: 'unknown' } });
      return;
    }
    try {
      const result: unknown = await handler(message.params ?? {}, this);
      this.write({ jsonrpc: '2.0', id: message.id, result });
    } catch (error) {
      const failure = error instanceof RpcFailure ? error : new RpcFailure(-32000, 'failed');
      this.write({
        jsonrpc: '2.0',
        id: message.id,
        error: { code: failure.code, message: failure.message },
      });
    }
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.exit({ code: 0, signal: null, spawnError: null });
  }

  /** The process ends (or never started). */
  exit(exit: CodexExit): void {
    this.incoming.close();
    this.resolveExit(exit);
  }

  write(message: object): void {
    this.incoming.push(`${JSON.stringify(message)}\n`);
  }

  raw(chunk: string): void {
    this.incoming.push(chunk);
  }

  notify(method: string, params: object): void {
    this.write({ jsonrpc: '2.0', method, params });
  }

  /** A server → client request; resolves with the client's answer. */
  request(method: string, params: object): Promise<RpcMessage> {
    this.serverRequestId += 1;
    const id = `srv-${this.serverRequestId}`;
    return new Promise((resolve) => {
      this.replies.set(id, resolve);
      this.write({ jsonrpc: '2.0', id, method, params });
    });
  }

  /** The requests the client sent with this method, in order. */
  requests(method: string): RpcMessage[] {
    return this.sent.filter((m) => m.method === method && m.id !== undefined);
  }

  completeTurn(turnId: string, status = 'completed'): void {
    this.notify('turn/completed', { threadId: 'thr-synthetic', turn: { id: turnId, status } });
  }
}

/** Resolves after pending promise callbacks and queued I/O callbacks have run. */
export async function settle(rounds = 5): Promise<void> {
  for (let i = 0; i < rounds; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
}

/** Reads every event until `finished`. */
export async function collect(
  events: AsyncIterable<ManagedAgentEvent>,
): Promise<ManagedAgentEvent[]> {
  const out: ManagedAgentEvent[] = [];
  for await (const event of events) out.push(event);
  return out;
}

/** Collects events in the background; `seen` grows as they arrive. */
export function watch(events: AsyncIterable<ManagedAgentEvent>): {
  seen: ManagedAgentEvent[];
  done: Promise<void>;
} {
  const seen: ManagedAgentEvent[] = [];
  const done = (async () => {
    for await (const event of events) seen.push(event);
  })();
  return { seen, done };
}

/** A temp folder holding a plain `.git` directory (a main checkout). */
export function tempRepo(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'acp-codex-test-'));
  mkdirSync(path.join(dir, '.git'));
  return dir;
}

export function makeSpec(overrides: Partial<ManagedAgentSpec> = {}): ManagedAgentSpec {
  return {
    agentRunId: 'run-agent-1',
    kind: 'lead',
    cwd: '/synthetic/project',
    prompt: 'Synthetic task.',
    model: null,
    ...overrides,
  };
}
