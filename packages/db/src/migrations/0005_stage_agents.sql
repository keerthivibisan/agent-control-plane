-- 0005_stage_agents: agents of the workflow stages that have no parent (ADR-0019, R-G Part 2).
--
-- 0002 kept "exactly one lead per run" as a unique index over the agents WITHOUT a parent. The
-- redesign's planner, reviewer and tester (R-C) also have no parent: they are started by the
-- engine, not by a helper, and inventing a parent for them would record a relationship that does
-- not exist (AGENTS.md rule 1). The rule is the same, keyed by kind instead: at most one lead per
-- run. The repository still checks that a lead has no parent and a worker has one.
--
-- Never edit this file after it ships: add a new migration instead.

DROP INDEX agent_runs_one_lead;
CREATE UNIQUE INDEX agent_runs_one_lead ON agent_runs (run_id) WHERE kind = 'lead';
