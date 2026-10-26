import {
  ATTACHMENT_MIME_TYPES,
  AttachmentNameSchema,
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENTS_PER_TICKET,
  type AttachmentMimeType,
} from '@acp/core';

/*
 * The browser's checks before an upload (ADR-0026 §4): the same limits the server applies, so a
 * file that would be refused is never sent. The server checks everything again, content included.
 */

/**
 * Most attachments on one comment: the comment request's `attachmentIds` limit
 * (`TicketCommentRequestSchema`; a test pins the two together).
 */
export const MAX_ATTACHMENTS_PER_COMMENT = 10;

/**
 * A file's type when the browser reports none, or a variant name of an allowed one
 * (`application/x-zip-compressed`): by its extension. Never HTML or SVG.
 */
const BY_EXTENSION: Readonly<Record<string, AttachmentMimeType>> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  txt: 'text/plain',
  log: 'text/plain',
  md: 'text/markdown',
  markdown: 'text/markdown',
  csv: 'text/csv',
  json: 'application/json',
  pdf: 'application/pdf',
  zip: 'application/zip',
  gz: 'application/gzip',
  tgz: 'application/gzip',
};

/** What the file picker offers: the allowed types and their extensions. */
export const ATTACHMENT_ACCEPT = [
  ...ATTACHMENT_MIME_TYPES,
  ...Object.keys(BY_EXTENSION).map((e) => `.${e}`),
].join(',');

function isAllowed(type: string): type is AttachmentMimeType {
  return (ATTACHMENT_MIME_TYPES as readonly string[]).includes(type);
}

/** The allowed type to send for a file, or null when it may not be attached. */
export function attachmentType(file: { name: string; type: string }): AttachmentMimeType | null {
  const declared = file.type.split(';')[0]?.trim().toLowerCase() ?? '';
  // A type the allowlist names outright; anything that looks like markup or a script never is.
  if (isAllowed(declared)) return declared;
  if (/html|svg|xml|javascript|ecmascript/.test(declared)) return null;
  const ext = /\.([a-z0-9]+)$/i.exec(file.name)?.[1]?.toLowerCase();
  return ext === undefined ? null : (BY_EXTENSION[ext] ?? null);
}

export type FileRefusal =
  | { kind: 'tooBig' }
  | { kind: 'empty' }
  | { kind: 'type' }
  | { kind: 'name' }
  | { kind: 'tooMany' }
  | { kind: 'perComment'; max: number };

export type FileCheck =
  { ok: true; mimeType: AttachmentMimeType } | { ok: false; why: FileRefusal };

/**
 * Whether one more file may be attached: its size, type and name, and room on the ticket
 * (`onTicket` attachments already there) and, for a comment, on the comment (`onComment`).
 */
export function checkFile(
  file: { name: string; type: string; size: number },
  room: { onTicket: number; onComment?: number },
): FileCheck {
  if (room.onTicket >= MAX_ATTACHMENTS_PER_TICKET) return { ok: false, why: { kind: 'tooMany' } };
  if (room.onComment !== undefined && room.onComment >= MAX_ATTACHMENTS_PER_COMMENT) {
    return { ok: false, why: { kind: 'perComment', max: MAX_ATTACHMENTS_PER_COMMENT } };
  }
  if (!AttachmentNameSchema.safeParse(file.name).success) {
    return { ok: false, why: { kind: 'name' } };
  }
  if (file.size === 0) return { ok: false, why: { kind: 'empty' } };
  if (file.size > MAX_ATTACHMENT_BYTES) return { ok: false, why: { kind: 'tooBig' } };
  const mimeType = attachmentType(file);
  if (mimeType === null) return { ok: false, why: { kind: 'type' } };
  return { ok: true, mimeType };
}

export function isImage(mimeType: string): boolean {
  return mimeType.startsWith('image/');
}

/** "820 B", "14.2 KB", "3.4 MB": file sizes in 1,024s, as file managers show them. */
export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10 * 1024 ? 1 : 0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
