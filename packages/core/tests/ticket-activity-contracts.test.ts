// Contract tests for comments, activity and attachments (ADR-0026, v0.3.0 C-0). Additive: older
// comment shapes still parse. Synthetic data only.
import { describe, expect, it } from 'vitest';
import {
  AttachmentNameSchema,
  AttachmentSchema,
  COMMENTS_TAB_KINDS,
  MAX_ATTACHMENT_BYTES,
} from '../src/index.js';
import {
  ActivityItemDtoSchema,
  TicketCommentDtoSchema,
  TicketCommentRequestSchema,
} from '../src/api/index.js';

const T = '2026-10-22T09:00:00.000Z';
const comment = {
  id: 'c1',
  ticketId: 't1',
  runId: null,
  planId: null,
  author: 'owner',
  body: 'Hi',
  createdAt: T,
};
const file = {
  id: 'a1',
  ticketId: 't1',
  commentId: null,
  name: 'screen.png',
  mimeType: 'image/png',
  sizeBytes: 1200,
  sha256: 'a'.repeat(64),
  createdAt: T,
};

describe('comments, activity and attachments (ADR-0026)', () => {
  it('keeps older comments valid and adds kind, agent and attachments', () => {
    expect(TicketCommentDtoSchema.parse(comment)).toEqual(comment);
    const withMore = {
      ...comment,
      kind: 'ticket-summary',
      attachments: [{ ...file, contentUrl: '/api/attachments/a1/content' }],
    };
    expect(TicketCommentDtoSchema.parse(withMore).attachments).toHaveLength(1);
    expect(COMMENTS_TAB_KINDS).toEqual(['comment', 'ticket-summary']);
    expect(
      TicketCommentRequestSchema.parse({ body: 'x', attachmentIds: ['a1'] }).attachmentIds,
    ).toEqual(['a1']);
  });

  it('accepts only allowed, plain attachments within the size limit', () => {
    expect(AttachmentSchema.parse(file).name).toBe('screen.png');
    expect(AttachmentSchema.safeParse({ ...file, mimeType: 'text/html' }).success).toBe(false);
    expect(AttachmentSchema.safeParse({ ...file, mimeType: 'image/svg+xml' }).success).toBe(false);
    expect(
      AttachmentSchema.safeParse({ ...file, sizeBytes: MAX_ATTACHMENT_BYTES + 1 }).success,
    ).toBe(false);
    for (const bad of ['../x.png', 'a/b.png', '.env', 'a\u0000b']) {
      expect(AttachmentNameSchema.safeParse(bad).success, bad).toBe(false);
    }
  });

  it('parses an activity item with an actor and a link', () => {
    const item = {
      id: 'i1',
      at: T,
      runId: 'r1',
      type: 'agent-note',
      actor: { kind: 'worker', label: 'Frontend helper', agentRunId: 'ag1' },
      title: 'Frontend helper wrote a note',
      body: 'Added the switch.',
      link: { kind: 'change', agentRunId: 'ag1' },
    };
    expect(ActivityItemDtoSchema.parse(item).actor.label).toBe('Frontend helper');
    expect(
      ActivityItemDtoSchema.safeParse({ ...item, link: { kind: 'pull-request', url: 'nope' } })
        .success,
    ).toBe(false);
  });

  it('lets the owner send a comment or a review, nothing else', () => {
    expect(TicketCommentRequestSchema.parse({ body: 'Hi' }).kind).toBeUndefined();
    expect(TicketCommentRequestSchema.parse({ body: 'Hi', kind: 'review' }).kind).toBe('review');
    for (const kind of ['ticket-summary', 'agent-note', 'run-facts', 'note', 'system']) {
      expect(TicketCommentRequestSchema.safeParse({ body: 'Hi', kind }).success, kind).toBe(false);
    }
  });
});
