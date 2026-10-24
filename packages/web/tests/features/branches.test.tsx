import type { ProjectBranchesDto } from '@acp/core/api';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { codeHost, type CodeHostKind } from '../../e2e/github-fixtures';
import { CSRF } from '../../e2e/review-loop-fixtures';
import { BranchesCard, MissingTargetFix } from '../../src/features/branching/Branches';
import { BranchingFields } from '../../src/features/branching/BranchingFields';
import { CodeHostCard } from '../../src/features/branching/CodeHostCard';
import { draftFromStrategy, type BranchingDraft } from '../../src/features/branching/strategy-form';
import { TicketBranchInputs } from '../../src/features/branching/TicketBranchFields';
import type { TicketBranchDraft } from '../../src/features/branching/ticket-branch';
import { ApiError, type FetchLike } from '../../src/lib/api';
import { CODE_HOST_CONNECT_COPY, PROJECT_BRANCHES_COPY } from '../../src/lib/copy';
import { project } from '../fixtures/dto';
import { PROJECT_ID } from '../fixtures/project-setup';
import { fakeServer, jsonResponse, renderWithApi, type RouteTable } from '../helpers';

/*
 * G-F (ADR-0025 §8): the project's local branches in Settings, creating one on the owner's click,
 * the strategy's and the ticket target's "create it", and the Start refusal's fix. The server is
 * a fake that answers as the real routes do; nothing reaches git or GitHub.
 */

const C = PROJECT_BRANCHES_COPY;
const P = `/api/projects/${PROJECT_ID}`;
const BRANCHES = `${P}/branches`;
const SHA = (c: string) => c.repeat(40);

function branches(
  names: string[],
  over: Partial<ProjectBranchesDto> & { onOrigin?: string[] } = {},
): ProjectBranchesDto {
  const { onOrigin = [], ...rest } = over;
  const hasOrigin = rest.hasOrigin ?? false;
  const current = rest.current === undefined ? (names[0] ?? null) : rest.current;
  return {
    truncated: false,
    ...rest,
    current,
    hasOrigin,
    branches: [...names].sort().map((name, i) => ({
      name,
      commit: SHA(String(i % 10)),
      current: name === current,
      onOrigin: hasOrigin ? onOrigin.includes(name) : null,
    })),
  };
}

/**
 * The branch routes as the server answers them: GET the list; POST refuses an existing name and
 * answers the list with the new branch (on origin when pushed). POSTs are recorded with CSRF.
 */
function branchServer(
  start: ProjectBranchesDto,
  host: CodeHostKind = 'ready',
  extra: RouteTable = {},
  refuse?: () => Response | null,
) {
  let current = start;
  const posts: { body: unknown; csrf: string | null }[] = [];
  const base = fakeServer({
    '/api/control/token': { token: CSRF },
    [P]: project({ id: PROJECT_ID, name: 'web-app', rootPath: '/work/web-app' }),
    [`${P}/code-host`]: codeHost(host),
    [BRANCHES]: () => jsonResponse(200, current),
    [`POST ${BRANCHES}`]: (body: unknown) => {
      const refused = refuse?.() ?? null;
      if (refused !== null) return refused;
      const b = body as { name: string; from: string; push?: boolean };
      if (current.branches.some((x) => x.name === b.name)) {
        return jsonResponse(409, {
          error: { code: 'branch_exists', message: 'exists', requestId: 'r' },
        });
      }
      const names = [...current.branches.map((x) => x.name), b.name];
      const pushed = current.branches.filter((x) => x.onOrigin === true).map((x) => x.name);
      current = branches(names, {
        current: current.current,
        hasOrigin: current.hasOrigin,
        onOrigin: b.push === true ? [...pushed, b.name] : pushed,
      });
      return jsonResponse(201, current);
    },
    ...extra,
  });
  const fetch: FetchLike = (input, init) => {
    if (init?.method === 'POST' && input === BRANCHES) {
      const headers = (init.headers ?? {}) as Record<string, string>;
      posts.push({
        body: typeof init.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined,
        csrf: headers['X-ACP-CSRF'] ?? null,
      });
    }
    return base.fetch(input, init);
  };
  return { fetch, calls: base.calls, posts };
}

const checkbox = (root: HTMLElement, label: string) =>
  within(root).getByLabelText<HTMLInputElement>(label);

describe('Settings: the Local branches card', () => {
  it('lists the branches with Current, On GitHub and the short commit', async () => {
    const server = branchServer(
      branches(['main', 'develop', 'feature/a'], { hasOrigin: true, onOrigin: ['main'] }),
    );
    renderWithApi(<BranchesCard projectId={PROJECT_ID} />, server);
    const card = await screen.findByTestId('settings-branches');
    const list = await within(card).findByRole('list', { name: C.listLabel });
    const rows = within(list).getAllByTestId('branch-row');
    expect(rows.map((r) => r.getAttribute('data-branch'))).toEqual([
      'develop',
      'feature/a',
      'main',
    ]);
    const main = rows[2] as HTMLElement;
    expect(within(main).getByTestId('branch-current').textContent).toBe(C.current);
    await waitFor(() =>
      expect(within(main).getByTestId('branch-on-origin').textContent).toBe('On GitHub'),
    );
    expect(main.textContent).toContain(SHA('2').slice(0, 7));
    expect(within(rows[0] as HTMLElement).queryByTestId('branch-on-origin')).toBeNull();
    expect(within(card).getByTestId('branches-count').textContent).toBe('3 branches');
  });

  it('New branch: checks the name as typed, then creates from the current branch and pushes', async () => {
    const server = branchServer(
      branches(['main', 'develop'], { current: 'main', hasOrigin: true }),
    );
    renderWithApi(<BranchesCard projectId={PROJECT_ID} />, server);
    const form = await screen.findByTestId('branch-new');
    const name = within(form).getByLabelText<HTMLInputElement>(C.name);
    fireEvent.change(name, { target: { value: 'a b' } });
    fireEvent.blur(name);
    expect(form.textContent).toContain('Use letters, digits');
    fireEvent.change(name, { target: { value: 'develop' } });
    expect(form.textContent).toContain(C.nameExists);
    fireEvent.change(name, { target: { value: 'release/2.0' } });
    expect(within(form).getByLabelText<HTMLSelectElement>(C.from).value).toBe('main');
    // GitHub origin: push is on by default.
    await waitFor(() => expect(checkbox(form, C.push(true)).checked).toBe(true));
    fireEvent.click(within(form).getByRole('button', { name: C.create }));
    await waitFor(() =>
      expect(within(form).getByTestId('branch-created').textContent).toBe(
        C.created('release/2.0', true),
      ),
    );
    expect(server.posts).toEqual([
      { body: { name: 'release/2.0', from: 'main', push: true }, csrf: CSRF },
    ]);
    expect(name.value).toBe('');
    expect(document.activeElement).toBe(name);
    const list = screen.getByRole('list', { name: C.listLabel });
    await waitFor(() =>
      expect(
        within(list)
          .getAllByTestId('branch-row')
          .map((r) => r.dataset['branch']),
      ).toContain('release/2.0'),
    );
  });

  it('without origin there is no push choice; a refusal is said plainly and focused', async () => {
    const server = branchServer(branches(['main']), 'no-remote', {}, () =>
      jsonResponse(404, {
        error: { code: 'base_branch_missing', message: 'gone', requestId: 'r' },
      }),
    );
    renderWithApi(<BranchesCard projectId={PROJECT_ID} />, server);
    const form = await screen.findByTestId('branch-new');
    expect(within(form).queryByTestId('branch-push')).toBeNull();
    fireEvent.change(within(form).getByLabelText(C.name), { target: { value: 'dev' } });
    fireEvent.submit(form);
    const error = await within(form).findByTestId('branch-create-error');
    expect(error.getAttribute('data-code')).toBe('base_branch_missing');
    const alert = within(error).getByRole('alert');
    expect(alert.textContent).toBe(C.errors.base_branch_missing);
    await waitFor(() => expect(document.activeElement).toBe(alert));
    expect(server.posts[0]?.body).toEqual({ name: 'dev', from: 'main' });
  });

  it('an empty name is refused before anything is sent', async () => {
    const server = branchServer(branches(['main']));
    renderWithApi(<BranchesCard projectId={PROJECT_ID} />, server);
    const form = await screen.findByTestId('branch-new');
    fireEvent.submit(form);
    expect(form.textContent).toContain(C.nameMissing);
    expect(document.activeElement).toBe(within(form).getByLabelText(C.name));
    expect(server.posts).toEqual([]);
  });
});

describe('the Start refusal: create the missing target, then start again once', () => {
  const refusal = new ApiError({
    kind: 'http',
    path: '/api/tickets/t-1/start',
    status: 409,
    code: 'target_branch_missing',
    message: 'The target branch dev does not exist in the project yet',
  });

  it('offers "Create dev from main" and retries the start exactly once', async () => {
    const server = branchServer(branches(['main'], { hasOrigin: true }));
    const onRetry = vi.fn();
    function Harness() {
      const [error, setError] = useState<ApiError | null>(refusal);
      return (
        <MissingTargetFix
          projectId={PROJECT_ID}
          ticketBranch={{ target: 'dev' }}
          strategy={undefined}
          error={error}
          onRetry={() => {
            onRetry();
            setError(null);
          }}
        />
      );
    }
    renderWithApi(<Harness />, server);
    const fix = await screen.findByTestId('start-fix');
    expect(fix.textContent).toContain('dev isn’t a branch in the project folder yet.');
    const create = await within(fix).findByRole('button', { name: C.createFrom('dev', 'main') });
    await waitFor(() => expect(checkbox(fix, C.push(true)).checked).toBe(true));
    fireEvent.click(create);
    await waitFor(() => expect(onRetry).toHaveBeenCalledTimes(1));
    expect(server.posts.map((p) => p.body)).toEqual([{ name: 'dev', from: 'main', push: true }]);
    expect(screen.queryByTestId('start-fix')).toBeNull();
  });

  it('nothing for another refusal; "Start again" (once) when the branch exists by now', async () => {
    const server = branchServer(branches(['main', 'dev']));
    const onRetry = vi.fn();
    const other = new ApiError({
      kind: 'http',
      path: '/x',
      status: 409,
      code: 'managed_disabled',
      message: 'off',
    });
    function Harness() {
      const [error, setError] = useState<ApiError>(other);
      return (
        <>
          <button type="button" onClick={() => setError(refusal)}>
            refuse
          </button>
          <MissingTargetFix
            projectId={PROJECT_ID}
            ticketBranch={{ target: 'dev' }}
            strategy={undefined}
            error={error}
            onRetry={onRetry}
          />
        </>
      );
    }
    renderWithApi(<Harness />, server);
    expect(screen.queryByTestId('start-fix')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'refuse' }));
    const again = await screen.findByRole('button', { name: C.missing.startAgain });
    fireEvent.click(again);
    fireEvent.click(again);
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(server.posts).toEqual([]);
  });
});

describe('the strategy form and a ticket’s target', () => {
  function Strategy({ initial }: { initial: BranchingDraft }) {
    const [draft, setDraft] = useState(initial);
    return (
      <BranchingFields
        draft={draft}
        errors={{}}
        onChange={setDraft}
        projectKey="WEB"
        projectId={PROJECT_ID}
      />
    );
  }

  it('warns under a base or target the folder doesn’t have, with Create it', async () => {
    const server = branchServer(branches(['main']), 'no-remote');
    const draft = draftFromStrategy({
      preset: 'git-flow',
      baseBranch: 'develop',
      defaultTargetBranch: 'develop',
      ticketBranchTemplate: '{type}/{key}-{slug}',
      typeWords: { feature: 'feature', bug: 'fix', chore: 'chore', harness: 'chore' },
    });
    renderWithApi(<Strategy initial={draft} />, server);
    const note = await screen.findByTestId('branching-base-missing');
    // Base and target are the same branch: one warning.
    expect(screen.queryByTestId('branching-target-missing')).toBeNull();
    expect(note.textContent).toContain(C.strategyMissing('develop'));
    fireEvent.click(within(note).getByRole('button', { name: C.createIt }));
    const create = await within(note).findByRole('button', {
      name: C.createFrom('develop', 'main'),
    });
    await waitFor(() => expect(document.activeElement).toBe(create));
    fireEvent.click(create);
    const created = await screen.findByTestId('branching-base-missing-created');
    expect(created.textContent).toBe(C.created('develop', false));
    await waitFor(() => expect(document.activeElement).toBe(created));
    expect(server.posts.map((p) => p.body)).toEqual([{ name: 'develop', from: 'main' }]);
  });

  it('the ticket target offers the local branches and creates a typed one', async () => {
    const server = branchServer(branches(['main', 'develop'], { current: 'main' }), 'no-remote');
    function Ticket() {
      const [draft, setDraft] = useState<TicketBranchDraft>({ name: '', target: '', from: '' });
      return (
        <TicketBranchInputs
          draft={draft}
          onChange={setDraft}
          namePlaceholder={null}
          targetPlaceholder="main"
          projectId={PROJECT_ID}
          preferredBase="develop"
        />
      );
    }
    const { container } = renderWithApi(<Ticket />, server);
    const input = screen.getByTestId('ticket-branch-target-input');
    const listId = input.getAttribute('list') ?? '';
    await waitFor(() =>
      expect(
        [
          ...(container.querySelector(`datalist[id="${listId}"]`)?.querySelectorAll('option') ??
            []),
        ].map((o) => o.getAttribute('value')),
      ).toEqual(['develop', 'main']),
    );
    fireEvent.change(input, { target: { value: 'develop' } });
    expect(screen.queryByTestId('ticket-branch-target-missing')).toBeNull();
    fireEvent.change(input, { target: { value: 'qa' } });
    const note = await screen.findByTestId('ticket-branch-target-missing');
    fireEvent.click(within(note).getByRole('button', { name: C.createFrom('qa', 'develop') }));
    expect((await screen.findByTestId('ticket-branch-target-missing-created')).textContent).toBe(
      C.created('qa', false),
    );
    expect(server.posts.map((p) => p.body)).toEqual([{ name: 'qa', from: 'develop' }]);
  });
});

describe('the GitHub card names the branch it would push', () => {
  it('“Push main now” once the branches say the folder is on main', async () => {
    const server = branchServer(branches(['main']), 'no-remote');
    renderWithApi(<CodeHostCard projectId={PROJECT_ID} />, server);
    const push = await screen.findByLabelText<HTMLInputElement>(
      CODE_HOST_CONNECT_COPY.create.pushNamed('main'),
    );
    expect(push.checked).toBe(true);
    await waitFor(() =>
      expect(screen.getByTestId('code-host-create-summary').textContent).toContain(
        'then pushes main.',
      ),
    );
  });
});
