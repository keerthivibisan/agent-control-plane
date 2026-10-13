import { MAX_CHECK_OUTPUT_BYTES, redact } from '@acp/core';

/**
 * The stored part of a check's output (ADR-0017 §3): the last `MAX_CHECK_OUTPUT_BYTES` of stdout
 * and stderr together, in arrival order, redacted. Twice the stored size is kept raw, so a secret
 * that straddles the cut is still whole when `redact()` runs; only then is the text cut to size.
 */
export class OutputTail {
  private chunks: Buffer[] = [];
  private size = 0;
  private dropped = false;

  constructor(private readonly keepBytes = MAX_CHECK_OUTPUT_BYTES * 2) {}

  push(chunk: Buffer): void {
    this.chunks.push(chunk);
    this.size += chunk.length;
    if (this.size <= this.keepBytes * 2) return;
    // Compact only now and then, so a chatty check costs O(output), not O(output × chunks).
    const all = Buffer.concat(this.chunks);
    const kept = all.subarray(all.length - this.keepBytes);
    this.chunks = [Buffer.from(kept)];
    this.size = kept.length;
    this.dropped = true;
  }

  /** Redacted text of at most `MAX_CHECK_OUTPUT_BYTES` (UTF-8), with `notes` at the end. */
  finish(notes: readonly string[] = []): string {
    let raw = Buffer.concat(this.chunks);
    let dropped = this.dropped;
    if (raw.length > this.keepBytes) {
      raw = raw.subarray(raw.length - this.keepBytes);
      dropped = true;
    }
    const text = redact(stripTerminalCodes(decodeFromBoundary(raw)));
    const suffix = notes.map((n) => `\n[${n}]`).join('');
    return fitTail(text, suffix, dropped);
  }
}

const CUT_PREFIX = '[… earlier output cut]\n';

function fitTail(text: string, suffix: string, alreadyCut: boolean): string {
  const max = MAX_CHECK_OUTPUT_BYTES;
  const suffixBytes = Buffer.byteLength(suffix, 'utf8');
  const full = Buffer.from(text, 'utf8');
  if (!alreadyCut && full.length + suffixBytes <= max) return text + suffix;
  const room = max - suffixBytes - Buffer.byteLength(CUT_PREFIX, 'utf8');
  if (room <= 0) return Buffer.from(suffix, 'utf8').subarray(0, max).toString('utf8');
  const tail = full.length > room ? decodeFromBoundary(full.subarray(full.length - room)) : text;
  return CUT_PREFIX + tail + suffix;
}

/** Skips UTF-8 continuation bytes at the start, so a cut never begins in half a character. */
function decodeFromBoundary(bytes: Buffer): string {
  let start = 0;
  while (start < bytes.length && start < 4 && ((bytes[start] ?? 0) & 0xc0) === 0x80) start++;
  return bytes.subarray(start).toString('utf8');
}

/**
 * Colour and cursor escape sequences make no sense outside a terminal, and other control
 * characters (except tab and newline) are dropped so the UI shows plain text.
 */
export function stripTerminalCodes(text: string): string {
  return (
    text
      .replace(
        // eslint-disable-next-line no-control-regex -- matching escape sequences is the point
        /\u001b\[[0-?]*[ -/]*[@-~]|\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)|\u001b[@-_]/g,
        '',
      )
      .replace(/\r\n/g, '\n')
      // eslint-disable-next-line no-control-regex -- see above
      .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '')
  );
}
