import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { App } from '../../src/app/App';
import { PROJECT_PAGES } from '../../src/app/project-pages';
import { buildCommands, filterCommands, type Command } from '../../src/features/palette/commands';
import { createApiClient } from '../../src/lib/api';
import { QueryStore } from '../../src/lib/query-store';
import { apiProject, board, CSRF, PROJECT_ID, ticketDto, webProject } from '../fixtures/board';
import { fakeServer, jsonResponse } from '../helpers';

const BOARD = `/api/board?projectId=${PROJECT_ID}`;

const input = {
  projects: [webProject, apiProject],
  current: { id: PROJECT_ID, name: 'web-app' },
  pages: PROJECT_PAGES,
  tickets: Array.from({ length: 8 }, (_, i) => ({
    id: `t-${i + 1}`,
    projectId: PROJECT_ID,
    key: `WEB-${i + 1}`,
    title: `Ticket number ${i + 1}`,
  })),
};

const ids = (cs: readonly Command[]) => cs.map((c) => c.id);

describe('palette commands', () => {
  it('offers the actions, available pages of the current project, projects and tickets', () => {
    const all = buildCommands(input);
    expect(ids(all.filter((c) => c.group === 'actions'))).toEqual([
      'action:new-ticket',
      'action:run-checks',
      'action:new-project',
    ]);
    const pages = all.filter((c) => c.group === 'pages');
    expect(ids(pages)).toEqual([
      'page:board',
      'page:workflow',
      'page:harness',
      'page:tokens',
      'page:sessions',
      'page:settings',
      'page:all-projects',
      'page:health',
      'page:connection',
    ]);
    // Unavailable pages (Skills) are never offered.
    expect(all.some((c) => c.id === 'page:skills')).toBe(false);
    expect(pages[0]?.action).toEqual({ kind: 'go', hash: `#/p/${PROJECT_ID}/board` });
    expect(all.find((c) => c.id === 'ticket:t-3')?.action).toEqual({
      kind: 'go',
      hash: `#/p/${PROJECT_ID}/tickets/t-3`,
    });
  });

  it('has no project pages and no New ticket without a current project', () => {
    const all = buildCommands({ ...input, current: null, tickets: [] });
    expect(all.some((c) => c.id === 'action:new-ticket')).toBe(false);
    expect(all.some((c) => c.id === 'page:board')).toBe(false);
    expect(all.some((c) => c.id === 'action:new-project')).toBe(true);
  });

  it('lists only the newest tickets until you type, then finds one by key', () => {
    const all = buildCommands(input);
    expect(filterCommands(all, '').filter((c) => c.group === 'tickets')).toHaveLength(6);
    expect(ids(filterCommands(all, 'web-8'))).toEqual(['ticket:t-8']);
    // Exact key first, then keys that start with it.
    const many = buildCommands({
      ...input,
      tickets: [
        { id: 'a', projectId: PROJECT_ID, key: 'WEB-12', title: 'x' },
        { id: 'b', projectId: PROJECT_ID, key: 'WEB-1', title: 'y' },
      ],
    });
    expect(ids(filterCommands(many, 'web-1'))).toEqual(['ticket:b', 'ticket:a']);
  });

  it('matches every word against label, hint and keywords', () => {
    const all = buildCommands(input);
    expect(ids(filterCommands(all, 'number 4'))).toEqual(['ticket:t-4']);
    expect(ids(filterCommands(all, 'hooks'))).toEqual(['page:connection']);
    expect(ids(filterCommands(all, '/work/api'))).toEqual([`project:${apiProject.id}`]);
    expect(filterCommands(all, 'zzz')).toEqual([]);
  });
});

function renderApp(routes: Record<string, unknown> = {}) {
  const s = fakeServer({
    '/api/projects': [webProject, apiProject],
    '/api/control/token': { token: CSRF },
    [BOARD]: board(),
    ...routes,
  });
  window.location.hash = `#/p/${PROJECT_ID}/board`;
  const view = render(<App store={new QueryStore(createApiClient(s.fetch))} eventSource={null} />);
  return { s, view };
}

const open = () => fireEvent.keyDown(window, { key: 'k', metaKey: true });
const combobox = () =>
  within(screen.getByRole('dialog')).getByRole('combobox', {
    name: 'Search projects, pages and tickets',
  });

afterEach(() => window.localStorage.clear());

describe('command palette', () => {
  it('opens with ⌘K or Ctrl+K as a labelled dialog with focus in the search field', async () => {
    renderApp();
    await screen.findByTestId('board-stats');
    open();
    const dialog = screen.getByRole('dialog', { name: 'Command palette' });
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(document.activeElement).toBe(combobox());
    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.keyDown(window, { key: 'K', ctrlKey: true });
    expect(screen.getByRole('dialog', { name: 'Command palette' })).toBeTruthy();
  });

  it('moves with the arrows, keeps Tab inside, opens a ticket by key with Enter', async () => {
    renderApp();
    await screen.findByTestId('board-stats');
    fireEvent.click(screen.getByTestId('open-palette'));
    const box = combobox();
    const options = () => within(screen.getByRole('listbox')).getAllByRole('option');
    expect(options()[0]?.getAttribute('aria-selected')).toBe('true');
    fireEvent.keyDown(box, { key: 'ArrowDown' });
    expect(options()[1]?.getAttribute('aria-selected')).toBe('true');
    expect(box.getAttribute('aria-activedescendant')).toBe(options()[1]?.id);
    fireEvent.keyDown(box, { key: 'ArrowUp' });
    fireEvent.keyDown(box, { key: 'ArrowUp' });
    expect(options().at(-1)?.getAttribute('aria-selected')).toBe('true');
    fireEvent.keyDown(box, { key: 'Tab' });
    expect(document.activeElement).toBe(box);

    fireEvent.change(box, { target: { value: 'web-9' } });
    await waitFor(() => expect(options()).toHaveLength(1));
    expect(options()[0]?.textContent).toContain('Rate limit the public API');
    fireEvent.keyDown(box, { key: 'Enter' });
    expect(window.location.hash).toBe(`#/p/${PROJECT_ID}/tickets/t-9`);
    expect(screen.queryByRole('dialog', { name: 'Command palette' })).toBeNull();
  });

  it('says when nothing matches', async () => {
    renderApp();
    await screen.findByTestId('board-stats');
    open();
    fireEvent.change(combobox(), { target: { value: 'no such thing' } });
    expect(within(screen.getByRole('dialog')).getByRole('status').textContent).toBe(
      'Nothing matches.',
    );
  });

  it('jumps to a project page and returns focus to the opener', async () => {
    renderApp();
    const opener = await screen.findByTestId('open-palette');
    opener.focus();
    fireEvent.click(opener);
    fireEvent.change(combobox(), { target: { value: 'tokens' } });
    fireEvent.keyDown(combobox(), { key: 'Enter' });
    expect(window.location.hash).toBe(`#/p/${PROJECT_ID}/tokens`);
    expect(document.activeElement).toBe(opener);
  });

  it('New ticket opens the ticket dialog for the current project, then the new ticket', async () => {
    const created = ticketDto({ id: 't-new', key: 'WEB-20', title: 'From the palette' });
    const { s } = renderApp({
      [`POST /api/projects/${PROJECT_ID}/tickets`]: () => jsonResponse(201, created),
    });
    await screen.findByTestId('board-stats');
    open();
    fireEvent.change(combobox(), { target: { value: 'new ticket' } });
    fireEvent.keyDown(combobox(), { key: 'Enter' });
    const dialog = await screen.findByRole('dialog', { name: 'New ticket' });
    fireEvent.change(within(dialog).getByLabelText('Title'), {
      target: { value: 'From the palette' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create ticket' }));
    await waitFor(() => expect(window.location.hash).toBe(`#/p/${PROJECT_ID}/tickets/t-new`));
    expect(
      s.calls.some((c) => c.method === 'POST' && c.path === `/api/projects/${PROJECT_ID}/tickets`),
    ).toBe(true);
  });
});
