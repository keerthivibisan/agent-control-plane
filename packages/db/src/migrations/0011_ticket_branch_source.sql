-- 0011_ticket_branch_source: where a ticket branch started (ADR-0025 §10, docs/v0.3.0/README.md,
-- G-H).
--
-- Conventions (as in 0001-0010):
--   * Additive only: one nullable column on `ticket_branches`. Rows stored before 0011 keep NULL:
--     those branches started from their target (`base_branch`), as every branch did before §10.
--   * `source_branch` is the branch whose tip the ticket branch was created at, set only when it is
--     not the target (the ticket's `from`, or the project strategy's default source). The name is
--     checked in Zod (core's GitBranchNameSchema); here only its length. `base_commit` is that
--     branch's tip at creation, as it was the target's before.
--   * No conversation content (ADR-0009): a branch name.
--   * Never edit this file after it ships: add a new migration instead.

ALTER TABLE ticket_branches ADD COLUMN source_branch TEXT
  CHECK (source_branch IS NULL OR length(source_branch) BETWEEN 1 AND 200);
