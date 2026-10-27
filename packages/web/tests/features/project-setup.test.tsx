import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { WorkflowGraphSchema, validateWorkflowGraph } from '@acp/core';
import { afterEach, describe, expect, it } from 'vitest';
import { NewProjectWizard } from '../../src/features/project-setup/NewProjectWizard';
import { ProjectSettings } from '../../src/features/project-setup/ProjectSettings';
import type { FetchLike } from '../../src/lib/api';
import { CSRF } from '../fixtures/control';
import { project } from '../fixtures/dto';
import { PROJECT_ID, candidates, harness, harnessTicket, setup } from '../fixtures/project-setup';
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

    // Step 3 (ADR-0021): the approval mode. A new project starts in Auto edits, with the plain
    // warning that agent-written code can then run without asking; Manual has no warning.
    const allow = await step('allowlist');
    expect(within(allow).getByText('Step 3 of 5')).toBeTruthy();
    expect(
      within(allow).getByLabelText<HTMLInputElement>(/Auto edits \(recommended\)/).checked,
    ).toBe(true);
    expect(within(allow).getByTestId('approvals-warning')).toBeTruthy();
    fireEvent.click(within(allow).getByLabelText(/^Manual/));
    expect(within(allow).queryByTestId('approvals-warning')).toBeNull();
    // ADR-0022: Full auto has its own warning instead.
    fireEvent.click(within(allow).getByLabelText(/^Full auto/));
    expect(within(allow).getByTestId('full-auto-warning')).toBeTruthy();
    expect(within(allow).queryByTestId('approvals-warning')).toBeNull();
    fireEvent.click(within(allow).getByLabelText(/^Auto edits/));
    expect(within(allow).queryByTestId('full-auto-warning')).toBeNull();
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
      approvals: { mode: 'auto-edits', commands: [] },
      contextFiles: ['CLAUDE.md', 'AGENTS.md'],
    });
    expect(within(h).getByText('None')).toBeTruthy();
    expect(within(h).getByText(/has no harness yet/)).toBeTruthy();
    fireEvent.click(within(h).getByRole('button', { name: 'Create a ‘Build the harness’ ticket' }));
    const created = await within(h).findByText('Added WEB-1 “Build the harness” to the board.');
    const notice = created.closest('[role="status"]') as HTMLElement;
    expect(within(notice).getByRole('link', { name: 'Open ticket' }).getAttribute('href')).toBe(
      `#/p/${PROJECT_ID}/tickets/t-harness`,
    );
    // Every mutation sends the CSRF token, including adding an existing folder (P4-H finding).
    expect(s.csrf).toEqual([CSRF, CSRF, CSRF]);

    // Back keeps the project (no second POST); Finish opens the board.
    fireEvent.click(screen.getByRole('button', { name: 'Finish and open the board' }));
    expect(window.location.hash).toBe(`#/p/${PROJECT_ID}/board`);
    expect(s.calls.filter((c) => c.path === '/api/projects' && c.method === 'POST')).toHaveLength(
      1,
    );
  });

  it('WG-D: the workflow choice in step 2 is saved as the project’s graph on finish', async () => {
    let refuse = true;
    const s = server({
      'POST /api/projects': (body: unknown) =>
        jsonResponse(201, project({ id: PROJECT_ID, ...(body as object) })),
      [`PUT ${P}/workflow-graph`]: (body: unknown) =>
        refuse
          ? jsonResponse(500, { error: { code: 'internal', message: 'disk full', requestId: 'r' } })
          : jsonResponse(200, {
              graph: (body as { graph: unknown }).graph,
              stored: 'v2',
              issues: [],
              setup: setup(),
              skills: [],
              agents: [],
              updatedAt: '2026-10-13T10:00:00.000Z',
            }),
    });
    renderWithApi(<NewProjectWizard />, s);
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'web-app' } });
    fireEvent.change(screen.getByLabelText('Folder path'), { target: { value: '/work/web-app' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add project' }));

    // Step 2: the three templates with their review styles, "Build my own", the planner switch.
    const agents = await step('agents');
    await within(agents).findByLabelText('Ticket prefix');
    const choice = within(agents).getByTestId('wizard-workflow');
    expect(within(choice).getByLabelText<HTMLInputElement>(/^Today’s setup/).checked).toBe(true);
    expect(within(choice).getByText(/The lead reviews and merges/)).toBeTruthy();
    expect(within(choice).getByText(/A reviewer checks, the lead decides/)).toBeTruthy();
    expect(
      within(choice).getByText(
        /The reviewer sends changes back to the helper, then the lead merges/,
      ),
    ).toBeTruthy();
    expect(within(choice).getByLabelText(/^Build my own/)).toBeTruthy();
    fireEvent.click(within(choice).getByLabelText(/^Reviewer ↔ helper loop/));
    fireEvent.click(within(choice).getByLabelText('Add a planner'));
    next();
    const allow = await step('allowlist');
    fireEvent.click(within(allow).getByLabelText(/^Full auto/));
    next();
    await step('context');
    next();
    await step('harness');
    expect(s.calls.some((c) => c.path === `${P}/workflow-graph`)).toBe(false);

    // A refused save keeps you here and says so; the next try saves and opens the board.
    fireEvent.click(screen.getByRole('button', { name: 'Finish and open the board' }));
    expect(await screen.findByText(/The workflow wasn’t saved/)).toBeTruthy();
    expect(window.location.hash).not.toBe(`#/p/${PROJECT_ID}/board`);
    refuse = false;
    fireEvent.click(screen.getByRole('button', { name: 'Finish and open the board' }));
    await waitFor(() => expect(window.location.hash).toBe(`#/p/${PROJECT_ID}/board`));
    const put = s.calls
      .filter((c) => c.method === 'PUT' && c.path === `${P}/workflow-graph`)
      .at(-1);
    const graph = WorkflowGraphSchema.parse((put?.body as { graph: unknown }).graph);
    expect(graph.template).toBe('reviewer-helper-loop');
    expect(graph.nodes.some((n) => n.type === 'planner')).toBe(true);
    // A Full auto project: the plan step approves automatically, as before graphs.
    expect(graph.nodes.find((n) => n.type === 'plan-approval')).toMatchObject({ auto: true });
    expect(validateWorkflowGraph(graph, { projectMode: 'full-auto' })).toEqual([]);
    expect(s.csrf.at(-1)).toBe(CSRF);
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

describe('Project settings (#/p/:id/settings, docs/redesign/README.md §4.7)', () => {
  it('shows the project, its board key and model, context files, links and the danger zone', async () => {
    const s = server({
      [`${P}/setup`]: setup({ contextFiles: ['CLAUDE.md'], model: 'some-model' }),
    });
    renderWithApi(<ProjectSettings id={PROJECT_ID} />, s);
    expect(await screen.findByRole('heading', { level: 1, name: 'Settings' })).toBeTruthy();
    const card = await screen.findByTestId('settings-project');
    expect(within(card).getByText('web-app')).toBeTruthy();
    expect(within(card).getByText('/work/web-app')).toBeTruthy();
    expect(within(card).getByLabelText<HTMLInputElement>('Board key').value).toBe('WEB');
    expect(within(card).getByLabelText<HTMLInputElement>('Default model').value).toBe('some-model');
    const context = screen.getByTestId('settings-context');
    expect(within(context).getByLabelText<HTMLInputElement>('CLAUDE.md').checked).toBe(true);
    expect(screen.getByRole('button', { name: 'Save changes' })).toHaveProperty('disabled', true);

    // Limits and the allowlist live on Workflow now; the harness on its own page.
    expect(screen.queryByText('Helpers at once')).toBeNull();
    expect(screen.queryByText('Pre-approved actions')).toBeNull();
    expect(screen.queryByTestId('settings-harness')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Run checks now' })).toBeNull();
    const workflow = screen.getByTestId('settings-workflow-link');
    expect(within(workflow).getByRole('link', { name: 'Open Workflow' }).getAttribute('href')).toBe(
      `#/p/${PROJECT_ID}/workflow`,
    );
    const harnessRow = screen.getByTestId('settings-harness-link');
    expect(
      within(harnessRow).getByRole('link', { name: 'Open Harness' }).getAttribute('href'),
    ).toBe(`#/p/${PROJECT_ID}/harness`);
    expect(s.calls.some((c) => c.path === `${P}/harness`)).toBe(false);

    expect(
      within(screen.getByTestId('settings-danger')).getByText(/never delete the folder/),
    ).toBeTruthy();
  });

  it('saves edits with PUT, keeping the limits as saved, and clears the unsaved note', async () => {
    const s = server({}, setup({ maxConcurrentHelpers: 4, maxDepth: 2 }));
    renderWithApi(<ProjectSettings id={PROJECT_ID} />, s);
    const context = await screen.findByTestId('settings-context');
    fireEvent.click(await within(context).findByLabelText('README.md'));
    fireEvent.change(screen.getByLabelText('Board key'), { target: { value: 'app' } });
    expect(screen.getByText('You have unsaved changes.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByText('Saved.')).toBeTruthy();
    expect(s.calls.find((c) => c.method === 'PUT')?.body).toMatchObject({
      projectKey: 'APP',
      contextFiles: ['README.md'],
      maxConcurrentHelpers: 4,
      maxDepth: 2,
    });
    expect(s.csrf).toEqual([CSRF]);
  });

  it('checks the board key in a sentence before saving', async () => {
    const s = server();
    renderWithApi(<ProjectSettings id={PROJECT_ID} />, s);
    fireEvent.change(await screen.findByLabelText('Board key'), { target: { value: 'W' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByText(/Use 2 to 6 capital letters/)).toBeTruthy();
    expect(s.calls.some((c) => c.method === 'PUT')).toBe(false);
  });

  it('shows a save refusal in plain words', async () => {
    const s = server({
      [`PUT ${P}/setup`]: jsonResponse(400, {
        error: { code: 'invalid_request', message: 'key already used', requestId: 'r-2' },
      }),
    });
    renderWithApi(<ProjectSettings id={PROJECT_ID} />, s);
    fireEvent.change(await screen.findByLabelText('Default model'), {
      target: { value: 'other-model' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(
      await screen.findByText(/Your changes couldn't be saved\. key already used/),
    ).toBeTruthy();
  });
});

describe('Conflicts, verification and delivery policy (ADR-0030)', () => {
  it('starts on the safe defaults and saves an explicit policy with PUT', async () => {
    const s = server();
    renderWithApi(<ProjectSettings id={PROJECT_ID} />, s);
    const card = await screen.findByTestId('settings-automation');
    expect(within(card).getByTestId<HTMLSelectElement>('automation-conflict-mode').value).toBe(
      'manual',
    );
    expect(within(card).getByTestId<HTMLSelectElement>('automation-delivery-mode').value).toBe(
      'manual',
    );
    expect(within(card).getByTestId<HTMLInputElement>('automation-allow-unverified').checked).toBe(
      false,
    );
    fireEvent.change(within(card).getByTestId('automation-conflict-mode'), {
      target: { value: 'auto' },
    });
    fireEvent.change(within(card).getByTestId('automation-verification-mode'), {
      target: { value: 'agent-adaptive' },
    });
    fireEvent.change(within(card).getByTestId('automation-skip-scopes'), {
      target: { value: 'docs/**\n*.md' },
    });
    fireEvent.change(within(card).getByTestId('automation-delivery-mode'), {
      target: { value: 'push-pr' },
    });
    // Delegated delivery with no target is allowed but warned about.
    expect(within(card).getByTestId('automation-warnings').textContent).toContain(
      'no target branch is allowed',
    );
    fireEvent.change(within(card).getByTestId('automation-targets'), {
      target: { value: 'dev' },
    });
    fireEvent.click(within(card).getByTestId('automation-save'));
    await waitFor(() => expect(s.calls.some((c) => c.method === 'PUT')).toBe(true));
    expect(s.calls.find((c) => c.method === 'PUT')?.body).toMatchObject({
      automation: {
        conflictResolution: { mode: 'auto', maxAttempts: 2, helper: null },
        verification: {
          mode: 'agent-adaptive',
          skipScopes: ['docs/**', '*.md'],
          alwaysRunChecks: [],
          allowUnverifiedDelivery: false,
          onMissingChecks: 'escalate',
        },
        delivery: { mode: 'push-pr', allowedTargets: ['dev'] },
      },
    });
    expect(s.csrf).toContain(CSRF);
  });

  it('refuses an unsafe pattern before saving', async () => {
    const s = server();
    renderWithApi(<ProjectSettings id={PROJECT_ID} />, s);
    const card = await screen.findByTestId('settings-automation');
    fireEvent.change(within(card).getByTestId('automation-verification-mode'), {
      target: { value: 'agent-adaptive' },
    });
    fireEvent.change(within(card).getByTestId('automation-skip-scopes'), {
      target: { value: '../secrets/**' },
    });
    expect(within(card).getByTestId('automation-invalid')).toBeTruthy();
    expect(within(card).getByTestId('automation-save')).toHaveProperty('disabled', true);
    expect(s.calls.some((c) => c.method === 'PUT')).toBe(false);
  });
});
