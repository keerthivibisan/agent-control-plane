import { describe, expect, it } from 'vitest';
import { CodexRpcError, CodexTransportClosedError, JsonRpcClient } from '../src/transport.js';
import type { ServerRequestReply } from '../src/transport.js';
import { FakeAppServer, settle } from './helpers/fake-app-server.js';

/* Synthetic JSON-RPC traffic against the in-memory fake; no real Codex. */

function client(server: FakeAppServer) {
  const notes: { method: string; params: unknown }[] = [];
  const rpc = new JsonRpcClient(server, {
    onNotification: (method, params) => notes.push({ method, params }),
    onRequest: (method): Promise<ServerRequestReply> =>
      Promise.resolve(
        method === 'ping' ? { result: { pong: true } } : { error: { code: -32601, message: 'no' } },
      ),
  });
  return { rpc, notes };
}

describe('JSONL framing', () => {
  it('joins split chunks, handles several lines in one chunk and skips blank lines', async () => {
    const server = new FakeAppServer();
    const { notes } = client(server);
    server.raw('{"jsonrpc":"2.0","method":"a/b",');
    server.raw(
      '"params":{"n":1}}\n\n   \n{"jsonrpc":"2.0","method":"c/d","params":{}}\n{"jsonrpc"',
    );
    server.raw(':"2.0","method":"e/f"}\n');
    await settle();
    expect(notes.map((n) => n.method)).toEqual(['a/b', 'c/d', 'e/f']);
    expect(notes[0]?.params).toEqual({ n: 1 });
  });

  it('counts and skips a garbage line without throwing', async () => {
    const server = new FakeAppServer();
    const { rpc, notes } = client(server);
    server.raw('not json at all\n[1,2]\n{"jsonrpc":"2.0","method":"ok/now","params":{}}\n');
    await settle();
    expect(rpc.badLines).toBe(2);
    expect(notes.map((n) => n.method)).toEqual(['ok/now']);
  });

  it('reads a final line that has no newline once the stream ends', async () => {
    const server = new FakeAppServer();
    const { notes } = client(server);
    server.raw('{"jsonrpc":"2.0","method":"last/one","params":{}}');
    server.exit({ code: 0, signal: null, spawnError: null });
    await settle();
    expect(notes.map((n) => n.method)).toEqual(['last/one']);
  });
});

describe('requests', () => {
  it('correlates answers by id, even out of order', async () => {
    const server = new FakeAppServer();
    let release: (value: unknown) => void = () => undefined;
    server.handlers['slow'] = () => new Promise((resolve) => (release = resolve));
    server.handlers['fast'] = () => 'fast-result';
    const { rpc } = client(server);
    const slow = rpc.request('slow', {});
    const fast = rpc.request('fast', {});
    await expect(fast).resolves.toBe('fast-result');
    release('slow-result');
    await expect(slow).resolves.toBe('slow-result');
    const ids = server.sent.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('rejects with CodexRpcError on an error answer', async () => {
    const server = new FakeAppServer();
    const { rpc } = client(server);
    await expect(rpc.request('no/such', {})).rejects.toBeInstanceOf(CodexRpcError);
  });

  it('rejects every pending request when the process exits, and later requests at once', async () => {
    const server = new FakeAppServer();
    server.handlers['hang'] = () => new Promise(() => undefined);
    const { rpc } = client(server);
    const a = rpc.request('hang', {});
    const b = rpc.request('hang', {});
    server.exit({ code: 1, signal: null, spawnError: null });
    await expect(a).rejects.toBeInstanceOf(CodexTransportClosedError);
    await expect(b).rejects.toBeInstanceOf(CodexTransportClosedError);
    await expect(rpc.request('initialize', {})).rejects.toBeInstanceOf(CodexTransportClosedError);
    expect(rpc.isClosed).toBe(true);
  });

  it('answers server requests with the handler reply, keeping the server id', async () => {
    const server = new FakeAppServer();
    client(server);
    await expect(server.request('ping', {})).resolves.toMatchObject({ result: { pong: true } });
    await expect(server.request('other', {})).resolves.toMatchObject({
      error: { code: -32601 },
    });
  });

  it('sends notifications without an id', () => {
    const server = new FakeAppServer();
    const { rpc } = client(server);
    rpc.notify('initialized');
    expect(server.sent).toEqual([{ jsonrpc: '2.0', method: 'initialized' }]);
  });
});
