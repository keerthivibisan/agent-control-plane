import { FIXTURE_ROOT, tempDir, writeTranscript } from './helpers.js';

/*
 * A generated, fully SYNTHETIC Claude data root that mixes every usage-accounting rule in one place.
 * It is written into a temp directory per test; no real data is involved.
 */

export const SID_A = 'f1f1f1f1-0000-4000-8000-00000000000a';
export const SID_B = 'f1f1f1f1-0000-4000-8000-00000000000b';
export const SID_C = 'f1f1f1f1-0000-4000-8000-00000000000c';
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

export function generatedClaudeDir(): string {
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
