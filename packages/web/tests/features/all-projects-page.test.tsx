import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { AllProjectsPage } from '../../src/features/all-projects/AllProjectsPage';
import { apiProject, board, PROJECT_ID, webProject } from '../fixtures/board';
import { overview, page, session } from '../fixtures/dto';
import { fakeServer, jsonResponse, renderWithApi } from '../helpers';

const ACTIVE = '/api/sessions?limit=200&status=active';

describe('All projects (#/projects)', () => {
  it('shows one card per project with its folder, harness and live counts', async () => {
    renderWithApi(
      <AllProjectsPage />,
      fakeServer({
        '/api/projects': [
          { ...webProject, sessionCount: 3 },
          { ...apiProject, sessionCount: 1, lastEventAt: null },
        ],
        [ACTIVE]: page([session({ id: 's-1', projectId: PROJECT_ID })]),
        [`/api/board?projectId=${PROJECT_ID}`]: board(),
        // An older server, or a project without a board: no made-up numbers.
        [`/api/board?projectId=${apiProject.id}`]: jsonResponse(500, {
          error: { code: 'internal', message: 'boom', requestId: 'r' },
        }),
        '/api/overview': overview({ projectCount: 2 }),
      }),
    );
    expect(await screen.findByRole('heading', { level: 1, name: 'All projects' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'New project' }).getAttribute('href')).toBe(
      '#/projects/new',
    );
    const cards = screen.getByRole('list', { name: 'Your projects' });
    const web = cards.querySelector(`[data-project-id="${PROJECT_ID}"]`) as HTMLElement;
    expect(within(web).getByRole('link', { name: 'web-app' }).getAttribute('href')).toBe(
      `#/p/${PROJECT_ID}/board`,
    );
    expect(within(web).getByText('/work/web-app')).toBeTruthy();
    expect((await within(web).findByTestId('card-harness')).getAttribute('data-state')).toBe(
      'ready',
    );
    expect(within(web).getByTestId('card-harness').textContent).toBe('Harness: Ready');
    expect(within(web).getByTestId('card-runs').textContent).toContain('3 running');
    expect(within(web).getByTestId('card-runs').textContent).toContain('3 need you');
    expect(within(web).getByText('3 sessions')).toBeTruthy();
    expect(await within(web).findByText('1 running')).toBeTruthy();

    const api = cards.querySelector(`[data-project-id="${apiProject.id}"]`) as HTMLElement;
    expect(await within(api).findByText('Board not available')).toBeTruthy();
    expect(within(api).queryByTestId('card-harness')).toBeNull();
    expect(within(api).getByText('No activity yet')).toBeTruthy();
    expect(within(api).getByText('0 running')).toBeTruthy();

    // The former Overview follows the cards.
    expect(await screen.findByRole('region', { name: 'Across your projects' })).toBeTruthy();
    expect((await screen.findByTestId('stat-projects')).textContent).toContain('2 folders');
  });

  it('says "Not reported" for running sessions when the count is only partial', async () => {
    renderWithApi(
      <AllProjectsPage />,
      fakeServer({
        '/api/projects': [webProject],
        [ACTIVE]: page([session({ id: 's-1', projectId: PROJECT_ID })], 'more'),
        [`/api/board?projectId=${PROJECT_ID}`]: board(),
        '/api/overview': overview(),
      }),
    );
    const cards = await screen.findByRole('list', { name: 'Your projects' });
    expect(within(cards).getByText('Not reported')).toBeTruthy();
  });

  it('with no projects, shows one get-started card with New project', async () => {
    renderWithApi(<AllProjectsPage />, fakeServer({}));
    const card = await screen.findByTestId('get-started');
    expect(card.textContent).toContain('Add your first project');
    expect(within(card).getByRole('link', { name: 'New project' }).getAttribute('href')).toBe(
      '#/projects/new',
    );
    expect(screen.queryByTestId('across-projects')).toBeNull();
  });
});
