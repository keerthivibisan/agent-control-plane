import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect } from 'vitest';
import { RunDetailDtoSchema, type RunDetailDto } from '@acp/core/api';
import { PASSING_WHEN_FIXED, type setupBoard } from './helpers.js';

/** Shared steps of the review-loop tests (ADR-0021, RL-B). Synthetic repository and agents. */

export type Board = Awaited<ReturnType<typeof setupBoard>>;

export const FILES = { 'README.md': 'x\n', 'src/app.ts': 'export {};\n', ...PASSING_WHEN_FIXED };

/** A loop ticket with an approved plan: the run is RUNNING and its ticket branch exists. */
export async function approved(s: Board, start: object = {}) {
  const ticket = await s.createTicket('Add dark mode');
  expect((await s.post(`/api/tickets/${ticket.id}/move`, { status: 'READY' })).status).toBe(200);
  const started = await s.post(`/api/tickets/${ticket.id}/start`, start);
  expect(started.status).toBe(200);
  await s.settle();
  // This ticket's lead: the latest lead start (an earlier ticket's lead may exist too).
  const lead = s.fake.agents.filter((a) => a.spec.kind === 'lead').at(-1);
  if (lead === undefined) throw new Error('the lead has not started');
  lead.started();
  await s.settle();
  await lead.callLead('submit_plan', {
    summary: 'Add a theme toggle',
    steps: [{ title: 'Build the toggle', role: 'Builder', detail: 'In settings' }],
  });
  await s.settle();
  const plan = (await s.detail(ticket.id)).plans[0];
  await s.post(`/api/tickets/${ticket.id}/plans/${plan?.id ?? ''}/decision`, {
    decision: 'approve',
  });
  await s.settle();
  const runId = (await s.detail(ticket.id)).currentRun?.id ?? '';
  return { ticket, runId, lead };
}

/** The lead starts a helper; it starts, writes `files` into its worktree and finishes. */
export async function helperDone(
  s: Board,
  lead: ReturnType<Board['fake']['lead']>,
  runId: string,
  files: Record<string, string>,
  role = 'Builder',
) {
  const reply = await lead.callLead('start_agent', { role, task: `Do the ${role} part` });
  expect(reply).toContain('Started agent');
  await s.settle();
  const worker = s.fake.workers().at(-1);
  if (worker === undefined) throw new Error('no worker');
  worker.started();
  await s.settle();
  for (const [path, content] of Object.entries(files)) {
    writeFileSync(join(s.worktree(runId, worker.id), path), content);
  }
  worker.finish('success');
  await s.settle();
  return worker;
}

export async function run(s: Board, runId: string): Promise<RunDetailDto> {
  await s.settle();
  return RunDetailDtoSchema.parse((await s.get(`/api/runs/${runId}`)).body);
}

export const reviewers = (s: Board) => s.fake.agents.filter((a) => a.spec.kind === 'reviewer');
