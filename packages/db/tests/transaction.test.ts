import { join } from 'node:path';
import type { Checkpoint } from '@acp/core';
import { describe, expect, it } from 'vitest';
import { createRepositories, DbError, openDatabase, withTransaction } from '../src/index.js';
import { endedEvent, key, sessionInput, tokens, usageEvent } from './fixtures.js';
import { tempDir, thrown } from './helpers.js';

const path = '/home/user/.claude/projects/-repo/sess-1.jsonl';
const checkpoint = (byteOffset: number): Checkpoint => ({
  sourcePath: path,
  fileIdentity: '1:2',
  sizeBytes: 10_000,
  mtimeMs: 1,
  byteOffset,
  headHash: 'f'.repeat(64),
  parseErrors: 0,
});

function count(db: ReturnType<typeof openDatabase>, table: string): number {
  return db.connection.prepare(`SELECT COUNT(*) FROM ${table}`).pluck().get() as number;
}

describe('withTransaction (B5)', () => {
  it('commits events, projections, and the checkpoint together and returns the result', () => {
    const file = join(tempDir(), 'acp.sqlite');
    const db = openDatabase(file);
    const repos = createRepositories(db);
    const inserted = withTransaction(db, () => {
      const sessionId = repos.sessions.upsert(sessionInput(key('sess-1'))).id;
      const a = repos.events.insertIfNew({
        event: endedEvent('k1', key('sess-1')),
        sessionId,
        projectId: null,
      });
      repos.checkpoints.set(checkpoint(100));
      return a.inserted;
    });
    expect(inserted).toBe(true);
    db.close();

    const reopened = openDatabase(file);
    try {
      expect(count(reopened, 'events')).toBe(1);
      expect(createRepositories(reopened).checkpoints.get(path)?.byteOffset).toBe(100);
    } finally {
      reopened.close();
    }
  });

  it('crash simulation: a throw midway rolls back events AND the checkpoint (no partial state)', () => {
    const file = join(tempDir(), 'acp.sqlite');
    const db = openDatabase(file);
    const repos = createRepositories(db);

    // A previous batch committed up to offset 100.
    withTransaction(db, () => repos.checkpoints.set(checkpoint(100)));

    const error = thrown(() =>
      withTransaction(db, () => {
        const sessionId = repos.sessions.upsert(sessionInput(key('sess-1'))).id;
        const usage = usageEvent('k-usage', key('sess-1'), 'msg-1', tokens(1, 2));
        const { id } = repos.events.insertIfNew({ event: usage, sessionId, projectId: null });
        repos.usage.insertObservation({
          eventId: id,
          provider: 'claude-code',
          messageId: 'msg-1',
          sessionId,
          occurredAt: usage.occurredAt,
          requestId: null,
          model: null,
          tokens: usage.payload.tokens,
        });
        repos.events.insertIfNew({
          event: endedEvent('k2', key('sess-1')),
          sessionId,
          projectId: null,
        });
        repos.checkpoints.set(checkpoint(5000));
        throw new Error('simulated crash before commit');
      }),
    );
    expect(error).toMatchObject({ message: 'simulated crash before commit' });

    // Same connection, and a fresh connection to the file: nothing from the batch survived.
    for (const view of [db, openDatabase(file)]) {
      expect(count(view, 'events')).toBe(0);
      expect(count(view, 'sessions')).toBe(0);
      expect(count(view, 'usage_observations')).toBe(0);
      expect(createRepositories(view).checkpoints.get(path)?.byteOffset).toBe(100);
      view.close();
    }
  });

  it('a retried batch after the rollback is applied once (dedup absorbs the re-read)', () => {
    const db = openDatabase(join(tempDir(), 'acp.sqlite'));
    const repos = createRepositories(db);
    const batch = (crash: boolean) =>
      withTransaction(db, () => {
        const sessionId = repos.sessions.upsert(sessionInput(key('sess-1'))).id;
        const r = repos.events.insertIfNew({
          event: endedEvent('k1', key('sess-1')),
          sessionId,
          projectId: null,
        });
        repos.checkpoints.set(checkpoint(200));
        if (crash) throw new Error('crash');
        return r;
      });
    expect(() => batch(true)).toThrow('crash');
    expect(batch(false).inserted).toBe(true);
    expect(batch(false).inserted).toBe(false);
    expect(count(db, 'events')).toBe(1);
    db.close();
  });

  it('nests as a savepoint: a caught inner failure rolls back only the inner work', () => {
    const db = openDatabase(join(tempDir(), 'acp.sqlite'));
    const repos = createRepositories(db);
    withTransaction(db, () => {
      repos.events.insertIfNew({
        event: endedEvent('outer', key('s')),
        sessionId: null,
        projectId: null,
      });
      expect(() =>
        withTransaction(db, () => {
          repos.events.insertIfNew({
            event: endedEvent('inner', key('s')),
            sessionId: null,
            projectId: null,
          });
          throw new Error('inner');
        }),
      ).toThrow('inner');
    });
    expect(repos.events.getByDedupKey('outer')).toBeDefined();
    expect(repos.events.getByDedupKey('inner')).toBeUndefined();
    db.close();
  });

  it('rejects an async body', () => {
    const db = openDatabase(join(tempDir(), 'acp.sqlite'));
    // @ts-expect-error an async body is rejected at compile time too
    expect(() => withTransaction(db, () => Promise.resolve(1))).toThrow(DbError);
    expect(db.connection.inTransaction).toBe(false);
    db.close();
  });
});
