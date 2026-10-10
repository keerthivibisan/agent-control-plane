import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { REDACTED, type NormalizedEvent, type ObservationAdapter } from '@acp/core';
import { ConfigError, loadConfig } from '../src/config.js';
import { createLogger, errorFields } from '../src/logger.js';
import { createPipeline } from '../src/pipeline/ingest.js';
import { createScheduler } from '../src/scheduler.js';
import {
  API_NOW,
  batch,
  captureLogger,
  envelope,
  observed,
  setupApp,
  setupPipeline,
} from './helpers.js';

/*
 * Phase 1 checklist "Logs are redacted" (docs/security.md §2.4-2.5): every log line is redacted
 * JSON, and failure paths log only ids, counts and error names, never bodies, paths or messages.
 */

/** Strings that must never reach a log line: a payload marker, a home path and a secret. */
const MARKER = 'PAYLOAD-MARKER-do-not-log';
const HOME_PATH = '/Users/someone/.claude/projects/-secret-repo/abc.jsonl';
const SECRET = 'sk-ant-api03-SECRETSECRETSECRET';
const TAINTED = `${MARKER} ${HOME_PATH} ${SECRET}`;

function expectClean(lines: readonly string[]): void {
  expect(lines.length).toBeGreaterThan(0);
  for (const line of lines) {
    expect(line).not.toContain(MARKER);
    expect(line).not.toContain('/Users/');
    expect(line).not.toContain('SECRETSECRET');
  }
}

function adapterWith(over: Partial<ObservationAdapter>): ObservationAdapter {
  return {
    provider: 'claude-code',
    capabilities: () => Promise.reject(new Error('unused')),
    discoverCandidates: () => Promise.resolve([]),
    poll: () => ({
      [Symbol.asyncIterator]: () => ({
        next: () => Promise.resolve({ done: true, value: undefined }),
      }),
    }),
    normalizeHook: () => [],
    diagnostics: () => ({ fileIssues: [], ignoredRecords: {}, parseErrors: 0 }),
    ...over,
  };
}

describe('logger', () => {
  it('writes one JSON line per call and redacts secrets in the message and string fields', () => {
    const lines: string[] = [];
    const logger = createLogger(
      (l) => lines.push(l),
      () => API_NOW,
    );
    logger.log('warn', `failed with Authorization: Bearer abcdef0123456789abcdef ${SECRET}`, {
      url: 'http://127.0.0.1/x?token=hunter2hunter2&page=1',
      key: 'ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ012345',
      count: 3,
      ok: false,
      none: null,
    });
    expect(lines.length).toBe(1);
    const record = JSON.parse(lines[0] ?? '') as Record<string, unknown>;
    expect(record).toMatchObject({
      time: API_NOW.toISOString(),
      level: 'warn',
      count: 3,
      ok: false,
      none: null,
    });
    expect(record['message']).toContain(REDACTED);
    expect(record['url']).toBe(`http://127.0.0.1/x?token=${REDACTED}&page=1`);
    expect(record['key']).toBe(REDACTED);
    for (const leaked of ['SECRETSECRET', 'abcdef0123456789abcdef', 'hunter2', 'ghp_']) {
      expect(lines[0]).not.toContain(leaked);
    }
  });

  it('reduces a caught error to its class name and a machine code, never its message', () => {
    const sqlite = Object.assign(new Error(TAINTED), { code: 'SQLITE_BUSY' });
    expect(errorFields(sqlite)).toEqual({ errorName: 'Error', errorCode: 'SQLITE_BUSY' });
    expect(errorFields(new TypeError(TAINTED))).toEqual({
      errorName: 'TypeError',
      errorCode: null,
    });
    // A "code" that is free text is dropped.
    expect(errorFields(Object.assign(new Error('x'), { code: HOME_PATH })).errorCode).toBeNull();
    expect(errorFields(TAINTED)).toEqual({ errorName: 'unknown', errorCode: null });
  });

  it('startup config errors name the variable, not its value', () => {
    let caught: unknown;
    try {
      loadConfig({ ACP_MODE: SECRET, ACP_PORT: HOME_PATH });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ConfigError);
    const message = (caught as ConfigError).message;
    expect(message).toContain('ACP_MODE');
    expect(message).toContain('ACP_PORT');
    expect(message).not.toContain('SECRETSECRET');
    expect(message).not.toContain('/Users/');
  });
});

describe('hook receiver logging', () => {
  const tainted = { hook_event_name: 'Notification', session_id: 'hs-1', message: TAINTED };

  it('logs rejections with only a request id and a reason code', async () => {
    const cap = captureLogger();
    const s = await setupApp({
      ingestDemo: false,
      logger: cap.logger,
      hookAdapter: adapterWith({
        normalizeHook: () => {
          throw new Error(TAINTED);
        },
      }),
    });
    const post = () => request(s.app).post('/api/hooks/claude-code');

    const unauthorized = await post().set('X-ACP-Hook-Token', 'wrong').send(tainted);
    const invalid = await post().set('X-ACP-Hook-Token', s.hookToken).send(tainted);
    const badJson = await post()
      .set('X-ACP-Hook-Token', s.hookToken)
      .set('Content-Type', 'application/json')
      .send(`{"broken": "${MARKER}`);
    const tooLarge = await post()
      .set('X-ACP-Hook-Token', s.hookToken)
      .send({ ...tainted, pad: 'x'.repeat(300 * 1024) });
    expect([unauthorized.status, invalid.status, badJson.status, tooLarge.status]).toEqual([
      401, 400, 400, 413,
    ]);

    const rejected = cap.records().filter((r) => r['message'] === 'hook rejected');
    expect(rejected.map((r) => r['reason'])).toEqual([
      'unauthorized',
      'invalid_hook',
      'invalid_json',
      'payload_too_large',
    ]);
    expect(rejected.map((r) => r['requestId'])).toEqual(
      [unauthorized, invalid, badJson, tooLarge].map((r) => r.headers['x-request-id']),
    );
    for (const r of rejected) {
      expect(Object.keys(r).sort()).toEqual(['level', 'message', 'reason', 'requestId', 'time']);
    }
    expectClean(cap.lines);
  });

  it('logs a hook to a mode without hooks (demo) as hooks_unavailable', async () => {
    const cap = captureLogger();
    const s = await setupApp({ ingestDemo: false, logger: cap.logger });
    const res = await request(s.app)
      .post('/api/hooks/claude-code')
      .set('X-ACP-Hook-Token', s.hookToken)
      .send(tainted);
    expect(res.status).toBe(404);
    expect(cap.records().map((r) => [r['message'], r['reason']])).toEqual([
      ['hook rejected', 'hooks_unavailable'],
    ]);
    expectClean(cap.lines);
  });

  it('logs an accepted hook as a request id and an event count', async () => {
    const cap = captureLogger();
    const event: NormalizedEvent = {
      ...envelope({ dedupKey: 'hook:t', channel: 'hook', sessionId: 'hs-1' }),
      eventType: 'session.attention',
      payload: { notificationType: 'permission_prompt' },
    };
    const s = await setupApp({
      ingestDemo: false,
      logger: cap.logger,
      hookAdapter: adapterWith({ normalizeHook: () => [event] }),
    });
    const res = await request(s.app)
      .post('/api/hooks/claude-code')
      .set('X-ACP-Hook-Token', s.hookToken)
      .send(tainted);
    expect(res.status).toBe(204);
    expect(cap.records()).toEqual([
      {
        time: API_NOW.toISOString(),
        level: 'info',
        message: 'hook accepted',
        requestId: res.headers['x-request-id'],
        events: 1,
      },
    ]);
    expect(cap.lines.join('\n')).not.toContain('permission_prompt');
    expectClean(cap.lines);
  });

  it('an unhandled route error logs the request id, method and error class only', async () => {
    const cap = captureLogger();
    const s = await setupApp({ ingestDemo: false, logger: cap.logger });
    s.services.system.health = () => {
      throw new RangeError(TAINTED);
    };
    const res = await request(s.app).get('/api/health');
    expect(res.status).toBe(500);
    expect(JSON.stringify(res.body)).not.toContain(MARKER);
    expect(cap.records()).toEqual([
      {
        time: API_NOW.toISOString(),
        level: 'error',
        message: 'unhandled request error',
        requestId: res.headers['x-request-id'],
        method: 'GET',
        errorName: 'RangeError',
        errorCode: null,
      },
    ]);
    expectClean(cap.lines);
  });
});

describe('ingestion logging', () => {
  it('a rolled-back batch logs the error class, code and event count only', () => {
    const cap = captureLogger();
    const base = setupPipeline();
    // The checkpoint write fails with a driver error that quotes a path and content.
    const checkpoints = new Proxy(base.repos.checkpoints, {
      get(target, prop, receiver) {
        if (prop === 'set') {
          return () => {
            throw Object.assign(new Error(TAINTED), { code: 'SQLITE_FULL' });
          };
        }
        const value: unknown = Reflect.get(target, prop, receiver);
        return typeof value === 'function' ? (value as () => unknown).bind(target) : value;
      },
    });
    const pipeline = createPipeline({
      db: base.db,
      repos: { ...base.repos, checkpoints },
      logger: cap.logger,
      now: () => API_NOW,
      publish: () => {},
    });
    const events = [observed({ dedupKey: 'k1' }, HOME_PATH), observed({ dedupKey: 'k2' }, null)];
    expect(() => pipeline.ingestBatch(batch(HOME_PATH, events))).toThrow();
    expect(cap.records()).toEqual([
      {
        time: API_NOW.toISOString(),
        level: 'error',
        message: 'ingest batch rolled back',
        errorName: 'Error',
        errorCode: 'SQLITE_FULL',
        events: 2,
      },
    ]);
    expect(pipeline.counters().batchesFailed).toBe(1);
    expectClean(cap.lines);
  });

  it('invalid events are logged as a count, never their content', () => {
    const cap = captureLogger();
    const base = setupPipeline(undefined, cap.logger);
    base.pipeline.ingestEvents([
      { junk: TAINTED } as unknown as NormalizedEvent,
      {
        ...observed({ dedupKey: 'bad' }, HOME_PATH),
        eventType: MARKER,
      } as unknown as NormalizedEvent,
    ]);
    expect(cap.records()).toEqual([
      {
        time: API_NOW.toISOString(),
        level: 'warn',
        message: 'events failed validation and were skipped',
        count: 2,
      },
    ]);
    expectClean(cap.lines);
  });

  it('a failed poll logs the provider and error class only', async () => {
    const cap = captureLogger();
    const base = setupPipeline();
    const failing = adapterWith({
      poll: () => ({
        [Symbol.asyncIterator]: () => ({
          next: () => Promise.reject(new TypeError(TAINTED)),
        }),
      }),
    });
    const scheduler = createScheduler({
      adapters: [failing],
      repos: base.repos,
      pipeline: base.pipeline,
      logger: cap.logger,
      now: () => API_NOW,
      intervalMs: 60_000,
    });
    await scheduler.pollNow();
    expect(scheduler.stats().pollErrors).toBe(1);
    expect(cap.records()).toEqual([
      {
        time: API_NOW.toISOString(),
        level: 'error',
        message: 'poll failed',
        provider: 'claude-code',
        errorName: 'TypeError',
        errorCode: null,
      },
    ]);
    expectClean(cap.lines);
  });
});
