import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../../src/config.js';
import { startServer } from '../../src/bootstrap.js';
import { silentLogger } from '../../src/logger.js';
import { SessionSummaryDtoSchema, pageSchema } from '@acp/core/api';
import {
  FIXTURE_ROOT,
  NOW,
  copyScenario,
  dbModelTotals,
  dbSessionTotals,
  ingestUntilIdle,
  openLiveStack,
  runReference,
  SCENARIOS,
  sessionLabel,
  tempDir,
} from './helpers.js';
import { SID_A, SID_B, SID_C, generatedClaudeDir } from './generated.js';

/*
 * P1-F task F1. The reference script (scripts/reference-usage.ts) recomputes usage straight from the
 * JSONL files with its own implementation of usage-accounting §5. These tests run it as a separate
 * process and require its per-session and per-model totals to equal what the real live-mode stack
 * (Claude Code adapter → pipeline → SQLite → queries) stored. All inputs are synthetic.
 */

/** Strings that only ever appear as content or paths inside fixture lines. */
const CONTENT_MARKERS = [
  '<redacted>',
  '/home/user',
  'never-read',
  'SECRET',
  'acc00000',
  '0rg00000',
];

async function compare(claudeDir: string, roots: readonly string[] = [FIXTURE_ROOT]) {
  const stack = openLiveStack(join(tempDir(), 'acp.sqlite'), roots);
  await ingestUntilIdle(stack, claudeDir);
  const reference = runReference(claudeDir, roots);
  return {
    stack,
    reference,
    db: { sessions: dbSessionTotals(stack), models: dbModelTotals(stack) },
  };
}

describe('F1: reference recomputation equals the live pipeline on every fixture scenario', () => {
  it.each(SCENARIOS)('%s', async (scenario) => {
    const { reference, db } = await compare(copyScenario(scenario));
    expect(db.sessions).toEqual(reference.sessions);
    expect(db.models).toEqual(reference.models);
    for (const marker of CONTENT_MARKERS) expect(reference.stdout).not.toContain(marker);
  });

  it('the fixture set is not trivially empty on both sides', async () => {
    let records = 0;
    for (const scenario of SCENARIOS) {
      const { reference } = await compare(copyScenario(scenario));
      records += reference.report.total.records;
    }
    expect(records).toBeGreaterThan(10);
  });

  it('known values: streaming growth takes max output, fork copies are counted once (ambiguous)', () => {
    const streaming = runReference(copyScenario('01-streaming-duplicates'));
    // Three lines of one message plus one more message, two records in total.
    expect(streaming.report.observations.total).toBe(4);
    expect(streaming.report.total.records).toBe(2);
    const fork = runReference(copyScenario('02-fork'));
    expect(fork.report.messages).toBe(3);
    expect(fork.report.total.records).toBe(3);
    const original = fork.sessions[sessionLabel('c0ffee00-0000-4000-8000-000000000001', null)];
    expect(original?.records).toBe(2);
    expect(original?.ambiguous).toBe(2);
  });
});

describe('F1: generated scenario mixing every rule', () => {
  it('reference and pipeline agree, with the expected hand-computed values', async () => {
    const claudeDir = generatedClaudeDir();
    const { reference, db } = await compare(claudeDir);
    expect(db.sessions).toEqual(reference.sessions);
    expect(db.models).toEqual(reference.models);

    const a = reference.sessions[sessionLabel(SID_A, null)];
    // msg_g1 (max output 42), msg_g2 (ambiguous with B, lexical tie-break), msg_g4, msg_g5, msg_g6.
    expect(a?.records).toBe(5);
    expect(a?.tokens).toEqual({
      input: 5 + 2 + 8,
      output: 42 + 9 + 10 + 8,
      cacheCreation: 111,
      cacheRead: 1012,
    });
    expect(a?.recordsWithUnavailable).toEqual({
      input: 2,
      output: 1,
      cacheCreation: 1,
      cacheRead: 1,
    });
    expect(a?.ambiguous).toBe(1);
    expect(reference.sessions[sessionLabel(SID_A, 'gsub1')]?.records).toBe(1);
    expect(reference.sessions[sessionLabel(SID_B, null)]?.tokens).toEqual({
      input: 3,
      output: 4,
      cacheCreation: null,
      cacheRead: 6,
    });
    expect(reference.sessions[sessionLabel(SID_C, null)]).toBeUndefined();
    expect(reference.sessions[sessionLabel(SID_C, 'gsub2')]?.records).toBe(1);
    expect(reference.report.observations.synthetic).toBe(1);
    expect(reference.report.lines.unparseable).toBe(1);
    expect(reference.models['<synthetic>']).toBeUndefined();
  });

  it('through the HTTP API of a live-mode server: per-session direct usage equals the reference', async () => {
    const claudeDir = generatedClaudeDir();
    const config = loadConfig(
      {
        ACP_MODE: 'live',
        ACP_DATA_DIR: tempDir(),
        ACP_CLAUDE_DIR: claudeDir,
        ACP_POLL_INTERVAL_MS: '60000',
      },
      { homeDir: tempDir() },
    );
    const server = await startServer({
      config,
      port: 0,
      logger: silentLogger,
      now: () => NOW,
      normalizeRoot: (p) => Promise.resolve(p),
    });
    try {
      const base = `http://127.0.0.1:${server.port}/api`;
      const created = await fetch(`${base}/projects`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'project', rootPath: FIXTURE_ROOT }),
      });
      expect(created.status).toBe(201);

      const Page = pageSchema(SessionSummaryDtoSchema);
      let sessions: ReturnType<typeof Page.parse>['items'] = [];
      // Registering a project requests a poll; wait for it to land.
      for (let i = 0; i < 100; i++) {
        const res = await fetch(`${base}/sessions?limit=200`);
        sessions = Page.parse(await res.json()).items;
        if (sessions.length >= 4) break;
        await new Promise((r) => setTimeout(r, 50));
      }
      const fromApi: Record<string, unknown> = {};
      for (const s of sessions) {
        if (s.directUsage.recordCount === 0) continue;
        fromApi[sessionLabel(s.providerSessionId, s.providerAgentId)] = {
          records: s.directUsage.recordCount,
          tokens: s.directUsage.tokens,
          recordsWithUnavailable: s.directUsage.recordsWithUnavailable,
        };
      }
      const reference = runReference(claudeDir);
      const expected: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(reference.sessions)) {
        expected[k] = {
          records: v.records,
          tokens: v.tokens,
          recordsWithUnavailable: v.recordsWithUnavailable,
        };
      }
      expect(fromApi).toEqual(expected);
    } finally {
      await server.close();
    }
  });
});
