import { spawn as spawnChild } from 'node:child_process';
import { z } from 'zod';
import { codexArgs } from './config.js';
import { AsyncQueue } from './queue.js';

/**
 * The stdio link to one `codex app-server` process (JSON-RPC 2.0, one JSON message per line; CLI
 * 0.166.0, docs/research/codex-app-server-2026-11-07.md). Injectable, so tests drive a scripted
 * fake and never the real `codex` (ADR-0031 §3).
 */
export interface CodexTransport {
  /** Writes one JSON message; the transport adds the newline. A write after close is dropped. */
  send(line: string): void;
  /** Raw stdout text in arbitrary chunks (not lines: `JsonRpcClient` frames them). */
  readonly incoming: AsyncIterable<string>;
  /** Ends stdin and stops the process. Idempotent. */
  close(): void;
  /** Settles once, when the process has exited or could not start. Never rejects. */
  readonly exited: Promise<CodexExit>;
  /** Bytes the process wrote to stderr, for diagnostics; the text itself is never kept. */
  readonly stderrBytes?: number;
}

export interface CodexExit {
  code: number | null;
  signal: string | null;
  /** Why the process never ran: `not-found` is ENOENT (Codex is not installed). */
  spawnError: 'not-found' | 'failed' | null;
}

export interface SpawnCodexOptions {
  bin?: string;
  cwd: string;
  /** The complete environment (`codexEnv`); nothing else is inherited. */
  env: Readonly<Record<string, string>>;
}

export type SpawnCodex = (options: SpawnCodexOptions) => CodexTransport;

/**
 * Spawns `codex app-server` as an argument array with no shell (ADR-0013, AGENTS.md §3 rule 8).
 * Stderr is drained and only its size is counted: it may quote model or tool output (ADR-0009).
 */
export function spawnCodexAppServer(options: SpawnCodexOptions): CodexTransport {
  const incoming = new AsyncQueue<string>();
  let settle: (exit: CodexExit) => void = () => undefined;
  const exited = new Promise<CodexExit>((resolve) => {
    let done = false;
    settle = (exit) => {
      if (done) return;
      done = true;
      incoming.close();
      resolve(exit);
    };
  });
  const child = spawnChild(options.bin ?? 'codex', codexArgs(), {
    cwd: options.cwd,
    env: { ...options.env },
    stdio: 'pipe',
    shell: false,
  });
  let stderrBytes = 0;
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk: string) => incoming.push(chunk));
  child.stderr.on('data', (chunk: Buffer) => {
    stderrBytes += chunk.length;
  });
  // A write to a process that already exited raises EPIPE here; the exit itself is reported.
  child.stdin.on('error', () => undefined);
  child.on('error', (error: NodeJS.ErrnoException) => {
    settle({
      code: null,
      signal: null,
      spawnError: error.code === 'ENOENT' ? 'not-found' : 'failed',
    });
  });
  child.on('exit', (code, signal) => settle({ code, signal, spawnError: null }));
  let closed = false;
  return {
    send(line) {
      if (closed || child.stdin.destroyed) return;
      child.stdin.write(`${line}\n`);
    },
    incoming,
    close() {
      if (closed) return;
      closed = true;
      child.stdin.end();
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
    },
    exited,
    get stderrBytes() {
      return stderrBytes;
    },
  };
}

/** A JSON-RPC error answer from the app-server. Its message is never logged (it may quote input). */
export class CodexRpcError extends Error {
  readonly code: number;
  constructor(method: string, code: number, message: string) {
    super(`${method} failed (${code}): ${message}`);
    this.name = 'CodexRpcError';
    this.code = code;
  }
}

/** A request that can no longer be answered: the app-server exited or the link was closed. */
export class CodexTransportClosedError extends Error {
  readonly exit: CodexExit | null;
  constructor(method: string, exit: CodexExit | null) {
    super(`${method}: the Codex app-server is no longer running`);
    this.name = 'CodexTransportClosedError';
    this.exit = exit;
  }
}

/** How the client answers a request the server sends (an approval, a dynamic tool call). */
export type ServerRequestReply = { result: unknown } | { error: { code: number; message: string } };

export interface JsonRpcHandlers {
  onNotification(method: string, params: unknown): void;
  /** Must resolve; a throw is answered with a JSON-RPC error. */
  onRequest(method: string, params: unknown): Promise<ServerRequestReply>;
}

const IdSchema = z.union([z.number(), z.string()]);
/** Every message the server sends, read loosely; the method's own schema reads `params`. */
const MessageSchema = z.looseObject({
  id: IdSchema.optional(),
  method: z.string().min(1).optional(),
  params: z.unknown().optional(),
  result: z.unknown().optional(),
  error: z.looseObject({ code: z.number(), message: z.string().catch('') }).optional(),
});

interface Pending {
  method: string;
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
}

/**
 * JSON-RPC over a `CodexTransport`: request ids and answers, the server's own requests, and
 * notifications. Stdout is framed into lines whatever the chunking; blank lines are skipped, and a
 * line that is not a JSON-RPC message is counted (`badLines`) and skipped, never thrown. When the
 * process exits every pending request rejects with `CodexTransportClosedError`.
 */
export class JsonRpcClient {
  private nextId = 1;
  private readonly pending = new Map<number, Pending>();
  private exit: CodexExit | null = null;
  private ended = false;
  /** Lines that were not JSON-RPC messages; counted, never logged. */
  badLines = 0;
  /** Settles when the process has exited (or never started). */
  readonly closed: Promise<CodexExit>;

  constructor(
    private readonly transport: CodexTransport,
    private readonly handlers: JsonRpcHandlers,
  ) {
    void this.read();
    this.closed = transport.exited.then((exit) => {
      this.exit = exit;
      this.ended = true;
      for (const [id, p] of this.pending) {
        this.pending.delete(id);
        p.reject(new CodexTransportClosedError(p.method, exit));
      }
      return exit;
    });
  }

  /** True once the process has exited. */
  get isClosed(): boolean {
    return this.ended;
  }

  request(method: string, params: unknown): Promise<unknown> {
    if (this.ended) return Promise.reject(new CodexTransportClosedError(method, this.exit));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { method, resolve, reject });
      this.write({ jsonrpc: '2.0', id, method, params });
    });
  }

  notify(method: string, params?: unknown): void {
    if (this.ended) return;
    this.write(
      params === undefined ? { jsonrpc: '2.0', method } : { jsonrpc: '2.0', method, params },
    );
  }

  private write(message: object): void {
    this.transport.send(JSON.stringify(message));
  }

  private async read(): Promise<void> {
    let buffer = '';
    for await (const chunk of this.transport.incoming) {
      buffer += chunk;
      let newline = buffer.indexOf('\n');
      while (newline >= 0) {
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        this.dispatch(line);
        newline = buffer.indexOf('\n');
      }
    }
    // A final line without a newline is still a message.
    if (buffer.trim() !== '') this.dispatch(buffer);
  }

  private dispatch(line: string): void {
    if (line.trim() === '') return;
    let raw: unknown;
    try {
      raw = JSON.parse(line);
    } catch {
      this.badLines += 1;
      return;
    }
    const parsed = MessageSchema.safeParse(raw);
    if (!parsed.success) {
      this.badLines += 1;
      return;
    }
    const m = parsed.data;
    if (m.method !== undefined && m.id !== undefined) {
      void this.answer(m.id, m.method, m.params);
      return;
    }
    if (m.method !== undefined) {
      this.handlers.onNotification(m.method, m.params);
      return;
    }
    if (typeof m.id !== 'number') {
      this.badLines += 1;
      return;
    }
    const p = this.pending.get(m.id);
    if (p === undefined) return;
    this.pending.delete(m.id);
    if (m.error !== undefined) p.reject(new CodexRpcError(p.method, m.error.code, m.error.message));
    else p.resolve(m.result ?? null);
  }

  private async answer(id: string | number, method: string, params: unknown): Promise<void> {
    let reply: ServerRequestReply;
    try {
      reply = await this.handlers.onRequest(method, params);
    } catch {
      reply = { error: { code: -32603, message: 'The control plane could not answer.' } };
    }
    if (this.ended) return;
    this.write({ jsonrpc: '2.0', id, ...reply });
  }
}
