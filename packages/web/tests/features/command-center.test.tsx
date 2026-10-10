import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { CommandCenter } from '../../src/features/command-center/CommandCenter';
import { containingProject } from '../../src/features/command-center/CandidateRoots';
import {
  candidate,
  diagnostics,
  event,
  overview,
  partialUsage,
  project,
  session,
  T1,
} from '../fixtures/dto';
import { fakeServer, jsonResponse, renderWithApi } from '../helpers';

const base = {
  '/api/discovery/candidates': [],
  '/api/diagnostics/ingestion': diagnostics(),
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

  it('shows adapter diagnostics: known skipped records apart from unrecognized ones', async () => {
    const d = diagnostics({
      unrecognized: [{ providerVersion: '2.1.0', recordType: 'mystery-type', count: 2 }],
      adapters: [
        {
          provider: 'claude-code',
          fileIssues: [{ path: 'projects/-repo/big.jsonl', reason: 'size-cap', detail: 'EFBIG' }],
          ignoredRecords: [
            { recordType: 'file-history-snapshot', count: 12601 },
            { recordType: 'queue-operation', count: 3 },
          ],
          parseErrors: 1,
        },
      ],
      ingestion: {
        pipeline: { eventsInvalid: 4, batchesFailed: 2 },
        scheduler: { polls: 17, pollErrors: 1, lastPollAt: T1 },
      },
    });
    renderWithApi(
      <CommandCenter />,
      fakeServer({ ...base, '/api/overview': overview(), '/api/diagnostics/ingestion': d }),
    );

    const ignored = await screen.findByTestId('ignored-records');
    expect(ignored.textContent).toContain('file-history-snapshot: 12,601');
    expect(ignored.textContent).toContain('queue-operation: 3');
    expect(screen.getByText('Known record types, skipped (counted, not stored)')).toBeTruthy();
    const unrecognized = screen.getByTestId('unrecognized-records');
    expect(unrecognized.textContent).toContain('mystery-type');
    expect(unrecognized.textContent).not.toContain('file-history-snapshot');
    expect(ignored.textContent).not.toContain('mystery-type');

    expect(screen.getByTestId('file-issues').textContent).toBe(
      'projects/-repo/big.jsonl: size-cap (EFBIG)',
    );
    const adapter = screen.getByTestId('adapter-diagnostics-claude-code');
    expect(adapter.textContent).toContain('1 line skipped as unparseable');

    const counters = screen.getByTestId('ingestion-counters');
    const value = (label: string) =>
      within(counters).getByText(label).nextElementSibling?.textContent;
    expect(value('Polls (since start)')).toBe('17');
    expect(value('Poll errors')).toBe('1');
    expect(value('Failed batches / invalid events')).toBe('2 / 4');
    expect(
      within(counters).getByText('Last poll').nextElementSibling?.querySelector('time'),
    ).toBeTruthy();
  });

  it('lists latest provider snapshots per session as estimated, unavailable never as $0', async () => {
    const o = overview({
      latestSnapshots: [
        {
          sessionId: 's-titled',
          title: 'Refactor parser',
          occurredAt: T1,
          scope: 'unknown',
          reportedCostUsd: { provenance: 'estimated', value: 1.5 },
        },
        {
          sessionId: 'abcdef12-0000-4000-8000-000000000000',
          title: null,
          occurredAt: null,
          scope: 'session',
          reportedCostUsd: { provenance: 'unavailable', value: null },
        },
      ],
    });
    renderWithApi(<CommandCenter />, fakeServer({ ...base, '/api/overview': o }));

    const list = await screen.findByTestId('latest-snapshots');
    expect(
      screen.getByText('Latest provider snapshots: cost estimated (provider-reported)'),
    ).toBeTruthy();
    const rows = list.querySelectorAll('li');
    expect(rows.length).toBe(2);

    const first = rows[0] as HTMLElement;
    expect(within(first).getByRole('link').getAttribute('href')).toBe('#/sessions/s-titled');
    const cost = within(first).getByTestId('cost');
    expect(cost.textContent).toContain('~$1.50');
    expect(cost.textContent).toContain('estimated (provider-reported)');
    expect(cost.querySelector('[data-provenance="estimated"]')).toBeTruthy();
    // Estimated cost is never styled as an authoritative number.
    expect(cost.querySelector('.text-estimated.italic')).toBeTruthy();

    const second = rows[1] as HTMLElement;
    expect(within(second).getByTestId('cost').textContent).toContain('unavailable');
    expect(second.textContent).not.toMatch(/\$0/);
    expect(second.textContent).toContain('(time unknown)');

    // Per session only: no total cost is rendered anywhere on the page.
    expect(document.body.textContent).not.toMatch(/total cost/i);
    expect(screen.getAllByTestId('cost').length).toBe(2);
  });

  it('says when no provider snapshot was observed', async () => {
    renderWithApi(<CommandCenter />, fakeServer({ ...base, '/api/overview': overview() }));
    expect((await screen.findByTestId('latest-snapshots-empty')).textContent).toBe(
      'No provider snapshot observed yet.',
    );
    expect(screen.queryByTestId('cost')).toBeNull();
  });

  it('says no poll ran yet instead of inventing a time', async () => {
    renderWithApi(<CommandCenter />, fakeServer({ ...base, '/api/overview': overview() }));
    const counters = await screen.findByTestId('ingestion-counters');
    expect(within(counters).getByText('Last poll').nextElementSibling?.textContent).toBe('not yet');
    expect(screen.queryByTestId('ignored-records')).toBeNull();
  });

  it('matches candidate roots to registered projects by path segment', () => {
    const projects = [project({ id: 'a', rootPath: '/work/app' })];
    expect(containingProject('/work/app/sub', projects)?.id).toBe('a');
    expect(containingProject('/work/app', projects)?.id).toBe('a');
    expect(containingProject('/work/application', projects)).toBeUndefined();
  });
});
