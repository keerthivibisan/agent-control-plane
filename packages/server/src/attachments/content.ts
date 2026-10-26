import { createHash } from 'node:crypto';
import { ATTACHMENT_MIME_TYPES, type AttachmentMimeType } from '@acp/core';

/**
 * Checks on an uploaded attachment's bytes (ADR-0026 §4). The declared type must be on the
 * allowlist, and the content must match it: a known signature for images, PDF, zip and gzip, and
 * valid UTF-8 without NUL bytes for the text types. A mismatch is refused, never re-typed, so a
 * file is always served as what it was checked to be.
 */

/** The declared `Content-Type`, lower-cased and without parameters, if it is allowed. */
export function allowedMimeType(header: string | undefined): AttachmentMimeType | null {
  if (header === undefined) return null;
  const bare = header.split(';', 1)[0]?.trim().toLowerCase() ?? '';
  return (ATTACHMENT_MIME_TYPES as readonly string[]).includes(bare)
    ? (bare as AttachmentMimeType)
    : null;
}

function startsWith(bytes: Uint8Array, signature: readonly number[], at = 0): boolean {
  if (bytes.length < at + signature.length) return false;
  return signature.every((b, i) => bytes[at + i] === b);
}

const ascii = (text: string): number[] => [...text].map((c) => c.charCodeAt(0));

const SIGNATURES: Readonly<Partial<Record<AttachmentMimeType, (b: Uint8Array) => boolean>>> = {
  'image/png': (b) => startsWith(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  'image/jpeg': (b) => startsWith(b, [0xff, 0xd8, 0xff]),
  'image/gif': (b) => startsWith(b, ascii('GIF87a')) || startsWith(b, ascii('GIF89a')),
  'image/webp': (b) => startsWith(b, ascii('RIFF')) && startsWith(b, ascii('WEBP'), 8),
  'application/pdf': (b) => startsWith(b, ascii('%PDF-')),
  // A local file header, or the end record of an empty archive.
  'application/zip': (b) =>
    startsWith(b, [0x50, 0x4b, 0x03, 0x04]) || startsWith(b, [0x50, 0x4b, 0x05, 0x06]),
  'application/gzip': (b) => startsWith(b, [0x1f, 0x8b]),
};

const TEXT_TYPES: readonly AttachmentMimeType[] = [
  'text/plain',
  'text/markdown',
  'text/csv',
  'application/json',
];

export function isTextType(mimeType: AttachmentMimeType): boolean {
  return TEXT_TYPES.includes(mimeType);
}

/** Whether the bytes are what the declared type says (see the module comment). */
export function contentMatches(mimeType: AttachmentMimeType, bytes: Uint8Array): boolean {
  if (isTextType(mimeType)) {
    if (bytes.includes(0)) return false;
    try {
      new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      return true;
    } catch {
      return false;
    }
  }
  return SIGNATURES[mimeType]?.(bytes) ?? false;
}

export function sha256Of(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/** Images may show inline; everything else is a download. */
export function isInlineType(mimeType: AttachmentMimeType): boolean {
  return mimeType.startsWith('image/');
}

/**
 * `Content-Disposition` for a download or an inline image: an ASCII fallback name (anything else
 * becomes `_`, quotes and backslashes too) plus the exact name in RFC 5987 form.
 */
export function contentDisposition(name: string, inline: boolean): string {
  const fallback = [...name]
    .map((c) => (/^[\x20-\x7e]$/.test(c) && c !== '"' && c !== '\\' ? c : '_'))
    .join('');
  const encoded = encodeURIComponent(name).replace(
    /['()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `${inline ? 'inline' : 'attachment'}; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}
