-- 0016_plan_options: several planners' plan drafts per run (ADR-0037 §4, docs/arrows/README.md,
-- AR-4).
--
-- Conventions (as in 0001-0015):
--   * Additive only: one new table. `ticket_plans` is not rebuilt: migrations run in one
--     transaction with foreign keys on, so dropping it would cascade into `ticket_comments`
--     (`plan_id`), and its UNIQUE (run_id, version) cannot be relaxed without a rebuild. Every
--     existing plan row stays valid and every reader of `ticket_plans` is unchanged: the chosen
--     option is stored there as the run's plan exactly like a single planner's plan.
--   * A run with two or more planners holds one row here per submitted option, numbered 1, 2, ...
--     per run (`option_index`, in submission order). `status` is `proposed`, `chosen`,
--     `not-chosen` or `superseded` (core's TicketPlanOptionStatusSchema, checked in Zod; its
--     length here). `plan_id` is the plan the chosen option became, set only on `chosen`.
--   * `node_id` and `label` are the planner's node in the run's graph and its label (owner text);
--     `steps` is the same JSON array as `ticket_plans.steps` (core's PlanStepSchema).
--   * Deleting the run deletes its options (ADR-0015), and deleting the chosen plan deletes it.
--   * No conversation content (ADR-0009): a plan summary and steps, as `ticket_plans` holds.
--   * Never edit this file after it ships: add a new migration instead.

CREATE TABLE ticket_plan_options (
  id TEXT PRIMARY KEY,
  ticket_id TEXT NOT NULL REFERENCES tickets (id) ON DELETE CASCADE,
  run_id TEXT NOT NULL,
  option_index INTEGER NOT NULL CHECK (option_index >= 1),
  agent_run_id TEXT NOT NULL CHECK (length(agent_run_id) BETWEEN 1 AND 200),
  node_id TEXT NOT NULL CHECK (length(node_id) BETWEEN 1 AND 64),
  label TEXT NOT NULL CHECK (length(label) BETWEEN 1 AND 40),
  summary TEXT NOT NULL CHECK (length(summary) BETWEEN 1 AND 2000),
  steps TEXT NOT NULL CHECK (json_valid(steps) AND json_type(steps) = 'array'),
  planned_helpers INTEGER NOT NULL CHECK (planned_helpers >= 0),
  status TEXT NOT NULL CHECK (length(status) BETWEEN 1 AND 20),
  plan_id TEXT,
  created_at TEXT NOT NULL,
  decided_at TEXT,
  UNIQUE (run_id, option_index),
  CHECK ((status = 'chosen') = (plan_id IS NOT NULL)),
  FOREIGN KEY (ticket_id, run_id) REFERENCES orchestration_runs (ticket_id, id) ON DELETE CASCADE,
  FOREIGN KEY (ticket_id, plan_id) REFERENCES ticket_plans (ticket_id, id) ON DELETE CASCADE
) STRICT;

CREATE INDEX ticket_plan_options_ticket ON ticket_plan_options (ticket_id, created_at);
-- At most one chosen option per run: the owner approves one plan.
CREATE UNIQUE INDEX ticket_plan_options_one_chosen ON ticket_plan_options (run_id)
  WHERE status = 'chosen';
