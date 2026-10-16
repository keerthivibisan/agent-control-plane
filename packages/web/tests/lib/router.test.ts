import { describe, expect, it } from 'vitest';
import {
  href,
  parseRoute,
  PROJECT_PAGE_IDS,
  routeProjectId,
  type LegacyRoute,
  type Route,
} from '../../src/lib/router';

/** Route without its URLSearchParams (compared separately: they never deep-equal in vitest). */
function plain(route: Route): unknown {
  if (route.name === 'project') {
    const { params, ...rest } = route;
    return { ...rest, query: params.toString() };
  }
  if (route.name === 'legacy' && 'params' in route.legacy) {
    const { params, ...rest } = route.legacy;
    return { name: 'legacy', legacy: { ...rest, query: params.toString() } };
  }
  return route;
}

const legacy = (l: LegacyRoute | Record<string, unknown>) => ({ name: 'legacy', legacy: l });

describe('hash router: project-first routes', () => {
  it('parses every project page', () => {
    for (const page of PROJECT_PAGE_IDS) {
      expect(plain(parseRoute(`#/p/p-1/${page}`))).toEqual({
        name: 'project',
        projectId: 'p-1',
        page,
        item: null,
        query: '',
      });
    }
  });

  it('keeps the query of a project page and decodes ids', () => {
    expect(plain(parseRoute('#/p/a%2Fb/sessions?status=stale&root=s-1'))).toEqual({
      name: 'project',
      projectId: 'a/b',
      page: 'sessions',
      item: null,
      query: 'status=stale&root=s-1',
    });
  });

  it('parses a ticket, a skill and a Phase 3 run', () => {
    expect(parseRoute('#/p/p-1/tickets/t-12')).toEqual({
      name: 'ticket',
      projectId: 'p-1',
      id: 't-12',
    });
    expect(plain(parseRoute('#/p/p-1/skills/code-review'))).toEqual({
      name: 'project',
      projectId: 'p-1',
      page: 'skills',
      item: 'code-review',
      query: '',
    });
    expect(parseRoute('#/p/p-1/runs/r-1')).toEqual({ name: 'run', projectId: 'p-1', runId: 'r-1' });
    expect(parseRoute('#/p/p-1/runs/new')).toEqual({ name: 'run', projectId: 'p-1', runId: null });
  });

  it('parses the global pages', () => {
    expect(parseRoute('#/projects')).toEqual({ name: 'projects' });
    expect(parseRoute('#/projects/new')).toEqual({ name: 'project-new' });
    expect(parseRoute('#/health')).toEqual({ name: 'health', tab: 'overview' });
    expect(parseRoute('#/health/connection')).toEqual({ name: 'health', tab: 'connection' });
    expect(parseRoute('#/sessions/a%2Fb')).toEqual({ name: 'session', id: 'a/b' });
  });

  it('says not found for anything else', () => {
    for (const h of [
      '#/nope',
      '#/p',
      '#/p/p-1',
      '#/p/p-1/nope',
      '#/p/p-1/board/x',
      '#/p/p-1/tickets',
      '#/p/p-1/tickets/t/x',
      '#/p/%E0%A4%A/board',
      '#/health/x',
      '#/setup/x',
      '#/sessions/a/b',
      '#/projects/p-1/other',
      '#/board/p-1/x',
      '#/control/a/b',
    ]) {
      expect(parseRoute(h).name, h).toBe('not-found');
    }
  });
});

describe('hash router: old addresses parse as legacy routes', () => {
  it('recognises every pre-redesign route', () => {
    expect(parseRoute('')).toEqual(legacy({ kind: 'home' }));
    expect(parseRoute('#/')).toEqual(legacy({ kind: 'home' }));
    expect(parseRoute('#/board')).toEqual(legacy({ kind: 'board', projectId: null }));
    expect(parseRoute('#/board/p-1')).toEqual(legacy({ kind: 'board', projectId: 'p-1' }));
    expect(parseRoute('#/tickets/t-1')).toEqual(legacy({ kind: 'ticket', ticketId: 't-1' }));
    expect(parseRoute('#/projects/p-1')).toEqual(legacy({ kind: 'project', projectId: 'p-1' }));
    expect(parseRoute('#/projects/p-1/settings')).toEqual(
      legacy({ kind: 'project-settings', projectId: 'p-1' }),
    );
    expect(plain(parseRoute('#/usage?groupBy=day'))).toEqual(
      legacy({ kind: 'usage', query: 'groupBy=day' }),
    );
    expect(plain(parseRoute('#/sessions?status=stale'))).toEqual(
      legacy({ kind: 'sessions', query: 'status=stale' }),
    );
    expect(parseRoute('#/setup')).toEqual(legacy({ kind: 'setup' }));
    expect(parseRoute('#/control')).toEqual(legacy({ kind: 'control', runId: null }));
    expect(parseRoute('#/control/new')).toEqual(legacy({ kind: 'control', runId: 'new' }));
    expect(parseRoute('#/control/r-1')).toEqual(legacy({ kind: 'control', runId: 'r-1' }));
  });
});

describe('href', () => {
  it('builds the new addresses and round-trips ids', () => {
    expect(href.project('p 1')).toBe('#/p/p%201/board');
    expect(href.board('p-1')).toBe('#/p/p-1/board');
    expect(href.board()).toBe('#/');
    expect(href.projectSettings('p-1')).toBe('#/p/p-1/settings');
    expect(href.ticket({ id: 't 1', projectId: 'p-1' })).toBe('#/p/p-1/tickets/t%201');
    expect(href.run({ id: 'r-1', projectId: 'p-1' })).toBe('#/p/p-1/runs/r-1');
    expect(href.skill('p-1', 'code-review')).toBe('#/p/p-1/skills/code-review');
    expect(href.setup()).toBe('#/health/connection');
    expect(parseRoute(href.session('weird id/1'))).toEqual({ name: 'session', id: 'weird id/1' });
    for (const h of [href.projects(), href.newProject(), href.setup(), href.health()]) {
      expect(parseRoute(h).name, h).not.toBe('not-found');
    }
  });

  it('puts the project of Sessions and Tokens links into the path', () => {
    expect(href.sessions({ projectId: 'p-1', status: 'stale', q: '' })).toBe(
      '#/p/p-1/sessions?status=stale',
    );
    expect(href.usage({ projectId: 'p-1', groupBy: 'day' })).toBe('#/p/p-1/tokens?groupBy=day');
    // Without a project they are the old addresses, which redirect to the last project.
    expect(href.sessions({ status: 'stale' })).toBe('#/sessions?status=stale');
    expect(href.usage({ groupBy: 'day' })).toBe('#/usage?groupBy=day');
  });

  it('names the project of project-scoped routes only', () => {
    expect(routeProjectId(parseRoute('#/p/p-1/tokens'))).toBe('p-1');
    expect(routeProjectId(parseRoute('#/p/p-1/tickets/t-1'))).toBe('p-1');
    expect(routeProjectId(parseRoute('#/p/p-1/runs/r-1'))).toBe('p-1');
    expect(routeProjectId(parseRoute('#/projects'))).toBeNull();
    expect(routeProjectId(parseRoute('#/sessions/s-1'))).toBeNull();
  });
});
