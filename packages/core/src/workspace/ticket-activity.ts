import { z } from 'zod';
import { IsoTimestampSchema } from '../domain/time.js';

/**
 * Ticket comments, the activity timeline and attachments (ADR-0026). The ticket page's Comments tab
 * holds people's comments and the lead's whole-ticket summary; its Conversation tab is the
 * activity: what each agent did, reviews, decisions and the run facts. Attachments are files the
 * owner adds, stored in the app's data folder, which agents may read. No conversation content is
 * stored (ADR-0009): every text here is written for the ticket on purpose.
 */

/**
 * What a ticket comment is, so each lands on the right tab. Absent on comments stored before
 * ADR-0026: the server derives it (owner → `comment`, reviewer → `review`, the app → `run-facts` or
 * `system`, the lead → `note`).
 */
export const TicketCommentKindSchema = z.enum([
  /** A person's comment (Comments). */
  'comment',
  /** The lead's summary of the whole ticket, updated by later runs (Comments). */
  'ticket-summary',
  /** A helper's or tester's "what I did" note (Conversation). */
  'agent-note',
  /** A reviewer's findings (Conversation). */
  'review',
  /** The lead's rework, discard or ask note (Conversation). */
  'note',
  /** The facts of a run, composed by the app (Conversation). */
  'run-facts',
  /** A one-line event: a merge, a pull request (Conversation). */
  'system',
]);
export type TicketCommentKind = z.infer<typeof TicketCommentKindSchema>;

/** Kinds shown on the Comments tab; every other kind is on Conversation. */
export const COMMENTS_TAB_KINDS: readonly TicketCommentKind[] = Object.freeze([
  'comment',
  'ticket-summary',
]);

/** Most characters in a helper's or tester's note (the `report_work` tool, ADR-0026 §3). */
export const MAX_AGENT_NOTE_CHARS = 600;
/** Most characters in the lead's ticket summary (its `request_review.summary`). */
export const MAX_TICKET_SUMMARY_CHARS = 1500;

// ---------------------------------------------------------------- attachments

export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
export const MAX_ATTACHMENTS_PER_TICKET = 50;

/**
 * The file types an attachment may have, by its declared type and checked against its content's
 * signature where one exists. Never HTML, SVG or scripts: content is always served as a download
 * or as an image with `X-Content-Type-Options: nosniff`.
 */
export const ATTACHMENT_MIME_TYPES = [
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'text/plain',
  'text/markdown',
  'text/csv',
  'application/json',
  'application/pdf',
  'application/zip',
  'application/gzip',
] as const;
export const AttachmentMimeTypeSchema = z.enum(ATTACHMENT_MIME_TYPES);
export type AttachmentMimeType = z.infer<typeof AttachmentMimeTypeSchema>;

/** A file name as shown and downloaded: no folders, no control characters, not dot-led. */
export const AttachmentNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .refine(
    (n) =>
      !n.includes('/') &&
      !n.includes('\\') &&
      !n.startsWith('.') &&
      [...n].every((ch) => {
        const code = ch.charCodeAt(0);
        return code >= 0x20 && code !== 0x7f;
      }),
    'a plain file name (no folders)',
  );

export const AttachmentSchema = z.object({
  id: z.string().min(1),
  ticketId: z.string().min(1),
  /** The comment it belongs to; null when it is attached to the ticket itself. */
  commentId: z.string().min(1).nullable(),
  name: AttachmentNameSchema,
  mimeType: AttachmentMimeTypeSchema,
  sizeBytes: z.number().int().positive().max(MAX_ATTACHMENT_BYTES),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  createdAt: IsoTimestampSchema,
});
export type Attachment = z.infer<typeof AttachmentSchema>;

// ---------------------------------------------------------------- activity

/** What happened, for the Conversation tab. */
export const ActivityTypeSchema = z.enum([
  'run-started',
  'run-ended',
  'plan',
  'agent-started',
  'agent-ended',
  'agent-note',
  'review',
  'note',
  'decision',
  'run-facts',
  'merge',
  'pull-request',
]);
export type ActivityType = z.infer<typeof ActivityTypeSchema>;

export const ActivityActorKindSchema = z.enum([
  'owner',
  'lead',
  'planner',
  'worker',
  'tester',
  'reviewer',
  'app',
]);
export type ActivityActorKind = z.infer<typeof ActivityActorKindSchema>;
