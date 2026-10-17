-- 0007_ticket_run_options: a ticket's own run options (RL-H, docs/review-loop/README.md §11).
--
-- Conventions (as in 0001-0006):
--   * A column is added to the existing table (the table is not rebuilt), so 0003 stays
--     untouched. Existing tickets get NULL: every option follows the project, as before.
--   * The JSON object's shape ({approvalMode?, reviewer?, maxReworkRounds?}) is validated with Zod
--     in TypeScript (core's TicketRunOptionsSchema), so a later change can add a key without
--     rebuilding the table. Here it must be a JSON object of bounded length.
--   * NULL means "Project default" for every option; the repository never stores `{}`.
--   * No conversation content (ADR-0009): only owner-chosen enum values and a small number.
--   * Never edit this file after it ships: add a new migration instead.

ALTER TABLE tickets ADD COLUMN run_options TEXT
  CHECK (run_options IS NULL
    OR (length(run_options) <= 500 AND json_valid(run_options)
      AND json_type(run_options) = 'object'));
