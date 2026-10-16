import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { App } from '../../src/app/App';
import { HarnessPage } from '../../src/features/harness/HarnessPage';
import { createApiClient } from '../../src/lib/api';
import { QueryStore } from '../../src/lib/query-store';
import { board, card, CSRF, webProject } from '../fixtures/board';
import { checkRuns, harness, harnessTicket, PROJECT_ID } from '../fixtures/project-setup';
import { fakeServer, jsonResponse, renderWithApi, type RouteTable } from '../helpers';

/*
 * Redesign R-E: the Harness page against fixture DTOs (tests/fixtures/project-setup.ts), with the
 * routes P4-D serves: GET /projects/:id/harness, GET /projects/:id/tickets, and the two POSTs.
 */

const BASE = `/api/projects/${PROJECT_ID}`;
const HARNESS = `${BASE}/harness`;
const TICKETS = `${BASE}/tickets`;
const CHECKS = `POST ${BASE}/harness/checks`;
const TICKET = `POST ${BASE}/harness/ticket`;
const now = () => new Date('2026-10-13T09:05:00.000Z');

function server(routes: RouteTable) {
  return fakeServer({ '/api/control/token': { token: CSRF }, [TICKETS]: [], ...routes });
}

function renderPage(routes: RouteTable) {
  const s = server(routes);
  const view = renderWithApi(<HarnessPage projectId={PROJECT_ID} now={now} />, s);
  return { s, ...view };
}

const region = (name: string) => screen.getByRole('region', { name });
const tipOf = (el: HTMLElement, label: string) =>
  within(el)
    .getByRole('button', { name: `About ${label}` })
    .getAttribute('data-tip') ?? '';

afterEach(() => window.localStorage.clear());

describe('Harness page', () => {
  it('shows a ready harness: status, each check with command, folder, time limit and required', async () => {
    renderPage({ [HARNESS]: harness('ready') });
    expect(await screen.findByRole('heading', { level: 1, name: /Harness/ })).toBeTruthy();
    const status = await screen.findByTestId('harness-status');
    expect(within(status).getByText('Ready')).toBeTruthy();
    expect(within(status).getByText('2 checks · 1 required')).toBeTruthy();
    expect(status.querySelector('[data-state]')?.getAttribute('data-state')).toBe('ready');

    const table = screen.getByRole('table', { name: 'Harness checks' });
    const test = table.querySelector<HTMLElement>('[data-check="test"]');
    const lint = table.querySelector<HTMLElement>('[data-check="lint"]');
    if (test === null || lint === null) throw new Error('check rows missing');
    expect(within(test).getByText('pnpm test').tagName).toBe('CODE');
    expect(within(test).getByText('Required').getAttribute('title')).toBe(
      'Must pass before a plain merge.',
    );
    expect(within(test).getByText('Project folder')).toBeTruthy();
    expect(within(test).getByText('10 min')).toBeTruthy();
    expect(within(lint).getByText('Optional')).toBeTruthy();
    expect(within(lint).getByText('packages/app')).toBeTruthy();
    expect(within(lint).getByText('2 min')).toBeTruthy();

    // Primary action in the header; no runs yet in this session, and the card says where history starts.
    expect(screen.getByRole('button', { name: 'Run checks now' })).toBeTruthy();
    const runs = region('Runs on the main branch');
    expect(within(runs).getByText('No runs yet')).toBeTruthy();
    expect(tipOf(runs, 'Earlier in this session')).toContain('since you opened the app');
    // No "Build the harness" while a harness exists.
    expect(screen.queryByRole('button', { name: 'Build the harness' })).toBeNull();
  });

  it('runs the checks on main and shows each result, then keeps the earlier run', async () => {
    const { s } = renderPage({
      [HARNESS]: harness('ready'),
      [CHECKS]: () => jsonResponse(200, checkRuns()),
    });
    const run = await screen.findByRole('button', { name: 'Run checks now' });
    fireEvent.click(run);
    const latest = await screen.findByTestId('latest-run');
    await waitFor(() => expect(latest.getAttribute('data-state')).toBe('finished'));
    const post = s.calls.find((c) => c.method === 'POST');
    expect(post?.path).toBe(`${BASE}/harness/checks`);
    expect(post?.body).toEqual({});

    expect(within(latest).getByTestId('run-summary').textContent).toBe('1 of 2 checks passed');
    const results = within(latest).getByRole('list', { name: 'Check results' });
    const test = results.querySelector<HTMLElement>('[data-check="test"]');
    const lint = results.querySelector<HTMLElement>('[data-check="lint"]');
    if (test === null || lint === null) throw new Error('result rows missing');
    expect(within(test).getByText('Passed')).toBeTruthy();
    expect(within(test).getByText(/took 4s · Exit code 0/)).toBeTruthy();
    expect(within(lint).getByText('Failed')).toBeTruthy();
    expect(within(lint).getByText(/Exit code 1/)).toBeTruthy();
    expect(within(lint).getByText(/x is never used/)).toBeTruthy();
    // The harness status is read again afterwards.
    await waitFor(() =>
      expect(s.calls.filter((c) => c.method === 'GET' && c.path === HARNESS).length).toBe(2),
    );

    fireEvent.click(screen.getByRole('button', { name: 'Run checks now' }));
    await waitFor(() =>
      expect(screen.getByRole('region', { name: 'Earlier in this session' })).toBeTruthy(),
    );
    const earlier = screen.getByRole('region', { name: 'Earlier in this session' });
    expect(earlier.textContent).toContain('1 of 2 checks passed');
  });

  it('says so while the checks run, and explains "checks are already running"', async () => {
    let release: () => void = () => {};
    const s = server({
      [HARNESS]: harness('partial'),
      [CHECKS]: () =>
        jsonResponse(409, {
          error: {
            code: 'checks_running',
            message: 'The checks are already running',
            requestId: 'r',
          },
        }),
    });
    const held: typeof s.fetch = (input, init) =>
      init?.method === 'POST'
        ? new Promise<void>((r) => {
            release = r;
          }).then(() => s.fetch(input, init))
        : s.fetch(input, init);
    window.location.hash = `#/p/${PROJECT_ID}/harness`;
    render(<App store={new QueryStore(createApiClient(held))} eventSource={null} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Run checks now' }));
    const latest = await screen.findByTestId('latest-run');
    expect(within(latest).getByRole('status').textContent).toContain('Running checks…');
    expect(
      screen.getByRole<HTMLButtonElement>('button', { name: 'Running checks…' }).disabled,
    ).toBe(true);
    release();
    // The first alert is the sentence; the technical one sits in Details below it.
    const alert = (await within(latest).findAllByRole('alert'))[0];
    if (alert === undefined) throw new Error('no alert');
    expect(alert.textContent).toContain('Checks are already running on the main branch');
    expect(alert.getAttribute('data-code')).toBe('checks_running');
  });

  it('without a harness: "Build the harness" creates the ticket, links to it and shows its stage', async () => {
    const { s } = renderPage({
      [HARNESS]: harness('none'),
      [TICKET]: () => jsonResponse(201, harnessTicket()),
    });
    const status = await screen.findByTestId('harness-status');
    expect(within(status).getByText('No harness yet')).toBeTruthy();
    // Nothing to run and no checks to list yet.
    expect(screen.queryByRole('button', { name: 'Run checks now' })).toBeNull();
    expect(screen.queryByTestId('harness-checks')).toBeNull();
    expect(screen.queryByTestId('harness-runs')).toBeNull();
    // Writing .acp/harness.json in a new folder still asks the owner.
    expect(tipOf(status, 'Build the harness')).toContain('folder that doesn’t exist yet');

    fireEvent.click(within(status).getByRole('button', { name: 'Build the harness' }));
    const ticket = await screen.findByTestId('harness-ticket');
    expect(s.calls.find((c) => c.method === 'POST')?.path).toBe(`${BASE}/harness/ticket`);
    expect(ticket.getAttribute('data-stage')).toBe('BACKLOG');
    expect(within(ticket).getByText('Backlog')).toBeTruthy();
    expect(within(ticket).getByRole('link', { name: 'Open ticket' }).getAttribute('href')).toBe(
      `#/p/${PROJECT_ID}/tickets/t-harness`,
    );
    expect(within(ticket).getByRole('status').textContent).toBe(
      'Added WEB-1 to the board. Start it from there.',
    );
    // Its own review runs no checks (they are read from the project folder, which has none yet),
    // and writing into the new .acp folder asks the owner.
    expect(tipOf(ticket, 'Its review runs no checks')).toContain('never from the agent’s copy');
    expect(tipOf(ticket, 'It asks you before creating .acp/harness.json')).toContain(
      'even when edits are pre-approved',
    );
    expect(screen.queryByRole('button', { name: 'Build the harness' })).toBeNull();
  });

  it('shows an existing harness ticket with its stage instead of offering a new one', async () => {
    renderPage({
      [HARNESS]: harness('none'),
      [TICKETS]: [
        card({
          id: 't-3',
          key: 'WEB-3',
          stage: 'PLANNING',
          type: 'harness',
          title: 'Build the harness',
        }),
      ],
    });
    const ticket = await screen.findByTestId('harness-ticket');
    expect(within(ticket).getByText('Planning')).toBeTruthy();
    expect(within(ticket).getByText('WEB-3')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Build the harness' })).toBeNull();
  });

  it('says "its review runs no checks" only while the project has no runnable checks', async () => {
    renderPage({
      [HARNESS]: harness('ready'),
      [TICKETS]: [card({ id: 't-4', key: 'WEB-4', stage: 'WORKING', type: 'harness' })],
    });
    const ticket = await screen.findByTestId('harness-ticket');
    expect(within(ticket).queryByText('Its review runs no checks')).toBeNull();
    expect(within(ticket).getByText('It asks you before creating .acp/harness.json')).toBeTruthy();
  });

  it('lists the problems of an invalid harness in plain sentences, with nothing to run', async () => {
    renderPage({ [HARNESS]: harness('invalid') });
    const status = await screen.findByTestId('harness-status');
    expect(within(status).getByText('Invalid')).toBeTruthy();
    expect(within(status).getByText('What needs fixing')).toBeTruthy();
    expect(within(status).getByText("Check 'test' needs a timeout.")).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Run checks now' })).toBeNull();
    expect(screen.queryByTestId('harness-checks')).toBeNull();
  });

  it('explains where checks run, the review race and the 10-second status delay', async () => {
    const { s } = renderPage({ [HARNESS]: harness('ready') });
    const usage = await screen.findByTestId('harness-usage');
    expect(usage.querySelectorAll('[data-use]')).toHaveLength(3);
    expect(usage.textContent).toContain('A failed required check blocks a plain merge');
    expect(usage.textContent).toContain('“Merge anyway” needs a reason');
    expect(tipOf(usage, "When a ticket's work enters review")).toContain(
      'answers that checks are already running',
    );
    const status = screen.getByTestId('harness-status');
    expect(tipOf(status, 'Read from the repository')).toContain('about 10 seconds');
    // "Check again" reads the folder once more.
    fireEvent.click(within(status).getByRole('button', { name: 'Check again' }));
    await waitFor(() =>
      expect(s.calls.filter((c) => c.path === HARNESS).length).toBeGreaterThanOrEqual(2),
    );
  });
});

describe('⌘K "Run checks"', () => {
  it('starts the checks on main and opens the Harness page with the result', async () => {
    const s = fakeServer({
      '/api/projects': [webProject],
      '/api/control/token': { token: CSRF },
      [`/api/board?projectId=${PROJECT_ID}`]: board(),
      [HARNESS]: harness('ready'),
      [TICKETS]: [],
      [CHECKS]: () => jsonResponse(200, checkRuns()),
    });
    window.location.hash = `#/p/${PROJECT_ID}/board`;
    render(<App store={new QueryStore(createApiClient(s.fetch))} eventSource={null} />);
    await screen.findByTestId('board-stats');
    fireEvent.keyDown(window, { key: 'k', metaKey: true });
    const box = within(screen.getByRole('dialog')).getByRole('combobox');
    fireEvent.change(box, { target: { value: 'run checks' } });
    const option = within(screen.getByRole('listbox')).getAllByRole('option')[0];
    expect(option?.getAttribute('data-command')).toBe('action:run-checks');
    fireEvent.keyDown(box, { key: 'Enter' });
    expect(window.location.hash).toBe(`#/p/${PROJECT_ID}/harness`);
    const latest = await screen.findByTestId('latest-run');
    await waitFor(() => expect(latest.getAttribute('data-state')).toBe('finished'));
    expect(
      s.calls.filter((c) => c.method === 'POST' && c.path === `${BASE}/harness/checks`),
    ).toHaveLength(1);
    expect(within(latest).getByTestId('run-summary').textContent).toBe('1 of 2 checks passed');
  });
});
