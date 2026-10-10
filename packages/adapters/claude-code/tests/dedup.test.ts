import { describe, expect, it } from 'vitest';
import {
  canonicalJson,
  hookRecordKey,
  metaRecordKey,
  sha256Hex,
  transcriptRecordKey,
} from '../src/dedup.js';

const SID = 'c0ffee00-0000-4000-8000-000000000001';
const SID_2 = 'c0ffee00-0000-4000-8000-000000000002';

describe('record keys', () => {
  it('uses the uuid when present, scoped by session and agent', () => {
    expect(transcriptRecordKey(SID, null, 'u1', Buffer.from('x'))).toBe(`cc:tx:${SID}:main:u1`);
    expect(transcriptRecordKey(SID, 'afake1', 'u1', Buffer.from('x'))).toBe(
      `cc:tx:${SID}:afake1:u1`,
    );
  });

  it('falls back to the sha256 of the line bytes, independent of offsets', () => {
    const line = Buffer.from('{"type":"mode"}');
    const key = transcriptRecordKey(SID, null, null, line);
    expect(key).toBe(`cc:tx:${SID}:main:h:${sha256Hex(line)}`);
    expect(transcriptRecordKey(SID, null, null, Buffer.from(line))).toBe(key);
    expect(transcriptRecordKey(SID, null, null, Buffer.from('{"type":"modeX"}'))).not.toBe(key);
  });

  it('keys a copied line differently in each session file (path-derived session id)', () => {
    expect(transcriptRecordKey(SID, null, 'u1', Buffer.from('x'))).not.toBe(
      transcriptRecordKey(SID_2, null, 'u1', Buffer.from('x')),
    );
  });

  it('keys a meta file by its bytes, so a changed file is a new fact', () => {
    const v1 = metaRecordKey(SID, 'afake1', Buffer.from('{"a":1}'));
    expect(metaRecordKey(SID, 'afake1', Buffer.from('{"a":1}'))).toBe(v1);
    expect(metaRecordKey(SID, 'afake1', Buffer.from('{"a":2}'))).not.toBe(v1);
    expect(v1).toBe(`cc:meta:${SID}:afake1:h:${sha256Hex('{"a":1}')}`);
  });

  it('keys a hook by tool_use_id, else by the canonical body hash', () => {
    expect(hookRecordKey(SID, 'PreToolUse', 'toolu_1', { a: 1 })).toBe(
      `cc:hook:${SID}:PreToolUse:toolu_1`,
    );
    const a = hookRecordKey(SID, 'Stop', null, { x: 1, y: { b: 2, a: 1 } });
    const b = hookRecordKey(SID, 'Stop', null, { y: { a: 1, b: 2 }, x: 1 });
    expect(a).toBe(b);
    expect(hookRecordKey(SID, 'Stop', null, { x: 2 })).not.toBe(a);
  });

  it('canonicalJson sorts keys recursively and keeps array order', () => {
    expect(canonicalJson({ b: [{ d: 1, c: 2 }, 3], a: null })).toBe(
      '{"a":null,"b":[{"c":2,"d":1},3]}',
    );
  });
});
