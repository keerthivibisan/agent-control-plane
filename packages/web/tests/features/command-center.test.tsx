import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { CommandCenter } from '../../src/features/command-center/CommandCenter';
import { capabilities, event, overview, partialUsage, project, session, T1 } from '../fixtures/dto';
import { fakeServer, renderWithApi } from '../helpers';

const hooksOn = capabilities({
  hooks: { receiverUrl: 'http://127.0.0.1:7420/api/hooks/claude-code', receivedAny: true },
});

describe('Overview (#/)', () => {
  it('shows every headline number from the overview DTO, with units', async () => {
    const o = overview({
      projectCount: 3,
      sessionsByStatus: { active: 7, idle: 11, stale: 13, ended: 17, unknown: 0 },
      needsAttention: [session({ id: 's-attn', title: 'Waiting on me', lastAttentionAt: T1 })],
    });
    renderWithApi(<CommandCenter />, fakeServer({ '/api/overview': o }));

    expect(await screen.findByRole('heading', { level: 1, name: 'Overview' })).toBeTruthy();
    expect(screen.getByTestId('stat-running').textContent).toContain('7 sessions');
    expect(screen.getByTestId('stat-need-you').textContent).toContain('1 session');
    expect(screen.getByTestId('stat-projects').textContent).toContain('3 folders');

    const counts = screen.getByTestId('sessions-by-status');
    const count = (s: string) => counts.querySelector(`[data-status-count="${s}"]`)?.textContent;
    expect(count('active')).toBe('Running7 sessions');
    expect(count('idle')).toBe('Paused11 sessions');
    expect(count('stale')).toBe('Inactive13 sessions');
    expect(count('ended')).toBe('Ended17 sessions');
    // Unknown appears only when some session has it; "completed" never exists.
    expect(counts.querySelector('[data-status-count="unknown"]')).toBeNull();
    expect(document.body.textContent).not.toMatch(/completed/i);
  });

  it('shows Unknown in the status card when a session has it', async () => {
    const o = overview({
      sessionsByStatus: { active: 0, idle: 0, stale: 0, ended: 0, unknown: 2 },
    });
    renderWithApi(<CommandCenter />, fakeServer({ '/api/overview': o }));
    const counts = await screen.findByTestId('sessions-by-status');
    expect(counts.querySelector('[data-status-count="unknown"]')?.textContent).toBe(
      'Unknown2 sessions',
    );
  });

  it('shows token types side by side, missing ones as "Not reported", never a total', async () => {
    const o = overview({ totals: partialUsage });
    renderWithApi(<CommandCenter />, fakeServer({ '/api/overview': o }));
    const tokens = await screen.findByRole('region', { name: 'Tokens used' });
    const value = (c: string) => tokens.querySelector(`dd[data-category="${c}"]`)?.textContent;
    expect(value('input')).toBe('10');
    expect(value('output')).toBe('200');
    expect(value('cacheCreation')).toBe('Not reported');
    expect(value('cacheRead')).toBe('5,000');
    expect(within(tokens).getByText('Input tokens')).toBeTruthy();
    expect(within(tokens).getByText('Cache write tokens')).toBeTruthy();
    // The partial note explains cache read; 10 + 200 + 5000 = 5210 must never appear.
    expect(tokens.textContent).not.toContain('5,210');
    expect(tokens.textContent).not.toMatch(/total tokens/i);
  });

  it('lists running and waiting sessions as friendly rows', async () => {
    const o = overview({
      activeSessions: [
        session({ id: 's-run', title: 'Refactor parser', projectId: 'p-1', childCount: 2 }),
        session({ id: 's-untitled', title: null, agentType: null, projectId: null }),
      ],
      needsAttention: [
        session({
          id: 's-attn',
          title: 'Waiting on me',
          lastAttentionAt: T1,
          status: {
            value: 'idle',
            provenance: 'derived',
            basis: { lastEventAt: T1, endedAt: null, evaluatedAt: T1 },
          },
        }),
      ],
    });
    renderWithApi(
      <CommandCenter />,
      fakeServer({
        '/api/overview': o,
        '/api/capabilities': hooksOn,
        '/api/projects': [project({ id: 'p-1', name: 'alpha' })],
      }),
    );

    const running = await screen.findByRole('list', { name: 'Running now' });
    const row = running.querySelector('[data-session-id="s-run"]') as HTMLElement;
    expect(within(row).getByRole('link', { name: 'Refactor parser' }).getAttribute('href')).toBe(
      '#/sessions/s-run',
    );
    await within(row).findByText('alpha · 2 helper agents');
    expect(within(row).getByText('Running')).toBeTruthy();
    expect(within(row).getByRole('time')).toBeTruthy();
    const untitled = running.querySelector('[data-session-id="s-untitled"]') as HTMLElement;
    expect(untitled.textContent).toContain('Untitled session');
    expect(untitled.textContent).toContain('No project');

    const waiting = screen.getByTestId('needs-attention');
    expect(within(waiting).getByText('Waiting on me')).toBeTruthy();
    expect(within(waiting).getByText('Paused')).toBeTruthy();
    expect(waiting.textContent).toContain('Asked');
  });

  it('says plainly when nothing runs and points to Setup when hooks never arrived', async () => {
    renderWithApi(<CommandCenter />, fakeServer({ '/api/overview': overview() }));
    expect(await screen.findByText('Nothing running')).toBeTruthy();
    const hooksOff = await screen.findByTestId('hooks-off');
    expect(hooksOff.textContent).toContain('Live updates are off');
    expect(within(hooksOff).getByRole('link', { name: 'Set up live updates' })).toBeTruthy();
    expect(
      within(hooksOff).getByRole('link', { name: 'Set up live updates' }).getAttribute('href'),
    ).toBe('#/setup');
  });

  it('says nothing needs you once hooks are connected', async () => {
    renderWithApi(
      <CommandCenter />,
      fakeServer({ '/api/overview': overview(), '/api/capabilities': hooksOn }),
    );
    expect(await screen.findByText('Nothing needs you')).toBeTruthy();
    expect(screen.queryByTestId('hooks-off')).toBeNull();
  });

  it('with no projects, shows only a get-started card that links to Setup', async () => {
    renderWithApi(
      <CommandCenter />,
      fakeServer({ '/api/overview': overview({ projectCount: 0, candidateRootCount: 2 }) }),
    );
    const card = await screen.findByTestId('get-started');
    expect(card.textContent).toContain('Add your first project');
    expect(card.textContent).toContain('2 folders with Claude Code activity were found');
    expect(
      within(card).getByRole('link', { name: 'Add a project folder' }).getAttribute('href'),
    ).toBe('#/setup');
    // The register form and diagnostics moved to Setup and Data health.
    expect(screen.queryByRole('form')).toBeNull();
    expect(screen.queryByTestId('sessions-by-status')).toBeNull();
  });

  it('lists estimated cost per session, "Not reported" never $0, and no total', async () => {
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
    renderWithApi(<CommandCenter />, fakeServer({ '/api/overview': o }));

    const card = await screen.findByRole('region', { name: 'Estimated cost by session' });
    expect(card.textContent).toContain('Claude Code makes this estimate, not this app');
    expect(card.textContent).toContain('never added together');
    const rows = screen.getByTestId('latest-snapshots').querySelectorAll('li');
    expect(rows.length).toBe(2);

    const first = rows[0] as HTMLElement;
    expect(within(first).getByRole('link').getAttribute('href')).toBe('#/sessions/s-titled');
    const cost = within(first).getByTestId('cost');
    expect(cost.textContent).toContain('~$1.50');
    expect(cost.getAttribute('data-provenance')).toBe('estimated');
    expect(within(cost).getByRole('button', { name: 'About Estimated cost' })).toBeTruthy();

    const second = rows[1] as HTMLElement;
    expect(within(second).getByRole('link').textContent).toBe('Session abcdef12');
    expect(within(second).getByTestId('cost').textContent).toContain('Not reported');
    expect(second.textContent).not.toMatch(/\$0/);

    // Per session only: one cost per row and no total anywhere.
    expect(screen.getAllByTestId('cost').length).toBe(2);
    expect(document.body.textContent).not.toMatch(/total cost/i);
    expect(document.body.textContent).not.toContain('$1.50 total');
  });

  it('says when no cost was reported yet', async () => {
    renderWithApi(<CommandCenter />, fakeServer({ '/api/overview': overview() }));
    expect((await screen.findByTestId('latest-snapshots-empty')).textContent).toContain(
      'No cost reported yet',
    );
    expect(screen.queryByTestId('cost')).toBeNull();
  });

  it('describes recent activity in plain sentences linked to sessions, raw events in Details', async () => {
    const o = overview({
      activeSessions: [session({ id: 's-1', title: 'Refactor parser' })],
      recentEvents: [
        event({ id: 41, eventType: 'session.attention', sessionId: 's-1', payload: {} }),
        event({
          id: 40,
          eventType: 'tool.called',
          sessionId: 'abcdef12-0000-4000-8000-000000000000',
          payload: { toolName: 'Read' },
        }),
        event({ id: 39, eventType: 'session.observed', sessionId: null, occurredAt: null }),
      ],
    });
    renderWithApi(<CommandCenter />, fakeServer({ '/api/overview': o }));

    const feed = await screen.findByTestId('activity-feed');
    const item = (id: number) => feed.querySelector(`[data-event-id="${id}"]`) as HTMLElement;
    expect(item(41).textContent).toContain('Waiting for you');
    expect(
      within(item(41)).getByRole('link', { name: 'Refactor parser' }).getAttribute('href'),
    ).toBe('#/sessions/s-1');
    expect(item(40).textContent).toContain('Used tool: Read');
    expect(within(item(40)).getByRole('link').textContent).toBe('Session abcdef12');
    expect(item(39).textContent).toContain('Not linked to a session');
    expect(item(39).textContent).toContain('Not reported');

    // The raw event type is only inside the collapsed Technical details.
    const raw = screen.getByTestId('raw-events');
    expect(raw.hasAttribute('open')).toBe(false);
    expect(within(raw).getByText('session.attention')).toBeTruthy();
    expect(feed.textContent).not.toContain('session.attention');
  });

  it('shows at most 10 activity sentences', async () => {
    const recentEvents = Array.from({ length: 14 }, (_, i) =>
      event({ id: i + 1, eventType: 'session.turn_ended', payload: {} }),
    );
    renderWithApi(<CommandCenter />, fakeServer({ '/api/overview': overview({ recentEvents }) }));
    const feed = await screen.findByTestId('activity-feed');
    expect(feed.querySelectorAll('li').length).toBe(10);
  });
});
