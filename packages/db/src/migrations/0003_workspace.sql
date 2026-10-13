-- 0003_workspace: Phase 4 Agent Workspace — project setup, tickets, plans, comments, check runs
-- (docs/phase-4/README.md §6.5, ADR-0016, ADR-0017, ADR-0012/0013 amendments).
--
-- Conventions (as in 0001/0002):
--   * Ids are TEXT UUIDs; timestamps are UTC ISO-8601 TEXT ending in 'Z'.
--   * Enum-like columns (type, priority, status, author) are validated with Zod in TypeScript, not
--     with CHECK, so a later phase can add a value without rebuilding the table.
--   * Structural rules (lengths, ranges, JSON shape, same-ticket references) are enforced here too.
--   * Stored text (ADR-0016): ticket titles and descriptions, owner and lead comments, the lead's
--     plans, and the redacted last 16 KiB of a check's output (ADR-0017). Worker conversation
--     content, thinking and tool input/output are still never stored.
--   * Tickets are cancelled, never deleted: a project with tickets cannot be unregistered.
--   * Never edit this file after it ships: add a new migration instead.

-- The project's AI work environment (1:1 with projects). The scalar settings live in `setup`
-- (JSON, validated with core's ProjectAgentSetupSchema on write and read); the project key and the
-- ticket counter are columns because SQL needs them.
CREATE TABLE project_setup (
  project_id TEXT PRIMARY KEY REFERENCES projects (id) ON DELETE CASCADE,
  -- 2-6 capital letters; unique so a ticket key like WEB-12 names one project.
  project_key TEXT NOT NULL UNIQUE
    CHECK (length(project_key) BETWEEN 2 AND 6 AND project_key NOT GLOB '*[^A-Z]*'),
  setup TEXT NOT NULL CHECK (json_valid(setup) AND json_type(setup) = 'object'),
  -- The next ticket number. Only ever incremented, so a number is never reused, even if the
  -- project key changes.
  next_ticket_seq INTEGER NOT NULL DEFAULT 1 CHECK (next_ticket_seq >= 1),
  updated_at TEXT NOT NULL
) STRICT;

CREATE TABLE tickets (
  id TEXT PRIMARY KEY,
  -- RESTRICT: tickets are never deleted, so their project stays registered (ADR-0016).
  project_id TEXT NOT NULL REFERENCES projects (id) ON DELETE RESTRICT,
  seq INTEGER NOT NULL CHECK (seq >= 1),
  -- `<PROJECT_KEY>-<seq>`, fixed when the ticket is created.
  key TEXT NOT NULL CHECK (length(key) BETWEEN 4 AND 30),
  title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
  description TEXT NOT NULL DEFAULT '' CHECK (length(description) <= 20000),
  type TEXT NOT NULL,
  priority TEXT NOT NULL,
  labels TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(labels) AND json_type(labels) = 'array'),
  status TEXT NOT NULL,
  -- The ticket's current run (1 ticket = 1 run at a time; earlier runs stay in the history). A run
  -- of this ticket only (trigger below). Deleting the run clears it.
  current_run_id TEXT REFERENCES orchestration_runs (id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (project_id, seq),
  UNIQUE (project_id, id)
) STRICT;

CREATE INDEX tickets_project ON tickets (project_id, seq);
CREATE INDEX tickets_status ON tickets (status);
CREATE INDEX tickets_current_run ON tickets (current_run_id);

-- A run started from a ticket. NULL for Phase 3 control-panel runs. The column is added (not the
-- table rebuilt) so 0002 stays untouched; ALTER TABLE cannot add a composite foreign key, so the
-- same-project rule is a trigger. The triggers only fire when the referenced row exists, so a
-- missing ticket or run is still reported by the foreign key.
ALTER TABLE orchestration_runs ADD COLUMN ticket_id TEXT REFERENCES tickets (id) ON DELETE RESTRICT;

-- Parent key for the same-ticket references below (plans and comments point at a run of their own
-- ticket). `id` is the primary key, so this index is unique for every row, including NULL tickets.
CREATE UNIQUE INDEX orchestration_runs_ticket ON orchestration_runs (ticket_id, id);

CREATE TRIGGER orchestration_runs_ticket_project_insert
BEFORE INSERT ON orchestration_runs
WHEN NEW.ticket_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM tickets t WHERE t.id = NEW.ticket_id AND t.project_id = NEW.project_id
  )
  AND EXISTS (SELECT 1 FROM tickets t WHERE t.id = NEW.ticket_id)
BEGIN
  SELECT RAISE(ABORT, 'orchestration run ticket belongs to another project');
END;

CREATE TRIGGER orchestration_runs_ticket_project_update
BEFORE UPDATE OF ticket_id, project_id ON orchestration_runs
WHEN NEW.ticket_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM tickets t WHERE t.id = NEW.ticket_id AND t.project_id = NEW.project_id
  )
  AND EXISTS (SELECT 1 FROM tickets t WHERE t.id = NEW.ticket_id)
BEGIN
  SELECT RAISE(ABORT, 'orchestration run ticket belongs to another project');
END;

CREATE TRIGGER tickets_current_run_insert
BEFORE INSERT ON tickets
WHEN NEW.current_run_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM orchestration_runs r WHERE r.id = NEW.current_run_id AND r.ticket_id = NEW.id
  )
  AND EXISTS (SELECT 1 FROM orchestration_runs r WHERE r.id = NEW.current_run_id)
BEGIN
  SELECT RAISE(ABORT, 'ticket current run is not a run of this ticket');
END;

CREATE TRIGGER tickets_current_run_update
BEFORE UPDATE OF current_run_id ON tickets
WHEN NEW.current_run_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM orchestration_runs r WHERE r.id = NEW.current_run_id AND r.ticket_id = NEW.id
  )
  AND EXISTS (SELECT 1 FROM orchestration_runs r WHERE r.id = NEW.current_run_id)
BEGIN
  SELECT RAISE(ABORT, 'ticket current run is not a run of this ticket');
END;

-- The lead's proposed plans (ADR-0016), versioned per run: 1, 2, ...
CREATE TABLE ticket_plans (
  id TEXT PRIMARY KEY,
  ticket_id TEXT NOT NULL REFERENCES tickets (id) ON DELETE CASCADE,
  run_id TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version >= 1),
  summary TEXT NOT NULL CHECK (length(summary) BETWEEN 1 AND 2000),
  -- JSON array of { title, role, detail }, validated with core's PlanStepSchema.
  steps TEXT NOT NULL CHECK (json_valid(steps) AND json_type(steps) = 'array'),
  planned_helpers INTEGER NOT NULL CHECK (planned_helpers >= 0),
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  decided_at TEXT,
  UNIQUE (run_id, version),
  UNIQUE (ticket_id, id),
  -- The plan's run is a run of the same ticket; deleting the run deletes its plans (ADR-0015).
  FOREIGN KEY (ticket_id, run_id) REFERENCES orchestration_runs (ticket_id, id) ON DELETE CASCADE
) STRICT;

CREATE INDEX ticket_plans_ticket ON ticket_plans (ticket_id, created_at);
-- At most one plan waiting for the owner and at most one approved plan per run.
CREATE UNIQUE INDEX ticket_plans_one_proposed ON ticket_plans (run_id) WHERE status = 'proposed';
CREATE UNIQUE INDEX ticket_plans_one_approved ON ticket_plans (run_id) WHERE status = 'approved';

-- Owner and lead comments on a ticket, optionally about one run or one plan of that ticket.
CREATE TABLE ticket_comments (
  id TEXT PRIMARY KEY,
  ticket_id TEXT NOT NULL REFERENCES tickets (id) ON DELETE CASCADE,
  run_id TEXT,
  plan_id TEXT,
  author TEXT NOT NULL,
  body TEXT NOT NULL CHECK (length(body) BETWEEN 1 AND 8000),
  created_at TEXT NOT NULL,
  -- A comment about a run or plan belongs to it: deleting the run deletes it (ADR-0015).
  FOREIGN KEY (ticket_id, run_id) REFERENCES orchestration_runs (ticket_id, id) ON DELETE CASCADE,
  FOREIGN KEY (ticket_id, plan_id) REFERENCES ticket_plans (ticket_id, id) ON DELETE CASCADE
) STRICT;

CREATE INDEX ticket_comments_ticket ON ticket_comments (ticket_id, created_at);
CREATE INDEX ticket_comments_run ON ticket_comments (run_id);
CREATE INDEX ticket_comments_plan ON ticket_comments (plan_id);

-- Harness check results (ADR-0017). `run_id` NULL = "Run checks now" on the main branch;
-- `agent_run_id` NULL with a run = not tied to one agent's worktree.
CREATE TABLE check_runs (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  run_id TEXT REFERENCES orchestration_runs (id) ON DELETE CASCADE,
  agent_run_id TEXT,
  check_id TEXT NOT NULL CHECK (length(check_id) BETWEEN 1 AND 40),
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  required INTEGER NOT NULL CHECK (required IN (0, 1)),
  status TEXT NOT NULL,
  exit_code INTEGER,
  duration_ms INTEGER NOT NULL CHECK (duration_ms >= 0),
  -- The last <= 16 KiB of combined output, redacted (MAX_CHECK_OUTPUT_BYTES).
  output_tail TEXT NOT NULL CHECK (length(output_tail) <= 16384),
  started_at TEXT NOT NULL,
  -- An agent's check always names its run, so the composite reference below is always checked.
  CHECK (agent_run_id IS NULL OR run_id IS NOT NULL),
  FOREIGN KEY (run_id, agent_run_id) REFERENCES agent_runs (run_id, id) ON DELETE CASCADE
) STRICT;

CREATE INDEX check_runs_run ON check_runs (run_id, started_at);
CREATE INDEX check_runs_agent_run ON check_runs (agent_run_id, started_at);
CREATE INDEX check_runs_project_main ON check_runs (project_id, started_at) WHERE run_id IS NULL;
