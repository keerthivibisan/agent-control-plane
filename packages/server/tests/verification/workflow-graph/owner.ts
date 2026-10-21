import {
  ProjectDtoSchema,
  RunDetailDtoSchema,
  TicketDetailDtoSchema,
  TicketDtoSchema,
  type ProjectDto,
  type RunDetailDto,
  type TicketDetailDto,
  type TicketDto,
} from '@acp/core/api';
import type { ApprovalMode, TicketRunOptions } from '@acp/core';
import { commitFiles, errorCode, ok, waitFor, type GraphServer } from './harness.js';

/*
 * The owner's side of a WG-V flow, over the HTTP routes the UI uses (vitest-free). Every text is
 * synthetic.
 */

export async function newProject(
  b: GraphServer,
  parentDir: string,
  name: string,
  harness?: Readonly<Record<string, string>>,
): Promise<ProjectDto> {
  const project = ProjectDtoSchema.parse(
    ok(
      await b.post('/api/projects/new', { parentDir, name, readme: `# ${name}\n\nSynthetic.\n` }),
      201,
      'new project',
    ),
  );
  // The owner commits the harness on main (test-side git, isolated config).
  if (harness !== undefined) commitFiles(project.rootPath, harness, 'Add the harness');
  return project;
}

export async function saveSetup(
  b: GraphServer,
  projectId: string,
  projectKey: string,
  mode: ApprovalMode,
  extra: Record<string, unknown> = {},
): Promise<void> {
  ok(
    await b.put(`/api/projects/${projectId}/setup`, {
      projectKey,
      maxConcurrentHelpers: 3,
      maxDepth: 1,
      defaultBudgetTokensPerAgent: 100_000,
      model: null,
      approvals: { mode, commands: [] },
      contextFiles: [],
      ...extra,
    }),
    200,
    'setup',
  );
}

export async function newTicket(
  b: GraphServer,
  projectId: string,
  title: string,
  runOptions?: TicketRunOptions,
): Promise<TicketDto> {
  return TicketDtoSchema.parse(
    ok(
      await b.post(`/api/projects/${projectId}/tickets`, {
        title,
        description: 'Synthetic ticket.',
        ...(runOptions !== undefined && { runOptions }),
      }),
      201,
      'new ticket',
    ),
  );
}

/** Ready → Start (with `body` as the run's own options); returns the run id. */
export async function startTicket(b: GraphServer, ticketId: string, body: object = {}) {
  ok(await b.post(`/api/tickets/${ticketId}/move`, { status: 'READY' }), 200, 'ready');
  const started = TicketDetailDtoSchema.parse(
    ok(await b.post(`/api/tickets/${ticketId}/start`, body), 200, 'start'),
  );
  const runId = started.currentRun?.id;
  if (runId === undefined) throw new Error('the ticket has no run');
  return runId;
}

export async function ticket(b: GraphServer, ticketId: string): Promise<TicketDetailDto> {
  return TicketDetailDtoSchema.parse(ok(await b.get(`/api/tickets/${ticketId}`), 200, 'ticket'));
}

export async function run(b: GraphServer, runId: string): Promise<RunDetailDto> {
  return RunDetailDtoSchema.parse(ok(await b.get(`/api/runs/${runId}`), 200, 'run'));
}

export async function untilRun(
  b: GraphServer,
  runId: string,
  ready: (r: RunDetailDto) => boolean,
  what: string,
  timeoutMs = 30_000,
): Promise<RunDetailDto> {
  return waitFor(
    async () => {
      const r = await run(b, runId);
      return ready(r) ? r : undefined;
    },
    what,
    timeoutMs,
    25,
  );
}

/** Waits for the run's proposed plan (version `version`) and decides it. */
export async function decidePlan(
  b: GraphServer,
  ticketId: string,
  version: number,
  decision: 'approve' | 'request-changes',
): Promise<void> {
  const plan = await waitFor(
    async () => {
      const d = await ticket(b, ticketId);
      const p = d.plans.find((x) => x.version === version && x.status === 'proposed');
      return p !== undefined && d.ticket.stage === 'PLAN_REVIEW' ? p : undefined;
    },
    `plan v${version}`,
    30_000,
    25,
  );
  ok(
    await b.post(`/api/tickets/${ticketId}/plans/${plan.id}/decision`, {
      decision,
      ...(decision === 'request-changes' && { comment: 'Synthetic: split the work.' }),
    }),
    200,
    'plan decision',
  );
}

/** The owner's one merge of the ticket branch, once the run is in REVIEW and its checks passed. */
export async function ownerMerge(b: GraphServer, runId: string): Promise<void> {
  await untilRun(b, runId, (r) => r.status === 'REVIEW', 'the owner review');
  const res = await waitFor(
    async () => {
      const r = await b.post(`/api/runs/${runId}/ticket-branch`, { action: 'merge' });
      return r.status === 409 && errorCode(r) === 'checks_running' ? undefined : r;
    },
    'the tip checks',
    30_000,
    25,
  );
  ok(res, 200, 'owner merge');
  await untilRun(b, runId, (r) => r.status === 'COMPLETED', 'the run completed');
}

/** The owner's merge of one change in a legacy run (before ADR-0021: into the base branch). */
export async function ownerMergeChange(b: GraphServer, runId: string, agentRunId: string) {
  const res = await waitFor(
    async () => {
      const r = await b.post(`/api/runs/${runId}/review`, { agentRunId, action: 'merge' });
      return r.status === 409 && errorCode(r) === 'checks_running' ? undefined : r;
    },
    'the change checks',
    30_000,
    25,
  );
  ok(res, 200, 'owner merges the change');
}
