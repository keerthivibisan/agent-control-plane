import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import {
  APPROVAL_MODES,
  type ApprovalMode,
  type ChangeReviewerMode,
  type PlannerMode,
  type TicketRunOptions,
} from '@acp/core';
import {
  ProjectDtoSchema,
  RunDetailDtoSchema,
  TicketBranchReviewDtoSchema,
  type UpdateWorkflowRequest,
} from '@acp/core/api';
import { git } from '../control/harness.js';
import { openDatabase } from '@acp/db';
import { startAutopilot, type AutopilotScript } from './autopilot.js';
import { PASS_WHEN_FIXED, bootGraphServer, ok, waitFor, type GraphServer } from './harness.js';
import {
  decidePlan,
  newProject,
  newTicket,
  ownerMerge,
  ownerMergeChange,
  saveSetup,
  startTicket,
  ticket,
  run,
  untilRun,
} from './owner.js';
import { sweepRepositories, v010Readability } from './v010-readers.js';

/*
 * A data dir in the v0.1.0 shape (WG-V upgrade test, RESUME.md Step 4b item 3). Synthetic only.
 *
 * Why it is written by today's server on version 1 workflows and then reduced, rather than row by
 * row: a finished run spans a dozen tables (runs, agents, workspaces, change states and rounds,
 * plans, comments, approvals, messages, checks, ticket branches), and v0.1.0's own write path is
 * the run store, which differs from today's only in the snapshot's `graph` and `graphContext`
 * keys and a plan step's `helper` (`git diff b6a1f27 -- packages/server/src/control/store.ts`;
 * version 1 runs store no step helper). So the projects, workflows, tickets and runs go through
 * the same routes v0.1.0's UI used, on version 1 workflows (the v1 `PUT /workflow`); then the two
 * snapshot keys are removed. The frozen v0.1.0 readers (`v010-readers.ts`) then prove every row
 * is v0.1.0-shaped before the upgrade starts.
 *
 * Contents:
 * - 24 projects with a stored version 1 workflow: planner `lead`|`separate` × reviewer
 *   `agent`|`lead`|unset (stored before ADR-0021) × code review on|off × unit tests on|off, with
 *   the four approval modes in turn, models, skills and agent files set on some, and a skill that
 *   no longer exists on others;
 * - `run-auto`, with no stored workflow (the default) in Full auto, and `plain`, with no setup at
 *   all;
 * - finished runs: a legacy run (before ADR-0021), route b to the owner's merge, a separate planner
 *   with a plan sent back, the lead reviewing with a rework round, the final code review and a
 *   tester, a stopped run, and a control-panel run without a ticket;
 * - one run in flight at the upgrade: Full auto, plan approved automatically, a reviewer's rework
 *   round, waiting in REVIEW for the owner's merge;
 * - tickets with their own run options (approval mode, reviewer, rounds), started or not.
 */

export interface FixtureProject {
  id: string;
  name: string;
  rootPath: string;
  stored: 'v1' | 'default';
  mode: ApprovalMode | null;
  workflow?: UpdateWorkflowRequest;
}

export interface FixtureRun {
  id: string;
  ticketId: string | null;
  projectId: string;
  flow: string;
  /** The status the run had when the v0.1.0 data was made. */
  status: string;
}

export interface V010Fixture {
  dataDir: string;
  parentDir: string;
  projects: FixtureProject[];
  runs: FixtureRun[];
  tickets: { id: string; projectId: string; runOptions?: TicketRunOptions; started: boolean }[];
  /** The run waiting in REVIEW at the upgrade (Full auto, on `run-auto`). */
  inFlight: { runId: string; ticketId: string; projectId: string };
  /** Snapshot keys removed by the reduction to v0.1.0 (`graph` and `graphContext`), per run. */
  reducedSnapshots: number;
  logs: string[];
}

const PLANNERS: readonly PlannerMode[] = ['lead', 'separate'];
const REVIEWERS: readonly (ChangeReviewerMode | undefined)[] = ['agent', 'lead', undefined];
const ONOFF = [false, true] as const;

const SKILL = {
  name: 'review-tests',
  description: 'Synthetic: how to review one change.',
  instructions: 'Synthetic instructions.\n',
};
const AGENT_FILE = {
  name: 'strict-reviewer',
  description: 'Synthetic reviewer agent file.',
  tools: ['Read', 'Grep'],
  model: null,
  instructions: 'Synthetic agent instructions.\n',
};

/** A version 1 workflow request for one combination. */
export function v1Workflow(
  plannerMode: PlannerMode,
  reviewer: ChangeReviewerMode | undefined,
  codeReview: boolean,
  unitTests: boolean,
  extras: 'files' | 'missing-skill' | 'none',
): UpdateWorkflowRequest {
  const skill = extras === 'files' ? SKILL.name : extras === 'missing-skill' ? 'gone-skill' : null;
  const agent = extras === 'files' ? AGENT_FILE.name : null;
  const model = extras === 'files' ? 'claude-synthetic-model' : null;
  return {
    plannerMode,
    stages: {
      plan: { model, skill: null },
      orchestrate: { model: null, skill: null },
      helpers: { model, skill },
      review: {
        requireChecks: true,
        ...(reviewer !== undefined && {
          reviewer,
          maxReworkRounds: reviewer === 'agent' ? 2 : 1,
          model: null,
          skill,
          agent,
        }),
      },
      'code-review': { enabled: codeReview, model: null, skill: null, agent },
      'unit-tests': { enabled: unitTests, model, skill: null },
    },
  };
}

const KEYS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

async function comboProjects(b: GraphServer, parentDir: string): Promise<FixtureProject[]> {
  const out: FixtureProject[] = [];
  let i = 0;
  for (const plannerMode of PLANNERS) {
    for (const reviewer of REVIEWERS) {
      for (const codeReview of ONOFF) {
        for (const unitTests of ONOFF) {
          const extras = i % 4 === 0 ? 'files' : i % 4 === 1 ? 'missing-skill' : 'none';
          const name = `combo-${i}`;
          const project = await newProject(b, parentDir, name);
          const mode = APPROVAL_MODES[i % APPROVAL_MODES.length] ?? 'auto-edits';
          await saveSetup(b, project.id, `C${KEYS[i] ?? 'Z'}`, mode);
          if (extras === 'files') {
            const p = `/api/projects/${project.id}`;
            ok(await b.post(`${p}/skills`, SKILL), 201, 'skill');
            ok(await b.post(`${p}/skills/${SKILL.name}/commit`), 200, 'skill commit');
            ok(await b.post(`${p}/agents`, AGENT_FILE), 201, 'agent file');
            ok(await b.post(`${p}/agents/${AGENT_FILE.name}/commit`), 200, 'agent commit');
          }
          const workflow = v1Workflow(plannerMode, reviewer, codeReview, unitTests, extras);
          ok(await b.put(`/api/projects/${project.id}/workflow`, workflow), 200, 'v1 workflow');
          out.push({
            id: project.id,
            name,
            rootPath: project.rootPath,
            stored: 'v1',
            mode,
            workflow,
          });
          i++;
        }
      }
    }
  }
  return out;
}

/** A plain git repository in the parent folder, made by the owner (not by the app). */
function plainRepo(parentDir: string): string {
  const repo = join(parentDir, 'plain');
  mkdirSync(repo);
  git(repo, 'init', '--quiet', '-b', 'main');
  writeFileSync(join(repo, 'README.md'), 'Synthetic.\n');
  git(repo, 'add', '--all');
  git(repo, 'commit', '--quiet', '-m', 'initial');
  return repo;
}

/** Files that make the synthetic check pass. */
const DONE = (name: string) => ({ [`src/${name}.txt`]: `${name}\n`, 'fixed.txt': 'ok\n' });

/**
 * Runs `owner` while the autopilot plays the agents; on failure the error carries the autopilot's
 * aggregate log and the run's shape (synthetic data, for debugging the fixture).
 */
async function piloted(
  b: GraphServer,
  ticketId: string,
  runId: string,
  script: AutopilotScript,
  owner: () => Promise<void>,
): Promise<void> {
  const pilot = startAutopilot(b, ticketId, runId, script);
  try {
    await owner();
  } catch (error) {
    const r = await run(b, runId).catch(() => undefined);
    const shape = r && {
      status: r.status,
      agents: r.agents.map((a) => [a.kind, a.status]),
      changes: r.changes?.map((c) => [c.state, c.reworkRounds, c.checks.map((k) => k.status)]),
    };
    throw new Error(
      `${error instanceof Error ? error.message : 'failed'}; pilot ${JSON.stringify(pilot.log)}; run ${JSON.stringify(shape)}`,
      { cause: error },
    );
  } finally {
    await pilot.stop();
  }
}

/** Builds the v0.1.0-shaped data dir in temp folders from `make` (the caller removes them). */
export async function buildV010DataDir(make: (prefix: string) => string): Promise<V010Fixture> {
  const dataDir = make('acp-wgv-v010-data-');
  const parentDir = make('acp-wgv-v010-repos-');
  const claudeDir = make('acp-wgv-v010-claude-');
  const homeDir = make('acp-wgv-v010-home-');
  const logs: string[] = [];
  const projects: FixtureProject[] = [];
  const runs: FixtureRun[] = [];
  const tickets: V010Fixture['tickets'] = [];

  // ---- Before ADR-0021: a legacy run (the owner merges each change into main).
  {
    const b = await bootGraphServer({ dataDir, claudeDir, homeDir, logs, legacyTicketRuns: true });
    try {
      const project = await newProject(b, parentDir, 'run-legacy', PASS_WHEN_FIXED);
      await saveSetup(b, project.id, 'LEG', 'auto-edits');
      projects.push({
        id: project.id,
        name: 'run-legacy',
        rootPath: project.rootPath,
        stored: 'default',
        mode: 'auto-edits',
      });
      const t = await newTicket(b, project.id, 'Legacy ticket');
      tickets.push({ id: t.id, projectId: project.id, started: true });
      const runId = await startTicket(b, t.id);
      const lead = await waitFor(() => b.fake.agents.find((a) => a.spec.kind === 'lead'), 'lead');
      lead.started();
      await untilRun(b, runId, (r) => r.agents[0]?.status === 'RUNNING', 'lead running');
      await lead.callLead('submit_plan', {
        summary: 'Synthetic plan.',
        steps: [{ title: 'Do it', role: 'Builder', detail: 'Synthetic.' }],
      });
      await decidePlan(b, t.id, 1, 'approve');
      await lead.callLead('start_agent', { role: 'Builder', task: 'Synthetic task.' });
      const r = await untilRun(
        b,
        runId,
        (x) => x.agents.some((a) => a.role === 'Builder'),
        'helper',
      );
      const helperId = r.agents.find((a) => a.role === 'Builder')?.id ?? '';
      const helper = await waitFor(() => b.fake.agents.find((a) => a.id === helperId), 'helper');
      helper.started();
      await untilRun(
        b,
        runId,
        (x) => x.agents.some((a) => a.id === helperId && a.status === 'RUNNING'),
        'helper running',
      );
      for (const [path, content] of Object.entries(DONE('legacy'))) {
        mkdirSync(dirname(join(helper.spec.cwd, path)), { recursive: true });
        writeFileSync(join(helper.spec.cwd, path), content);
      }
      helper.finish('success');
      await untilRun(
        b,
        runId,
        (x) => x.agents.some((a) => a.id === helperId && a.status === 'SUCCEEDED'),
        'helper done',
      );
      await lead.callLead('request_review', {});
      await ownerMergeChange(b, runId, helperId);
      await waitFor(
        async () => ((await ticket(b, t.id)).ticket.status === 'DONE' ? true : undefined),
        'legacy done',
        30_000,
        25,
      );
      runs.push({
        id: runId,
        ticketId: t.id,
        projectId: project.id,
        flow: 'legacy',
        status: 'COMPLETED',
      });
    } finally {
      await b.close();
    }
  }

  // ---- The review loop (ADR-0021), as v0.1.0 shipped it.
  const b = await bootGraphServer({ dataDir, claudeDir, homeDir, logs });
  let inFlight: V010Fixture['inFlight'] | undefined;
  try {
    projects.push(...(await comboProjects(b, parentDir)));

    // A project with no setup row and no workflow at all.
    // Registered as an existing folder (not created by the app, which saves a setup with it).
    const plain = ProjectDtoSchema.parse(
      ok(
        await b.post('/api/projects', { name: 'plain', rootPath: plainRepo(parentDir) }),
        201,
        'register plain',
      ),
    );
    projects.push({
      id: plain.id,
      name: 'plain',
      rootPath: plain.rootPath,
      stored: 'default',
      mode: null,
    });

    // Route b to the owner's merge; a stopped run; a control-panel run; tickets with options.
    const wfB = v1Workflow('lead', 'agent', false, false, 'none');
    const pB = await newProject(b, parentDir, 'run-b', PASS_WHEN_FIXED);
    await saveSetup(b, pB.id, 'RB', 'auto-edits');
    ok(await b.put(`/api/projects/${pB.id}/workflow`, wfB), 200, 'v1 workflow');
    projects.push({
      id: pB.id,
      name: 'run-b',
      rootPath: pB.rootPath,
      stored: 'v1',
      mode: 'auto-edits',
      workflow: wfB,
    });
    {
      const t = await newTicket(b, pB.id, 'Route b ticket');
      tickets.push({ id: t.id, projectId: pB.id, started: true });
      ok(
        await b.post(`/api/tickets/${t.id}/comments`, { body: 'Synthetic owner comment.' }),
        201,
        'comment',
      );
      const runId = await startTicket(b, t.id);
      await piloted(
        b,
        t.id,
        runId,
        {
          plan: [{ title: 'Build', role: 'Builder', detail: 'Synthetic.' }],
          helperFiles: () => DONE('b'),
        },
        async () => {
          await decidePlan(b, t.id, 1, 'approve');
          await ownerMerge(b, runId);
        },
      );
      runs.push({
        id: runId,
        ticketId: t.id,
        projectId: pB.id,
        flow: 'route-b',
        status: 'COMPLETED',
      });
    }
    {
      const runOptions: TicketRunOptions = { reviewer: 'agent', maxReworkRounds: 3 };
      const t = await newTicket(b, pB.id, 'Stopped ticket', runOptions);
      tickets.push({ id: t.id, projectId: pB.id, runOptions, started: true });
      const runId = await startTicket(b, t.id);
      const lead = await waitFor(
        () => b.fake.agents.find((a) => a.spec.kind === 'lead' && !a.ended),
        'lead',
      );
      lead.started();
      await untilRun(b, runId, (r) => r.agents[0]?.status === 'RUNNING', 'lead running');
      await lead.callLead('submit_plan', {
        summary: 'Synthetic plan.',
        steps: [{ title: 'Do it', role: 'Builder', detail: 'Synthetic.' }],
      });
      await decidePlan(b, t.id, 1, 'approve');
      await untilRun(b, runId, (r) => r.ticketBranch?.state === 'open', 'the ticket branch');
      await lead.callLead('start_agent', { role: 'Builder', task: 'Synthetic task.' });
      const r = await untilRun(
        b,
        runId,
        (x) => x.agents.some((a) => a.role === 'Builder'),
        'helper',
      );
      const helperId = r.agents.find((a) => a.role === 'Builder')?.id ?? '';
      const helper = await waitFor(() => b.fake.agents.find((a) => a.id === helperId), 'helper');
      helper.started();
      ok(await b.post(`/api/runs/${runId}/stop`), 200, 'stop');
      await untilRun(b, runId, (x) => x.status === 'CANCELLED', 'run cancelled');
      runs.push({
        id: runId,
        ticketId: t.id,
        projectId: pB.id,
        flow: 'stopped',
        status: 'CANCELLED',
      });
    }
    {
      const res = RunDetailDtoSchema.parse(
        ok(
          await b.post('/api/runs', { projectId: pB.id, title: 'Synthetic control run' }),
          201,
          'control run',
        ),
      );
      const leadId = res.agents.find((a) => a.kind === 'lead')?.id ?? '';
      // A control-panel run's lead starts with the owner's first message.
      ok(
        await b.post(`/api/runs/${res.id}/chat`, { text: 'Synthetic owner message.' }),
        200,
        'chat',
      );
      const lead = await waitFor(() => b.fake.agents.find((a) => a.id === leadId), 'control lead');
      lead.started();
      lead.finish('success');
      const done = await untilRun(
        b,
        res.id,
        (x) => ['COMPLETED', 'FAILED', 'NEEDS_REVIEW', 'REVIEW'].includes(x.status),
        'control run ended',
      );
      runs.push({
        id: res.id,
        ticketId: null,
        projectId: pB.id,
        flow: 'control-panel',
        status: done.status,
      });
    }
    for (const [title, runOptions, ready] of [
      [
        'Backlog ticket with options',
        { approvalMode: 'auto', reviewer: 'lead', maxReworkRounds: 0 },
        false,
      ],
      ['Ready ticket with options', { approvalMode: 'manual' }, true],
    ] as const) {
      const t = await newTicket(b, pB.id, title, runOptions);
      if (ready) ok(await b.post(`/api/tickets/${t.id}/move`, { status: 'READY' }), 200, 'ready');
      tickets.push({ id: t.id, projectId: pB.id, runOptions, started: false });
    }
    // The owner ran the checks on main once (a check run without a run).
    ok(await b.post(`/api/projects/${pB.id}/harness/checks`, {}), 200, 'main checks');

    // A separate planner, the plan sent back once, the lead reviewing with a rework round, the
    // final code review and a tester; the ticket's own options (Manual, the lead reviews, 1 round).
    const wfFull = v1Workflow('separate', 'lead', true, true, 'files');
    const pFull = await newProject(b, parentDir, 'run-full', PASS_WHEN_FIXED);
    await saveSetup(b, pFull.id, 'RF', 'manual');
    {
      const p = `/api/projects/${pFull.id}`;
      ok(await b.post(`${p}/skills`, SKILL), 201, 'skill');
      ok(await b.post(`${p}/skills/${SKILL.name}/commit`), 200, 'skill commit');
      ok(await b.post(`${p}/agents`, AGENT_FILE), 201, 'agent file');
      ok(await b.post(`${p}/agents/${AGENT_FILE.name}/commit`), 200, 'agent commit');
    }
    ok(await b.put(`/api/projects/${pFull.id}/workflow`, wfFull), 200, 'v1 workflow');
    projects.push({
      id: pFull.id,
      name: 'run-full',
      rootPath: pFull.rootPath,
      stored: 'v1',
      mode: 'manual',
      workflow: wfFull,
    });
    {
      const runOptions: TicketRunOptions = {
        approvalMode: 'manual',
        reviewer: 'lead',
        maxReworkRounds: 1,
      };
      const t = await newTicket(b, pFull.id, 'Separate planner ticket', runOptions);
      tickets.push({ id: t.id, projectId: pFull.id, runOptions, started: true });
      const runId = await startTicket(b, t.id);
      const script: AutopilotScript = {
        plan: [{ title: 'Build', role: 'Builder', detail: 'Synthetic.' }],
        helperFiles: () => DONE('full'),
        leadDecision: (_role, round) => (round === 0 ? 'rework' : 'merge'),
        testerFiles: { 'tests/full.test.txt': 'synthetic\n' },
      };
      await piloted(b, t.id, runId, script, async () => {
        await decidePlan(b, t.id, 1, 'request-changes');
        await decidePlan(b, t.id, 2, 'approve');
        await ownerMerge(b, runId);
      });
      runs.push({
        id: runId,
        ticketId: t.id,
        projectId: pFull.id,
        flow: 'separate-lead-final',
        status: 'COMPLETED',
      });
    }

    // Full auto with no stored workflow: the plan is approved automatically; a reviewer's rework
    // round; left in REVIEW, so the upgrade meets a run waiting for the owner's merge.
    const pAuto = await newProject(b, parentDir, 'run-auto', PASS_WHEN_FIXED);
    await saveSetup(b, pAuto.id, 'RA', 'full-auto');
    projects.push({
      id: pAuto.id,
      name: 'run-auto',
      rootPath: pAuto.rootPath,
      stored: 'default',
      mode: 'full-auto',
    });
    {
      const runOptions: TicketRunOptions = { approvalMode: 'full-auto' };
      const t = await newTicket(b, pAuto.id, 'Full auto ticket', runOptions);
      tickets.push({ id: t.id, projectId: pAuto.id, runOptions, started: true });
      const runId = await startTicket(b, t.id);
      await piloted(
        b,
        t.id,
        runId,
        {
          plan: [{ title: 'Build', role: 'Builder', detail: 'Synthetic.' }],
          helperFiles: () => DONE('auto'),
          verdict: (_role, round) => (round === 0 ? 'rework' : 'approve'),
          leadDecision: (_role, round) => (round === 0 ? 'rework' : 'merge'),
        },
        async () => {
          await untilRun(b, runId, (r) => r.status === 'REVIEW', 'the owner review');
          // The tip's checks finish before the server stops: a check the shutdown stops is
          // stored as `error`, which then blocks the owner's merge (WG-V.md, finding F3).
          await waitFor(
            async () => {
              const tb = TicketBranchReviewDtoSchema.parse(
                ok(await b.get(`/api/runs/${runId}/ticket-branch`)),
              );
              const tip = tb.ticketBranch.headCommit;
              const done = tb.checks.length > 0 && tb.checks.every((c) => c.commit === tip);
              return done && tb.checks.every((c) => c.status === 'passed') ? true : undefined;
            },
            'the tip checks',
            30_000,
            25,
          );
        },
      );
      runs.push({
        id: runId,
        ticketId: t.id,
        projectId: pAuto.id,
        flow: 'full-auto-in-flight',
        status: 'REVIEW',
      });
      inFlight = { runId, ticketId: t.id, projectId: pAuto.id };
    }
  } finally {
    await b.close();
  }
  if (inFlight === undefined) throw new Error('no run in flight');

  // ---- Reduce to exactly what v0.1.0 stored: no graph keys in any run snapshot.
  const reducedSnapshots = reduceToV010(join(dataDir, 'acp.sqlite'));
  const readable = v010Readability(join(dataDir, 'acp.sqlite'));
  const unreadable = Object.values(readable.unreadable).reduce((n, x) => n + x, 0);
  if (unreadable > 0) {
    throw new Error(`fixture is not v0.1.0-shaped: ${JSON.stringify(readable.reasons)}`);
  }
  const sweep = sweepRepositories(join(dataDir, 'acp.sqlite'));
  if (Object.keys(sweep.failed).length > 0) {
    throw new Error(`fixture does not read back: ${JSON.stringify(sweep.failed)}`);
  }
  return { dataDir, parentDir, projects, runs, tickets, inFlight, reducedSnapshots, logs };
}

/** Removes the snapshot keys v0.1.0 did not write; returns how many snapshots had them. */
function reduceToV010(path: string): number {
  const db = openDatabase(path, { migrate: false });
  try {
    const c = db.connection;
    const rows = c
      .prepare('SELECT id, limits FROM orchestration_runs WHERE limits IS NOT NULL')
      .all() as {
      id: string;
      limits: string;
    }[];
    const update = c.prepare('UPDATE orchestration_runs SET limits = ? WHERE id = ?');
    let reduced = 0;
    for (const row of rows) {
      const snapshot = JSON.parse(row.limits) as Record<string, unknown>;
      if (!('graph' in snapshot) && !('graphContext' in snapshot)) continue;
      const { graph: _graph, graphContext: _context, ...v010 } = snapshot;
      update.run(JSON.stringify(v010), row.id);
      reduced++;
    }
    return reduced;
  } finally {
    db.close();
  }
}
