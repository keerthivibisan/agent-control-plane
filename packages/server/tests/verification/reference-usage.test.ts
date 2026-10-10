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
  sessionLabel,
  tempDir,
  writeTranscript,
} from './helpers.js';

/*
 * P1-F task F1. The reference script (scripts/reference-usage.ts) recomputes usage straight from the
 * JSONL files with its own implementation of usage-accounting §5. These tests run it as a separate
 * process and require its per-session and per-model totals to equal what the real live-mode stack
 * (Claude Code adapter → pipeline → SQLite → queries) stored. All inputs are synthetic.
 */

/** Every fixture scenario with transcripts (07 has two versions of one file). */
const SCENARIOS = [
  '01-streaming-duplicates',
  '02-fork',
  '03-subagent-with-meta',
  '04-subagent-without-meta',
  '05-nested-subagent',
  '06-partial-last-line',
  '07-truncated-replaced/v1',
  '07-truncated-replaced/v2',
  '08-unknown-record-types',
  '09-cost-state',
  '10-cwd-change',
  '11-api-error-and-edge-lines',
  '12-missing-usage-categories',
  '13-hooks',
  '14-denied-files',
  '15-unparseable-line',
  '16-titles',
];

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

// ---------------------------------------------------------------------------------------------
// A generated (synthetic) Claude data root that mixes every rule in one place.

const SID_A = 'f1f1f1f1-0000-4000-8000-00000000000a';
const SID_B = 'f1f1f1f1-0000-4000-8000-00000000000b';
const SID_C = 'f1f1f1f1-0000-4000-8000-00000000000c';
const DIR = '-home-user-project';
const OUTSIDE = '/home/user/elsewhere';

let uuidSeq = 0;
function line(
  sid: string,
  cwd: string,
  ts: string | null,
  fields: Record<string, unknown>,
): Record<string, unknown> {
  uuidSeq++;
  return {
    type: 'assistant',
    uuid: `f1000000-0000-4000-8000-${String(uuidSeq).padStart(12, '0')}`,
    sessionId: sid,
    cwd,
    version: '2.1.263',
    ...(ts !== null && { timestamp: ts }),
    ...fields,
  };
}

function assistant(
  sid: string,
  cwd: string,
  ts: string | null,
  id: string,
  usage: Record<string, unknown> | null,
  model = 'claude-sonnet-4-5',
) {
  return line(sid, cwd, ts, {
    message: {
      id,
      model,
      role: 'assistant',
      content: [{ type: 'text', text: '<redacted>' }],
      ...(usage !== null && { usage }),
    },
  });
}

const u = (input: unknown, output: unknown, cacheCreation: unknown, cacheRead: unknown) => ({
  input_tokens: input,
  output_tokens: output,
  cache_creation_input_tokens: cacheCreation,
  cache_read_input_tokens: cacheRead,
});

function generatedClaudeDir(): string {
  const dir = tempDir('acp-verify-generated-');
  const P = FIXTURE_ROOT;
  // Session A (inside the root): streaming growth, missing categories, a synthetic line, equal
  // outputs at different times, a non-integer and a negative count (both become null).
  writeTranscript(dir, `${DIR}/${SID_A}.jsonl`, [
    line(SID_A, P, '2026-10-01T10:00:00.000Z', {
      type: 'user',
      message: { content: '<redacted>' },
    }),
    assistant(SID_A, P, '2026-10-01T10:00:01.000Z', 'msg_g1', u(5, 1, 100, 1000)),
    assistant(SID_A, P, '2026-10-01T10:00:02.000Z', 'msg_g1', u(5, 7, 100, 1000)),
    assistant(SID_A, P, '2026-10-01T10:00:03.000Z', 'msg_g1', u(5, 42, 100, 1000)),
    assistant(SID_A, P, '2026-10-01T10:00:04.000Z', 'msg_g2', { output_tokens: 9 }),
    assistant(SID_A, P, '2026-10-01T10:00:05.000Z', 'msg_g3', u(1, 1, 1, 1), '<synthetic>'),
    assistant(SID_A, P, '2026-10-01T10:00:06.000Z', 'msg_g4', u(2, 10, 3, 4)),
    assistant(SID_A, P, '2026-10-01T10:00:07.000Z', 'msg_g4', u(2, 10, 3, 4)),
    assistant(SID_A, P, '2026-10-01T10:00:08.000Z', 'msg_g5', u(1.5, -3, 0, 0), 'claude-opus-4-1'),
    assistant(SID_A, P, null, 'msg_g6', u(8, 8, 8, 8)),
    'this line is not json',
  ]);
  // Subagent of A: its own message, plus a later copy of msg_g1 (still attributed to A).
  writeTranscript(dir, `${DIR}/${SID_A}/subagents/agent-gsub1.jsonl`, [
    assistant(
      SID_A,
      P,
      '2026-10-01T10:01:00.000Z',
      'msg_g7',
      u(11, 22, 33, 44),
      'claude-haiku-4-5',
    ),
    assistant(SID_A, P, '2026-10-01T10:01:01.000Z', 'msg_g1', u(5, 42, 100, 1000)),
  ]);
  // Session B, a fork of A: copies msg_g2 with the same timestamp (ambiguous), adds msg_g8, and
  // ends with a partial line that must not be read.
  writeTranscript(
    dir,
    `${DIR}/${SID_B}.jsonl`,
    [
      assistant(SID_B, P, '2026-10-01T10:00:04.000Z', 'msg_g2', { output_tokens: 9 }),
      assistant(SID_B, P, '2026-10-01T10:02:00.000Z', 'msg_g8', u(3, 4, null, 6)),
      JSON.stringify(
        assistant(SID_B, P, '2026-10-01T10:02:01.000Z', 'msg_g9', u(1, 1, 1, 1)),
      ).slice(0, 80),
    ],
    { trailingNewline: false },
  );
  // Session C is outside the root, with an earlier copy of msg_g1 that must not be counted. Its
  // subagent's own cwd is inside the root, so that subagent is eligible.
  writeTranscript(dir, `${DIR}/${SID_C}.jsonl`, [
    assistant(SID_C, OUTSIDE, '2026-10-01T09:00:00.000Z', 'msg_g1', u(5, 99, 100, 1000)),
    assistant(SID_C, OUTSIDE, '2026-10-01T09:00:01.000Z', 'msg_g10', u(1, 2, 3, 4)),
  ]);
  writeTranscript(dir, `${DIR}/${SID_C}/subagents/agent-gsub2.jsonl`, [
    assistant(SID_C, `${P}/packages/a`, '2026-10-01T09:10:00.000Z', 'msg_g11', u(6, 6, 6, 6)),
  ]);
  return dir;
}

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
