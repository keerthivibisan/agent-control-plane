import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeAll, describe, expect, it } from 'vitest';
import { App } from '../../src/app/App';
import { ProjectPage } from '../../src/features/project/ProjectPage';
import { runningByProject } from '../../src/features/all-projects/project-bits';
import { createApiClient } from '../../src/lib/api';
import { QueryStore } from '../../src/lib/query-store';
import { page, partialUsage, project, session, usage, usageSummary } from '../fixtures/dto';
import { fakeServer, renderWithApi } from '../helpers';

beforeAll(() => {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

const routes = {
  '/api/projects/p-1': project({ id: 'p-1', name: 'alpha', rootPath: '/work/alpha' }),
  '/api/usage/summary?groupBy=session&projectId=p-1': usageSummary({
    groupBy: 'session',
    totals: partialUsage,
  }),
  '/api/projects/p-1/sessions': page(
    [
      session({ id: 's-1', title: 'First', childCount: 2 }),
      session({
        id: 's-h',
        title: null,
        agentType: 'Explore',
        providerAgentId: 'agent-1',
        directUsage: usage({
          tokens: { input: 5, output: null, cacheCreation: 7, cacheRead: 1500 },
        }),
      }),
    ],
    'cur-2',
  ),
  '/api/projects/p-1/sessions?cursor=cur-2': page([session({ id: 's-2', title: 'Second' })]),
};

describe('Project page', () => {
  it('shows the name, folder and the four token types of its sessions, never a total', async () => {
    renderWithApi(<ProjectPage id="p-1" />, fakeServer(routes));
    expect(await screen.findByRole('heading', { level: 1, name: 'alpha' })).toBeTruthy();
    expect(screen.getByText('/work/alpha')).toBeTruthy();
    expect(screen.getByRole('link', { name: '← All projects' }).getAttribute('href')).toBe(
      '#/projects',
    );

    const totals = await screen.findByTestId('project-usage');
    expect(totals.querySelector('[data-category="cacheCreation"]')?.textContent).toBe(
      'Not reported',
    );
    expect(totals.querySelector('[data-category="output"]')?.textContent).toBe('200');
    expect(within(totals).queryByText(/total/i)).toBeNull();
    expect(screen.getByRole('link', { name: 'Open in Tokens' }).getAttribute('href')).toBe(
      '#/usage?groupBy=session&projectId=p-1',
    );
    expect(screen.getByRole('link', { name: 'See tokens by day' }).getAttribute('href')).toBe(
      '#/usage?groupBy=day&projectId=p-1',
    );
  });

  it('lists its sessions with status, helper agents and tokens with units, and pages', async () => {
    const server = fakeServer(routes);
    renderWithApi(<ProjectPage id="p-1" />, server);
    const table = await screen.findByRole('table', { name: 'Sessions in this project' });
    const first = table.querySelector('tr[data-session-id="s-1"]') as HTMLElement;
    expect(within(first).getByRole('link', { name: 'First' }).getAttribute('href')).toBe(
      '#/sessions/s-1',
    );
    expect(within(first).getByText('Running')).toBeTruthy();
    expect(within(first).getByText('2 helper agents')).toBeTruthy();
    expect(first.textContent).toContain('1.2K input tokens');
    expect(first.textContent).toContain('98K cache read tokens');

    const helper = table.querySelector('tr[data-session-id="s-h"]') as HTMLElement;
    expect(within(helper).getByText('Explore')).toBeTruthy();
    expect(within(helper).getByText('Helper agent')).toBeTruthy();
    expect(within(helper).getByText('None')).toBeTruthy();
    expect(within(helper).getByText('Not reported')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(await screen.findByText('Second')).toBeTruthy();
    expect(server.calls.map((c) => c.path)).toContain('/api/projects/p-1/sessions?cursor=cur-2');
    expect(screen.getByText('Page 2')).toBeTruthy();
  });

  it('shows the API error for an unknown project', async () => {
    renderWithApi(<ProjectPage id="nope" />, fakeServer({}));
    expect(await screen.findByText(/no route/)).toBeTruthy();
  });
});

describe('Projects list', () => {
  it('counts running sessions per project only when the whole list fits one page', () => {
    const items = [
      session({ id: 'a', projectId: 'p-1' }),
      session({ id: 'b', projectId: 'p-1' }),
      session({ id: 'c', projectId: null }),
    ];
    expect(runningByProject(page(items))?.get('p-1')).toBe(2);
    expect(runningByProject(page(items, 'more'))).toBeNull();
    expect(runningByProject(undefined)).toBeNull();
  });

  it('shows running counts and the folder path', async () => {
    window.location.hash = '#/projects';
    const server = fakeServer({
      '/api/projects': [
        project({ id: 'p-1', name: 'alpha', sessionCount: 3 }),
        project({ id: 'p-2', name: 'beta', sessionCount: 1, lastEventAt: null }),
      ],
      '/api/sessions?limit=200&status=active': page([session({ id: 's-1', projectId: 'p-1' })]),
    });
    render(<App store={new QueryStore(createApiClient(server.fetch))} eventSource={null} />);
    const table = await screen.findByRole('table', { name: 'Projects' });
    const alpha = table.querySelector('tr[data-project-id="p-1"]') as HTMLElement;
    expect(within(alpha).getByText('3 sessions')).toBeTruthy();
    expect(await within(alpha).findByText('1 running')).toBeTruthy();
    const beta = table.querySelector('tr[data-project-id="p-2"]') as HTMLElement;
    expect(within(beta).getByText('None')).toBeTruthy();
    expect(within(beta).getByText('No activity yet')).toBeTruthy();
    expect(within(beta).getByText('/work/p-2')).toBeTruthy();
  });
});

describe('App routing to the new screens', () => {
  it('routes #/projects/:id and #/usage', async () => {
    const server = fakeServer({
      ...routes,
      '/api/usage/summary?groupBy=project': usageSummary(),
      '/api/usage/summary?groupBy=day': usageSummary({ groupBy: 'day', groups: [] }),
    });
    const store = new QueryStore(createApiClient(server.fetch));
    window.location.hash = '#/projects/p-1';
    const view = render(<App store={store} eventSource={null} />);
    expect(await screen.findByRole('heading', { level: 1, name: 'alpha' })).toBeTruthy();
    window.location.hash = '#/usage';
    expect(await screen.findByRole('heading', { level: 1, name: 'Tokens' })).toBeTruthy();
    view.unmount();
  });
});
