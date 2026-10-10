import { describe, expect, it } from 'vitest';
import { href, parseRoute } from '../../src/lib/router';

describe('hash router', () => {
  it('parses every route', () => {
    expect(parseRoute('')).toEqual({ name: 'home' });
    expect(parseRoute('#/')).toEqual({ name: 'home' });
    expect(parseRoute('#/sessions/a%2Fb')).toEqual({ name: 'session', id: 'a/b' });
    expect(parseRoute('#/projects/p-1')).toEqual({ name: 'project', id: 'p-1' });
    const sessions = parseRoute('#/sessions?status=stale&root=s-1');
    expect(sessions.name).toBe('sessions');
    if (sessions.name === 'sessions') expect(sessions.params.get('root')).toBe('s-1');
    expect(parseRoute('#/usage').name).toBe('usage');
    expect(parseRoute('#/projects')).toEqual({ name: 'projects' });
    expect(parseRoute('#/setup')).toEqual({ name: 'setup' });
    expect(parseRoute('#/health')).toEqual({ name: 'health' });
    expect(parseRoute('#/setup/x').name).toBe('not-found');
    expect(parseRoute('#/nope').name).toBe('not-found');
    expect(parseRoute('#/sessions/a/b').name).toBe('not-found');
  });

  it('round-trips ids through href', () => {
    const route = parseRoute(href.session('weird id/1'));
    expect(route).toEqual({ name: 'session', id: 'weird id/1' });
    expect(href.sessions({ status: 'stale', q: '' })).toBe('#/sessions?status=stale');
    for (const h of [href.projects(), href.setup(), href.health()]) {
      expect(parseRoute(h).name).not.toBe('not-found');
    }
  });
});
