import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { projectGraph } from '../../e2e/ticket-fixtures';
import { BoardPage } from '../../src/features/board/BoardPage';
import {
  CSRF,
  PROJECT_ID,
  apiProject,
  board,
  ticketDetail,
  ticketDto,
  webProject,
} from '../fixtures/board';
import { fakeServer, jsonResponse, renderWithApi, type RouteTable } from '../helpers';

/* RL-D (ADR-0021): the board's "Start with options…" opens the shared Start dialog. */

const BOARD = `/api/board?projectId=${PROJECT_ID}`;
const START = '/api/tickets/t-13/start';

function server(routes: RouteTable = {}) {
  return fakeServer({
    '/api/projects': [webProject, apiProject],
    '/api/control/token': { token: CSRF },
    [BOARD]: board(),
    // WG-F: the dialog reads the project's graph, never the version 1 workflow.
    [`/api/projects/${PROJECT_ID}/workflow-graph`]: projectGraph(),
    [`POST ${START}`]: ticketDetail(
      ticketDto({ id: 't-13', key: 'WEB-13', status: 'ACTIVE', stage: 'PLANNING' }),
    ),
    ...routes,
  });
}

async function openStartOptions() {
  await screen.findAllByTestId('ticket-card');
  const card = screen.getAllByTestId('ticket-card').find((c) => c.textContent?.includes('WEB-13'));
  if (!card) throw new Error('no card WEB-13');
  fireEvent.click(within(card).getByRole('button', { name: 'Move WEB-13' }));
  fireEvent.click(await screen.findByRole('menuitem', { name: 'Start with options…' }));
  return screen.findByTestId('start-dialog');
}

afterEach(() => {
  window.localStorage.clear();
});

describe('board: Start with options', () => {
  it('opens the dialog at the project’s settings; Cancel sends nothing', async () => {
    const s = server();
    renderWithApi(<BoardPage projectId={PROJECT_ID} />, s);
    const dialog = await openStartOptions();
    expect(within(dialog).getByRole('heading', { name: 'Start WEB-13' })).toBeTruthy();
    // WG-E (ADR-0023): the mode is a limit; without one, each block keeps its own mode.
    expect((await within(dialog).findByLabelText<HTMLInputElement>(/^No limit/)).checked).toBe(
      true,
    );
    fireEvent.click(within(dialog).getAllByRole('button', { name: 'Cancel' })[0] as HTMLElement);
    await waitFor(() => expect(screen.queryByTestId('start-dialog')).toBeNull());
    expect(s.calls.filter((c) => c.method === 'POST')).toHaveLength(0);
    expect(s.calls.some((c) => c.path === `/api/projects/${PROJECT_ID}/workflow`)).toBe(false);
  });

  it('starts with the overrides and says so on the board', async () => {
    const s = server();
    renderWithApi(<BoardPage projectId={PROJECT_ID} />, s);
    const dialog = await openStartOptions();
    fireEvent.click(await within(dialog).findByLabelText(/^Manual/));
    fireEvent.click(within(dialog).getByRole('radio', { name: '4 rework rounds' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Start' }));
    await waitFor(() => expect(s.calls.filter((c) => c.method === 'POST')).toHaveLength(1));
    expect(s.calls.find((c) => c.method === 'POST')).toMatchObject({
      path: START,
      body: { approvalMode: 'manual', maxReworkRounds: 4 },
    });
    await waitFor(() => expect(screen.queryByTestId('start-dialog')).toBeNull());
    expect((await screen.findByTestId('board-feedback')).textContent).toContain('WEB-13');
  });

  it('a Full auto limit says it changes nothing and starts with it (ADR-0023)', async () => {
    const s = server();
    renderWithApi(<BoardPage projectId={PROJECT_ID} />, s);
    const dialog = await openStartOptions();
    expect(within(dialog).queryByTestId('mode-no-effect')).toBeNull();
    fireEvent.click(await within(dialog).findByLabelText(/^Full auto/));
    // Every block runs at the project's Auto edits, and a limit can only tighten a block.
    expect(within(dialog).getByTestId('mode-no-effect')).toBeTruthy();
    expect(within(dialog).queryByTestId('full-auto-warning')).toBeNull();
    expect(within(dialog).queryByTestId('approvals-warning')).toBeNull();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Start' }));
    await waitFor(() => expect(s.calls.filter((c) => c.method === 'POST')).toHaveLength(1));
    expect(s.calls.find((c) => c.method === 'POST')).toMatchObject({
      path: START,
      body: { approvalMode: 'full-auto' },
    });
  });

  it('a refused start keeps the dialog open with the server’s reason', async () => {
    const s = server({
      [`POST ${START}`]: jsonResponse(409, {
        error: { code: 'conflict', message: 'The project has no harness.', requestId: 'r' },
      }),
    });
    renderWithApi(<BoardPage projectId={PROJECT_ID} />, s);
    const dialog = await openStartOptions();
    await within(dialog).findByLabelText(/^Manual/);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Start' }));
    await waitFor(() =>
      expect(
        within(dialog)
          .getAllByRole('alert')
          .some((a) => a.textContent?.includes('The project has no harness.')),
      ).toBe(true),
    );
  });
});
