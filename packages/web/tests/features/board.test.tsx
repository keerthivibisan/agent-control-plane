import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { App } from '../../src/app/App';
import { BoardPage } from '../../src/features/board/BoardPage';
import { createApiClient, type FetchLike } from '../../src/lib/api';
import { QueryStore } from '../../src/lib/query-store';
import {
  CSRF,
  OTHER_PROJECT_ID,
  PROJECT_ID,
  apiProject,
  board,
  ticketDetail,
  ticketDto,
  webProject,
} from '../fixtures/board';
import { fakeServer, jsonResponse, renderWithApi, type RouteTable } from '../helpers';

const BOARD = `/api/board?projectId=${PROJECT_ID}`;

function server(routes: RouteTable = {}) {
  const base = fakeServer({
    '/api/projects': [webProject, apiProject],
    '/api/control/token': { token: CSRF },
    [BOARD]: board(),
    ...routes,
  });
  const csrf: (string | null)[] = [];
  const fetch: FetchLike = (input, init) => {
    if (init?.method === 'POST') {
      csrf.push(((init.headers ?? {}) as Record<string, string>)['X-ACP-CSRF'] ?? null);
    }
    return base.fetch(input, init);
  };
  return { fetch, calls: base.calls, csrf };
}
type Server = ReturnType<typeof server>;

const posts = (s: Server) => s.calls.filter((c) => c.method === 'POST');
const renderBoard = (s: Server, projectId: string | null = PROJECT_ID) =>
  renderWithApi(<BoardPage projectId={projectId} />, s);

async function findCard(key: string): Promise<HTMLElement> {
  await screen.findAllByTestId('ticket-card');
  const found = screen.getAllByTestId('ticket-card').find((c) => c.textContent?.includes(key));
  if (!found) throw new Error(`no card ${key}`);
  return found;
}

/** A DataTransfer stand-in: jsdom has none. */
function dataTransfer() {
  const data = new Map<string, string>();
  return {
    data,
    effectAllowed: 'all',
    dropEffect: 'none',
    get types() {
      return [...data.keys()];
    },
    setData: (k: string, v: string) => data.set(k, v),
    getData: (k: string) => data.get(k) ?? '',
  };
}

afterEach(() => {
  window.localStorage.clear();
});

describe('board: layout and honest numbers', () => {
  it('shows every stage as a column in board order, with Cancelled folded away', async () => {
    renderBoard(server());
    await screen.findAllByTestId('ticket-card');
    const columns = screen.getAllByTestId(/^column-/).map((c) => c.dataset.testid);
    expect(columns).toEqual([
      'column-BACKLOG',
      'column-READY',
      'column-PLANNING',
      'column-PLAN_REVIEW',
      'column-WORKING',
      'column-NEEDS_YOU',
      'column-IN_REVIEW',
      'column-DONE',
      'column-CANCELLED',
    ]);
    const cancelled = screen.getByTestId('column-CANCELLED');
    expect(cancelled.dataset.collapsed).toBe('true');
    expect(within(cancelled).queryByTestId('ticket-card')).toBeNull();
    fireEvent.click(within(cancelled).getByRole('button', { name: 'Show cancelled (1)' }));
    expect(within(screen.getByTestId('column-CANCELLED')).getByText('Old idea')).toBeTruthy();
    expect(
      within(screen.getByTestId('column-WORKING')).getByText('Rate limit the public API'),
    ).toBeTruthy();
    // Empty columns explain themselves.
    expect(
      within(screen.getByTestId('column-PLANNING')).getByText(/Drop a ready ticket here/),
    ).toBeTruthy();
  });

  it('shows token types side by side, never one total, and no board-wide cost', async () => {
    renderBoard(server());
    const stats = await screen.findByTestId('board-stats');
    const tokens = within(stats).getByTestId('board-tokens');
    expect(tokens.textContent).toContain('1.2M input tokens');
    expect(tokens.textContent).toContain('84.3K output tokens');
    expect(tokens.textContent).toContain('310K cache write tokens');
    expect(tokens.textContent).toContain('3.1M cache read tokens');
    // 1,204,000 + 84,300 + 310,000 + 3,100,000 = 4,698,300 must never appear.
    expect(stats.textContent).not.toMatch(/4\.7M|4,698,300/);
    expect(stats.textContent).toContain(
      'Estimated cost: shown on each ticket for its latest run; never added up',
    );
    expect(stats.textContent).not.toMatch(/\$/);
    expect(within(stats).getByTestId('harness').textContent).toContain('Ready');
    expect(within(stats).getByTestId('board-counts').textContent).toBe('3 running·3 need you');
  });

  it('cards show key, type, priority, labels, helpers, budget tokens, needs-you and cost', async () => {
    renderBoard(server());
    const working = await findCard('WEB-9');
    expect(
      within(working).getByRole('link', { name: 'Rate limit the public API' }).getAttribute('href'),
    ).toBe('#/tickets/t-9');
    expect(working.textContent).toContain('Urgent');
    expect(within(working).getByTestId('card-run').textContent).toBe(
      '3 helpers·42.2K budget tokens',
    );
    expect(within(working).getByTestId('card-cost').textContent).toBe('~$0.61 estimated');

    const waiting = await findCard('WEB-11');
    expect(within(waiting).getByTestId('needs-you').textContent).toBe('2 need you');
    // Unreported cost reads "not reported", never $0.
    expect(within(waiting).getByTestId('card-cost').textContent).toBe('Cost not reported');
    expect(within(waiting).getByRole('list', { name: 'Labels' }).textContent).toContain('Chore');

    const backlog = await findCard('WEB-14');
    expect(within(backlog).getByText('Bug', { selector: 'li' })).toBeTruthy();
    expect(within(backlog).getByText('auth')).toBeTruthy();
    expect(within(backlog).queryByTestId('card-run')).toBeNull();
    expect(within(backlog).queryByTestId('card-cost')).toBeNull();

    const ready = await findCard('WEB-13');
    expect(ready.textContent).toContain('Last run failed');
  });
});

describe('board: project switcher and empty states', () => {
  it('opens the last used project for #/board and remembers the one shown', async () => {
    window.localStorage.setItem('acp.board.lastProject', OTHER_PROJECT_ID);
    const s = server({
      [`/api/board?projectId=${OTHER_PROJECT_ID}`]: board({ project: apiProject }, []),
    });
    renderBoard(s, null);
    expect(await screen.findByTestId('board-empty')).toBeTruthy();
    expect(s.calls.some((c) => c.path === `/api/board?projectId=${OTHER_PROJECT_ID}`)).toBe(true);
    const select = screen.getByRole<HTMLSelectElement>('combobox', { name: 'Project' });
    expect(select.value).toBe(OTHER_PROJECT_ID);
    fireEvent.change(select, { target: { value: PROJECT_ID } });
    expect(window.location.hash).toBe(`#/board/${PROJECT_ID}`);
  });

  it('asks for a project first when none is added', async () => {
    renderBoard(server({ '/api/projects': [] }), null);
    const empty = await screen.findByTestId('board-no-projects');
    expect(within(empty).getByText('Add a project first')).toBeTruthy();
    expect(within(empty).getByRole('link', { name: 'New project' }).getAttribute('href')).toBe(
      '#/projects/new',
    );
  });

  it('says so when the project does not exist', async () => {
    renderBoard(server(), 'gone');
    expect(await screen.findByText('Project not found')).toBeTruthy();
  });

  it('does not blame the project when the server lacks the board route', async () => {
    const missing = jsonResponse(404, {
      error: { code: 'unknown_route', message: 'No route for GET /board', requestId: 'req-t' },
    });
    renderBoard(server({ [BOARD]: missing }));
    expect(await screen.findByText(/No route for GET \/board/)).toBeTruthy();
    expect(screen.queryByText('Project not found')).toBeNull();
  });

  it('offers a first ticket on an empty board', async () => {
    renderBoard(server({ [BOARD]: board({}, []) }));
    const empty = await screen.findByTestId('board-empty');
    fireEvent.click(within(empty).getByRole('button', { name: 'New ticket' }));
    expect(screen.getByRole('dialog', { name: 'New ticket' })).toBeTruthy();
  });
});

describe('board: keyboard Move menu', () => {
  it('offers only owner-settable moves per card', async () => {
    renderBoard(server());
    const menuItems = async (key: string) => {
      const card = await findCard(key);
      const button = within(card).queryByRole('button', { name: `Move ${key}` });
      if (!button) return null;
      fireEvent.click(button);
      const menu = within(card).getByRole('menu');
      const items = within(menu)
        .getAllByRole('menuitem')
        .map((i) => i.textContent);
      fireEvent.keyDown(menu, { key: 'Escape' });
      return items;
    };
    expect(await menuItems('WEB-14')).toEqual(['Move to Ready', 'Cancel ticket…']);
    expect(await menuItems('WEB-13')).toEqual([
      'Move to Backlog',
      'Start (the lead agent plans it)',
      'Cancel ticket…',
    ]);
    expect(await menuItems('WEB-9')).toEqual(['Cancel ticket…']);
    expect(await menuItems('WEB-3')).toBeNull();
  });

  it('moves with the keyboard: arrow keys, Enter, focus back on the button', async () => {
    const s = server({
      'POST /api/tickets/t-14/move': ticketDto({
        id: 't-14',
        key: 'WEB-14',
        status: 'READY',
        stage: 'READY',
      }),
    });
    renderBoard(s);
    const card = await findCard('WEB-14');
    const button = within(card).getByRole('button', { name: 'Move WEB-14' });
    fireEvent.keyDown(button, { key: 'ArrowDown' });
    const menu = within(card).getByRole('menu');
    const [toReady, cancel] = within(menu).getAllByRole('menuitem');
    expect(document.activeElement).toBe(toReady);
    fireEvent.keyDown(menu, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(cancel);
    fireEvent.keyDown(menu, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(toReady);
    fireEvent.click(toReady as HTMLElement);
    await waitFor(() => expect(posts(s)).toHaveLength(1));
    expect(posts(s)[0]).toMatchObject({
      path: '/api/tickets/t-14/move',
      body: { status: 'READY' },
    });
    expect(s.csrf).toEqual([CSRF]);
    expect(await screen.findByTestId('board-feedback')).toHaveProperty(
      'textContent',
      'Moved WEB-14 to Ready.',
    );
  });

  it('starts a ready ticket (Ready → Planning creates a run)', async () => {
    const s = server({
      'POST /api/tickets/t-13/start': ticketDetail(
        ticketDto({ id: 't-13', key: 'WEB-13', status: 'ACTIVE', stage: 'PLANNING' }),
      ),
    });
    renderBoard(s);
    const card = await findCard('WEB-13');
    fireEvent.click(within(card).getByRole('button', { name: 'Move WEB-13' }));
    fireEvent.click(
      within(card).getByRole('menuitem', { name: 'Start (the lead agent plans it)' }),
    );
    await waitFor(() => expect(posts(s)).toHaveLength(1));
    expect(posts(s)[0]?.path).toBe('/api/tickets/t-13/start');
    expect(s.csrf).toEqual([CSRF]);
  });

  it('asks before cancelling; keeping it sends nothing', async () => {
    const s = server({
      'POST /api/tickets/t-9/move': ticketDto({
        id: 't-9',
        key: 'WEB-9',
        status: 'CANCELLED',
        stage: 'CANCELLED',
      }),
    });
    renderBoard(s);
    const card = await findCard('WEB-9');
    fireEvent.click(within(card).getByRole('button', { name: 'Move WEB-9' }));
    fireEvent.click(within(card).getByRole('menuitem', { name: 'Cancel ticket…' }));
    let dialog = screen.getByRole('dialog', { name: 'Cancel WEB-9?' });
    expect(document.activeElement).toBe(within(dialog).getByRole('button', { name: 'Keep it' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Keep it' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(posts(s)).toHaveLength(0);

    fireEvent.click(within(card).getByRole('button', { name: 'Move WEB-9' }));
    fireEvent.click(within(card).getByRole('menuitem', { name: 'Cancel ticket…' }));
    dialog = screen.getByRole('dialog', { name: 'Cancel WEB-9?' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel ticket' }));
    await waitFor(() => expect(posts(s)).toHaveLength(1));
    expect(posts(s)[0]).toMatchObject({
      path: '/api/tickets/t-9/move',
      body: { status: 'CANCELLED' },
    });
  });

  it('explains a refused move in words', async () => {
    const s = server({
      'POST /api/tickets/t-14/move': () =>
        new Response(
          JSON.stringify({
            error: { code: 'conflict', message: 'The ticket changed meanwhile.', requestId: 'r' },
          }),
          {
            status: 409,
            headers: { 'content-type': 'application/json' },
          },
        ),
    });
    renderBoard(s);
    const card = await findCard('WEB-14');
    fireEvent.click(within(card).getByRole('button', { name: 'Move WEB-14' }));
    fireEvent.click(within(card).getByRole('menuitem', { name: 'Move to Ready' }));
    expect((await screen.findAllByRole('alert'))[0]?.textContent).toBe(
      "WEB-14 didn't move. The ticket changed meanwhile.",
    );
  });
});

describe('board: drag and drop', () => {
  it('drops a backlog card on Ready, and refuses run-driven columns', async () => {
    const s = server({
      'POST /api/tickets/t-14/move': ticketDto({
        id: 't-14',
        key: 'WEB-14',
        status: 'READY',
        stage: 'READY',
      }),
    });
    renderBoard(s);
    const card = await findCard('WEB-14');
    expect(card.getAttribute('draggable')).toBe('true');
    const dt = dataTransfer();
    fireEvent.dragStart(card, { dataTransfer: dt });
    expect(dt.types).toEqual(['application/x-acp-ticket']);

    // A run-driven column doesn't accept the drop: dragover is not cancelled.
    const working = screen.getByTestId('column-WORKING');
    expect(fireEvent.dragOver(working, { dataTransfer: dt })).toBe(true);
    fireEvent.drop(working, { dataTransfer: dt });
    expect(posts(s)).toHaveLength(0);

    const ready = screen.getByTestId('column-READY');
    expect(fireEvent.dragOver(ready, { dataTransfer: dt })).toBe(false);
    fireEvent.drop(ready, { dataTransfer: dt });
    await waitFor(() => expect(posts(s)).toHaveLength(1));
    expect(posts(s)[0]).toMatchObject({
      path: '/api/tickets/t-14/move',
      body: { status: 'READY' },
    });
  });

  it('dropping on Cancelled (even folded) asks first', async () => {
    const s = server();
    renderBoard(s);
    const card = await findCard('WEB-12');
    const dt = dataTransfer();
    fireEvent.dragStart(card, { dataTransfer: dt });
    const cancelled = screen.getByTestId('column-CANCELLED');
    fireEvent.dragOver(cancelled, { dataTransfer: dt });
    fireEvent.drop(cancelled, { dataTransfer: dt });
    expect(screen.getByRole('dialog', { name: 'Cancel WEB-12?' })).toBeTruthy();
    expect(posts(s)).toHaveLength(0);
  });

  it('done and cancelled cards are not draggable', async () => {
    renderBoard(server());
    expect((await findCard('WEB-3')).getAttribute('draggable')).toBe('false');
  });
});

describe('board: New ticket dialog', () => {
  it('validates in sentences, then creates the ticket with the CSRF header', async () => {
    const s = server({
      [`POST /api/projects/${PROJECT_ID}/tickets`]: ticketDto({ id: 't-15', key: 'WEB-15' }),
    });
    renderBoard(s);
    await findCard('WEB-14');
    fireEvent.click(screen.getByRole('button', { name: 'New ticket' }));
    const dialog = screen.getByRole('dialog', { name: 'New ticket' });
    const title = within(dialog).getByLabelText('Title');
    expect(document.activeElement).toBe(title);

    fireEvent.click(within(dialog).getByRole('button', { name: 'Create ticket' }));
    expect(within(dialog).getByRole('alert').textContent).toBe('Give the ticket a title.');
    fireEvent.change(within(dialog).getByLabelText('Labels'), {
      target: { value: 'a,b,c,d,e,f,g,h,i,j,k' },
    });
    fireEvent.change(title, { target: { value: 'Add dark mode' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create ticket' }));
    expect(within(dialog).getByRole('alert').textContent).toBe('Use at most 10 labels.');
    expect(posts(s)).toHaveLength(0);

    fireEvent.change(within(dialog).getByLabelText('Labels'), {
      target: { value: 'ui, settings, ui' },
    });
    fireEvent.change(within(dialog).getByLabelText('Type'), { target: { value: 'bug' } });
    fireEvent.change(within(dialog).getByLabelText('Priority'), { target: { value: 'urgent' } });
    fireEvent.change(within(dialog).getByLabelText('Description'), {
      target: { value: 'Follow the system theme.' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create ticket' }));
    await waitFor(() => expect(posts(s)).toHaveLength(1));
    expect(posts(s)[0]).toMatchObject({
      path: `/api/projects/${PROJECT_ID}/tickets`,
      body: {
        title: 'Add dark mode',
        type: 'bug',
        priority: 'urgent',
        labels: ['ui', 'settings'],
        description: 'Follow the system theme.',
      },
    });
    expect(s.csrf).toEqual([CSRF]);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.getByTestId('board-feedback').textContent).toBe('Created WEB-15 in Backlog.');
  });

  it('closes with Escape and returns focus to the button that opened it', async () => {
    renderBoard(server());
    await findCard('WEB-14');
    const open = screen.getByRole('button', { name: 'New ticket' });
    open.focus();
    fireEvent.click(open);
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(open);
  });
});

describe('board: app shell', () => {
  it('lists Board first in the sidebar and renders #/board', async () => {
    window.location.hash = '#/board';
    const s = server();
    render(<App store={new QueryStore(createApiClient(s.fetch))} eventSource={null} />);
    const nav = screen.getByRole('navigation', { name: 'Main' });
    const links = within(nav).getAllByRole('link');
    // links[0] is the app name; the first page is Board.
    expect(links[1]?.textContent).toBe('Board');
    expect(links[1]?.getAttribute('href')).toBe('#/board');
    expect(links[1]?.getAttribute('aria-current')).toBe('page');
    expect(await screen.findByTestId('board-stats')).toBeTruthy();
  });
});
