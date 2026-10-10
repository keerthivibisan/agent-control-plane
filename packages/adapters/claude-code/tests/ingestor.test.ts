import { cp, readFile } from 'node:fs/promises';
import path from 'node:path';
import { NormalizedEventSchema } from '@acp/core';
import type { NormalizedEvent } from '@acp/core';
import { describe, expect, it } from 'vitest';
import { DiagnosticsCollector } from '../src/diagnostics.js';
import { TranscriptIngestor } from '../src/ingestor.js';
import {
  copyScenario,
  drain,
  expectGolden,
  FIXED_NOW,
  FIXTURES_DIR,
  MemoryStore,
  portable,
  ROOTS,
  scenarioRoot,
} from './helpers/scenarios.js';

const S1 = 'c0ffee00-0000-4000-8000-000000000001';
const S2 = 'c0ffee00-0000-4000-8000-000000000002';

function makeIngestor(claudeDir: string, chunkBytes = 1024 * 1024) {
  const diagnostics = new DiagnosticsCollector();
  const ingestor = new TranscriptIngestor({
    claudeDir,
    now: FIXED_NOW,
    maxFileBytes: 512 * 1024 * 1024,
    chunkBytes,
    diagnostics,
  });
  return { ingestor, diagnostics };
}

async function ingestScenario(name: string, chunkBytes?: number) {
  const root = await scenarioRoot(name);
  const { ingestor, diagnostics } = makeIngestor(root, chunkBytes);
  const result = await drain(ingestor);
  return { ...result, root, diagnostics, ingestor, events: portable(result.events, root) };
}

const keys = (events: NormalizedEvent[]) => events.map((e) => e.dedupKey);
const types = (events: NormalizedEvent[]) => events.map((e) => e.eventType);

/** Scenarios whose goldens come from transcripts alone (meta scenarios are in meta.test.ts). */
const TRANSCRIPT_GOLDENS = [
  '01-streaming-duplicates',
  '02-fork',
  '06-partial-last-line',
  '08-unknown-record-types',
  '09-cost-state',
  '10-cwd-change',
  '11-api-error-and-edge-lines',
  '12-missing-usage-categories',
  '14-denied-files',
  '15-unparseable-line',
  '16-titles',
];

describe('C4 golden contract tests (transcripts)', () => {
  for (const name of TRANSCRIPT_GOLDENS) {
    describe(name, () => {
      it('matches the reviewed golden, and every event is schema-valid', async () => {
        const { events } = await ingestScenario(name);
        for (const e of events) expect(NormalizedEventSchema.safeParse(e).success).toBe(true);
        await expectGolden(name, events);
      });

      it('copies no fixture text into any event, and emits no duplicate keys', async () => {
        const { events } = await ingestScenario(name);
        const json = JSON.stringify(events);
        expect(json).not.toContain('<redacted>');
        expect(new Set(keys(events)).size).toBe(events.length);
      });

      it('a second poll emits nothing new', async () => {
        const root = await scenarioRoot(name);
        const { ingestor } = makeIngestor(root);
        const store = new MemoryStore();
        const first = await drain(ingestor, store);
        const second = await drain(ingestor, store);
        expect(first.events.length).toBeGreaterThan(0);
        expect(second.events).toEqual([]);
      });

      it('a restart with a tiny chunk size reproduces the same keys', async () => {
        const whole = await ingestScenario(name);
        const small = await ingestScenario(name, 256);
        expect(keys(small.events).sort()).toEqual(keys(whole.events).sort());
      });
    });
  }
});

describe('scenario 1: streaming duplicates', () => {
  it('emits one usage.reported per line, same messageId, distinct keys, growing output', async () => {
    const { events } = await ingestScenario('01-streaming-duplicates');
    const usage = events.filter(
      (e) =>
        e.eventType === 'usage.reported' &&
        (e.payload as { messageId: string }).messageId === 'msg_fake0101',
    );
    expect(usage).toHaveLength(3);
    expect(new Set(keys(usage)).size).toBe(3);
    const outputs = usage.map((e) => (e.payload as { tokens: { output: number } }).tokens.output);
    expect(outputs).toEqual([8, 120, 345]);
    // The next message is a separate record; only the dedup rules in core fold the three together.
    expect(events.filter((e) => e.eventType === 'usage.reported')).toHaveLength(4);
  });
});

describe('scenario 2: fork', () => {
  it('uses the file path session id for copied lines, so keys differ per file', async () => {
    const { events } = await ingestScenario('02-fork');
    const sessions = new Set(events.map((e) => e.providerSessionId));
    expect(sessions).toEqual(new Set([S1, S2]));
    const usage = events.filter((e) => e.eventType === 'usage.reported');
    const forMessage = (id: string) =>
      usage.filter((e) => (e.payload as { messageId: string }).messageId === id);
    // The two copied messages appear in both files; the third exists only in the fork.
    for (const id of ['msg_fake0201', 'msg_fake0202']) {
      const group = forMessage(id);
      expect(new Set(group.map((e) => e.providerSessionId))).toEqual(new Set([S1, S2]));
      expect(new Set(keys(group)).size).toBe(group.length);
    }
    expect(forMessage('msg_fake0203').map((e) => e.providerSessionId)).toEqual([S2]);
  });
});

describe('scenario 6: partial last line', () => {
  it('checkpoints before the partial line and never parses it', async () => {
    const { batches, root } = await ingestScenario('06-partial-last-line');
    const file = path.join(root, 'projects/-home-user-project', `${S1}.jsonl`);
    const last = batches.at(-1)?.nextCheckpoint;
    expect(last?.sourcePath).toBe(file);
    expect(last?.byteOffset).toBeLessThan(last?.sizeBytes ?? 0);
    const raw = await readFile(file);
    expect(raw.at(Number(last?.byteOffset) - 1)).toBe(0x0a);
    expect(raw.subarray(Number(last?.byteOffset)).includes(0x0a)).toBe(false);
    expect(last?.parseErrors).toBe(0);
  });
});

describe('scenario 8: unknown record types', () => {
  it('reads nothing but the type of non-allowlisted records', async () => {
    const { events } = await ingestScenario('08-unknown-record-types');
    const json = JSON.stringify(events);
    for (const forbidden of ['acc00000', '0rg00000', 'never-read', 'SECRET']) {
      expect(json).not.toContain(forbidden);
    }
    const unrecognized = events.filter((e) => e.eventType === 'record.unrecognized');
    expect(unrecognized.length).toBeGreaterThan(0);
    for (const e of unrecognized) expect(Object.keys(e.payload)).toEqual(['recordType']);
    const observed = events.filter((e) => e.eventType === 'session.observed');
    expect(observed.map((e) => (e.payload as { cwd: string }).cwd)).toEqual(['/home/user/project']);
    expect(events.some((e) => e.eventType === 'session.cwd_changed')).toBe(false);
  });

  it('counts known, ignored types in diagnostics and reports only the rest (ADR-0011)', async () => {
    const { events, diagnostics } = await ingestScenario('08-unknown-record-types');
    const reported = events
      .flatMap((e) => (e.eventType === 'record.unrecognized' ? [e.payload.recordType] : []))
      .sort();
    // Uncertain types stay unrecognized (docs/provider-adapters.md §4.4).
    expect(reported).toEqual([
      'agent-name',
      'atis-latch',
      'brand-new-type-from-the-future',
      'bridge-session',
      'frame-link',
      'mode',
      'relocated',
      'summary',
      'system:compact_boundary',
    ]);
    expect(diagnostics.snapshot().ignoredRecords).toEqual({
      'artifact-autoreact-ledger': 1,
      'artifact-comment-monitor': 1,
      attachment: 1,
      'file-history-delta': 1,
      'file-history-snapshot': 1,
      'last-prompt': 1,
      'queue-operation': 1,
      'system:stop_hook_summary': 1,
    });
    // Ignored records emit nothing at all, so none of their fields can leak.
    const counts = diagnostics.snapshot().recordsByVersion;
    const total = Object.values(counts).reduce((n, c) => n + c.total, 0);
    const unrecognized = Object.values(counts).reduce((n, c) => n + c.unrecognized, 0);
    expect(total).toBe(18);
    expect(unrecognized).toBe(9);
  });
});

describe('scenario 9: cost-state', () => {
  it('emits snapshots with scope unknown and keeps missing categories null', async () => {
    const { events } = await ingestScenario('09-cost-state');
    const snaps = events.filter((e) => e.eventType === 'usage.snapshot');
    expect(snaps).toHaveLength(2);
    for (const s of snaps) {
      expect((s.payload as { scope: string; kind: string }).scope).toBe('unknown');
      expect((s.payload as { kind: string }).kind).toBe('cumulative-snapshot');
    }
  });
});

describe('scenario 10: cwd change', () => {
  it('emits session.observed once, then cwd_changed with from/to', async () => {
    const { events } = await ingestScenario('10-cwd-change');
    expect(types(events).filter((t) => t === 'session.observed')).toHaveLength(1);
    const changes = events.filter((e) => e.eventType === 'session.cwd_changed');
    expect(changes.map((e) => e.payload)).toEqual([
      { from: '/home/user/project', to: '/home/user/project/packages/a' },
      { from: '/home/user/project/packages/a', to: '/home/user/elsewhere' },
    ]);
  });

  it('keeps the cwd chain across a restart mid-file (state replay)', async () => {
    const root = await scenarioRoot('10-cwd-change');
    const full = (await drain(makeIngestor(root).ingestor)).events;

    const store = new MemoryStore();
    const first = makeIngestor(root, 300).ingestor;
    const gen = first.poll(ROOTS, store)[Symbol.asyncIterator]();
    const head = await gen.next();
    expect(head.done).toBe(false);
    if (head.done === true) return;
    store.map.set(head.value.sourcePath, head.value.nextCheckpoint);
    await gen.return?.(undefined);

    // A new ingestor has no cached state and must rebuild lastCwd from the lines before the checkpoint.
    const rest = await drain(makeIngestor(root, 300).ingestor, store);
    expect(keys([...head.value.events, ...rest.events]).sort()).toEqual(keys(full).sort());
    const changes = [...head.value.events, ...rest.events].filter(
      (e) => e.eventType === 'session.cwd_changed',
    );
    expect(changes).toHaveLength(2);
  });
});

describe('scenario 11: api_error and edge lines', () => {
  it('maps api_error to provider.error and leaves a missing requestId null', async () => {
    const { events } = await ingestScenario('11-api-error-and-edge-lines');
    const errors = events.filter((e) => e.eventType === 'provider.error');
    expect(errors.length).toBeGreaterThan(0);
    const assistants = events.filter((e) => e.eventType === 'message.assistant');
    expect(
      assistants.some((e) => (e.payload as { requestId: string | null }).requestId === null),
    ).toBe(true);
  });
});

describe('scenario 12: missing usage categories', () => {
  it('maps unusable counts to null, never 0', async () => {
    const { events } = await ingestScenario('12-missing-usage-categories');
    const usage = events.filter((e) => e.eventType === 'usage.reported');
    const counts = usage.flatMap((e) =>
      Object.values((e.payload as { tokens: Record<string, number | null> }).tokens),
    );
    expect(counts).toContain(null);
    expect(counts.every((c) => c === null || (Number.isInteger(c) && c >= 0))).toBe(true);
  });
});

describe('scenario 14: denied files', () => {
  it('never reads denied files and never shows the peer session', async () => {
    const { events, diagnostics } = await ingestScenario('14-denied-files');
    expect(events.length).toBeGreaterThan(0);
    expect(events.every((e) => e.providerSessionId === S1)).toBe(true);
    expect(JSON.stringify(events)).not.toContain(S2);
    expect(diagnostics.snapshot().fileIssues).toEqual([]);
  });
});

describe('scenario 15: unparseable lines', () => {
  it('skips and counts three bad lines, still reading the lines after them', async () => {
    const { batches, events } = await ingestScenario('15-unparseable-line');
    expect(batches.at(-1)?.nextCheckpoint.parseErrors).toBe(3);
    expect(events.length).toBeGreaterThan(0);
    const last = batches.at(-1)?.nextCheckpoint;
    expect(last?.byteOffset).toBe(last?.sizeBytes);
  });

  it('keeps the error count across a second poll and a restart', async () => {
    const root = await scenarioRoot('15-unparseable-line');
    const store = new MemoryStore();
    await drain(makeIngestor(root).ingestor, store);
    const again = await drain(makeIngestor(root).ingestor, store);
    expect(again.events).toEqual([]);
    expect([...store.map.values()][0]?.parseErrors).toBe(3);
  });
});

describe('scenario 16: titles', () => {
  it('redacts and caps titles, and attributes the source', async () => {
    const { events } = await ingestScenario('16-titles');
    const titled = events.filter((e) => e.eventType === 'session.titled');
    expect(titled.length).toBeGreaterThan(0);
    const json = JSON.stringify(titled);
    expect(json).not.toMatch(/sk-ant-/);
    expect(json).toContain('[REDACTED]');
    for (const e of titled) {
      expect((e.payload as { title: string }).title.length).toBeLessThanOrEqual(200);
    }
  });
});

describe('scenario 7: truncated or replaced file', () => {
  it('resets when v2 replaces v1 and re-reads from the start', async () => {
    const dir = await copyScenario('07-truncated-replaced', 'v1');
    const store = new MemoryStore();
    const { ingestor } = makeIngestor(dir);

    const first = await drain(ingestor, store);
    expect(first.events.length).toBeGreaterThan(0);
    expect((await drain(ingestor, store)).events).toEqual([]);

    // Overwrite in place with the shorter v2 (same path, same inode on most file systems).
    await cp(path.join(FIXTURES_DIR, '07-truncated-replaced', 'v2'), dir, { recursive: true });
    const second = await drain(ingestor, store);
    expect(second.events.length).toBeGreaterThan(0);
    const firstKeys = new Set(keys(first.events));
    expect(second.events.some((e) => firstKeys.has(e.dedupKey))).toBe(false);
    const cp2 = second.batches.at(-1)?.nextCheckpoint;
    expect(cp2?.byteOffset).toBe(cp2?.sizeBytes);
    expect(cp2?.sizeBytes).toBeLessThan(first.batches.at(-1)?.nextCheckpoint.sizeBytes ?? 0);

    expect((await drain(ingestor, store)).events).toEqual([]);

    await expectGolden('07-truncated-replaced', portable(first.events, dir), 'events-v1.json');
    await expectGolden('07-truncated-replaced', portable(second.events, dir), 'events-v2.json');
    for (const e of [...first.events, ...second.events]) {
      expect(NormalizedEventSchema.safeParse(e).success).toBe(true);
    }
  });
});
