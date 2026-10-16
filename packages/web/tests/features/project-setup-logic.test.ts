import { describe, expect, it } from 'vitest';
import {
  contextUsage,
  createRepoErrorMessage,
  draftFromSetup,
  draftToRequest,
  initialContextFiles,
  joinFolder,
  newRepoRequest,
  parseTokens,
  validateAgentFields,
  validateContext,
  validateNewRepo,
} from '../../src/features/project-setup/setup-form';
import {
  ApiError,
  createApiClient,
  createRepoProject,
  isProjectSetupPath,
  runHarnessChecks,
  updateProjectSetup,
  type FetchLike,
} from '../../src/lib/api';
import { formatKiB } from '../../src/lib/copy';
import { href, parseRoute } from '../../src/lib/router';
import { CSRF } from '../fixtures/control';
import { project } from '../fixtures/dto';
import { PROJECT_ID, candidates, checkRuns, setup } from '../fixtures/project-setup';
import { fakeServer, jsonResponse } from '../helpers';

describe('project setup form logic', () => {
  it('reads budgets the way people type them', () => {
    expect(parseTokens('500,000')).toBe(500_000);
    expect(parseTokens(' 250 000 ')).toBe(250_000);
    expect(parseTokens('1_000')).toBe(1000);
    expect(parseTokens('')).toBeNull();
    expect(parseTokens('0')).toBeNull();
    expect(parseTokens('12.5')).toBeNull();
    expect(parseTokens('lots')).toBeNull();
  });

  it('turns the saved setup into a draft and back into the PUT body', () => {
    const draft = draftFromSetup(setup({ model: 'some-model', contextFiles: ['CLAUDE.md'] }));
    expect(draft.budget).toBe('500,000');
    expect(draft.model).toBe('some-model');
    const r = draftToRequest({ ...draft, model: '  ', maxDepth: 2 }, candidates());
    expect(r).toEqual({
      ok: true,
      request: {
        projectKey: 'WEB',
        maxConcurrentHelpers: 3,
        maxDepth: 2,
        defaultBudgetTokensPerAgent: 500_000,
        model: null,
        allowlist: { editInOwnWorktree: false, runHarnessChecks: true },
        contextFiles: ['CLAUDE.md'],
      },
    });
  });

  it('explains invalid agent fields in sentences', () => {
    const draft = {
      ...draftFromSetup(setup()),
      projectKey: 'web1',
      budget: '-5',
      model: 'm'.repeat(101),
    };
    expect(validateAgentFields(draft)).toEqual({
      projectKey: 'Use 2 to 6 capital letters for the ticket prefix, for example WEB.',
      budget: 'Enter the budget as a whole number above zero, for example 500,000.',
      model: 'Use a shorter model name (at most 100 characters).',
    });
    expect(draftToRequest(draft, candidates()).ok).toBe(false);
  });

  it('counts the context limits: 10 files and 32 KB together', () => {
    const list = candidates();
    expect(contextUsage(['CLAUDE.md', 'gone.md'], list)).toEqual({ bytes: 6_200, unknown: 1 });
    expect(validateContext(['CLAUDE.md', 'AGENTS.md'], list)).toEqual({});
    expect(validateContext(['AGENTS.md', 'docs/architecture.md'], list).contextFiles).toBe(
      'The chosen files are larger than 32 KB together. Leave some out.',
    );
    const eleven = Array.from({ length: 11 }, (_, i) => `f${i}.md`);
    expect(validateContext(eleven, list).contextFiles).toBe('Choose at most 10 files.');
  });

  it('pre-selects suggested files only when nothing is chosen yet', () => {
    expect(initialContextFiles([], candidates())).toEqual(['CLAUDE.md', 'AGENTS.md']);
    expect(initialContextFiles(['README.md'], candidates())).toEqual(['README.md']);
  });

  it('formats sizes in KB', () => {
    expect(formatKiB(1)).toBe('1 byte');
    expect(formatKiB(900)).toBe('900 bytes');
    expect(formatKiB(6_200)).toBe('6.1 KB');
    expect(formatKiB(21_000)).toBe('21 KB');
  });

  it('validates a new repository before calling the server', () => {
    expect(validateNewRepo({ parentDir: '', name: '', readme: '' })).toEqual({
      parentDir: 'Enter the folder to create the repository in.',
      name: 'Give the repository a name.',
    });
    expect(validateNewRepo({ parentDir: 'code', name: 'my app', readme: '' })).toEqual({
      parentDir: 'Use the full folder path, starting with / (for example /Users/me/code).',
      name: 'Use only letters, digits, dots, dashes and underscores, starting with a letter or digit (at most 100 characters).',
    });
    expect(
      validateNewRepo({ parentDir: '/code', name: 'app', readme: 'x'.repeat(20_001) }),
    ).toEqual({
      readme: 'Keep the README under 20,000 characters.',
    });
    expect(newRepoRequest({ parentDir: ' /code ', name: 'app', readme: '  ' })).toEqual({
      parentDir: '/code',
      name: 'app',
    });
    expect(joinFolder('/code/', 'app')).toBe('/code/app');
  });

  it('turns create-repository refusals into sentences', () => {
    const http = (code: string) =>
      new ApiError({ kind: 'http', path: '', message: 'x', code, status: 409 });
    expect(createRepoErrorMessage(http('conflict'))).toBe(
      'A folder with that name already exists there. Pick another name.',
    );
    expect(createRepoErrorMessage(http('invalid_root'))).toMatch(/wasn't found/);
    expect(createRepoErrorMessage(http('other'))).toBe("The repository couldn't be created.");
  });
});

describe('project setup routes and client', () => {
  it('parses the wizard and settings routes', () => {
    expect(parseRoute(href.newProject())).toEqual({ name: 'project-new' });
    // Redesign (R-A): settings live at #/p/:projectId/settings; the old addresses redirect.
    const settings = parseRoute(href.projectSettings('a/b'));
    expect(settings.name === 'project' && [settings.projectId, settings.page]).toEqual([
      'a/b',
      'settings',
    ]);
    expect(parseRoute('#/projects/p-1')).toEqual({
      name: 'legacy',
      legacy: { kind: 'project', projectId: 'p-1' },
    });
    expect(parseRoute('#/projects/p-1/other').name).toBe('not-found');
  });

  it('matches only one project’s setup paths', () => {
    const match = isProjectSetupPath('p-1');
    expect(match('/api/projects/p-1/setup')).toBe(true);
    expect(match('/api/projects/p-1/harness')).toBe(true);
    expect(match('/api/projects/p-1/context-candidates')).toBe(true);
    expect(match('/api/projects/p-1/sessions')).toBe(false);
    expect(match('/api/projects/p-10/setup')).toBe(false);
  });

  function csrfServer(routes: Record<string, unknown>) {
    const base = fakeServer({ '/api/control/token': { token: CSRF }, ...routes });
    const headers: (string | null)[] = [];
    const fetch: FetchLike = (input, init) => {
      if (init?.method !== undefined && init.method !== 'GET') {
        headers.push(((init.headers ?? {}) as Record<string, string>)['X-ACP-CSRF'] ?? null);
      }
      return base.fetch(input, init);
    };
    return { client: createApiClient(fetch), calls: base.calls, headers };
  }

  it('sends PUT /setup and the harness POSTs with the CSRF header', async () => {
    const s = csrfServer({
      [`PUT /api/projects/${PROJECT_ID}/setup`]: (body: unknown) =>
        jsonResponse(200, setup(body as object)),
      [`POST /api/projects/${PROJECT_ID}/harness/checks`]: checkRuns(),
    });
    const r = draftToRequest(draftFromSetup(setup()), candidates());
    if (!r.ok) throw new Error('draft invalid');
    const saved = await updateProjectSetup(s.client, PROJECT_ID, r.request);
    expect(saved.projectKey).toBe('WEB');
    const runs = await runHarnessChecks(s.client, PROJECT_ID);
    expect(runs.map((x) => x.status)).toEqual(['passed', 'failed']);
    expect(s.headers).toEqual([CSRF, CSRF]);
    expect(s.calls.find((c) => c.method === 'PUT')?.body).toEqual(r.request);
  });

  it('refuses a malformed create-repository body before sending it', async () => {
    const s = csrfServer({ 'POST /api/projects/new': project({ id: 'p-n' }) });
    await expect(
      createRepoProject(s.client, { parentDir: 'relative', name: 'app' }),
    ).rejects.toMatchObject({ kind: 'parse' });
    expect(s.calls.some((c) => c.method === 'POST')).toBe(false);
    const p = await createRepoProject(s.client, { parentDir: '/code', name: 'app' });
    expect(p.id).toBe('p-n');
  });
});
