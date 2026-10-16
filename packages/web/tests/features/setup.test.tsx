import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SetupPage } from '../../src/features/setup/SetupPage';
import { containingProject } from '../../src/features/setup/UnaddedFolders';
import { registerErrorMessage, validateProjectInput } from '../../src/features/setup/register';
import { ApiError } from '../../src/lib/api';
import { candidate, capabilities, project } from '../fixtures/dto';
import { fakeServer, jsonResponse, renderWithApi } from '../helpers';

const base = { '/api/discovery/candidates': [] };

async function fillForm(name: string, path: string) {
  const form = await screen.findByRole('form', { name: 'Register a project' });
  fireEvent.change(within(form).getByLabelText('Name'), { target: { value: name } });
  fireEvent.change(within(form).getByLabelText('Folder path'), { target: { value: path } });
  fireEvent.submit(form);
  return form;
}

describe('Setup (#/setup)', () => {
  it('shows three numbered steps, the last one optional', async () => {
    renderWithApi(<SetupPage />, fakeServer(base));
    expect(await screen.findByRole('heading', { level: 1, name: 'Connection' })).toBeTruthy();
    expect(screen.getByText(/Connect this app to your work/)).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Add a project folder' })).toBeTruthy();
    expect(
      screen.getByRole('region', { name: 'Folders with Claude Code activity, not added yet' }),
    ).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Live updates through hooks' })).toBeTruthy();
    expect(document.querySelectorAll('[data-step]').length).toBe(3);
    expect(screen.getByText('Step 3 (Optional):')).toBeTruthy();
  });

  it('adds a project and links to it', async () => {
    const server = fakeServer({
      ...base,
      'POST /api/projects': (body: unknown) =>
        jsonResponse(
          200,
          project({ id: 'p-new', ...(body as { name: string; rootPath: string }) }),
        ),
    });
    renderWithApi(<SetupPage />, server);
    await fillForm('  repo ', ' /work/repo ');
    const status = await screen.findByText('Added repo.');
    expect(server.calls.find((c) => c.method === 'POST')?.body).toEqual({
      name: 'repo',
      rootPath: '/work/repo',
    });
    const notice = status.closest('[role="status"]') as HTMLElement;
    expect(within(notice).getByRole('link', { name: 'Open project' }).getAttribute('href')).toBe(
      '#/p/p-new/board',
    );
  });

  it('explains a relative path and an empty name in plain words, before calling the server', async () => {
    const server = fakeServer(base);
    renderWithApi(<SetupPage />, server);
    const form = await fillForm('', 'relative/path');
    expect(await within(form).findByText('Give the project a name.')).toBeTruthy();
    expect(
      within(form).getByText(
        'Use the full folder path, starting with / (for example /Users/me/code/my-app).',
      ),
    ).toBeTruthy();
    expect(within(form).getByLabelText('Folder path').getAttribute('aria-invalid')).toBe('true');
    expect(server.calls.some((c) => c.method === 'POST')).toBe(false);
  });

  it('turns a server error into a plain sentence, the raw error under Details', async () => {
    const server = fakeServer({
      ...base,
      'POST /api/projects': jsonResponse(400, {
        error: {
          code: 'invalid_root',
          message: 'Root path does not exist or is not readable',
          requestId: 'r-1',
        },
      }),
    });
    renderWithApi(<SetupPage />, server);
    const form = await fillForm('repo', '/nope');
    const alerts = await within(form).findAllByRole('alert');
    expect(alerts[0]?.textContent).toBe(
      "That folder wasn't found on this computer, or it isn't a folder. Check the path and try again.",
    );
    const details = within(form).getByText('Technical details').closest('details') as HTMLElement;
    expect(details.textContent).toContain('invalid_root');
    expect(details.textContent).toContain('Root path does not exist');
  });

  it('adds an unadded folder in one click, named after the folder', async () => {
    const server = fakeServer({
      '/api/discovery/candidates': [
        candidate({ cwd: '/work/alpha', sessionCount: 5 }),
        candidate({ cwd: '/work/app/sub', sessionCount: 1, lastSeenAt: null }),
      ],
      '/api/projects': [project({ id: 'p-app', name: 'app', rootPath: '/work/app' })],
      'POST /api/projects': (body: unknown) =>
        jsonResponse(
          200,
          project({ id: 'p-new', ...(body as { name: string; rootPath: string }) }),
        ),
    });
    renderWithApi(<SetupPage />, server);
    const row = (await screen.findByText('/work/alpha')).closest('tr') as HTMLElement;
    expect(row.textContent).toContain('5 sessions');
    fireEvent.click(within(row).getByRole('button', { name: 'Add as project "alpha"' }));
    await waitFor(() =>
      expect(server.calls.find((c) => c.method === 'POST')?.body).toEqual({
        name: 'alpha',
        rootPath: '/work/alpha',
      }),
    );
    expect(await screen.findByText('Added alpha.')).toBeTruthy();

    // A folder inside an existing project says so instead of offering to add it again.
    const inside = (await screen.findByText('/work/app/sub')).closest('tr') as HTMLElement;
    expect(inside.textContent).toContain('Inside project');
    expect(within(inside).getByRole('link', { name: 'app' })).toBeTruthy();
    expect(inside.textContent).toContain('No activity seen');
  });

  it('says when there are no unadded folders', async () => {
    renderWithApi(<SetupPage />, fakeServer(base));
    expect(await screen.findByText('No unadded folders')).toBeTruthy();
  });

  it('explains hooks, shows the receiver URL and the command, and says none arrived yet', async () => {
    renderWithApi(<SetupPage />, fakeServer(base));
    const hooks = await screen.findByRole('region', { name: 'Live updates through hooks' });
    const status = await within(hooks).findByTestId('hooks-status');
    expect(status.textContent).toBe('Not connected yet: no hook has been received.');
    expect(hooks.textContent).toContain('"Waiting for you" appears the moment');
    expect(hooks.textContent).toContain('pnpm --filter @acp/server hooks:snippet');
    expect(hooks.textContent).toContain('ACP_HOOK_TOKEN');
    expect(hooks.textContent).toContain('http://127.0.0.1:7420/api/hooks/claude-code');
    expect(hooks.textContent).toContain('never edits your Claude Code settings');
    expect(within(hooks).getByRole('button', { name: 'Copy command' })).toBeTruthy();
  });

  it('says when hooks are connected, and that sample data takes none', async () => {
    renderWithApi(
      <SetupPage />,
      fakeServer({
        ...base,
        '/api/capabilities': capabilities({
          mode: 'demo',
          hooks: { receiverUrl: 'http://127.0.0.1:1/api/hooks/claude-code', receivedAny: true },
        }),
      }),
    );
    const status = await screen.findByTestId('hooks-status');
    expect(status.getAttribute('data-received')).toBe('true');
    expect(status.textContent).toContain('Connected');
    expect(screen.getByText(/Sample data does not accept hooks/)).toBeTruthy();
  });
});

describe('setup helpers', () => {
  it('validates the form like the core schema, in plain words', () => {
    expect(validateProjectInput({ name: 'a', rootPath: '/x' })).toEqual({});
    expect(validateProjectInput({ name: 'a', rootPath: 'C:\\x' })).toEqual({});
    expect(validateProjectInput({ name: '', rootPath: '' })).toEqual({
      name: 'Give the project a name.',
      rootPath: 'Enter the folder path.',
    });
    expect(validateProjectInput({ name: 'x'.repeat(201), rootPath: '~/x' }).name).toContain(
      'shorter',
    );
  });

  it('maps server error codes to plain sentences', () => {
    const http = (code: string) =>
      new ApiError({ kind: 'http', path: '/api/projects', message: 'm', status: 400, code });
    expect(registerErrorMessage(http('conflict'))).toBe('This folder is already a project.');
    expect(registerErrorMessage(http('invalid_root'))).toContain("wasn't found");
    expect(registerErrorMessage(http('other'))).toBe("The folder couldn't be added.");
  });

  it('matches folders to registered projects by path segment', () => {
    const projects = [project({ id: 'a', rootPath: '/work/app' })];
    expect(containingProject('/work/app/sub', projects)?.id).toBe('a');
    expect(containingProject('/work/app', projects)?.id).toBe('a');
    expect(containingProject('/work/application', projects)).toBeUndefined();
  });
});
