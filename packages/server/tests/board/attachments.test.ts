import { existsSync, readFileSync, statSync } from 'node:fs';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { MAX_ATTACHMENT_BYTES } from '@acp/core';
import { AttachmentDtoSchema, CSRF_HEADER, TicketCommentDtoSchema } from '@acp/core/api';
import {
  allowedMimeType,
  contentDisposition,
  contentMatches,
} from '../../src/attachments/content.js';
import { commentKindOf } from '../../src/board/comments.js';
import { setupBoard } from './helpers.js';

/*
 * ADR-0026 §4 (C-A): the owner's attachments through the HTTP API: upload (allowlisted type,
 * plain name, size limit while streaming, content checked against the type), list, serve
 * (nosniff, a download except images, a sandbox policy), attach to a comment, delete with the
 * file. Synthetic bytes only.
 */

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
const TEXT = Buffer.from('Steps to reproduce:\n1. Open settings\n', 'utf8');

type Board = Awaited<ReturnType<typeof setupBoard>>;

const errorCode = (res: { body: unknown }): string =>
  (res.body as { error: { code: string } }).error.code;

function upload(
  s: Board,
  ticketId: string,
  bytes: Buffer,
  type: string,
  name: string,
  options: { csrf?: boolean; query?: string } = {},
) {
  let r = request(s.app)
    .post(`/api/tickets/${ticketId}/attachments${options.query ?? ''}`)
    .set('Content-Type', type)
    .set('X-Attachment-Name', encodeURIComponent(name));
  if (options.csrf !== false) r = r.set(CSRF_HEADER, s.token);
  return r.send(bytes);
}

describe('attachments over HTTP (ADR-0026 §4)', () => {
  it('uploads, lists, serves and deletes, keeping one file per content', async () => {
    const s = await setupBoard();
    const ticket = await s.createTicket('Dark mode');
    const res = await upload(s, ticket.id, PNG, 'image/png', 'screen shot ü.png');
    expect(res.status).toBe(201);
    const shot = AttachmentDtoSchema.parse(res.body);
    expect(shot).toMatchObject({
      ticketId: ticket.id,
      commentId: null,
      name: 'screen shot ü.png',
      mimeType: 'image/png',
      sizeBytes: PNG.byteLength,
      contentUrl: `/api/attachments/${shot.id}/content`,
    });
    const file = s.control.attachmentFiles.pathOf(shot.sha256);
    expect(file.startsWith(s.dataDir)).toBe(true);
    expect(readFileSync(file).equals(PNG)).toBe(true);
    expect(statSync(file).mode & 0o777).toBe(0o400);

    const copy = await upload(s, ticket.id, PNG, 'image/png', 'again.png');
    expect(copy.status).toBe(201);
    const notes = await upload(s, ticket.id, TEXT, 'text/plain; charset=utf-8', 'notes.txt');
    expect(notes.status).toBe(201);

    const list = await s.get(`/api/tickets/${ticket.id}/attachments`);
    expect(list.status).toBe(200);
    expect((list.body as { name: string }[]).map((a) => a.name)).toEqual([
      'screen shot ü.png',
      'again.png',
      'notes.txt',
    ]);

    const image = await s.get(shot.contentUrl).buffer(true);
    expect(image.status).toBe(200);
    expect(image.headers['content-type']).toBe('image/png');
    expect(image.headers['x-content-type-options']).toBe('nosniff');
    expect(image.headers['content-disposition']).toBe(
      `inline; filename="screen shot _.png"; filename*=UTF-8''screen%20shot%20%C3%BC.png`,
    );
    expect(image.headers['content-security-policy']).toContain('sandbox');
    expect(Buffer.from(image.body as Buffer).equals(PNG)).toBe(true);
    const text = await s.get(`/api/attachments/${(notes.body as { id: string }).id}/content`);
    expect(text.headers['content-type']).toBe('text/plain; charset=utf-8');
    expect(text.headers['content-disposition']).toMatch(/^attachment; filename="notes.txt"/);
    expect(text.text).toBe(TEXT.toString('utf8'));

    // Deleting one of two rows of the same content keeps the file; the last one removes it.
    expect((await s.send('delete', `/api/attachments/${shot.id}`)).status).toBe(204);
    expect(existsSync(file)).toBe(true);
    expect(
      (await s.send('delete', `/api/attachments/${(copy.body as { id: string }).id}`)).status,
    ).toBe(204);
    expect(existsSync(file)).toBe(false);
    expect((await s.get(shot.contentUrl)).status).toBe(404);
    expect((await s.send('delete', `/api/attachments/${shot.id}`)).status).toBe(404);
  });

  it('refuses a missing CSRF token, a type off the list, a bad name, a mismatch and an empty file', async () => {
    const s = await setupBoard();
    const ticket = await s.createTicket('Dark mode');
    expect((await upload(s, ticket.id, PNG, 'image/png', 'a.png', { csrf: false })).status).toBe(
      403,
    );
    const html = await upload(s, ticket.id, Buffer.from('<b>x</b>'), 'text/html', 'a.html');
    expect(html.status).toBe(415);
    expect(errorCode(html)).toBe('attachment_type_not_allowed');
    const svg = await upload(s, ticket.id, Buffer.from('<svg/>'), 'image/svg+xml', 'a.svg');
    expect(svg.status).toBe(415);
    for (const name of ['../a.png', '.hidden.png', 'a/b.png', '']) {
      const bad = await upload(s, ticket.id, PNG, 'image/png', name);
      expect(bad.status, name).toBe(400);
    }
    const lying = await upload(s, ticket.id, TEXT, 'image/png', 'fake.png');
    expect(lying.status).toBe(415);
    expect(errorCode(lying)).toBe('attachment_content_mismatch');
    const binary = await upload(
      s,
      ticket.id,
      Buffer.from([0xff, 0xfe, 0x00]),
      'text/plain',
      'b.txt',
    );
    expect(errorCode(binary)).toBe('attachment_content_mismatch');
    expect((await upload(s, ticket.id, Buffer.alloc(0), 'text/plain', 'e.txt')).status).toBe(400);
    expect((await upload(s, 'no-ticket', PNG, 'image/png', 'a.png')).status).toBe(404);
    expect((await s.get(`/api/tickets/${ticket.id}/attachments`)).body).toEqual([]);
  });

  it('answers 413 for a file over the limit', async () => {
    const s = await setupBoard();
    const ticket = await s.createTicket('Dark mode');
    const big = Buffer.alloc(MAX_ATTACHMENT_BYTES + 1, 0x61);
    const res = await upload(s, ticket.id, big, 'text/plain', 'big.txt');
    expect(res.status).toBe(413);
    expect((await s.get(`/api/tickets/${ticket.id}/attachments`)).body).toEqual([]);
  });

  it('attaches uploads to a new comment, or to a comment by ?commentId=, never across tickets', async () => {
    const s = await setupBoard();
    const ticket = await s.createTicket('Dark mode');
    const other = await s.createTicket('Other');
    const a = AttachmentDtoSchema.parse(
      (await upload(s, ticket.id, TEXT, 'text/markdown', 'a.md')).body,
    );
    const elsewhere = AttachmentDtoSchema.parse(
      (await upload(s, other.id, TEXT, 'text/csv', 'b.csv')).body,
    );
    const foreign = await s.post(`/api/tickets/${ticket.id}/comments`, {
      body: 'See the file',
      attachmentIds: [a.id, elsewhere.id],
    });
    expect(foreign.status).toBe(404);
    // All or none: the failed comment was not stored and the file is still unattached.
    expect((await s.detail(ticket.id)).comments).toEqual([]);

    const created = await s.post(`/api/tickets/${ticket.id}/comments`, {
      body: 'See the file',
      attachmentIds: [a.id],
    });
    expect(created.status).toBe(201);
    const comment = TicketCommentDtoSchema.parse(created.body);
    expect(comment).toMatchObject({ kind: 'comment', author: 'owner', agentRunId: null });
    expect(comment.attachments?.map((x) => x.id)).toEqual([a.id]);
    const again = await s.post(`/api/tickets/${ticket.id}/comments`, {
      body: 'Twice',
      attachmentIds: [a.id],
    });
    expect(again.status).toBe(409);

    const onComment = await upload(s, ticket.id, PNG, 'image/png', 'c.png', {
      query: `?commentId=${comment.id}`,
    });
    expect(onComment.status).toBe(201);
    expect(AttachmentDtoSchema.parse(onComment.body).commentId).toBe(comment.id);
    const wrong = await upload(s, other.id, PNG, 'image/png', 'c.png', {
      query: `?commentId=${comment.id}`,
    });
    expect(wrong.status).toBe(404);

    const detail = await s.detail(ticket.id);
    expect(detail.comments[0]?.attachments?.map((x) => x.name)).toEqual(['a.md', 'c.png']);
  });
});

describe('attachment content checks (ADR-0026 §4)', () => {
  it('knows the allowlist and each signature', () => {
    expect(allowedMimeType('Image/PNG; x=1')).toBe('image/png');
    expect(allowedMimeType('text/html')).toBeNull();
    expect(allowedMimeType(undefined)).toBeNull();
    const ok: [Parameters<typeof contentMatches>[0], number[]][] = [
      ['image/jpeg', [0xff, 0xd8, 0xff, 0xe0]],
      ['image/gif', [...Buffer.from('GIF89a')]],
      ['image/webp', [...Buffer.from('RIFF\0\0\0\0WEBPVP8 ')]],
      ['application/pdf', [...Buffer.from('%PDF-1.7')]],
      ['application/zip', [0x50, 0x4b, 0x03, 0x04]],
      ['application/gzip', [0x1f, 0x8b, 8]],
      ['application/json', [...Buffer.from('{"a":1}')]],
    ];
    for (const [type, bytes] of ok) {
      expect(contentMatches(type, Uint8Array.from(bytes)), type).toBe(true);
      expect(contentMatches(type, Uint8Array.from([0x00, 0x01, 0x02, 0x03])), type).toBe(false);
    }
  });

  it('builds a safe Content-Disposition', () => {
    expect(contentDisposition('a"b\\c.txt', false)).toBe(
      `attachment; filename="a_b_c.txt"; filename*=UTF-8''a%22b%5Cc.txt`,
    );
  });
});

describe('comment kinds of older comments (ADR-0026 §1)', () => {
  it('derives the kind from the author', () => {
    const base = {
      id: 'c',
      ticketId: 't',
      runId: null,
      planId: null,
      createdAt: '2026-10-22T09:00:00.000Z',
      kind: null,
      agentRunId: null,
    };
    expect(commentKindOf({ ...base, author: 'owner', body: 'x' })).toBe('comment');
    expect(commentKindOf({ ...base, author: 'reviewer', body: 'x' })).toBe('review');
    expect(commentKindOf({ ...base, author: 'lead', body: 'x' })).toBe('note');
    expect(commentKindOf({ ...base, author: 'app', body: 'Run summary\n\nx' })).toBe('run-facts');
    expect(commentKindOf({ ...base, author: 'app', body: 'Merged acp/X into main.' })).toBe(
      'system',
    );
    expect(commentKindOf({ ...base, author: 'app', body: 'x', kind: 'agent-note' })).toBe(
      'agent-note',
    );
  });
});
