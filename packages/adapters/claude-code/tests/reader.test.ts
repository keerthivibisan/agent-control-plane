import { createHash } from 'node:crypto';
import { appendFile, rename, truncate, utimes, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Checkpoint } from '@acp/core';
import { describe, expect, it } from 'vitest';
import { FileTooLargeError, HEAD_HASH_BYTES, readIncrement } from '../src/reader.js';
import type { ParsedLine, ReadBatch, ReadOptions } from '../src/reader.js';
import { makeTempDir, put } from './helpers/temp-claude-dir.js';

const OPTIONS: ReadOptions = { maxFileBytes: 1024 * 1024, chunkBytes: 1024 * 1024 };

async function readAll(
  file: string,
  checkpoint: Checkpoint | undefined,
  options: ReadOptions = OPTIONS,
): Promise<{ batches: ReadBatch[]; lines: ParsedLine[]; last: Checkpoint | undefined }> {
  const batches: ReadBatch[] = [];
  for await (const b of readIncrement(file, checkpoint, options)) batches.push(b);
  return {
    batches,
    lines: batches.flatMap((b) => b.lines),
    last: batches.at(-1)?.nextCheckpoint ?? checkpoint,
  };
}

const line = (n: number, pad = 0) => `${JSON.stringify({ n, pad: 'x'.repeat(pad) })}\n`;
const values = (lines: ParsedLine[]) => lines.map((l) => (l.value as { n: number }).n);
const sha = (s: string | Buffer) => createHash('sha256').update(s).digest('hex');

describe('incremental reader (C3)', () => {
  it('reads complete lines with offsets, and checkpoints at the end', async () => {
    const dir = await makeTempDir();
    const content = line(1) + line(2) + line(3);
    const file = await put(dir, 'a.jsonl', content);
    const { batches, lines, last } = await readAll(file, undefined);
    expect(values(lines)).toEqual([1, 2, 3]);
    expect(lines.map((l) => l.offset)).toEqual([0, line(1).length, line(1).length * 2]);
    expect(lines[0]?.raw.toString()).toBe(line(1).trimEnd());
    expect(batches).toHaveLength(1);
    expect(last).toMatchObject({
      sourcePath: file,
      byteOffset: content.length,
      sizeBytes: content.length,
      headHash: sha(content),
      parseErrors: 0,
    });
    expect(last?.fileIdentity).toMatch(/^\d+:\d+$/);
  });

  it('yields nothing when the file is unchanged since the checkpoint', async () => {
    const dir = await makeTempDir();
    const file = await put(dir, 'a.jsonl', line(1));
    const first = await readAll(file, undefined);
    expect((await readAll(file, first.last)).batches).toEqual([]);
  });

  it('scenario 6: never parses a partial last line; re-reads it once complete', async () => {
    const dir = await makeTempDir();
    const partial = JSON.stringify({ n: 3 });
    const file = await put(dir, 'a.jsonl', line(1) + line(2) + partial.slice(0, 5));
    const first = await readAll(file, undefined);
    expect(values(first.lines)).toEqual([1, 2]);
    expect(first.last?.byteOffset).toBe(line(1).length + line(2).length);
    expect(first.last?.parseErrors).toBe(0);

    await appendFile(file, `${partial.slice(5)}\n${line(4)}`);
    const second = await readAll(file, first.last);
    expect(values(second.lines)).toEqual([3, 4]);
    expect(second.batches[0]?.reset).toBe(false);
  });

  it('commits a grown size even when only a partial line was appended', async () => {
    const dir = await makeTempDir();
    const file = await put(dir, 'a.jsonl', line(1));
    const first = await readAll(file, undefined);
    await appendFile(file, '{"n":');
    const second = await readAll(file, first.last);
    expect(second.batches).toHaveLength(1);
    expect(second.lines).toEqual([]);
    expect(second.last?.byteOffset).toBe(line(1).length);
    expect(second.last?.sizeBytes).toBe(line(1).length + 5);
  });

  it('resumes from a checkpoint committed mid-file even though size and mtime match', async () => {
    const dir = await makeTempDir();
    const file = await put(dir, 'a.jsonl', line(1, 40) + line(2, 40) + line(3, 40));
    const gen = readIncrement(file, undefined, { ...OPTIONS, chunkBytes: 16 });
    const head = await gen.next();
    await gen.return(undefined);
    if (head.done === true) throw new Error('expected a first batch');
    const first: ReadBatch = head.value;
    expect(first.nextCheckpoint.byteOffset).toBeLessThan(first.nextCheckpoint.sizeBytes);

    const rest = await readAll(file, first.nextCheckpoint);
    expect(values([...first.lines, ...rest.lines])).toEqual([1, 2, 3]);
    expect(rest.last?.byteOffset).toBe(rest.last?.sizeBytes);
  });

  it('yields nothing for an untouched file whose last line is still partial', async () => {
    const dir = await makeTempDir();
    const file = await put(dir, 'a.jsonl', `${line(1)}{"n":`);
    const first = await readAll(file, undefined);
    expect(values(first.lines)).toEqual([1]);
    expect((await readAll(file, first.last)).batches).toEqual([]);
  });

  it('reads in bounded chunks; lines longer than a chunk stay intact', async () => {
    const dir = await makeTempDir();
    const content = line(1, 40) + line(2) + line(3, 100) + line(4);
    const file = await put(dir, 'a.jsonl', content);
    const small = await readAll(file, undefined, { ...OPTIONS, chunkBytes: 16 });
    const whole = await readAll(file, undefined);
    expect(values(small.lines)).toEqual([1, 2, 3, 4]);
    expect(small.batches.length).toBeGreaterThan(1);
    expect(small.lines.map((l) => l.offset)).toEqual(whole.lines.map((l) => l.offset));
    expect(small.last).toEqual(whole.last);
    // Checkpoint offsets only ever land just after a newline.
    for (const b of small.batches) expect(content[b.nextCheckpoint.byteOffset - 1]).toBe('\n');
  });

  it('scenario 7: resets to 0 when the file is truncated', async () => {
    const dir = await makeTempDir();
    const file = await put(dir, 'a.jsonl', line(1) + line(2) + line(3));
    const first = await readAll(file, undefined);
    await truncate(file, line(1).length);
    const second = await readAll(file, first.last);
    expect(second.batches[0]?.reset).toBe(true);
    expect(values(second.lines)).toEqual([1]);
    expect(second.last?.byteOffset).toBe(line(1).length);
  });

  it('scenario 7: resets when the head is rewritten in place (same inode, same size)', async () => {
    const dir = await makeTempDir();
    const file = await put(dir, 'a.jsonl', line(1) + line(2));
    const first = await readAll(file, undefined);
    await writeFile(file, line(8) + line(9));
    await utimes(file, new Date(), new Date(Date.now() + 5000));
    const second = await readAll(file, first.last);
    expect(second.last?.fileIdentity).toBe(first.last?.fileIdentity);
    expect(second.batches[0]?.reset).toBe(true);
    expect(values(second.lines)).toEqual([8, 9]);
  });

  it('scenario 7: resets when the file is replaced by another inode', async () => {
    const dir = await makeTempDir();
    const file = await put(dir, 'a.jsonl', line(1));
    const first = await readAll(file, undefined);
    const replacement = await put(dir, 'b.jsonl', line(1) + line(2));
    await rename(replacement, file);
    const second = await readAll(file, first.last);
    expect(second.last?.fileIdentity).not.toBe(first.last?.fileIdentity);
    expect(second.batches[0]?.reset).toBe(true);
    expect(values(second.lines)).toEqual([1, 2]);
  });

  it('does not reset when a file shorter than the head-hash window grows past it', async () => {
    const dir = await makeTempDir();
    const file = await put(dir, 'a.jsonl', line(1));
    const first = await readAll(file, undefined);
    await appendFile(file, line(2, HEAD_HASH_BYTES));
    const second = await readAll(file, first.last);
    expect(second.batches[0]?.reset).toBe(false);
    expect(values(second.lines)).toEqual([2]);
    const third = await readAll(file, second.last);
    expect(third.batches).toEqual([]);
  });

  it('scenario 10: skips an unparseable complete line, counts it, and keeps going', async () => {
    const dir = await makeTempDir();
    const file = await put(dir, 'a.jsonl', `${line(1)}{"n": 2, broken\n\n   \n${line(3)}`);
    const first = await readAll(file, undefined);
    expect(values(first.lines)).toEqual([1, 3]);
    expect(first.last?.parseErrors).toBe(1);
    await appendFile(file, `not json\n${line(4)}`);
    const second = await readAll(file, first.last);
    expect(values(second.lines)).toEqual([4]);
    expect(second.last?.parseErrors).toBe(2);
    // A reset starts the count again.
    const fromScratch = await readAll(file, undefined);
    expect(fromScratch.last?.parseErrors).toBe(2);
  });

  it('replays earlier lines for state recovery without returning them', async () => {
    const dir = await makeTempDir();
    const file = await put(dir, 'a.jsonl', line(1) + line(2));
    const first = await readAll(file, undefined);
    await appendFile(file, line(3));
    const replayed: number[] = [];
    const second = await readAll(file, first.last, {
      ...OPTIONS,
      replayBefore: (l) => replayed.push((l.value as { n: number }).n),
    });
    expect(replayed).toEqual([1, 2]);
    expect(values(second.lines)).toEqual([3]);
  });

  it('refuses a file over the size cap', async () => {
    const dir = await makeTempDir();
    const file = await put(dir, 'a.jsonl', line(1, 200));
    await expect(readAll(file, undefined, { ...OPTIONS, maxFileBytes: 100 })).rejects.toThrow(
      FileTooLargeError,
    );
  });

  it('commits an empty batch for an empty file', async () => {
    const dir = await makeTempDir();
    const file = await put(dir, 'a.jsonl', '');
    const { batches, last } = await readAll(file, undefined);
    expect(batches).toHaveLength(1);
    expect(last).toMatchObject({ byteOffset: 0, sizeBytes: 0, headHash: sha('') });
    expect(path.basename(last?.sourcePath ?? '')).toBe('a.jsonl');
  });
});
