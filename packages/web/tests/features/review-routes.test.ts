import { describe, expect, it } from 'vitest';
import { activePage, crumbsFor, fullWidth, pageKey, routeTicketId } from '../../src/app/nav';
import { reviewTarget } from '../../src/app/redirects';
import { hashWithParams, hashWithTab, paramFromHash } from '../../src/features/ticket/ticket-tabs';
import { href, parseRoute, routeProjectId, type Route } from '../../src/lib/router';

/*
 * v0.3.0 C-D: Files changed is the ticket page's tab. D-A's review page addresses still parse, and
 * redirect into the tab with the same selection; the links the app builds go straight there.
 */

const review = (hash: string) => {
  const route = parseRoute(hash);
  if (route.name !== 'review') throw new Error(`not a review route: ${hash}`);
  return route;
};

describe('the old review page addresses', () => {
  it('still parse: all changes and one helper’s change, with ?run=', () => {
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

  it('redirect to the ticket’s Files changed tab with the same change and run', () => {
    expect(reviewTarget(review('#/p/p1/tickets/t-21/files'))).toBe('#/p/p1/tickets/t-21?tab=files');
    expect(reviewTarget(review('#/p/p1/tickets/t-21/files?run=run-7'))).toBe(
      '#/p/p1/tickets/t-21?tab=files&run=run-7',
    );
    expect(reviewTarget(review('#/p/p1/tickets/t-21/changes/ag%20ui?run=run-7'))).toBe(
      '#/p/p1/tickets/t-21?tab=files&change=ag+ui&run=run-7',
    );
    // The target is the ticket page, on the tab, with the change the address named.
    const target = reviewTarget(review('#/p/p%201/tickets/t%2F21/changes/ag-ui'));
    expect(parseRoute(target)).toEqual({ name: 'ticket', projectId: 'p 1', id: 't/21' });
    expect(paramFromHash(target, 'change')).toBe('ag-ui');
  });

  it('belong to the project and the board in the shell while they redirect', () => {
    const route = parseRoute('#/p/p1/tickets/t-21/files');
    expect(routeProjectId(route)).toBe('p1');
    expect(activePage(route)).toBe('board');
    expect(routeTicketId(route)).toBe('t-21');
    expect(pageKey(route)).toBe('review:t-21:branch:');
  });
});

describe('links to Files changed', () => {
  it('go straight to the tab: all changes, or one change, with the run when given', () => {
    expect(href.ticketFiles({ projectId: 'p 1', ticketId: 't/21' })).toBe(
      '#/p/p%201/tickets/t%2F21?tab=files',
    );
    expect(href.ticketFiles({ projectId: 'p1', ticketId: 't', runId: null })).toBe(
      '#/p/p1/tickets/t?tab=files',
    );
    const change = href.ticketChange({
      projectId: 'p1',
      ticketId: 't-21',
      agentRunId: 'ag-ui',
      runId: 'run-7',
    });
    expect(change).toBe('#/p/p1/tickets/t-21?tab=files&change=ag-ui&run=run-7');
    expect(parseRoute(change)).toEqual({ name: 'ticket', projectId: 'p1', id: 't-21' });
    expect(paramFromHash(change, 'change')).toBe('ag-ui');
    expect(paramFromHash(change, 'run')).toBe('run-7');
  });

  it('the change belongs to Files changed: another tab drops it, the run stays', () => {
    const hash = '#/p/p1/tickets/t-21?tab=files&change=ag-ui&run=run-7';
    expect(hashWithTab(hash, 'checks')).toBe('#/p/p1/tickets/t-21?tab=checks&run=run-7');
    expect(hashWithTab(hash, 'comments')).toBe('#/p/p1/tickets/t-21?run=run-7');
    expect(hashWithTab(hash, 'files')).toBe(hash);
    expect(hashWithParams(hash, { change: null })).toBe('#/p/p1/tickets/t-21?tab=files&run=run-7');
    expect(hashWithParams('#/p/p1/tickets/t-21?tab=files', { change: 'ag-api' })).toBe(
      '#/p/p1/tickets/t-21?tab=files&change=ag-api',
    );
    expect(paramFromHash('#/p/p1/tickets/t-21?change=', 'change')).toBeNull();
  });
});

describe('the shell on a ticket', () => {
  const ticket: Route = { name: 'ticket', projectId: 'p1', id: 't-21' };

  it('the trail is Board / KEY, the key the page you are on (not a link)', () => {
    expect(crumbsFor(ticket, 'p1', 'WEB-21')).toEqual([
      { label: 'Board', to: '#/p/p1/board' },
      { label: 'WEB-21', to: null },
    ]);
    // Until the ticket is read, only Board.
    expect(crumbsFor(ticket, 'p1')).toEqual([{ label: 'Board', to: '#/p/p1/board' }]);
    // A run without a ticket stays under Board.
    expect(crumbsFor({ name: 'run', projectId: 'p1', runId: 'r1' }, 'p1', 'WEB-21')).toEqual([
      { label: 'Board', to: '#/p/p1/board' },
    ]);
  });

  it('uses the whole width on Files changed only', () => {
    expect(fullWidth(ticket, '#/p/p1/tickets/t-21?tab=files')).toBe(true);
    expect(fullWidth(ticket, '#/p/p1/tickets/t-21?tab=changes&change=x')).toBe(true);
    expect(fullWidth(ticket, '#/p/p1/tickets/t-21')).toBe(false);
    expect(fullWidth(ticket, '#/p/p1/tickets/t-21?tab=agents')).toBe(false);
    expect(fullWidth(parseRoute('#/p/p1/board'), '#/p/p1/board?tab=files')).toBe(false);
  });
});
