import { describe, expect, it } from 'vitest';
import {
  BoardDtoSchema,
  TicketCardDtoSchema,
  TicketCommentDtoSchema,
  TicketDetailDtoSchema,
  TicketDtoSchema,
} from '@acp/core/api';
import { TICKET_STAGES } from '@acp/core';
import { expectError } from '../control/helpers.js';
import { setupBoard } from './helpers.js';

/*
 * Board and ticket routes (README §6.3, §6.2, ADR-0016): every answer parses with its
 * `@acp/core/api` DTO, columns come from `ticketStage()`, and owner-set moves only.
 */

describe('tickets and the board', () => {
  it('creates tickets with per-project keys and shows them in the Backlog column', async () => {
    const s = await setupBoard();
    const a = TicketDtoSchema.parse(await s.createTicket('Add dark mode', { type: 'feature' }));
    const b = TicketDtoSchema.parse(
      await s.createTicket('Fix login', { type: 'bug', priority: 'high', labels: ['auth'] }),
    );
    expect([a.key, b.key]).toEqual(['WEBAPP-1', 'WEBAPP-2']);
    expect(b).toMatchObject({ status: 'BACKLOG', stage: 'BACKLOG', priority: 'high' });

    const res = await s.get(`/api/board?projectId=${s.project.id}`);
    expect(res.status).toBe(200);
    const board = BoardDtoSchema.parse(res.body);
    expect(board.projectKey).toBe('WEBAPP');
    expect(board.project.id).toBe(s.project.id);
    expect(board.harness.state).toBe('none');
    expect(board.columns.map((c) => c.stage)).toEqual(TICKET_STAGES);
    expect(board.columns.find((c) => c.stage === 'BACKLOG')?.tickets.map((t) => t.key)).toEqual([
      'WEBAPP-1',
      'WEBAPP-2',
    ]);
    // No usage recorded: every token type is unavailable (null), never 0.
    expect(board.stats).toEqual({
      tokensLast7Days: { input: null, output: null, cacheCreation: null, cacheRead: null },
      runningRuns: 0,
      needsYou: 0,
    });
    const card = board.columns[0]?.tickets[0];
    expect(card).toMatchObject({
      activeHelpers: 0,
      budgetTokensUsed: null,
      needsYou: 0,
      latestEstimatedCost: null,
      lastActivityAt: null,
      lastRunOutcome: null,
    });

    const list = await s.get(`/api/projects/${s.project.id}/tickets`);
    expect(TicketCardDtoSchema.array().parse(list.body)).toHaveLength(2);
    expect(s.notices.some((n) => n.kind === 'tickets-changed' && n.ticketIds?.includes(a.id))).toBe(
      true,
    );
  });

  it('answers 400 without projectId and 404 for an unknown project or ticket', async () => {
    const s = await setupBoard();
    expectError(await s.get('/api/board'), 400, 'invalid_request');
    expectError(await s.get('/api/board?projectId=nope'), 404, 'not_found');
    expectError(await s.get('/api/projects/nope/tickets'), 404, 'not_found');
    expectError(await s.get('/api/tickets/nope'), 404, 'not_found');
    expectError(await s.post('/api/projects/nope/tickets', { title: 'x' }), 404, 'not_found');
    expectError(
      await s.post(`/api/projects/${s.project.id}/tickets`, { title: '' }),
      400,
      'invalid_request',
    );
  });

  it('GET and PATCH a ticket answer TicketDetailDto', async () => {
    const s = await setupBoard();
    const t = await s.createTicket();
    const got = TicketDetailDtoSchema.parse((await s.get(`/api/tickets/${t.id}`)).body);
    expect(got).toMatchObject({ runs: [], currentRun: null, plans: [], comments: [], checks: [] });
    const res = await s.send('patch', `/api/tickets/${t.id}`, {
      title: 'Add a dark theme',
      labels: ['ui'],
    });
    expect(res.status).toBe(200);
    expect(TicketDetailDtoSchema.parse(res.body).ticket).toMatchObject({
      title: 'Add a dark theme',
      labels: ['ui'],
      description: '',
    });
    expectError(
      await s.send('patch', `/api/tickets/${t.id}`, { priority: 'whenever' }),
      400,
      'invalid_request',
    );
  });

  it('POST comments answers TicketCommentDto (201) and keeps it on the ticket', async () => {
    const s = await setupBoard();
    const t = await s.createTicket();
    const res = await s.post(`/api/tickets/${t.id}/comments`, { body: 'Use the system theme.' });
    expect(res.status).toBe(201);
    expect(TicketCommentDtoSchema.parse(res.body)).toMatchObject({
      ticketId: t.id,
      author: 'owner',
      body: 'Use the system theme.',
      runId: null,
      planId: null,
    });
    expect((await s.detail(t.id)).comments).toHaveLength(1);
    expectError(
      await s.post(`/api/tickets/${t.id}/comments`, { body: ' ' }),
      400,
      'invalid_request',
    );
  });

  it('moves Backlog ↔ Ready and to Cancelled; a Backlog ticket cannot start', async () => {
    const s = await setupBoard();
    const t = await s.createTicket();
    expectError(await s.post(`/api/tickets/${t.id}/start`), 409, 'ticket_not_ready');
    let res = await s.post(`/api/tickets/${t.id}/move`, { status: 'READY' });
    expect(TicketDtoSchema.parse(res.body)).toMatchObject({ status: 'READY', stage: 'READY' });
    res = await s.post(`/api/tickets/${t.id}/move`, { status: 'BACKLOG' });
    expect(TicketDtoSchema.parse(res.body).stage).toBe('BACKLOG');
    expectError(
      await s.post(`/api/tickets/${t.id}/move`, { status: 'DONE' }),
      400,
      'invalid_request',
    );
    res = await s.post(`/api/tickets/${t.id}/move`, { status: 'CANCELLED' });
    expect(TicketDtoSchema.parse(res.body).stage).toBe('CANCELLED');
  });

  it('start answers 404 managed_disabled when managed agents are off', async () => {
    const s = await setupBoard({ enabled: false });
    const t = await s.createTicket();
    // Reads work without managed agents.
    expect((await s.get(`/api/board?projectId=${s.project.id}`)).status).toBe(200);
    await s.post(`/api/tickets/${t.id}/move`, { status: 'READY' });
    expectError(await s.post(`/api/tickets/${t.id}/start`), 404, 'managed_disabled');
  });
});
