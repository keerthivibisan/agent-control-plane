import { createHash } from 'node:crypto';
import { open } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import type { Checkpoint } from '@acp/core';
import { OPEN_FLAGS } from './discovery.js';

/** `Checkpoint.headHash` covers at most this many leading bytes. */
export const HEAD_HASH_BYTES = 4096;
export const DEFAULT_CHUNK_BYTES = 1024 * 1024;

const NEWLINE = 0x0a;

/** A file that is over the size cap when opened for reading. */
export class FileTooLargeError extends Error {
  override readonly name = 'FileTooLargeError';
  constructor(
    readonly sizeBytes: number,
    readonly capBytes: number,
  ) {
    super(`file is ${sizeBytes} bytes; the cap is ${capBytes}`);
  }
}

/** A complete, JSON-parseable line. `raw` excludes the terminating `\n`. */
export interface ParsedLine {
  /** Byte offset of the line's first byte. */
  offset: number;
  raw: Buffer;
  value: unknown;
}

export interface ReadBatch {
  lines: ParsedLine[];
  /** Position after the last complete line of this batch (plus counters), to commit with it. */
  nextCheckpoint: Checkpoint;
  /** True on the first batch after the checkpoint no longer matched the file (offset reset to 0). */
  reset: boolean;
}

export interface ReadOptions {
  maxFileBytes: number;
  chunkBytes: number;
  /**
   * Called with every parseable line before the checkpoint's offset, before any new data is read.
   * Lets a caller rebuild per-file state (e.g. the last `cwd`) after a restart. No events come
   * from these lines.
   */
  replayBefore?: (line: ParsedLine) => void;
}

/**
 * Incremental JSONL reader (docs/provider-adapters.md §4.2; usage-accounting §7 scenarios 6, 7, 10).
 *
 * - Compares the file with the checkpoint (`dev:ino`, size, head hash). On a mismatch it starts
 *   again at offset 0 and resets `parseErrors`; dedup keys make the re-read idempotent.
 * - Reads in chunks of `chunkBytes` up to the size seen at open time, and only up to the last
 *   `\n`. A partial last line is left for the next pass.
 * - Skips unparseable complete lines and counts them in `parseErrors`. Blank lines are ignored.
 * - Yields one batch per chunk that completes at least one line. If nothing new was read, it
 *   yields one empty batch so the pipeline can still commit a reset or a changed size.
 * - Yields nothing when the file's identity, size, and mtime equal the checkpoint's.
 */
export async function* readIncrement(
  file: string,
  checkpoint: Checkpoint | undefined,
  options: ReadOptions,
): AsyncGenerator<ReadBatch> {
  const fh = await open(file, OPEN_FLAGS);
  try {
    const st = await fh.stat();
    if (st.size > options.maxFileBytes) throw new FileTooLargeError(st.size, options.maxFileBytes);
    const fileIdentity = `${st.dev}:${st.ino}`;
    if (
      checkpoint !== undefined &&
      checkpoint.fileIdentity === fileIdentity &&
      checkpoint.sizeBytes === st.size &&
      checkpoint.mtimeMs === st.mtimeMs
    ) {
      return;
    }

    let start = 0;
    let parseErrors = 0;
    let reset = false;
    if (checkpoint !== undefined) {
      const matches =
        checkpoint.fileIdentity === fileIdentity &&
        checkpoint.byteOffset <= st.size &&
        (await headHash(fh, checkpoint.byteOffset)) === checkpoint.headHash;
      if (matches) {
        start = checkpoint.byteOffset;
        parseErrors = checkpoint.parseErrors;
      } else {
        reset = true;
      }
    }

    if (options.replayBefore !== undefined && start > 0) {
      for await (const chunk of completeLines(fh, 0, start, options.chunkBytes)) {
        for (const line of chunk.lines) {
          const parsed = parseLine(line.raw);
          if (parsed.kind === 'ok') options.replayBefore({ ...line, value: parsed.value });
        }
      }
    }

    const base = {
      sourcePath: file,
      fileIdentity,
      sizeBytes: st.size,
      mtimeMs: st.mtimeMs,
    };
    let yielded = false;
    for await (const chunk of completeLines(fh, start, st.size, options.chunkBytes)) {
      const lines: ParsedLine[] = [];
      for (const line of chunk.lines) {
        const parsed = parseLine(line.raw);
        if (parsed.kind === 'blank') continue;
        if (parsed.kind === 'invalid') {
          parseErrors += 1;
          continue;
        }
        lines.push({ ...line, value: parsed.value });
      }
      yield {
        lines,
        reset: reset && !yielded,
        nextCheckpoint: {
          ...base,
          byteOffset: chunk.endOffset,
          headHash: await headHash(fh, chunk.endOffset),
          parseErrors,
        },
      };
      yielded = true;
    }
    if (!yielded) {
      yield {
        lines: [],
        reset,
        nextCheckpoint: {
          ...base,
          byteOffset: start,
          headHash: await headHash(fh, start),
          parseErrors,
        },
      };
    }
  } finally {
    await fh.close();
  }
}

/** sha256 hex of the first `min(HEAD_HASH_BYTES, consumedBytes)` bytes. */
export async function headHash(fh: FileHandle, consumedBytes: number): Promise<string> {
  const length = Math.min(HEAD_HASH_BYTES, consumedBytes);
  const buf = Buffer.alloc(length);
  const { bytesRead } = length > 0 ? await fh.read(buf, 0, length, 0) : { bytesRead: 0 };
  return createHash('sha256').update(buf.subarray(0, bytesRead)).digest('hex');
}

interface RawLine {
  offset: number;
  raw: Buffer;
}

/**
 * Yields the complete lines in `[start, end)`, one group per chunk that finishes at least one
 * line. A line longer than a chunk is accumulated until its newline arrives. Bytes after the last
 * newline are never yielded.
 */
async function* completeLines(
  fh: FileHandle,
  start: number,
  end: number,
  chunkBytes: number,
): AsyncGenerator<{ lines: RawLine[]; endOffset: number }> {
  let pos = start;
  let carry: Buffer[] = [];
  let carryStart = start;
  while (pos < end) {
    const length = Math.min(chunkBytes, end - pos);
    const buf = Buffer.allocUnsafe(length);
    const { bytesRead } = await fh.read(buf, 0, length, pos);
    if (bytesRead === 0) break; // the file shrank while reading; the next pass will reset
    const chunk = buf.subarray(0, bytesRead);
    pos += bytesRead;
    const lastNewline = chunk.lastIndexOf(NEWLINE);
    if (lastNewline === -1) {
      carry.push(chunk);
      continue;
    }
    const data = Buffer.concat([...carry, chunk.subarray(0, lastNewline + 1)]);
    const dataStart = carryStart;
    carry = [chunk.subarray(lastNewline + 1)];
    carryStart = pos - (bytesRead - lastNewline - 1);

    const lines: RawLine[] = [];
    let lineStart = 0;
    for (let i = data.indexOf(NEWLINE); i !== -1; i = data.indexOf(NEWLINE, i + 1)) {
      lines.push({ offset: dataStart + lineStart, raw: data.subarray(lineStart, i) });
      lineStart = i + 1;
    }
    yield { lines, endOffset: dataStart + data.length };
  }
}

type LineParse = { kind: 'ok'; value: unknown } | { kind: 'blank' } | { kind: 'invalid' };

function parseLine(raw: Buffer): LineParse {
  // A newline byte never occurs inside a multi-byte UTF-8 sequence, so per-line decoding is safe.
  const text = raw.toString('utf8');
  if (text.trim() === '') return { kind: 'blank' };
  try {
    return { kind: 'ok', value: JSON.parse(text) as unknown };
  } catch {
    return { kind: 'invalid' };
  }
}
