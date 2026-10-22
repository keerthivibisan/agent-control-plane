import { z } from 'zod';
import { IsoTimestampSchema } from '../domain/time.js';
import {
  ActivityActorKindSchema,
  ActivityTypeSchema,
  AttachmentSchema,
} from '../workspace/ticket-activity.js';

/**
 * The ticket's activity and attachments over HTTP (ADR-0026). Mutations need the `X-ACP-CSRF`
 * header.
 *
 * - `GET /api/tickets/:id/activity` → `TicketActivityDto` (the Conversation tab).
 * - `POST /api/tickets/:id/attachments` (raw body; `Content-Type` one of the allowed types; the
 *   file name in `X-Attachment-Name`, URI-encoded; optional `?commentId=`) → `AttachmentDto`.
 * - `GET /api/tickets/:id/attachments` → `AttachmentDto[]`.
 * - `GET /api/attachments/:id/content` → the bytes, as a download (images may show inline), with
 *   `X-Content-Type-Options: nosniff`.
 * - `DELETE /api/attachments/:id` → 204.
 */

export const AttachmentDtoSchema = AttachmentSchema.extend({
  /** `/api/attachments/:id/content`. */
  contentUrl: z.string().min(1),
});
export type AttachmentDto = z.infer<typeof AttachmentDtoSchema>;

export const ActivityItemDtoSchema = z.object({
  id: z.string().min(1),
  at: IsoTimestampSchema,
  /** The run it happened in; null for ticket-level events. */
  runId: z.string().min(1).nullable(),
  type: ActivityTypeSchema,
  actor: z.object({
    kind: ActivityActorKindSchema,
    /** The block label or role, e.g. "Frontend helper", "Lead", "You", "Agent Control Plane". */
    label: z.string().min(1).max(120),
    agentRunId: z.string().min(1).nullable(),
  }),
  /** One plain line, e.g. "Frontend helper started" or "Merged a change from Helpers". */
  title: z.string().min(1).max(300),
  /** The text written for the ticket (a note, findings, facts), if any. */
  body: z.string().max(8000).nullable(),
  /** Where the item points: a change's review page, the ticket branch files, a pull request. */
  link: z
    .discriminatedUnion('kind', [
      z.object({ kind: z.literal('change'), agentRunId: z.string().min(1) }),
      z.object({ kind: z.literal('files') }),
      z.object({ kind: z.literal('pull-request'), url: z.string().url() }),
      z.object({ kind: z.literal('plan'), planId: z.string().min(1) }),
    ])
    .nullable(),
});
export type ActivityItemDto = z.infer<typeof ActivityItemDtoSchema>;

/** Oldest first. */
export const TicketActivityDtoSchema = z.object({
  ticketId: z.string().min(1),
  items: z.array(ActivityItemDtoSchema),
});
export type TicketActivityDto = z.infer<typeof TicketActivityDtoSchema>;
