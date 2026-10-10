import { mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import type { NormalizedEvent, ObservationAdapter } from '@acp/core';
import { ErrorDtoSchema } from '@acp/core/api';
import { ensureHookToken, tokenMatches } from '../src/hooks/token.js';
import { envelope, setupApp } from './helpers.js';

const attention: NormalizedEvent = {
  ...envelope({ dedupKey: 'hook:attn', channel: 'hook', sessionId: 'hs-1' }),
  eventType: 'session.attention',
  payload: { notificationType: 'permission_prompt' },
};

function fakeAdapter(impl: (body: unknown) => NormalizedEvent[]): ObservationAdapter {
  return {
    provider: 'claude-code',
    capabilities: () => Promise.reject(new Error('unused')),
    discoverCandidates: () => Promise.resolve([]),
    poll: () => ({
      [Symbol.asyncIterator]: () => ({
        next: () => Promise.resolve({ done: true, value: undefined }),
      }),
    }),
    normalizeHook: impl,
    diagnostics: () => ({ fileIssues: [], ignoredRecords: {}, parseErrors: 0 }),
  };
}

const TOKEN = 'a'.repeat(64);

describe('POST /api/hooks/claude-code', () => {
  it('accepts an authenticated hook: 204 without a body, event stored, poll requested', async () => {
    const s = await setupApp({ ingestDemo: false, hookAdapter: fakeAdapter(() => [attention]) });
    const res = await request(s.app)
      .post('/api/hooks/claude-code')
      .set('X-ACP-Hook-Token', TOKEN)
      .send({ hook_event_name: 'Notification', session_id: 'hs-1' });
    expect(res.status).toBe(204);
    expect(res.text).toBe('');
    expect(s.hookState.receivedAny).toBe(true);
    expect(s.polls.length).toBe(1);
    const session = s.queries.listSessions().items[0];
    expect(session?.lastAttentionAt).not.toBeNull();
    // Hooks carry no provider time: the delivery time is the activity evidence.
    expect(session?.lastEventAt).not.toBeNull();
  });

  it('rejects a missing or wrong token with 401 and ingests nothing', async () => {
    const s = await setupApp({ ingestDemo: false, hookAdapter: fakeAdapter(() => [attention]) });
    for (const token of [undefined, 'wrong', 'a'.repeat(63)]) {
      const req = request(s.app).post('/api/hooks/claude-code');
      const res = await (token === undefined ? req : req.set('X-ACP-Hook-Token', token)).send({});
      expect(res.status).toBe(401);
      expect(ErrorDtoSchema.parse(res.body).error.code).toBe('unauthorized');
    }
    expect(s.repos.events.maxId()).toBeNull();
    expect(s.hookState.receivedAny).toBe(false);
  });

  it('rejects an oversize body with 413', async () => {
    const s = await setupApp({ ingestDemo: false, hookAdapter: fakeAdapter(() => []) });
    const res = await request(s.app)
      .post('/api/hooks/claude-code')
      .set('X-ACP-Hook-Token', TOKEN)
      .send({ pad: 'x'.repeat(300 * 1024) });
    expect(res.status).toBe(413);
    expect(ErrorDtoSchema.parse(res.body).error.code).toBe('payload_too_large');
  });

  it('answers 400 without echoing the payload when the adapter rejects it', async () => {
    const s = await setupApp({
      ingestDemo: false,
      hookAdapter: fakeAdapter(() => {
        throw new Error('bad field SECRET-VALUE');
      }),
    });
    const res = await request(s.app)
      .post('/api/hooks/claude-code')
      .set('X-ACP-Hook-Token', TOKEN)
      .send({ a: 1 });
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).not.toContain('SECRET-VALUE');
  });

  it('returns 404 when the mode has no hook-capable adapter', async () => {
    const s = await setupApp({ ingestDemo: false });
    const res = await request(s.app)
      .post('/api/hooks/claude-code')
      .set('X-ACP-Hook-Token', TOKEN)
      .send({});
    expect(res.status).toBe(404);
  });

  it('rejects browser-origin posts and preflights even with a valid token', async () => {
    const s = await setupApp({ ingestDemo: false, hookAdapter: fakeAdapter(() => [attention]) });
    const post = await request(s.app)
      .post('/api/hooks/claude-code')
      .set('Origin', 'https://evil.example')
      .set('X-ACP-Hook-Token', TOKEN)
      .send({});
    expect(post.status).toBe(403);
    const pre = await request(s.app)
      .options('/api/hooks/claude-code')
      .set('Origin', 'https://evil.example')
      .set('Access-Control-Request-Method', 'POST')
      .set('Access-Control-Request-Headers', 'x-acp-hook-token');
    expect(pre.status).toBe(403);
    expect(pre.headers['access-control-allow-origin']).toBeUndefined();
    expect(s.repos.events.maxId()).toBeNull();
  });
});

describe('hook token file', () => {
  it('is created with mode 0600, reused on later starts, and compared exactly', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'acp-token-'));
    try {
      const path = join(dir, 'nested', 'hook-token');
      const token = await ensureHookToken(path);
      expect(token).toMatch(/^[0-9a-f]{64}$/);
      expect(statSync(path).mode & 0o777).toBe(0o600);
      expect(await ensureHookToken(path)).toBe(token);

      writeFileSync(path, 'short\n', { mode: 0o644 });
      const replaced = await ensureHookToken(path);
      expect(replaced).not.toBe('short');
      expect(statSync(path).mode & 0o777).toBe(0o600);

      expect(tokenMatches(token, token)).toBe(true);
      expect(tokenMatches(token, token.slice(1))).toBe(false);
      expect(tokenMatches(token, undefined)).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
