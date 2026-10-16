import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { NewProjectWizard } from '../../src/features/project-setup/NewProjectWizard';
import { ProjectSettings } from '../../src/features/project-setup/ProjectSettings';
import { ProjectPage } from '../../src/features/project/ProjectPage';
import type { FetchLike } from '../../src/lib/api';
import { CSRF } from '../fixtures/control';
import { project } from '../fixtures/dto';
import {
  PROJECT_ID,
  candidates,
  checkRuns,
  harness,
  harnessTicket,
  setup,
} from '../fixtures/project-setup';
import { fakeServer, jsonResponse, renderWithApi, type RouteTable } from '../helpers';

const P = `/api/projects/${PROJECT_ID}`;

/** A fake server for one project's setup routes that also records each mutation's CSRF header. */
function server(routes: RouteTable = {}, initialSetup = setup()) {
  // Like the real server, a saved setup is what the next GET returns.
  let current = initialSetup;
  const base = fakeServer({
    '/api/control/token': { token: CSRF },
    [P]: project({ id: PROJECT_ID, name: 'web-app', rootPath: '/work/web-app' }),
    [`${P}/setup`]: () => jsonResponse(200, current),
    [`${P}/harness`]: harness('none'),
    [`${P}/context-candidates`]: candidates(),
    [`PUT ${P}/setup`]: (body: unknown) => {
      current = setup({ ...(body as object), updatedAt: '2026-10-13T10:00:00.000Z' });
      return jsonResponse(200, current);
    },
    [`POST ${P}/harness/ticket`]: jsonResponse(201, harnessTicket()),
    [`POST ${P}/harness/checks`]: checkRuns(),
    ...routes,
  });
  const csrf: (string | null)[] = [];
  const fetch: FetchLike = (input, init) => {
    if (init?.method === 'POST' || init?.method === 'PUT') {
      csrf.push(((init.headers ?? {}) as Record<string, string>)['X-ACP-CSRF'] ?? null);
    }
    return base.fetch(input, init);
  };
  return { fetch, calls: base.calls, csrf };
}

const next = () => fireEvent.click(screen.getByRole('button', { name: 'Next' }));
const step = (key: string) => screen.findByTestId(`wizard-step-${key}`);

afterEach(() => {
  window.location.hash = '';
});

describe('New project wizard (#/projects/new)', () => {
  it('adds an existing folder, then walks through the four setup steps and saves them', async () => {
    const s = server({
      'POST /api/projects': (body: unknown) =>
        jsonResponse(201, project({ id: PROJECT_ID, ...(body as object) })),
    });
    renderWithApi(<NewProjectWizard />, s);

    // Step 1: progress dots, the two sources, the Setup page's fields.
    const nav = screen.getByRole('navigation', { name: 'Setup steps' });
    expect(within(nav).getAllByRole('listitem')).toHaveLength(5);
    expect(within(nav).getByText('Project').closest('li')?.getAttribute('aria-current')).toBe(
      'step',
    );
    expect(screen.getByLabelText(/Add an existing folder/)).toBeTruthy();
    expect(screen.getByLabelText(/Create a new repository/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'web-app' } });
    fireEvent.change(screen.getByLabelText('Folder path'), { target: { value: '/work/web-app' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add project' }));

    // Step 2: the server's defaults; plan first is fixed on.
    const agents = await step('agents');
    expect(within(agents).getByText('Step 2 of 5')).toBeTruthy();
    expect(await within(agents).findByText('On')).toBeTruthy();
    expect(within(agents).getByLabelText<HTMLInputElement>('Ticket prefix').value).toBe('WEB');
    expect(within(agents).getByLabelText<HTMLInputElement>('3 helpers').checked).toBe(true);
    fireEvent.click(within(agents).getByLabelText('4 helpers'));
    fireEvent.click(within(agents).getByLabelText(/Helpers may start their own helpers/));
    fireEvent.change(within(agents).getByLabelText('Budget per agent'), {
      target: { value: '250,000' },
    });
    expect(within(agents).getByText(/250,000 budget tokens/)).toBeTruthy();
    next();

    // Step 3: the allowlist; no harness yet, so the checks toggle says when it applies.
    const allow = await step('allowlist');
    expect(
      within(allow).getByText('This takes effect once the project has a harness.'),
    ).toBeTruthy();
    fireEvent.click(
      within(allow).getByLabelText('Let helpers edit files in their own copy without asking'),
    );
    next();

    // Step 4: suggested files are pre-selected, with the limits counted.
    const ctx = await step('context');
    await waitFor(() =>
      expect(within(ctx).getByLabelText<HTMLInputElement>('CLAUDE.md').checked).toBe(true),
    );
    expect(within(ctx).getByLabelText<HTMLInputElement>('AGENTS.md').checked).toBe(true);
    expect(within(ctx).getByLabelText<HTMLInputElement>('README.md').checked).toBe(false);
    expect(within(ctx).getByTestId('context-usage').textContent).toContain('2 of 10 files chosen');
    expect(within(ctx).getByTestId('context-usage').textContent).toContain('21 KB of 32 KB');
    next();

    // Step 5: saved with CSRF; the harness is explained and the ticket can be created.
    const h = await step('harness');
    const put = s.calls.find((c) => c.method === 'PUT');
    expect(put?.path).toBe(`${P}/setup`);
    expect(put?.body).toEqual({
      projectKey: 'WEB',
      maxConcurrentHelpers: 4,
      maxDepth: 2,
      defaultBudgetTokensPerAgent: 250_000,
      model: null,
      allowlist: { editInOwnWorktree: true, runHarnessChecks: true },
      contextFiles: ['CLAUDE.md', 'AGENTS.md'],
    });
    expect(within(h).getByText('None')).toBeTruthy();
    expect(within(h).getByText(/has no harness yet/)).toBeTruthy();
    fireEvent.click(within(h).getByRole('button', { name: 'Create a ‘Build the harness’ ticket' }));
    const created = await within(h).findByText('Added WEB-1 “Build the harness” to the board.');
    const notice = created.closest('[role="status"]') as HTMLElement;
    expect(within(notice).getByRole('link', { name: 'Open ticket' }).getAttribute('href')).toBe(
      '#/tickets/t-harness',
    );
    // Every mutation sends the CSRF token, including adding an existing folder (P4-H finding).
    expect(s.csrf).toEqual([CSRF, CSRF, CSRF]);

    // Back keeps the project (no second POST); Finish opens the board.
    fireEvent.click(screen.getByRole('button', { name: 'Finish and open the board' }));
    expect(window.location.hash).toBe(`#/board/${PROJECT_ID}`);
    expect(s.calls.filter((c) => c.path === '/api/projects' && c.method === 'POST')).toHaveLength(
      1,
    );
  });

  it('creates a new repository, with sentence validation before calling the server', async () => {
    const s = server({
      'POST /api/projects/new': (body: unknown) =>
        jsonResponse(201, project({ id: PROJECT_ID, name: (body as { name: string }).name })),
    });
    renderWithApi(<NewProjectWizard />, s);
    fireEvent.click(screen.getByLabelText(/Create a new repository/));
    fireEvent.click(screen.getByRole('button', { name: 'Create repository' }));
    expect(await screen.findByText('Enter the folder to create the repository in.')).toBeTruthy();
    expect(screen.getByText('Give the repository a name.')).toBeTruthy();
    expect(s.calls.some((c) => c.method === 'POST')).toBe(false);

    fireEvent.change(screen.getByLabelText('Create it inside'), { target: { value: '/code' } });
    fireEvent.change(screen.getByLabelText('Repository name'), { target: { value: 'new-app' } });
    expect(screen.getByText('/code/new-app')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Create repository' }));
    await step('agents');
    expect(s.calls.find((c) => c.path === '/api/projects/new')?.body).toEqual({
      parentDir: '/code',
      name: 'new-app',
    });
    expect(s.csrf).toEqual([CSRF]);

    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(await screen.findByText('new-app is added.')).toBeTruthy();
    expect(screen.getByText(/A new git repository with a first commit on main/)).toBeTruthy();
  });

  it('explains a refused repository in a sentence, the raw error under Details', async () => {
    const s = server({
      'POST /api/projects/new': jsonResponse(409, {
        error: { code: 'conflict', message: 'target exists', requestId: 'r-1' },
      }),
    });
    renderWithApi(<NewProjectWizard />, s);
    fireEvent.click(screen.getByLabelText(/Create a new repository/));
    fireEvent.change(screen.getByLabelText('Create it inside'), { target: { value: '/code' } });
    fireEvent.change(screen.getByLabelText('Repository name'), { target: { value: 'taken' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create repository' }));
    expect(
      await screen.findByText('A folder with that name already exists there. Pick another name.'),
    ).toBeTruthy();
    expect(screen.getByText('Technical details')).toBeTruthy();
    expect(screen.getByTestId('wizard-step-source')).toBeTruthy();
  });

  it('keeps you on a step until its fields make sense', async () => {
    const s = server({
      'POST /api/projects': jsonResponse(201, project({ id: PROJECT_ID })),
      [`${P}/setup`]: setup({ contextFiles: ['AGENTS.md', 'docs/architecture.md'] }),
    });
    renderWithApi(<NewProjectWizard />, s);
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'x' } });
    fireEvent.change(screen.getByLabelText('Folder path'), { target: { value: '/x' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add project' }));
    const agents = await step('agents');
    fireEvent.change(await within(agents).findByLabelText('Ticket prefix'), {
      target: { value: 'w' },
    });
    fireEvent.change(within(agents).getByLabelText('Budget per agent'), {
      target: { value: 'lots' },
    });
    next();
    expect(
      await within(agents).findByText(
        'Use 2 to 6 capital letters for the ticket prefix, for example WEB.',
      ),
    ).toBeTruthy();
    expect(
      within(agents).getByText(
        'Enter the budget as a whole number above zero, for example 500,000.',
      ),
    ).toBeTruthy();
    fireEvent.change(within(agents).getByLabelText('Ticket prefix'), { target: { value: 'web' } });
    fireEvent.change(within(agents).getByLabelText('Budget per agent'), {
      target: { value: '500000' },
    });
    next();
    next();
    // The saved files are too large together: the sentence shows and nothing is saved.
    const ctx = await step('context');
    await within(ctx).findByLabelText('AGENTS.md');
    next();
    expect(
      await within(ctx).findByText(
        'The chosen files are larger than 32 KB together. Leave some out.',
      ),
    ).toBeTruthy();
    expect(s.calls.some((c) => c.method === 'PUT')).toBe(false);
  });
});

describe('Project settings (#/projects/:id/settings)', () => {
  it('shows the AI work environment, the harness and the danger zone', async () => {
    const s = server({
      [`${P}/setup`]: setup({ contextFiles: ['CLAUDE.md'], model: 'some-model' }),
      [`${P}/harness`]: harness('ready'),
    });
    renderWithApi(<ProjectSettings id={PROJECT_ID} />, s);
    expect(await screen.findByRole('heading', { level: 1, name: 'web-app settings' })).toBeTruthy();
    const env = await screen.findByTestId('settings-environment');
    expect(within(env).getByLabelText<HTMLInputElement>('Model').value).toBe('some-model');
    expect(within(env).getByRole('button', { name: 'Save changes' })).toHaveProperty(
      'disabled',
      true,
    );

    const h = screen.getByTestId('settings-harness');
    expect(within(h).getByText('Ready')).toBeTruthy();
    expect(within(h).getByText('Unit tests')).toBeTruthy();
    expect(within(h).getByText('Required')).toBeTruthy();
    expect(within(h).getByText('Optional')).toBeTruthy();
    // Each check shows its exact command, folder and time limit (coordinator decision, 2026-10-16).
    expect(within(h).getByText('pnpm test')).toBeTruthy();
    expect(within(h).getByText('time limit 600 s')).toBeTruthy();
    expect(within(h).getByText('pnpm lint')).toBeTruthy();
    expect(within(h).getByText('in packages/app · time limit 120 s')).toBeTruthy();
    expect(within(h).getByText('CLAUDE.md')).toBeTruthy();

    expect(
      within(screen.getByTestId('settings-danger')).getByText(/never delete the folder/),
    ).toBeTruthy();
  });

  it('runs the checks on main and shows each result with its output', async () => {
    const s = server({ [`${P}/harness`]: harness('partial') });
    renderWithApi(<ProjectSettings id={PROJECT_ID} />, s);
    const h = await screen.findByTestId('settings-harness');
    expect(await within(h).findByText('Partial')).toBeTruthy();
    expect(
      within(h).getByText('No check is required, so nothing has to pass before a merge.'),
    ).toBeTruthy();
    fireEvent.click(within(h).getByRole('button', { name: 'Run checks now' }));
    const results = await within(h).findByRole('list', { name: 'Latest results' });
    expect(within(results).getByText('Passed')).toBeTruthy();
    expect(within(results).getByText('Failed')).toBeTruthy();
    expect(within(results).getByText(/took 4s/)).toBeTruthy();
    expect(within(results).getByText(/x is never used/)).toBeTruthy();
    expect(within(results).getByText('Exit code 1')).toBeTruthy();
    expect(s.csrf).toEqual([CSRF]);
  });

  it('cannot run checks without a valid harness, and says why', async () => {
    renderWithApi(
      <ProjectSettings id={PROJECT_ID} />,
      server({ [`${P}/harness`]: harness('invalid') }),
    );
    const h = await screen.findByTestId('settings-harness');
    expect(await within(h).findByText("Check 'test' needs a timeout.")).toBeTruthy();
    expect(within(h).getByRole('button', { name: 'Run checks now' })).toHaveProperty(
      'disabled',
      true,
    );
    expect(
      within(h).getByText('Checks can run once the project has a valid harness.'),
    ).toBeTruthy();
  });

  it('saves edits with PUT and clears the unsaved note', async () => {
    const s = server();
    renderWithApi(<ProjectSettings id={PROJECT_ID} />, s);
    const env = await screen.findByTestId('settings-environment');
    fireEvent.click(await within(env).findByLabelText('README.md'));
    expect(within(env).getByText('You have unsaved changes.')).toBeTruthy();
    fireEvent.click(within(env).getByRole('button', { name: 'Save changes' }));
    expect(await within(env).findByText('Saved.')).toBeTruthy();
    expect(s.calls.find((c) => c.method === 'PUT')?.body).toMatchObject({
      contextFiles: ['README.md'],
    });
    expect(s.csrf).toEqual([CSRF]);
  });

  it('shows a save refusal in plain words', async () => {
    const s = server({
      [`PUT ${P}/setup`]: jsonResponse(400, {
        error: { code: 'invalid_request', message: 'limit above the ceiling', requestId: 'r-2' },
      }),
    });
    renderWithApi(<ProjectSettings id={PROJECT_ID} />, s);
    const env = await screen.findByTestId('settings-environment');
    fireEvent.click(await within(env).findByLabelText('6 helpers'));
    fireEvent.click(within(env).getByRole('button', { name: 'Save changes' }));
    expect(
      await within(env).findByText(/Your changes couldn't be saved\. limit above the ceiling/),
    ).toBeTruthy();
  });

  it('is linked from the project page', async () => {
    renderWithApi(
      <ProjectPage id={PROJECT_ID} />,
      server({
        [`/api/projects/${PROJECT_ID}/sessions`]: { items: [], page: { nextCursor: null } },
      }),
    );
    expect((await screen.findByRole('link', { name: 'Settings' })).getAttribute('href')).toBe(
      `#/projects/${PROJECT_ID}/settings`,
    );
  });
});
