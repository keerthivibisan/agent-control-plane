import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { defaultProjectWorkflow } from '@acp/core';
import {
  BoardDtoSchema,
  TicketDetailDtoSchema,
  TicketDtoSchema,
  type TicketDto,
} from '@acp/core/api';
import { patchRunOptions } from '../../src/board/service.js';
import { expectError } from '../control/helpers.js';
import { setupBoard } from './helpers.js';
import { FILES, run, type Board } from './loop-helpers.js';

/*
 * Ticket-level run options through the routes (RL-H): a ticket keeps its own approval mode,
 * reviewer and rework rounds, each "Project default" unless set. A run snapshots run override >
 * ticket > project. The fake managed adapter plays the lead; git runs in a throwaway repository.
 * Synthetic data only.
 */

/** The project's defaults: an approval mode on the setup, the review stage on the workflow. */
async function projectDefaults(
  s: Board,
  mode: 'manual' | 'auto-edits' | 'auto' | 'full-auto',
  review: { reviewer: 'agent' | 'lead'; maxReworkRounds: number },
) {
  const setup = {
    projectKey: 'WEBAPP',
    maxConcurrentHelpers: 3,
    maxDepth: 1,
    defaultBudgetTokensPerAgent: 100_000,
    model: null,
    approvals: { mode, commands: [] },
    contextFiles: [],
  };
  expect((await s.send('put', `/api/projects/${s.project.id}/setup`, setup)).status).toBe(200);
  const base = defaultProjectWorkflow(s.project.id, '2026-10-17T09:00:00.000Z');
  const workflow = {
    plannerMode: base.plannerMode,
    stages: { ...base.stages, review: { requireChecks: true, ...review } },
  };
  expect((await s.send('put', `/api/projects/${s.project.id}/workflow`, workflow)).status).toBe(
    200,
  );
}

/** Ready, then Start with `body`; the run's detail. */
async function startRun(s: Board, ticket: TicketDto, body: object = {}) {
  expect((await s.post(`/api/tickets/${ticket.id}/move`, { status: 'READY' })).status).toBe(200);
  const started = await s.post(`/api/tickets/${ticket.id}/start`, body);
  expect(started.status, JSON.stringify(started.body)).toBe(200);
  await s.settle();
  const runId = TicketDetailDtoSchema.parse(started.body).currentRun?.id ?? '';
  return run(s, runId);
}

async function stop(s: Board, ticket: TicketDto) {
  const detail = await s.detail(ticket.id);
  const runId = detail.currentRun?.id ?? '';
  expect((await s.post(`/api/runs/${runId}/stop`)).status).toBe(200);
  await s.settle();
}

describe('ticket run options (RL-H)', () => {
  it('a new ticket keeps its options; the DTO, detail and board carry them', async () => {
    const s = await setupBoard({ files: FILES });
    const plain = await s.createTicket('Plain');
    expect(plain).not.toHaveProperty('runOptions');
    const own = await s.createTicket('Careful', {
      runOptions: { approvalMode: 'manual', maxReworkRounds: 0 },
    });
    expect(TicketDtoSchema.parse(own).runOptions).toEqual({
      approvalMode: 'manual',
      maxReworkRounds: 0,
    });
    const detail = await s.detail(own.id);
    expect(detail.ticket.runOptions).toEqual({ approvalMode: 'manual', maxReworkRounds: 0 });
    const board = BoardDtoSchema.parse((await s.get(`/api/board?projectId=${s.project.id}`)).body);
    const cards = board.columns.flatMap((c) => c.tickets);
    expect(cards.find((c) => c.id === own.id)?.runOptions).toEqual(detail.ticket.runOptions);
    expect(cards.find((c) => c.id === plain.id)).not.toHaveProperty('runOptions');
    const listed = (await s.get(`/api/projects/${s.project.id}/tickets`)).body as TicketDto[];
    expect(listed.find((t) => t.id === own.id)?.runOptions).toEqual(detail.ticket.runOptions);
  });

  it('refuses invalid options on create and update, and needs the CSRF header', async () => {
    const s = await setupBoard({ files: FILES });
    expectError(
      await s.post(`/api/projects/${s.project.id}/tickets`, {
        title: 'Bad',
        runOptions: { approvalMode: 'yolo' },
      }),
      400,
      'invalid_request',
    );
    const t = await s.createTicket('T');
    // The refused create took no ticket number.
    expect(t.key).toBe('WEBAPP-1');
    expectError(
      await s.send('patch', `/api/tickets/${t.id}`, { runOptions: { maxReworkRounds: 6 } }),
      400,
      'invalid_request',
    );
    const refused = await request(s.app)
      .patch(`/api/tickets/${t.id}`)
      .send({ runOptions: { approvalMode: 'manual' } });
    expect(refused.status).toBe(403);
    expect((await s.detail(t.id)).ticket).not.toHaveProperty('runOptions');
  });

  it('update: a value sets an option, null puts it back to the project default', async () => {
    const s = await setupBoard({ files: FILES });
    const t = await s.createTicket('T', { runOptions: { approvalMode: 'manual' } });
    const patch = async (body: object) => {
      const res = await s.send('patch', `/api/tickets/${t.id}`, body);
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      return TicketDetailDtoSchema.parse(res.body).ticket;
    };
    // Other fields leave the options alone.
    expect((await patch({ title: 'Renamed' })).runOptions).toEqual({ approvalMode: 'manual' });
    expect((await patch({ runOptions: { reviewer: 'lead' } })).runOptions).toEqual({
      approvalMode: 'manual',
      reviewer: 'lead',
    });
    expect((await patch({ runOptions: { approvalMode: null } })).runOptions).toEqual({
      reviewer: 'lead',
    });
    const cleared = await patch({ runOptions: { reviewer: null } });
    expect(cleared).not.toHaveProperty('runOptions');
    await patch({ runOptions: { approvalMode: 'auto', maxReworkRounds: 4 } });
    expect(await patch({ runOptions: null })).not.toHaveProperty('runOptions');
  });

  it("a run snapshots the ticket's options over the project's (Manual ticket, Full auto project)", async () => {
    const logs: { message: string; fields: Record<string, unknown> }[] = [];
    const s = await setupBoard({
      files: FILES,
      logger: { log: (_level, message, fields = {}) => logs.push({ message, fields }) },
    });
    await projectDefaults(s, 'full-auto', { reviewer: 'agent', maxReworkRounds: 2 });
    const t = await s.createTicket('Careful', {
      runOptions: { approvalMode: 'manual', reviewer: 'lead' },
    });
    const detail = await startRun(s, t);
    expect(detail).toMatchObject({ approvalMode: 'manual', reviewer: 'lead', maxReworkRounds: 2 });
    // Not a Full auto run: the lead's brief does not say the plan is approved automatically.
    expect(s.fake.lead().spec.prompt).not.toContain('approved automatically');
    const started = logs.find((l) => l.message === 'ticket started')?.fields;
    expect(started).toMatchObject({
      approvalMode: 'manual',
      approvalModeFrom: 'ticket',
      reviewerFrom: 'ticket',
      maxReworkRoundsFrom: 'project',
    });
  });

  it("the one-run override wins over the ticket's options", async () => {
    const s = await setupBoard({ files: FILES });
    await projectDefaults(s, 'full-auto', { reviewer: 'agent', maxReworkRounds: 2 });
    const t = await s.createTicket('Careful', {
      runOptions: { approvalMode: 'manual', reviewer: 'lead', maxReworkRounds: 1 },
    });
    const detail = await startRun(s, t, { approvalMode: 'auto-edits', maxReworkRounds: 3 });
    expect(detail).toMatchObject({
      approvalMode: 'auto-edits',
      reviewer: 'lead',
      maxReworkRounds: 3,
    });
    // The override is for that run only: the ticket keeps its own options.
    expect((await s.detail(t.id)).ticket.runOptions).toEqual({
      approvalMode: 'manual',
      reviewer: 'lead',
      maxReworkRounds: 1,
    });
  });

  it('a project change reaches only tickets left on the project default', async () => {
    const s = await setupBoard({ files: FILES });
    await projectDefaults(s, 'auto-edits', { reviewer: 'agent', maxReworkRounds: 2 });
    const own = await s.createTicket('Own', { runOptions: { approvalMode: 'manual' } });
    const follows = await s.createTicket('Follows');
    // The owner changes the project's defaults after both tickets exist.
    await projectDefaults(s, 'auto', { reviewer: 'lead', maxReworkRounds: 4 });
    expect(await startRun(s, own)).toMatchObject({
      approvalMode: 'manual',
      reviewer: 'lead',
      maxReworkRounds: 4,
    });
    expect(await startRun(s, follows)).toMatchObject({
      approvalMode: 'auto',
      reviewer: 'lead',
      maxReworkRounds: 4,
    });
  });

  it('cleared back to the project default, the next run follows the project; a started run keeps its snapshot', async () => {
    const s = await setupBoard({ files: FILES });
    await projectDefaults(s, 'full-auto', { reviewer: 'agent', maxReworkRounds: 2 });
    const t = await s.createTicket('T', { runOptions: { approvalMode: 'manual' } });
    const first = await startRun(s, t);
    expect(first.approvalMode).toBe('manual');
    // Changing the ticket while its run works does not reach that run.
    expect(
      (await s.send('patch', `/api/tickets/${t.id}`, { runOptions: { approvalMode: null } }))
        .status,
    ).toBe(200);
    expect((await run(s, first.id)).approvalMode).toBe('manual');
    await stop(s, t);
    const rerun = await s.post(`/api/tickets/${t.id}/start`);
    expect(rerun.status, JSON.stringify(rerun.body)).toBe(200);
    await s.settle();
    const second = TicketDetailDtoSchema.parse(rerun.body).currentRun;
    expect(second?.id).not.toBe(first.id);
    expect((await run(s, second?.id ?? '')).approvalMode).toBe('full-auto');
  });
});

describe('patchRunOptions (RL-H)', () => {
  it('sets, clears and keeps fields', () => {
    expect(patchRunOptions(undefined, { approvalMode: 'manual' })).toEqual({
      approvalMode: 'manual',
    });
    expect(
      patchRunOptions({ approvalMode: 'manual', reviewer: 'lead' }, { approvalMode: null }),
    ).toEqual({ reviewer: 'lead' });
    expect(patchRunOptions({ maxReworkRounds: 0 }, { reviewer: 'agent' })).toEqual({
      maxReworkRounds: 0,
      reviewer: 'agent',
    });
    expect(patchRunOptions({ maxReworkRounds: 3 }, {})).toEqual({ maxReworkRounds: 3 });
    expect(patchRunOptions({ approvalMode: 'auto' }, null)).toEqual({});
  });
});
