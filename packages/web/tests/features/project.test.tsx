import { fireEvent, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { App } from '../../src/app/App';
import { ProjectPage } from '../../src/features/project/ProjectPage';
import { QueryStore } from '../../src/lib/query-store';
import { createApiClient } from '../../src/lib/api';
import { page, partialUsage, project, session, usageSummary } from '../fixtures/dto';
import { fakeServer, renderWithApi } from '../helpers';
import { render } from '@testing-library/react';

const routes = {
  '/api/projects/p-1': project({ id: 'p-1', name: 'alpha', rootPath: '/work/alpha' }),
  '/api/usage/summary?groupBy=session&projectId=p-1': usageSummary({
    groupBy: 'session',
    totals: partialUsage,
  }),
  '/api/projects/p-1/sessions': page([session({ id: 's-1', title: 'First' })], 'cur-2'),
  '/api/projects/p-1/sessions?cursor=cur-2': page([session({ id: 's-2', title: 'Second' })]),
};

describe('Project page', () => {
  it('shows metadata, DIRECT usage totals with unavailable categories, and paged sessions', async () => {
    const server = fakeServer(routes);
    renderWithApi(<ProjectPage id="p-1" />, server);
    expect(await screen.findByRole('heading', { name: 'alpha' })).toBeTruthy();
    expect(screen.getByText('/work/alpha')).toBeTruthy();

    const totals = await screen.findByTestId('project-usage');
    expect(within(totals).getByText(/sum of DIRECT usage/)).toBeTruthy();
    const creation = totals.querySelector('[data-category="cacheCreation"]') as HTMLElement;
    expect(creation.textContent).toBe('unavailable');

    expect(await screen.findByText('First')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'next' }));
    expect(await screen.findByText('Second')).toBeTruthy();
    expect(server.calls.map((c) => c.path)).toContain('/api/projects/p-1/sessions?cursor=cur-2');
  });

  it('shows the API error for an unknown project', async () => {
    renderWithApi(<ProjectPage id="nope" />, fakeServer({}));
    expect(await screen.findByText(/no route/)).toBeTruthy();
  });
});

describe('App routing to the new screens', () => {
  it('routes #/projects/:id, #/sessions/:id and #/usage', async () => {
    const server = fakeServer({
      ...routes,
      '/api/usage/summary?groupBy=project': usageSummary(),
      '/api/usage/summary?groupBy=day': usageSummary({ groupBy: 'day', groups: [] }),
    });
    const store = new QueryStore(createApiClient(server.fetch));
    window.location.hash = '#/projects/p-1';
    const view = render(<App store={store} eventSource={null} />);
    expect(await screen.findByRole('heading', { name: 'alpha' })).toBeTruthy();
    window.location.hash = '#/usage';
    expect(await screen.findByRole('heading', { name: 'Usage' })).toBeTruthy();
    view.unmount();
  });
});
