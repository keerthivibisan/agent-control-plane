import { describe, expect, it } from 'vitest';
import { activePage, crumbsFor, pageKey } from '../../src/app/nav';
import { href, parseRoute, routeProjectId } from '../../src/lib/router';

/* v0.3.0 D-A: the review pages' addresses and their links. */

describe('review routes', () => {
  it('parses the ticket branch’s files and one helper’s change', () => {
    expect(parseRoute('#/p/p1/tickets/t-21/files')).toEqual({
      name: 'review',
      projectId: 'p1',
      ticketId: 't-21',
      agentRunId: null,
      runId: null,
    });
    expect(parseRoute('#/p/p1/tickets/t-21/changes/ag%20ui?run=run-7')).toEqual({
      name: 'review',
      projectId: 'p1',
      ticketId: 't-21',
      agentRunId: 'ag ui',
      runId: 'run-7',
    });
    // The ticket page itself is unchanged.
    expect(parseRoute('#/p/p1/tickets/t-21')).toEqual({
      name: 'ticket',
      projectId: 'p1',
      id: 't-21',
    });
  });

  it('says not found for anything else under a ticket', () => {
    for (const hash of [
      '#/p/p1/tickets/t-21/files/extra',
      '#/p/p1/tickets/t-21/changes',
      '#/p/p1/tickets/t-21/changes/a/b',
      '#/p/p1/tickets/t-21/other',
      '#/p/p1/tickets',
    ]) {
      expect(parseRoute(hash).name).toBe('not-found');
    }
  });

  it('builds the links and round-trips odd ids', () => {
    const files = href.ticketFiles({ projectId: 'p 1', ticketId: 't/21' });
    expect(files).toBe('#/p/p%201/tickets/t%2F21/files');
    expect(parseRoute(files)).toMatchObject({ projectId: 'p 1', ticketId: 't/21', runId: null });
    const change = href.ticketChange({
      projectId: 'p1',
      ticketId: 't-21',
      agentRunId: 'ag-ui',
      runId: 'run-7',
    });
    expect(change).toBe('#/p/p1/tickets/t-21/changes/ag-ui?run=run-7');
    expect(parseRoute(change)).toMatchObject({ agentRunId: 'ag-ui', runId: 'run-7' });
    expect(href.ticketFiles({ projectId: 'p1', ticketId: 't', runId: null })).toBe(
      '#/p/p1/tickets/t/files',
    );
  });

  it('belongs to the project and the board in the shell', () => {
    const route = parseRoute('#/p/p1/tickets/t-21/files');
    expect(routeProjectId(route)).toBe('p1');
    expect(activePage(route)).toBe('board');
    expect(crumbsFor(route, 'p1')).toEqual([{ label: 'Board', to: '#/p/p1/board' }]);
    expect(pageKey(route)).toBe('review:t-21:branch:');
    expect(pageKey(parseRoute('#/p/p1/tickets/t-21/changes/ag'))).toBe('review:t-21:ag:');
  });
});
