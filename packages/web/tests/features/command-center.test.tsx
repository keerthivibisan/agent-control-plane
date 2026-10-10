import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { CommandCenter } from '../../src/features/command-center/CommandCenter';
import { containingProject } from '../../src/features/command-center/CandidateRoots';
import { candidate, event, overview, partialUsage, project, session, T1 } from '../fixtures/dto';
import { fakeServer, jsonResponse, renderWithApi } from '../helpers';

const base = {
  '/api/discovery/candidates': [],
  '/api/diagnostics/ingestion': {
    sources: [],
    unrecognized: [],
    edgeConflictCount: 0,
    usageConflictCount: 0,
  },
};

describe('Command Center', () => {
  it('renders every number from the overview DTO', async () => {
    const o = overview({
      projectCount: 3,
      sessionsByStatus: { active: 7, idle: 11, stale: 13, ended: 17, unknown: 19 },
      totals: partialUsage,
      activeSessions: [session({ id: 's-active', title: 'Refactor parser' })],
      needsAttention: [session({ id: 's-attn', title: 'Waiting on me', lastAttentionAt: T1 })],
      recentEvents: [
        event({ id: 41, eventType: 'session.attention', payload: { notificationType: 'idle' } }),
      ],
    });
    renderWithApi(
      <CommandCenter />,
      fakeServer({ ...base, '/api/overview': o, '/api/projects': [project({ id: 'p-1' })] }),
    );

    const counts = await screen.findByTestId('sessions-by-status');
    const count = (s: string) => counts.querySelector(`[data-status-count="${s}"]`)?.textContent;
    expect(count('active')).toBe('active7');
    expect(count('stale')).toBe('stale (no recent activity)13');
    expect(count('ended')).toBe('ended17');
    expect(screen.getByText('Projects').nextElementSibling?.textContent).toBe('3');

    const total = screen.getByRole('region', { name: 'Total usage' });
    expect(total.querySelector('[data-category="cacheCreation"]')?.textContent).toBe('unavailable');
    expect(total.querySelector('[data-category="input"]')?.textContent).toBe('10');

    expect(within(screen.getByTestId('needs-attention')).getByText('Waiting on me')).toBeTruthy();
    expect(screen.getByText('Refactor parser')).toBeTruthy();
    expect(screen.getByText('session.attention')).toBeTruthy();
  });

  it('explains how to register a project and registers a discovered root', async () => {
    const server = fakeServer({
      ...base,
      '/api/overview': overview({ projectCount: 0, candidateRootCount: 1 }),
      '/api/discovery/candidates': [candidate({ cwd: '/work/alpha', sessionCount: 5 })],
      'POST /api/projects': (body: unknown) =>
        jsonResponse(
          200,
          project({ id: 'p-new', ...(body as { name: string; rootPath: string }) }),
        ),
    });
    renderWithApi(<CommandCenter />, server);

    expect(await screen.findByText('Get started: register a project')).toBeTruthy();
    expect(screen.getByText(/registered project roots/)).toBeTruthy();
    const row = await screen.findByText('/work/alpha');
    const register = within(row.closest('tr') as HTMLElement).getByRole('button', {
      name: 'register',
    });
    fireEvent.click(register);
    await waitFor(() =>
      expect(server.calls.find((c) => c.method === 'POST')?.body).toEqual({
        name: 'alpha',
        rootPath: '/work/alpha',
      }),
    );
    expect(await screen.findByText(/Registered/)).toBeTruthy();
  });

  it('posts the register form and shows a server 400 ErrorDto', async () => {
    const server = fakeServer({
      ...base,
      '/api/overview': overview({ projectCount: 0 }),
      'POST /api/projects': jsonResponse(400, {
        error: { code: 'not_a_directory', message: 'rootPath does not exist', requestId: 'r-1' },
      }),
    });
    renderWithApi(<CommandCenter />, server);
    const form = await screen.findByRole('form', { name: 'Register a project' });
    fireEvent.change(within(form).getByPlaceholderText('my-repo'), { target: { value: 'repo' } });
    fireEvent.change(within(form).getByPlaceholderText('/Users/me/code/my-repo'), {
      target: { value: '/nope' },
    });
    fireEvent.submit(form);
    const alert = await within(form).findByRole('alert');
    expect(alert.textContent).toContain('rootPath does not exist');
    expect(alert.textContent).toContain('not_a_directory');
  });

  it('rejects a relative path before calling the server', async () => {
    const server = fakeServer({ ...base, '/api/overview': overview({ projectCount: 0 }) });
    renderWithApi(<CommandCenter />, server);
    const form = await screen.findByRole('form', { name: 'Register a project' });
    fireEvent.change(within(form).getByPlaceholderText('my-repo'), { target: { value: 'repo' } });
    fireEvent.change(within(form).getByPlaceholderText('/Users/me/code/my-repo'), {
      target: { value: 'relative/path' },
    });
    fireEvent.submit(form);
    expect((await within(form).findByRole('alert')).textContent).toContain('absolute path');
    expect(server.calls.some((c) => c.method === 'POST')).toBe(false);
  });

  it('explains that needs-attention requires hooks when none were received', async () => {
    renderWithApi(<CommandCenter />, fakeServer({ ...base, '/api/overview': overview() }));
    expect(await screen.findByText('No session is waiting for input.')).toBeTruthy();
    expect((await screen.findAllByTestId('hooks-status'))[0]?.textContent).toContain('opt-in');
  });

  it('matches candidate roots to registered projects by path segment', () => {
    const projects = [project({ id: 'a', rootPath: '/work/app' })];
    expect(containingProject('/work/app/sub', projects)?.id).toBe('a');
    expect(containingProject('/work/app', projects)?.id).toBe('a');
    expect(containingProject('/work/application', projects)).toBeUndefined();
  });
});
