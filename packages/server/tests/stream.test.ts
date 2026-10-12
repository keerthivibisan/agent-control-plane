import type { AddressInfo } from 'node:net';
import type { Express } from 'express';
import { describe, expect, it } from 'vitest';
import { StreamNoticeDtoSchema } from '@acp/core/api';
import { at, batch, setupApp, tokens, usage } from './helpers.js';

/** Opens the SSE stream on a real socket and collects raw text. */
async function openStream(app: Express, headers: Record<string, string> = {}) {
  const server = app.listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  const port = (server.address() as AddressInfo).port;
  const controller = new AbortController();
  const res = await fetch(`http://127.0.0.1:${port}/api/events/stream`, {
    headers,
    signal: controller.signal,
  });
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let text = '';
  const pump = (async () => {
    try {
      for (;;) {
        const { done, value } = (await reader.read()) as { done: boolean; value?: Uint8Array };
        if (done) return;
        text += decoder.decode(value, { stream: true });
      }
    } catch {
      /* aborted */
    }
  })();
  return {
    res,
    text: () => text,
    waitFor: async (needle: string) => {
      for (let i = 0; i < 200 && !text.includes(needle); i++)
        await new Promise((r) => setTimeout(r, 10));
      expect(text).toContain(needle);
    },
    close: async () => {
      controller.abort();
      await pump;
      await new Promise((r) => server.close(r));
    },
  };
}

function notices(text: string) {
  return [...text.matchAll(/^data: (.+)$/gm)].map((m) =>
    StreamNoticeDtoSchema.parse(JSON.parse(m[1]!)),
  );
}

describe('SSE /api/events/stream', () => {
  it('sends a notice only after the batch is committed and visible', async () => {
    const s = await setupApp({ ingestDemo: false });
    const stream = await openStream(s.app);
    expect(stream.res.headers.get('content-type')).toContain('text/event-stream');

    // A failing batch is rolled back: no notice.
    expect(() =>
      s.pipeline.ingestBatch({
        ...batch('/a.jsonl', [usage({ dedupKey: 'u0' }, 'm0', tokens(1, 1))]),
        nextCheckpoint: { ...batch('/a.jsonl', []).nextCheckpoint, byteOffset: -1 },
      }),
    ).toThrow();

    let maxIdAtNotice: number | null = null;
    s.notifier.subscribe(() => (maxIdAtNotice = s.repos.events.maxId()));
    s.pipeline.ingestBatch(batch('/a.jsonl', [usage({ dedupKey: 'u1' }, 'm1', tokens(1, 1))]));
    await stream.waitFor('data: {');

    const received = notices(stream.text());
    expect(received).toHaveLength(1);
    expect(received[0]).toMatchObject({ kind: 'events-ingested', lastEventId: 1 });
    expect(maxIdAtNotice).toBe(1);
    expect(stream.text()).toContain('id: 1\n');
    await stream.close();
  });

  it('replays one catch-up notice for events after Last-Event-ID', async () => {
    const s = await setupApp({ ingestDemo: false });
    s.pipeline.ingestEvents([
      usage({ dedupKey: 'a', occurredAt: at(1) }, 'm1', tokens(1, 1)),
      usage({ dedupKey: 'b', occurredAt: at(2) }, 'm2', tokens(1, 1)),
      usage({ dedupKey: 'c', occurredAt: at(3) }, 'm3', tokens(1, 1)),
    ]);
    const stream = await openStream(s.app, { 'Last-Event-ID': '1' });
    await stream.waitFor('data: {');
    const received = notices(stream.text());
    expect(received).toHaveLength(1);
    expect(received[0]?.lastEventId).toBe(3);
    expect(received[0]?.sessionIds).toHaveLength(1);
    await stream.close();
  });

  it('sends heartbeats and unsubscribes when the client disconnects', async () => {
    const s = await setupApp({ ingestDemo: false });
    const stream = await openStream(s.app);
    await stream.waitFor(': heartbeat');
    expect(s.notifier.subscriberCount()).toBe(1);
    await stream.close();
    for (let i = 0; i < 100 && s.notifier.subscriberCount() > 0; i++)
      await new Promise((r) => setTimeout(r, 10));
    expect(s.notifier.subscriberCount()).toBe(0);
  });
});
