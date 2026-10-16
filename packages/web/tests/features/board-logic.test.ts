import { TICKET_STAGES } from '@acp/core';
import { describe, expect, it } from 'vitest';
import {
  allowedMoves,
  boardColumns,
  canMove,
  moveRequest,
  parseLabels,
  ticketCount,
} from '../../src/features/board/moves';
import {
  boardPaths,
  createApiClient,
  createTicket,
  isBoardPath,
  moveTicket,
  startTicket,
} from '../../src/lib/api';
import { href, parseRoute } from '../../src/lib/router';
import { board, CSRF, ticketDetail, ticketDto, tickets } from '../fixtures/board';
import { fakeServer, jsonResponse } from '../helpers';

describe('board moves (README §5.2: only owner-settable moves)', () => {
  it('allows Backlog ↔ Ready, Ready → Planning, and open → Cancelled', () => {
    expect(allowedMoves('BACKLOG')).toEqual(['READY', 'CANCELLED']);
    expect(allowedMoves('READY')).toEqual(['BACKLOG', 'PLANNING', 'CANCELLED']);
    for (const stage of ['PLANNING', 'PLAN_REVIEW', 'WORKING', 'NEEDS_YOU', 'IN_REVIEW'] as const) {
      expect(allowedMoves(stage)).toEqual(['CANCELLED']);
    }
    expect(allowedMoves('DONE')).toEqual([]);
    expect(allowedMoves('CANCELLED')).toEqual([]);
  });

  it('never lets the owner drag into a run-driven column other than Planning from Ready', () => {
    for (const from of TICKET_STAGES) {
      for (const to of ['PLAN_REVIEW', 'WORKING', 'NEEDS_YOU', 'IN_REVIEW', 'DONE'] as const) {
        expect(canMove(from, to)).toBe(false);
      }
    }
    expect(canMove('BACKLOG', 'PLANNING')).toBe(false);
    expect(canMove('READY', 'PLANNING')).toBe(true);
    expect(canMove('READY', 'READY')).toBe(false);
  });

  it('maps Planning to starting a run and the rest to a status change', () => {
    expect(moveRequest('PLANNING')).toEqual({ kind: 'start' });
    expect(moveRequest('READY')).toEqual({ kind: 'move', status: 'READY' });
    expect(moveRequest('CANCELLED')).toEqual({ kind: 'move', status: 'CANCELLED' });
  });

  it('lays out every stage in board order, even ones the server left out', () => {
    const b = board({}, [tickets.working, tickets.backlog]);
    const columns = boardColumns(b);
    expect(columns.map((c) => c.stage)).toEqual([...TICKET_STAGES]);
    expect(columns[0]?.tickets.map((t) => t.key)).toEqual(['WEB-14']);
    expect(columns.find((c) => c.stage === 'READY')?.tickets).toEqual([]);
    expect(ticketCount(b)).toBe(2);
  });

  it('parses labels: trimmed, blanks and repeats dropped', () => {
    expect(parseLabels(' ui, dark mode,,ui , ')).toEqual(['ui', 'dark mode']);
    expect(parseLabels('')).toEqual([]);
  });
});

describe('board routes', () => {
  it('parses #/board and #/board/:projectId and round-trips ids', () => {
    // Redesign (R-A): the board lives at #/p/:projectId/board; #/board/... redirects there.
    expect(parseRoute('#/board')).toEqual({
      name: 'legacy',
      legacy: { kind: 'board', projectId: null },
    });
    expect(parseRoute('#/board/p-1')).toEqual({
      name: 'legacy',
      legacy: { kind: 'board', projectId: 'p-1' },
    });
    const route = parseRoute(href.board('a b/c'));
    expect(route.name === 'project' && route.page === 'board' && route.projectId).toBe('a b/c');
    expect(parseRoute('#/board/p-1/x').name).toBe('not-found');
    expect(href.ticket({ id: 't 1', projectId: 'p-1' })).toBe('#/p/p-1/tickets/t%201');
  });
});

describe('board client functions (README §6.3)', () => {
  function server() {
    const s = fakeServer({
      '/api/control/token': { token: CSRF },
      'POST /api/projects/p%2F1/tickets': () =>
        jsonResponse(201, ticketDto({ id: 't-1', key: 'WEB-1' })),
      'POST /api/tickets/t-1/move': ticketDto({
        id: 't-1',
        key: 'WEB-1',
        status: 'READY',
        stage: 'READY',
      }),
      'POST /api/tickets/t-1/start': ticketDetail(ticketDto({ id: 't-1', key: 'WEB-1' })),
    });
    const headers: Record<string, string>[] = [];
    const client = createApiClient((input, init) => {
      if (init?.method === 'POST') headers.push((init.headers ?? {}) as Record<string, string>);
      return s.fetch(input, init);
    });
    return { client, calls: s.calls, headers };
  }

  it('builds the board and ticket paths', () => {
    expect(boardPaths.board('p 1')).toBe('/api/board?projectId=p+1');
    expect(boardPaths.tickets('p/1')).toBe('/api/projects/p%2F1/tickets');
    expect(boardPaths.move('t-1')).toBe('/api/tickets/t-1/move');
    expect(boardPaths.start('t-1')).toBe('/api/tickets/t-1/start');
  });

  it('marks board, ticket and project-ticket paths for refetching, and nothing else', () => {
    expect(isBoardPath('/api/board?projectId=p')).toBe(true);
    expect(isBoardPath('/api/tickets/t-1')).toBe(true);
    expect(isBoardPath('/api/projects/p-1/tickets')).toBe(true);
    expect(isBoardPath('/api/projects/p-1')).toBe(false);
    expect(isBoardPath('/api/projects/p-1/sessions')).toBe(false);
    expect(isBoardPath('/api/projects')).toBe(false);
  });

  it('creates, moves and starts tickets with the CSRF header and parsed bodies', async () => {
    const { client, calls, headers } = server();
    const created = await createTicket(client, 'p/1', {
      title: '  Dark mode ',
      description: '',
      type: 'feature',
      priority: 'high',
      labels: ['ui'],
    });
    expect(created.key).toBe('WEB-1');
    expect(calls.find((c) => c.method === 'POST')?.body).toEqual({
      title: 'Dark mode',
      description: '',
      type: 'feature',
      priority: 'high',
      labels: ['ui'],
    });
    const moved = await moveTicket(client, 't-1', { status: 'READY' });
    expect(moved.stage).toBe('READY');
    const started = await startTicket(client, 't-1');
    expect(started.ticket.id).toBe('t-1');
    expect(headers).toHaveLength(3);
    for (const h of headers) expect(h['X-ACP-CSRF']).toBe(CSRF);
  });

  it('refuses an invalid request before it leaves the browser', async () => {
    const { client, calls } = server();
    await expect(
      moveTicket(client, 't-1', { status: 'DONE' } as unknown as { status: 'READY' }),
    ).rejects.toMatchObject({ kind: 'parse' });
    expect(calls.filter((c) => c.method === 'POST')).toHaveLength(0);
  });
});
