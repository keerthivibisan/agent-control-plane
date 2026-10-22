import {
  CodeHostStatusDtoSchema,
  TicketBranchDtoSchema,
  TicketDetailDtoSchema,
} from '@acp/core/api';
import { BranchStrategySchema } from '@acp/core';
import type { ProjectAgentSetupDto } from '@acp/core/api';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import {
  CODE_HOST_PATH,
  GH_BRANCH,
  GH_PR_URL,
  PR_PATH,
  PR_REFRESH_PATH,
  codeHost,
  ghMergedScenario,
  ghOpenScenario,
  ghReviewScenario,
  githubFlowStrategy,
  pullRequest,
  withPullRequestLines,
  type CodeHostKind,
} from '../../e2e/github-fixtures';
import {
  CSRF,
  LOOP_BRANCH_PATH,
  LOOP_RUN_PATH,
  LOOP_TICKET_ID,
  LOOP_TICKET_PATH,
  loopWorkingScenario,
  type LoopScenario,
} from '../../e2e/review-loop-fixtures';
import { NewTicketDialog } from '../../src/features/board/NewTicketDialog';
import { NewProjectWizard } from '../../src/features/project-setup/NewProjectWizard';
import { ProjectSettings } from '../../src/features/project-setup/ProjectSettings';
import { TicketPage } from '../../src/features/ticket/TicketPage';
import type { FetchLike } from '../../src/lib/api';
import {
  BRANCHING_COPY,
  CODE_HOST_COPY,
  PULL_REQUEST_COPY,
  TICKET_BRANCH_COPY,
} from '../../src/lib/copy';
import { project } from '../fixtures/dto';
import { PROJECT_ID, candidates, harness, harnessTicket, setup } from '../fixtures/project-setup';
import { fakeServer, jsonResponse, renderWithApi, type RouteTable } from '../helpers';

/*
 * G-B (ADR-0025): the branching strategy and GitHub status in Settings, a ticket's own branch in
 * New ticket and on the ticket page, and the ticket branch card's final step (merge here, or Push
 * & open PR with its link, state and Refresh). Routes are fakes; nothing reaches GitHub.
 */

beforeAll(() => {
  // The ticket page's live graph (React Flow) needs these in jsdom.
  if (typeof globalThis.DOMMatrixReadOnly === 'undefined') {
    class Matrix {
      m22: number;
      constructor(transform?: string) {
        const scale = /scale\(([\d.]+)\)/.exec(transform ?? '')?.[1];
        this.m22 = scale === undefined ? 1 : Number(scale);
      }
    }
    Object.assign(globalThis, { DOMMatrixReadOnly: Matrix });
  }
  for (const prop of ['offsetWidth', 'offsetHeight'] as const) {
    Object.defineProperty(HTMLElement.prototype, prop, { configurable: true, get: () => 800 });
  }
  Object.assign(SVGElement.prototype, {
    getBBox: () => ({ x: 0, y: 0, width: 0, height: 0 }),
  });
});

const P = `/api/projects/${PROJECT_ID}`;
const GH_FLOW = BranchStrategySchema.parse(githubFlowStrategy());
const C = BRANCHING_COPY;
const H = CODE_HOST_COPY;
const PR = PULL_REQUEST_COPY;
const TB = TICKET_BRANCH_COPY;

/** Records each mutation's CSRF header beside the fake server's calls. */
function withCsrf(routes: RouteTable) {
  const base = fakeServer(routes);
  const csrf: (string | null)[] = [];
  const fetch: FetchLike = (input, init) => {
    if (init?.method !== undefined && init.method !== 'GET') {
      csrf.push(((init.headers ?? {}) as Record<string, string>)['X-ACP-CSRF'] ?? null);
    }
    return base.fetch(input, init);
  };
  return { fetch, calls: base.calls, csrf };
}
type Server = ReturnType<typeof withCsrf>;
const mutations = (s: Server) => s.calls.filter((c) => c.method !== 'GET');

// --- Settings -----------------------------------------------------------------------------------

function settingsServer(
  saved: Partial<ProjectAgentSetupDto> = {},
  host: CodeHostKind | Response = 'ready',
  routes: RouteTable = {},
) {
  let current = setup(saved);
  return withCsrf({
    '/api/control/token': { token: CSRF },
    [P]: project({ id: PROJECT_ID, name: 'web-app', rootPath: '/work/web-app' }),
    [`${P}/setup`]: () => jsonResponse(200, current),
    [`${P}/context-candidates`]: candidates(),
    [CODE_HOST_PATH]: host instanceof Response ? () => host : codeHost(host),
    [`PUT ${P}/setup`]: (body: unknown) => {
      const { branching, ...rest } = body as Record<string, unknown>;
      current = setup({
        ...rest,
        ...(branching !== null &&
          branching !== undefined && { branching: BranchStrategySchema.parse(branching) }),
        updatedAt: '2026-10-22T10:00:00.000Z',
      });
      return jsonResponse(200, current);
    },
    ...routes,
  });
}

async function branchingCard() {
  return screen.findByTestId('settings-branching');
}

describe('Settings: the branching strategy', () => {
  it('starts at None for a project without one, and saves nothing for it unchanged', async () => {
    const s = settingsServer();
    renderWithApi(<ProjectSettings id={PROJECT_ID} />, s);
    const card = await branchingCard();
    expect(within(card).getByLabelText<HTMLInputElement>(/None, keep acp/).checked).toBe(true);
    expect(within(card).getByTestId('branching-none').textContent).toContain('acp/WEB-12');
    expect(within(card).queryByLabelText('Base branch')).toBeNull();
    // Another change saves without touching the strategy (absent keeps it).
    fireEvent.change(screen.getByLabelText('Default model'), { target: { value: 'm' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await screen.findByText('Saved.');
    expect(mutations(s)[0]?.body).not.toHaveProperty('branching');
  });

  it('switches presets with a live preview, locks a preset’s names, and saves the strategy', async () => {
    const s = settingsServer();
    renderWithApi(<ProjectSettings id={PROJECT_ID} />, s);
    const card = await branchingCard();
    // GitHub's default branch is where GitHub flow starts.
    await screen.findByText(H.connected('acme/web-app'));
    fireEvent.click(within(card).getByLabelText(/GitHub flow/));
    expect(within(card).getByLabelText<HTMLInputElement>('Base branch').value).toBe('main');
    const template = within(card).getByLabelText<HTMLInputElement>('Ticket branch name');
    expect(template.value).toBe('{type}/{key}-{slug}');
    expect(template.readOnly).toBe(true);
    expect(within(card).getByLabelText<HTMLInputElement>('Bug').value).toBe('fix');
    const names = () =>
      within(card)
        .getAllByTestId('branching-preview-name')
        .map((n) => n.textContent);
    expect(names()).toEqual([
      'feature/WEB-12-add-saved-searches',
      'fix/WEB-13-login-fails-on-safari',
    ]);

    // Git flow: develop and bugfix.
    fireEvent.click(within(card).getByLabelText(/Git flow/));
    expect(within(card).getByLabelText<HTMLInputElement>('Default target branch').value).toBe(
      'develop',
    );
    expect(names()[1]).toBe('bugfix/WEB-13-login-fails-on-safari');

    // Custom frees the names; the preview follows the board key and the template as typed.
    fireEvent.click(within(card).getByLabelText(/Custom/));
    const custom = within(card).getByLabelText<HTMLInputElement>('Ticket branch name');
    expect(custom.readOnly).toBe(false);
    fireEvent.change(custom, { target: { value: '{key}-{slug}' } });
    fireEvent.change(screen.getByLabelText('Board key'), { target: { value: 'app' } });
    expect(names()).toEqual(['APP-12-add-saved-searches', 'APP-13-login-fails-on-safari']);

    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await screen.findByText('Saved.');
    expect(mutations(s)[0]?.body).toMatchObject({
      projectKey: 'APP',
      branching: {
        preset: 'custom',
        baseBranch: 'develop',
        defaultTargetBranch: 'develop',
        ticketBranchTemplate: '{key}-{slug}',
        typeWords: { feature: 'feature', bug: 'bugfix', chore: 'chore', harness: 'chore' },
      },
    });
    expect(s.csrf).toEqual([CSRF]);
  });

  it('checks the template and the branches as typed, and Save waits for a fix', async () => {
    const s = settingsServer({ branching: GH_FLOW });
    renderWithApi(<ProjectSettings id={PROJECT_ID} />, s);
    const card = await branchingCard();
    expect(within(card).getByLabelText<HTMLInputElement>(/GitHub flow/).checked).toBe(true);
    fireEvent.click(within(card).getByLabelText(/Custom/));
    const template = within(card).getByLabelText('Ticket branch name');
    fireEvent.change(template, { target: { value: '{type}/{slug}' } });
    expect(within(card).getByText(C.errors.templateNeedsKey)).toBeTruthy();
    expect(within(card).getByText(C.previewUnavailable)).toBeTruthy();
    fireEvent.change(template, { target: { value: '{type}/{ticket}' } });
    expect(within(card).getByText(C.errors.templateToken('{ticket}'))).toBeTruthy();
    fireEvent.change(within(card).getByLabelText('Base branch'), { target: { value: 'my main' } });
    expect(within(card).getByText(C.errors.branch)).toBeTruthy();
    fireEvent.change(within(card).getByLabelText('Chore'), { target: { value: 'Chore' } });
    expect(within(card).getByText(C.errors.typeWord)).toBeTruthy();
    const save = screen.getByRole('button', { name: 'Save changes' });
    expect(save).toHaveProperty('disabled', true);

    fireEvent.change(template, { target: { value: '{type}/{key}' } });
    fireEvent.change(within(card).getByLabelText('Base branch'), { target: { value: 'main' } });
    fireEvent.change(within(card).getByLabelText('Chore'), { target: { value: 'chore' } });
    expect(save).toHaveProperty('disabled', false);
    expect(mutations(s)).toHaveLength(0);
  });

  it('None removes a saved strategy (null); Undo changes puts the saved one back', async () => {
    const s = settingsServer({ branching: GH_FLOW });
    renderWithApi(<ProjectSettings id={PROJECT_ID} />, s);
    const card = await branchingCard();
    fireEvent.click(within(card).getByLabelText(/None, keep acp/));
    fireEvent.click(screen.getByRole('button', { name: 'Undo changes' }));
    expect(within(card).getByLabelText<HTMLInputElement>(/GitHub flow/).checked).toBe(true);
    fireEvent.click(within(card).getByLabelText(/None, keep acp/));
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await screen.findByText('Saved.');
    expect(mutations(s)[0]?.body).toMatchObject({ branching: null });
  });
});

describe('Settings: GitHub status', () => {
  it.each([
    ['no-remote', H.problems['no-remote']],
    ['no-cli', H.problems['no-cli']],
    ['not-logged-in', H.problems['not-logged-in']],
  ] as const)('says what to fix when %s', async (kind, text) => {
    renderWithApi(<ProjectSettings id={PROJECT_ID} />, settingsServer({}, kind));
    const card = await screen.findByTestId('settings-code-host');
    expect(await within(card).findByText(text)).toBeTruthy();
    expect(within(card).getByTestId('code-host-state').textContent).toBe(H.word.notConnected);
    expect(within(card).getByTestId('code-host-message').dataset['problem']).toBe(kind);
  });

  it('shows the connection, and Check again asks once more', async () => {
    const s = settingsServer();
    renderWithApi(<ProjectSettings id={PROJECT_ID} />, s);
    const card = await screen.findByTestId('settings-code-host');
    expect(await within(card).findByText('Connected to GitHub: acme/web-app')).toBeTruthy();
    expect(within(card).getByTestId('code-host-state').textContent).toBe(H.word.connected);
    expect(within(card).getByText('main')).toBeTruthy();
    const asked = () => s.calls.filter((c) => c.path === CODE_HOST_PATH).length;
    expect(asked()).toBe(1);
    fireEvent.click(within(card).getByRole('button', { name: H.recheck }));
    await waitFor(() => expect(asked()).toBe(2));
  });

  it('a server that can’t tell says so, with the details', async () => {
    const failed = jsonResponse(404, {
      error: { code: 'not_found', message: 'no route', requestId: 'r-1' },
    });
    renderWithApi(<ProjectSettings id={PROJECT_ID} />, settingsServer({}, failed));
    const card = await screen.findByTestId('settings-code-host');
    expect(await within(card).findByText(H.loadFailed)).toBeTruthy();
    expect(within(card).queryByTestId('code-host-state')).toBeNull();
  });

  it('the fixtures match the contract', () => {
    for (const k of ['ready', 'no-remote', 'no-cli', 'not-logged-in'] as const) {
      expect(CodeHostStatusDtoSchema.safeParse(codeHost(k)).success).toBe(true);
    }
  });
});

// --- New ticket -----------------------------------------------------------------------------------

describe('New ticket: the branch under More options', () => {
  function dialogServer(saved: Partial<ProjectAgentSetupDto>) {
    return withCsrf({
      '/api/control/token': { token: CSRF },
      [`${P}/setup`]: setup(saved),
      [`POST ${P}/tickets`]: harnessTicket(),
    });
  }

  it('shows the names the project would give, checks as typed and sends only what is set', async () => {
    const s = dialogServer({ branching: GH_FLOW });
    const created = vi.fn();
    renderWithApi(
      <NewTicketDialog projectId={PROJECT_ID} onClose={() => undefined} onCreated={created} />,
      s,
    );
    const dialog = screen.getByRole('dialog', { name: 'New ticket' });
    fireEvent.change(within(dialog).getByLabelText('Title'), { target: { value: 'Dark mode' } });
    fireEvent.change(within(dialog).getByLabelText('Type'), { target: { value: 'bug' } });
    const more = within(dialog).getByTestId('run-options-more');
    const name = within(more).getByLabelText<HTMLInputElement>(TB.name);
    const target = within(more).getByLabelText<HTMLInputElement>(TB.target);
    await waitFor(() => expect(name.placeholder).toBe('fix/WEB-N-dark-mode'));
    expect(target.placeholder).toBe('main');

    fireEvent.change(name, { target: { value: 'spike dark mode' } });
    expect(within(more).getByText(C.errors.branch)).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create ticket' }));
    expect(mutations(s)).toHaveLength(0);

    fireEvent.change(name, { target: { value: 'spike/dark-mode' } });
    fireEvent.change(target, { target: { value: 'release/2.0' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create ticket' }));
    await waitFor(() => expect(created).toHaveBeenCalled());
    expect(mutations(s)[0]?.body).toMatchObject({
      title: 'Dark mode',
      branch: { name: 'spike/dark-mode', target: 'release/2.0' },
    });
  });

  it('without a strategy: acp/<KEY> and Project default; empty fields send no branch', async () => {
    const s = dialogServer({});
    const created = vi.fn();
    renderWithApi(
      <NewTicketDialog projectId={PROJECT_ID} onClose={() => undefined} onCreated={created} />,
      s,
    );
    const dialog = screen.getByRole('dialog', { name: 'New ticket' });
    const more = within(dialog).getByTestId('run-options-more');
    const name = within(more).getByLabelText<HTMLInputElement>(TB.name);
    await waitFor(() => expect(name.placeholder).toBe('acp/WEB-N'));
    expect(within(more).getByLabelText<HTMLInputElement>(TB.target).placeholder).toBe(
      'Project default',
    );
    fireEvent.change(within(dialog).getByLabelText('Title'), { target: { value: 'Dark mode' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create ticket' }));
    await waitFor(() => expect(created).toHaveBeenCalled());
    expect(mutations(s)[0]?.body).not.toHaveProperty('branch');
  });
});

// --- The ticket page ------------------------------------------------------------------------------

const ok = (body: unknown) => () => jsonResponse(200, body);

function ticketServer(sc: LoopScenario, routes: RouteTable = {}) {
  const detail = sc.routes[LOOP_TICKET_PATH] as Record<string, unknown>;
  const run = detail['currentRun'] as Record<string, unknown>;
  return withCsrf({
    ...sc.routes,
    [`${P}/setup`]: setup({ branching: GH_FLOW }),
    [`PATCH ${LOOP_TICKET_PATH}`]: ok(detail),
    [`POST ${LOOP_BRANCH_PATH}`]: ok(sc.routes[LOOP_BRANCH_PATH]),
    [`POST ${PR_PATH}`]: ok(run['ticketBranch']),
    [`POST ${PR_REFRESH_PATH}`]: ok(run['ticketBranch']),
    ...routes,
  });
}

function renderTicket(sc: LoopScenario, routes: RouteTable = {}) {
  const s = ticketServer(sc, routes);
  renderWithApi(<TicketPage id={LOOP_TICKET_ID} />, s);
  return s;
}

/** The scenario with the ticket's own branch settings. */
function withTicketBranch(sc: LoopScenario, branch: Record<string, unknown>): LoopScenario {
  const detail = sc.routes[LOOP_TICKET_PATH] as Record<string, unknown>;
  const ticket = detail['ticket'] as Record<string, unknown>;
  return {
    routes: { ...sc.routes, [LOOP_TICKET_PATH]: { ...detail, ticket: { ...ticket, branch } } },
  };
}

/** A working run without a ticket branch yet: the branch settings can be changed. */
function beforeBranch(): LoopScenario {
  const sc = loopWorkingScenario();
  const detail = sc.routes[LOOP_TICKET_PATH] as Record<string, unknown>;
  const run = { ...(detail['currentRun'] as Record<string, unknown>), ticketBranch: null };
  return {
    routes: {
      ...sc.routes,
      [LOOP_TICKET_PATH]: { ...detail, currentRun: run },
      [LOOP_RUN_PATH]: run,
    },
  };
}

describe('the ticket page: the ticket’s branch', () => {
  it('shows what the project gives, and saves the ticket’s own name and target', async () => {
    const s = renderTicket(beforeBranch());
    const section = await screen.findByTestId('ticket-branch-settings');
    await waitFor(() =>
      expect(within(section).getByTestId('ticket-branch-name').textContent).toBe(
        'Project default (feature/WEB-21-saved-searches)',
      ),
    );
    expect(within(section).getByTestId('ticket-branch-target').textContent).toBe(
      'Project default (main)',
    );
    fireEvent.click(within(section).getByRole('button', { name: TB.editLabel }));
    // v0.3.0 D-B: the sidebar's Change edits in a dialog.
    const dialog = screen.getByTestId('ticket-branch-dialog');
    const name = within(dialog).getByLabelText<HTMLInputElement>(TB.name);
    expect(name.placeholder).toBe('feature/WEB-21-saved-searches');
    fireEvent.change(name, { target: { value: '-bad' } });
    expect(within(dialog).getByRole('button', { name: TB.save })).toHaveProperty('disabled', true);
    fireEvent.change(name, { target: { value: 'spike/search' } });
    fireEvent.click(within(dialog).getByRole('button', { name: TB.save }));
    await waitFor(() => expect(mutations(s)).toHaveLength(1));
    expect(mutations(s)[0]).toMatchObject({
      method: 'PATCH',
      path: LOOP_TICKET_PATH,
      body: { branch: { name: 'spike/search', target: null } },
    });
  });

  it('emptying both fields puts the ticket back to the project’s (branch: null)', async () => {
    const s = renderTicket(withTicketBranch(beforeBranch(), { target: 'develop' }));
    const section = await screen.findByTestId('ticket-branch-settings');
    expect(within(section).getByTestId('ticket-branch-target').textContent).toBe(
      'develop · This ticket',
    );
    fireEvent.click(within(section).getByRole('button', { name: TB.editLabel }));
    const dialog = screen.getByTestId('ticket-branch-dialog');
    fireEvent.change(within(dialog).getByLabelText(TB.target), { target: { value: '' } });
    fireEvent.click(within(dialog).getByRole('button', { name: TB.save }));
    await waitFor(() => expect(mutations(s)).toHaveLength(1));
    expect(mutations(s)[0]?.body).toEqual({ branch: null });
  });

  it('once the run created the branch, shows it and its target read-only', async () => {
    renderTicket(ghReviewScenario());
    const section = await screen.findByTestId('ticket-branch-settings');
    expect(within(section).getByTestId('ticket-branch-actual').textContent).toBe(GH_BRANCH);
    expect(within(section).getByTestId('ticket-branch-actual-target').textContent).toBe('main');
    expect(within(section).queryByRole('button', { name: TB.editLabel })).toBeNull();
  });
});

describe('the ticket branch card: the final step', () => {
  async function card() {
    return screen.findByTestId('ticket-branch');
  }
  /** The pull request is in the Comments tab's sidebar (v0.3.0 D-B; Comments since C-B). */
  const side = () => screen.getByTestId('sidebar-pull-request');

  it('fixtures match the contract', () => {
    for (const sc of [
      ghReviewScenario(),
      ghReviewScenario(pullRequest('open')),
      ghReviewScenario(pullRequest('closed')),
      ghMergedScenario(),
      ghOpenScenario(true),
      ghOpenScenario(false),
      withPullRequestLines(ghMergedScenario()),
    ]) {
      expect(TicketDetailDtoSchema.safeParse(sc.routes[LOOP_TICKET_PATH]).success).toBe(true);
      const run = (sc.routes[LOOP_TICKET_PATH] as Record<string, unknown>)['currentRun'];
      const branch = (run as Record<string, unknown>)['ticketBranch'];
      expect(TicketBranchDtoSchema.safeParse(branch).success).toBe(true);
    }
  });

  it.each(['no-remote', 'no-cli', 'not-logged-in'] as const)(
    'without GitHub (%s) Push & open PR is off, with the reason; Merge stays',
    async (kind) => {
      renderTicket(ghReviewScenario(null, kind));
      const c = await card();
      expect(within(c).getByRole('button', { name: 'Merge into main' })).toBeTruthy();
      const push = within(c).getByRole('button', { name: PR.push });
      expect(await within(c).findByText(PR.blocked[kind])).toBeTruthy();
      expect(push).toHaveProperty('disabled', true);
      expect(push.getAttribute('aria-describedby')).toBe(within(c).getByTestId('push-blocked').id);
    },
  );

  it('asks first, saying what will happen; sends the title and draft choice', async () => {
    const s = renderTicket(ghReviewScenario());
    const c = await card();
    const push = within(c).getByRole('button', { name: PR.push });
    await waitFor(() => expect(push).toHaveProperty('disabled', false));
    fireEvent.click(push);
    const confirm = within(c).getByTestId('push-confirm');
    expect(confirm.textContent).toContain(
      `Push ${GH_BRANCH} to origin and open a pull request against main on GitHub. The pull request description is this ticket’s run summary.`,
    );
    const title = within(confirm).getByLabelText<HTMLInputElement>(PR.titleLabel);
    expect(title.value).toBe('WEB-21: Saved searches');
    expect(document.activeElement).toBe(title);
    fireEvent.change(title, { target: { value: ' ' } });
    expect(within(confirm).getByText(PR.titleMissing)).toBeTruthy();
    expect(within(confirm).getByRole('button', { name: PR.confirmButton })).toHaveProperty(
      'disabled',
      true,
    );
    fireEvent.change(title, { target: { value: 'WEB-21: Saved searches in the sidebar' } });
    fireEvent.click(within(confirm).getByLabelText(PR.draft));
    expect(mutations(s)).toHaveLength(0);
    fireEvent.click(within(confirm).getByRole('button', { name: PR.confirmButton }));
    await waitFor(() => expect(mutations(s)).toHaveLength(1));
    expect(mutations(s)[0]).toMatchObject({
      method: 'POST',
      path: PR_PATH,
      body: { title: 'WEB-21: Saved searches in the sidebar', draft: true },
    });
    expect(s.csrf).toEqual([CSRF]);
    await waitFor(() => expect(within(c).queryByTestId('push-confirm')).toBeNull());
  });

  it('Cancel sends nothing', async () => {
    const s = renderTicket(ghReviewScenario());
    const c = await card();
    const push = within(c).getByRole('button', { name: PR.push });
    await waitFor(() => expect(push).toHaveProperty('disabled', false));
    fireEvent.click(push);
    fireEvent.click(within(c).getByRole('button', { name: PR.cancel }));
    expect(within(c).queryByTestId('push-confirm')).toBeNull();
    expect(mutations(s)).toHaveLength(0);
  });

  it.each([
    'gh-not-installed',
    'gh-not-logged-in',
    'no-github-remote',
    'push-rejected',
    'pr-exists-elsewhere',
    'timeout',
    'gh-failed',
  ] as const)('shows the %s refusal in plain words, the form kept', async (code) => {
    renderTicket(ghReviewScenario(), {
      [`POST ${PR_PATH}`]: () =>
        jsonResponse(409, { error: { code, message: 'raw words', requestId: 'r-9' } }),
    });
    const c = await card();
    const push = within(c).getByRole('button', { name: PR.push });
    await waitFor(() => expect(push).toHaveProperty('disabled', false));
    fireEvent.click(push);
    fireEvent.click(within(c).getByRole('button', { name: PR.confirmButton }));
    const error = await within(c).findByTestId('pr-error');
    expect(within(error).getAllByRole('alert')[0]?.textContent).toBe(PR.errors[code]);
    expect(within(c).getByTestId('push-confirm')).toBeTruthy();
  });

  it('an open pull request: number and link in a new tab, its state, Checked, Refresh; no local merge', async () => {
    const s = renderTicket(ghReviewScenario(pullRequest('open')));
    const c = await card();
    const pr = within(side()).getByTestId('pull-request');
    const link = within(pr).getByRole('link', { name: /Pull request #42/ });
    expect(link.getAttribute('href')).toBe(GH_PR_URL);
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');
    expect(link.textContent).toContain(PR.newTab);
    expect(within(pr).getByTestId('pr-state').textContent).toBe('Open');
    expect(within(pr).getByTestId('pr-checked').textContent).toMatch(/^Checked /);
    expect(within(pr).getByTestId('pr-note').textContent).toBe(PR.openNote('main'));
    expect(within(c).queryByRole('button', { name: 'Merge into main' })).toBeNull();
    expect(within(c).queryByRole('button', { name: PR.push })).toBeNull();
    expect(within(c).getByRole('button', { name: 'Request changes…' })).toBeTruthy();
    expect(s.calls.some((call) => call.path === CODE_HOST_PATH)).toBe(false);

    // G-D: opening the page read it once; Refresh reads it again.
    await waitFor(() => expect(mutations(s)).toHaveLength(1));
    const refresh = within(pr).getByRole('button', { name: PR.refresh });
    await waitFor(() => expect(refresh).toHaveProperty('disabled', false));
    fireEvent.click(refresh);
    await waitFor(() => expect(mutations(s)).toHaveLength(2));
    for (const m of mutations(s)) {
      expect(m).toMatchObject({ method: 'POST', path: PR_REFRESH_PATH, body: {} });
    }
  });

  it('a failed check on opening, then a failed Refresh, say so in plain words', async () => {
    let answers = 0;
    const s = renderTicket(ghReviewScenario(pullRequest('open')), {
      [`POST ${PR_REFRESH_PATH}`]: () => {
        answers += 1;
        return answers === 1
          ? jsonResponse(504, { error: { code: 'timeout', message: 'slow', requestId: 'r-3' } })
          : jsonResponse(409, {
              error: { code: 'gh-not-logged-in', message: 'auth', requestId: 'r-4' },
            });
      },
    });
    await card();
    const first = await within(side()).findByTestId('pr-error');
    expect(within(first).getAllByRole('alert')[0]?.textContent).toBe(PR.errors.timeout);
    const refresh = within(side()).getByRole('button', { name: PR.refresh });
    await waitFor(() => expect(refresh).toHaveProperty('disabled', false));
    fireEvent.click(refresh);
    await waitFor(() =>
      expect(within(side()).getByTestId('pr-error').getAttribute('data-code')).toBe(
        'gh-not-logged-in',
      ),
    );
    expect(
      within(within(side()).getByTestId('pr-error')).getAllByRole('alert')[0]?.textContent,
    ).toBe(PR.errors['gh-not-logged-in']);
    expect(mutations(s)).toHaveLength(2);
  });

  it('merged on GitHub: the card reads merged, the ticket is done, no Refresh', async () => {
    renderTicket(ghMergedScenario());
    const c = await card();
    expect(within(c).getByTestId('branch-state').textContent).toBe('Merged into main on GitHub');
    const pr = within(side()).getByTestId('pull-request');
    expect(within(pr).getByTestId('pr-state').textContent).toBe('Merged');
    expect(within(pr).getByTestId('pr-note').textContent).toBe(PR.mergedNote('main'));
    expect(within(pr).queryByRole('button', { name: PR.refresh })).toBeNull();
    expect(within(c).queryByTestId('branch-actions')).toBeNull();
    expect(screen.getByTestId('ticket-stage').textContent).toContain('Done');
  });

  it('closed without merging: both final steps are offered again', async () => {
    renderTicket(ghReviewScenario(pullRequest('closed')));
    const c = await card();
    const pr = within(side()).getByTestId('pull-request');
    expect(within(pr).getByTestId('pr-state').textContent).toBe('Closed');
    expect(within(pr).getByTestId('pr-note').textContent).toBe(PR.closedNote);
    expect(within(c).getByRole('button', { name: 'Merge into main' })).toBeTruthy();
    expect(within(c).getByRole('button', { name: PR.push })).toBeTruthy();
  });

  it('never links a pull request URL that is not https', async () => {
    renderTicket(
      ghReviewScenario(pullRequest('open', { url: 'http://github.com/acme/web-app/pull/42' })),
    );
    await card();
    const pr = within(side()).getByTestId('pull-request');
    expect(within(pr).queryByRole('link')).toBeNull();
    expect(within(pr).getByText('Pull request #42')).toBeTruthy();
  });
});

// --- G-D: reading an open pull request on opening, and Push new commits ------------------------

const refreshes = (s: Server) => mutations(s).filter((m) => m.path === PR_REFRESH_PATH);

describe('the ticket page reads an open pull request once when it opens (G-D)', () => {
  it('asks once, with the CSRF token; refetches and stream notices never ask again', async () => {
    const s = ticketServer(ghOpenScenario(false));
    const { store } = renderWithApi(<TicketPage id={LOOP_TICKET_ID} />, s);
    await screen.findByTestId('pull-request');
    await waitFor(() => expect(refreshes(s)).toHaveLength(1));
    expect(refreshes(s)[0]).toMatchObject({ method: 'POST', body: {} });
    expect(s.csrf).toEqual([CSRF]);
    // Stream notices refetch the ticket and the run; the pull request is still open.
    for (let i = 0; i < 3; i += 1) {
      store.invalidate(() => true);
      await waitFor(() =>
        expect(s.calls.filter((c) => c.path === LOOP_TICKET_PATH).length).toBeGreaterThan(i + 2),
      );
    }
    await new Promise((r) => setTimeout(r, 50));
    expect(refreshes(s)).toHaveLength(1);
  });

  it('a new visit asks again; a page without an open pull request never asks', async () => {
    const s = ticketServer(ghOpenScenario(false));
    const first = renderWithApi(<TicketPage id={LOOP_TICKET_ID} />, s);
    await waitFor(() => expect(refreshes(s)).toHaveLength(1));
    first.unmount();
    renderWithApi(<TicketPage id={LOOP_TICKET_ID} />, s);
    await waitFor(() => expect(refreshes(s)).toHaveLength(2));

    for (const sc of [
      ghReviewScenario(),
      ghReviewScenario(pullRequest('closed')),
      ghMergedScenario(),
    ]) {
      const other = ticketServer(sc);
      const view = renderWithApi(<TicketPage id={LOOP_TICKET_ID} />, other);
      await view.findByTestId('ticket-branch');
      await new Promise((r) => setTimeout(r, 50));
      expect(refreshes(other)).toHaveLength(0);
      view.unmount();
    }
  });

  it('a pull request opened during the visit is not read again on its own', async () => {
    const before = ghReviewScenario();
    const after = ghOpenScenario(false);
    let opened = false;
    const pick = (path: string) => () => jsonResponse(200, (opened ? after : before).routes[path]);
    const branchOf = (sc: LoopScenario) =>
      (
        (sc.routes[LOOP_TICKET_PATH] as Record<string, unknown>)['currentRun'] as Record<
          string,
          unknown
        >
      )['ticketBranch'];
    const s = ticketServer(before, {
      [LOOP_TICKET_PATH]: pick(LOOP_TICKET_PATH),
      [LOOP_RUN_PATH]: pick(LOOP_RUN_PATH),
      [`POST ${PR_PATH}`]: () => {
        opened = true;
        return jsonResponse(200, branchOf(after));
      },
    });
    renderWithApi(<TicketPage id={LOOP_TICKET_ID} />, s);
    const c = await screen.findByTestId('ticket-branch');
    const push = within(c).getByRole('button', { name: PR.push });
    await waitFor(() => expect(push).toHaveProperty('disabled', false));
    fireEvent.click(push);
    fireEvent.click(within(c).getByRole('button', { name: PR.confirmButton }));
    await screen.findByTestId('pull-request');
    await new Promise((r) => setTimeout(r, 50));
    expect(mutations(s).map((m) => m.path)).toEqual([PR_PATH]);
  });
});

describe('the pull request lines in the ticket’s comments (G-D)', () => {
  it('shows the push, the push again and the merge on GitHub as small lines', async () => {
    window.location.hash = '#?tab=conversation';
    renderTicket(withPullRequestLines(ghMergedScenario()));
    // On Conversation since v0.3.0 C-B (ADR-0026).
    const comments = await screen.findByTestId('activity');
    await waitFor(() => expect(within(comments).getAllByTestId('merge-line')).toHaveLength(3));
    const lines = within(comments).getAllByTestId('merge-line');
    expect(lines.map((l) => l.getAttribute('data-kind')).sort()).toEqual([
      'pr-merged',
      'pr-pushed',
      'pr-pushed',
    ]);
    const merged = lines.find((l) => l.getAttribute('data-kind') === 'pr-merged');
    expect(merged?.textContent).toContain('Merged via pull request #42 into main at 9c8b7a6');
    expect([...(merged?.querySelectorAll('code') ?? [])].map((c) => c.textContent)).toEqual([
      'main',
      '9c8b7a6',
    ]);
  });
});

describe('Push new commits to an open pull request (G-D)', () => {
  it('is offered when the branch moved on since the last push, and asks first', async () => {
    const s = renderTicket(ghOpenScenario(true));
    const c = await card();
    await waitFor(() => expect(refreshes(s)).toHaveLength(1));
    const button = within(c).getByRole('button', { name: PR.pushNew });
    await waitFor(() => expect(button).toHaveProperty('disabled', false));
    fireEvent.click(button);
    const confirm = within(c).getByTestId('confirm');
    expect(confirm.textContent).toContain(
      `Push the new commits on ${GH_BRANCH} to the open pull request #42.`,
    );
    expect(mutations(s).filter((m) => m.path === PR_PATH)).toHaveLength(0);
    fireEvent.click(within(confirm).getByRole('button', { name: PR.pushNew }));
    await waitFor(() => expect(mutations(s).filter((m) => m.path === PR_PATH)).toHaveLength(1));
    expect(mutations(s).find((m) => m.path === PR_PATH)).toMatchObject({
      method: 'POST',
      body: {},
    });
    expect(s.csrf.every((t) => t === CSRF)).toBe(true);
    // The local merge stays hidden while the pull request is open.
    expect(within(c).queryByRole('button', { name: 'Merge into main' })).toBeNull();
    expect(within(c).getByRole('button', { name: 'Request changes…' })).toBeTruthy();
  });

  it('Cancel sends nothing', async () => {
    const s = renderTicket(ghOpenScenario(true));
    const c = await card();
    fireEvent.click(await within(c).findByRole('button', { name: PR.pushNew }));
    fireEvent.click(within(c).getByRole('button', { name: PR.cancel }));
    expect(within(c).queryByTestId('confirm')).toBeNull();
    expect(mutations(s).filter((m) => m.path === PR_PATH)).toHaveLength(0);
  });

  it('is not offered when the pull request has the tip, or the last push is unknown', async () => {
    for (const sc of [ghOpenScenario(false), ghReviewScenario(pullRequest('open'))]) {
      const view = renderWithApi(<TicketPage id={LOOP_TICKET_ID} />, ticketServer(sc));
      const c = await view.findByTestId('ticket-branch');
      expect(view.getByTestId('pull-request')).toBeTruthy();
      expect(within(c).queryByRole('button', { name: PR.pushNew })).toBeNull();
      view.unmount();
    }
  });

  it('a refused push says GitHub’s branch has commits the app won’t overwrite', async () => {
    renderTicket(ghOpenScenario(true), {
      [`POST ${PR_PATH}`]: () =>
        jsonResponse(409, { error: { code: 'push-rejected', message: 'raw', requestId: 'r-5' } }),
    });
    const c = await card();
    fireEvent.click(await within(c).findByRole('button', { name: PR.pushNew }));
    fireEvent.click(
      within(within(c).getByTestId('confirm')).getByRole('button', { name: PR.pushNew }),
    );
    const error = await within(within(c).getByTestId('push-new-commits')).findByTestId('pr-error');
    expect(within(error).getAllByRole('alert')[0]?.textContent).toBe(PR.pushNewRejected);
    expect(PR.pushNewRejected).toBe(
      'The branch on GitHub has commits the app doesn’t have; it won’t overwrite them.',
    );
  });

  async function card() {
    return screen.findByTestId('ticket-branch');
  }
});

describe('New project wizard: the optional branching strategy', () => {
  it('is collapsed at None, and a chosen strategy is saved with the setup', async () => {
    const s = settingsServer({}, 'ready', {
      [`${P}/harness`]: harness('none'),
      'POST /api/projects': (body: unknown) =>
        jsonResponse(201, project({ id: PROJECT_ID, ...(body as object) })),
    });
    renderWithApi(<NewProjectWizard />, s);
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'web-app' } });
    fireEvent.change(screen.getByLabelText('Folder path'), { target: { value: '/work/web-app' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add project' }));
    const agents = await screen.findByTestId('wizard-step-agents');
    const section = await within(agents).findByTestId('wizard-branching');
    expect(section.hasAttribute('open')).toBe(false);
    fireEvent.click(within(section).getByLabelText(/Git flow/));
    expect(within(section).getAllByTestId('branching-preview-name')[0]?.textContent).toBe(
      'feature/WEB-12-add-saved-searches',
    );
    const next = () => fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    next();
    await screen.findByTestId('wizard-step-allowlist');
    next();
    await screen.findByTestId('wizard-step-context');
    next();
    await screen.findByTestId('wizard-step-harness');
    expect(s.calls.find((c) => c.method === 'PUT')?.body).toMatchObject({
      branching: { preset: 'git-flow', baseBranch: 'develop', defaultTargetBranch: 'develop' },
    });
  });
});
