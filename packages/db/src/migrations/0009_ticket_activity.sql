-- 0009_ticket_activity: comment kinds, agent notes and attachments (ADR-0026, docs/v0.3.0/README.md
-- part 4, C-A).
--
-- Conventions (as in 0001-0008):
--   * `ticket_comments.kind` is the tab a comment belongs on (core's TicketCommentKindSchema),
--     validated with Zod in TypeScript; here only its length is checked. NULL for every comment
--     stored before 0009: the server derives the kind from the author (ADR-0026).
--   * `ticket_comments.agent_run_id` is the helper or tester that wrote an `agent-note` (the
--     `report_work` tool). One note per agent run: a later call replaces it (the unique index).
--     Deleting the agent run deletes its note, like the run's other comments (ADR-0015).
--   * `ticket_attachments` are the owner's files on a ticket or one of its comments. The bytes
--     live in the app's data folder, content-addressed by SHA-256; the row holds the name the
--     owner gave, the allowlisted type, the size and the hash. The comment belongs to the same
--     ticket (checked by the repository); deleting the comment keeps the file on the ticket.
--   * No conversation content (ADR-0009): notes are text written for the ticket on purpose.
--   * Never edit this file after it ships: add a new migration instead.

ALTER TABLE ticket_comments ADD COLUMN kind TEXT
  CHECK (kind IS NULL OR length(kind) BETWEEN 1 AND 20);
ALTER TABLE ticket_comments ADD COLUMN agent_run_id TEXT
  REFERENCES agent_runs (id) ON DELETE CASCADE;

CREATE UNIQUE INDEX ticket_comments_agent_note ON ticket_comments (agent_run_id)
  WHERE kind = 'agent-note';
CREATE INDEX ticket_comments_kind ON ticket_comments (ticket_id, kind);

CREATE TABLE ticket_attachments (
  id TEXT PRIMARY KEY,
  ticket_id TEXT NOT NULL REFERENCES tickets (id) ON DELETE CASCADE,
  -- NULL: attached to the ticket itself.
  comment_id TEXT REFERENCES ticket_comments (id) ON DELETE SET NULL,
  -- A plain file name (core's AttachmentNameSchema, checked in Zod).
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 200),
  -- One of core's ATTACHMENT_MIME_TYPES (checked in Zod).
  mime_type TEXT NOT NULL CHECK (length(mime_type) BETWEEN 1 AND 100),
  -- At most MAX_ATTACHMENT_BYTES (10 MiB).
  size_bytes INTEGER NOT NULL CHECK (size_bytes BETWEEN 1 AND 10485760),
  sha256 TEXT NOT NULL CHECK (length(sha256) = 64 AND sha256 NOT GLOB '*[^0-9a-f]*'),
  created_at TEXT NOT NULL
) STRICT;

CREATE INDEX ticket_attachments_ticket ON ticket_attachments (ticket_id, created_at);
CREATE INDEX ticket_attachments_comment ON ticket_attachments (comment_id);
CREATE INDEX ticket_attachments_sha256 ON ticket_attachments (sha256);
