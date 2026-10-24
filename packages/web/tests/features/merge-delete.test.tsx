import { BranchStrategySchema } from '@acp/core';
import { TicketBranchDtoSchema, TicketBranchReviewDtoSchema } from '@acp/core/api';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  BRANCH_DELETE_PATH,
  GH_BRANCH,
  MERGE_PR_PATH,
  PR_REFRESH_PATH,
  ghFinishedScenario,
  ghMergedAnswer,
  ghMergedScenario,
  ghOpenScenario,
  githubFlowStrategy,
} from '../../e2e/github-fixtures';
import {
  CSRF,
  LOOP_BRANCH_PATH,
  LOOP_TICKET_ID,
  LOOP_TICKET_PATH,
  PROJECT_ID,
  type LoopScenario,
} from '../../e2e/review-loop-fixtures';
import {
  branchActionErrorText,
  branchGone,
  branchStillExists,
  mergeMethodKey,
  readMergeMethod,
  saveMergeMethod,
} from '../../src/features/branching/merge-branch';
import { TicketPage } from '../../src/features/ticket/TicketPage';
import { ApiError, type FetchLike } from '../../src/lib/api';
import { MERGE_PR_COPY } from '../../src/lib/copy';
import { fakeServer, jsonResponse, renderWithApi, type RouteTable } from '../helpers';
import { setup } from '../fixtures/project-setup';

/*
 * G-G (ADR-0025 §9): Merge pull request from the final step (method remembered per project,
 * "Delete branch" ticked by default, a confirmation saying exactly what happens) and Delete
 * branch once the ticket branch is merged or discarded. Routes are fakes; nothing reaches GitHub.
 */

beforeAll(() => {
  // The ticket page's live graph (React Flow) needs these in jsdom.
  if (typeof globalThis.DOMMatrixReadOnly === 'undefined') {
    class Matrix {
      m22 = 1;
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

afterEach(() => {
  window.localStorage.clear();
});

const M = MERGE_PR_COPY;
const P = `/api/projects/${PROJECT_ID}`;
const ok = (body: unknown) => () => jsonResponse(200, body);
const refusal = (status: number, code: string, message: string) => () =>
  jsonResponse(status, { error: { code, message, requestId: 'r-1' } });

function server(sc: LoopScenario, routes: RouteTable = {}) {
  const detail = sc.routes[LOOP_TICKET_PATH] as Record<string, unknown>;
  const run = detail['currentRun'] as Record<string, unknown>;
  const base = fakeServer({
    ...sc.routes,
    [`${P}/setup`]: setup({ branching: BranchStrategySchema.parse(githubFlowStrategy()) }),
    [`POST ${PR_REFRESH_PATH}`]: ok(run['ticketBranch']),
    ...routes,
  });
  const csrf: (string | null)[] = [];
  const fetch: FetchLike = (input, init) => {
    if (init?.method !== undefined && init.method !== 'GET') {
      csrf.push(((init.headers ?? {}) as Record<string, string>)['X-ACP-CSRF'] ?? null);
    }
    return base.fetch(input, init);
  };
  return { fetch, calls: base.calls, csrf };
}
type Server = ReturnType<typeof server>;

const posts = (s: Server, path: string) =>
  s.calls.filter((c) => c.method === 'POST' && c.path === path);

function renderTicket(sc: LoopScenario, routes: RouteTable = {}) {
  const s = server(sc, routes);
  renderWithApi(<TicketPage id={LOOP_TICKET_ID} />, s);
  return s;
}

const card = () => screen.findByTestId('ticket-branch');

describe('merge-branch rules', () => {
  it('remembers the method per project, and falls back to a merge commit', () => {
    const store = new Map<string, string>();
    const storage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
    };
    expect(readMergeMethod('p-1', storage)).toBe('merge');
    saveMergeMethod('p-1', 'squash', storage);
    expect(store.get(mergeMethodKey('p-1'))).toBe('squash');
    expect(readMergeMethod('p-1', storage)).toBe('squash');
    expect(readMergeMethod('p-2', storage)).toBe('merge');
    store.set(mergeMethodKey('p-1'), 'octopus');
    expect(readMergeMethod('p-1', storage)).toBe('merge');
  });

  it('a storage that throws (a private window) changes nothing', () => {
    const broken = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    };
    expect(readMergeMethod('p-1', broken)).toBe('merge');
    expect(() => saveMergeMethod('p-1', 'rebase', broken)).not.toThrow();
    expect(readMergeMethod('p-1', null)).toBe('merge');
  });

  it('offers Delete branch only for a finished branch git says still exists', () => {
    const merged = { state: 'merged' as const };
    const pr = (headOnOrigin: boolean | null) => ({
      provider: 'github' as const,
      number: 42,
      url: 'https://github.com/acme/web-app/pull/42',
      state: 'merged' as const,
      baseBranch: 'main',
      headBranch: GH_BRANCH,
      checkedAt: '2026-10-17T09:58:00.000Z',
      headOnOrigin,
    });
    expect(branchStillExists({ ...merged, localExists: true, pullRequest: pr(true) })).toBe('both');
    expect(branchStillExists({ ...merged, localExists: false, pullRequest: pr(true) })).toBe(
      'origin',
    );
    expect(branchStillExists({ ...merged, localExists: true, pullRequest: pr(false) })).toBe(
      'local',
    );
    expect(branchStillExists({ ...merged, localExists: false, pullRequest: pr(false) })).toBeNull();
    expect(branchStillExists({ state: 'discarded', localExists: true })).toBe('local');
    // Still open (no merged pull request): never.
    expect(branchStillExists({ state: 'open', localExists: true })).toBeNull();
    // A server before G-G: unknown, nothing is offered on a guess.
    expect(branchStillExists({ ...merged })).toBeNull();
    expect(branchGone({ ...merged })).toBe(false);
    expect(branchGone({ ...merged, localExists: false, pullRequest: pr(false) })).toBe(true);
    expect(branchGone({ ...merged, localExists: false, pullRequest: pr(null) })).toBe(true);
    expect(branchGone({ ...merged, localExists: false, pullRequest: pr(true) })).toBe(false);
  });

  it('words a refusal with the app’s own sentence, the copy when it has none', () => {
    const err = (code: string, message: string) =>
      new ApiError({ kind: 'http', path: '/x', status: 409, code, message });
    expect(branchActionErrorText(err('pull_request_not_mergeable', 'Has conflicts.'))).toBe(
      'Has conflicts.',
    );
    expect(branchActionErrorText(err('merge_method_not_allowed', ''))).toBe(
      M.errors.merge_method_not_allowed,
    );
    expect(branchActionErrorText(err('timeout', 'May or may not be merged.'))).toBe(
      'May or may not be merged.',
    );
    expect(branchActionErrorText(err('something_else', 'raw'))).toBeNull();
    expect(
      branchActionErrorText(new ApiError({ kind: 'unreachable', path: '/x', message: 'down' })),
    ).toBeNull();
  });

  it('the fixtures match the contract', () => {
    for (const presence of [
      { localExists: true, headOnOrigin: true },
      { localExists: false, headOnOrigin: null },
    ]) {
      expect(TicketBranchDtoSchema.safeParse(ghMergedAnswer(presence)).success).toBe(true);
      const review = ghFinishedScenario(presence).routes[LOOP_BRANCH_PATH];
      expect(TicketBranchReviewDtoSchema.safeParse(review).success).toBe(true);
    }
  });
});

describe('Merge pull request (G-G)', () => {
  it('asks first with the method and Delete branch, then merges with them', async () => {
    const s = renderTicket(ghOpenScenario(false), {
      [`POST ${MERGE_PR_PATH}`]: ok(ghMergedAnswer({ localExists: false, headOnOrigin: false })),
    });
    const c = await card();
    const box = await within(c).findByTestId('merge-pr');
    const method = within(box).getByLabelText<HTMLSelectElement>(M.methodLabel);
    expect(method.value).toBe('merge');
    expect([...method.options].map((o) => o.text)).toEqual([
      'Create a merge commit',
      'Squash and merge',
      'Rebase and merge',
    ]);
    const del = within(box).getByLabelText<HTMLInputElement>(M.deleteBranch);
    expect(del.checked).toBe(true);
    // The header points to it.
    expect(screen.getByTestId('final-step-shortcut').textContent).toBe('Merge pull request');

    fireEvent.change(method, { target: { value: 'squash' } });
    expect(window.localStorage.getItem(mergeMethodKey(PROJECT_ID))).toBe('squash');
    fireEvent.click(within(box).getByRole('button', { name: 'Squash and merge' }));
    const confirm = within(c).getByTestId('merge-confirm');
    expect(confirm.textContent).toContain(
      `Merges #42 into main on GitHub as one squashed commit and deletes ${GH_BRANCH} there and in the project folder. The ticket is done once GitHub reports it merged.`,
    );
    // A stray Enter never confirms: Cancel has the focus.
    expect(document.activeElement).toBe(within(confirm).getByRole('button', { name: M.cancel }));
    expect(posts(s, MERGE_PR_PATH)).toHaveLength(0);
    fireEvent.click(within(confirm).getByRole('button', { name: M.confirmButton.squash }));
    await waitFor(() => expect(posts(s, MERGE_PR_PATH)).toHaveLength(1));
    expect(posts(s, MERGE_PR_PATH)[0]?.body).toEqual({ method: 'squash', deleteBranch: true });
    expect(s.csrf.every((t) => t === CSRF)).toBe(true);
  });

  it('uses the project’s last method; unticked, it keeps the branch; Cancel sends nothing', async () => {
    window.localStorage.setItem(mergeMethodKey(PROJECT_ID), 'rebase');
    const s = renderTicket(ghOpenScenario(false), {
      [`POST ${MERGE_PR_PATH}`]: ok(ghMergedAnswer({ localExists: true, headOnOrigin: true })),
    });
    const c = await card();
    const box = await within(c).findByTestId('merge-pr');
    const button = within(box).getByRole('button', { name: 'Rebase and merge' });
    fireEvent.click(within(box).getByLabelText(M.deleteBranch));
    fireEvent.click(button);
    fireEvent.click(within(c).getByRole('button', { name: M.cancel }));
    expect(within(c).queryByTestId('merge-confirm')).toBeNull();
    expect(posts(s, MERGE_PR_PATH)).toHaveLength(0);

    fireEvent.click(within(c).getByRole('button', { name: 'Rebase and merge' }));
    const confirm = within(c).getByTestId('merge-confirm');
    expect(confirm.textContent).toBe(
      'Merges #42 into main on GitHub by rebasing its commits. The ticket is done once GitHub reports it merged.' +
        M.confirmButton.rebase +
        M.cancel,
    );
    fireEvent.click(within(confirm).getByRole('button', { name: M.confirmButton.rebase }));
    await waitFor(() => expect(posts(s, MERGE_PR_PATH)).toHaveLength(1));
    expect(posts(s, MERGE_PR_PATH)[0]?.body).toEqual({ method: 'rebase', deleteBranch: false });
  });

  it('is off until new commits are pushed, saying why', async () => {
    renderTicket(ghOpenScenario(true));
    const c = await card();
    const box = await within(c).findByTestId('merge-pr');
    const button = within(box).getByRole('button', { name: 'Merge pull request' });
    expect(button).toHaveProperty('disabled', true);
    expect(button.getAttribute('aria-describedby')).toBe(
      within(box).getByTestId('merge-blocked').id,
    );
    expect(within(box).getByTestId('merge-blocked').textContent).toBe(M.needsPush);
    expect(within(c).getByRole('button', { name: 'Push new commits' })).toBeTruthy();
  });

  it('a refusal is said in the app’s words, with the details', async () => {
    const message =
      'Pull request #42 has conflicts with its target on GitHub. Resolve them there, then try again.';
    renderTicket(ghOpenScenario(false), {
      [`POST ${MERGE_PR_PATH}`]: refusal(409, 'pull_request_not_mergeable', message),
    });
    const c = await card();
    fireEvent.click(await within(c).findByRole('button', { name: 'Merge pull request' }));
    fireEvent.click(within(c).getByRole('button', { name: M.confirmButton.merge }));
    const error = await within(c).findByTestId('merge-error');
    expect(error.getAttribute('data-code')).toBe('pull_request_not_mergeable');
    expect(within(error).getAllByRole('alert')[0]?.textContent).toBe(message);
    expect(within(error).getByText('Technical details')).toBeTruthy();
  });

  it('says so when the project folder is on the ticket branch and the app left it', async () => {
    renderTicket(ghOpenScenario(false), {
      [`POST ${MERGE_PR_PATH}`]: ok(ghMergedAnswer({ localExists: true, headOnOrigin: false })),
    });
    const c = await card();
    fireEvent.click(await within(c).findByRole('button', { name: 'Merge pull request' }));
    fireEvent.click(within(c).getByRole('button', { name: M.confirmButton.merge }));
    expect((await within(c).findByTestId('merge-kept-local')).textContent).toBe(
      M.keptLocal(GH_BRANCH),
    );
  });
});

describe('Delete branch (G-G)', () => {
  it('is offered once merged while the branch exists; asks first; then says Branch deleted', async () => {
    const s = renderTicket(ghFinishedScenario({ localExists: true, headOnOrigin: true }), {
      [`POST ${BRANCH_DELETE_PATH}`]: ok(
        ghMergedAnswer({ localExists: false, headOnOrigin: false }),
      ),
    });
    const c = await card();
    const button = await within(c).findByRole('button', { name: M.delete });
    fireEvent.click(button);
    const confirm = within(c).getByTestId('delete-confirm');
    expect(within(confirm).getByText(M.deleteQuestion(GH_BRANCH, 'both', null))).toBeTruthy();
    expect(M.deleteQuestion(GH_BRANCH, 'both', null)).toBe(
      `Deletes ${GH_BRANCH} on GitHub and in the project folder. Its commits stay in the ticket’s history here.`,
    );
    expect(document.activeElement).toBe(within(confirm).getByRole('button', { name: M.cancel }));
    expect(posts(s, BRANCH_DELETE_PATH)).toHaveLength(0);
    fireEvent.click(within(confirm).getByRole('button', { name: M.confirmDelete }));
    await waitFor(() => expect(posts(s, BRANCH_DELETE_PATH)).toHaveLength(1));
    expect(posts(s, BRANCH_DELETE_PATH)[0]?.body).toEqual({});
    expect((await within(c).findByTestId('branch-deleted')).textContent).toBe(M.deleted);
    expect(within(c).queryByRole('button', { name: M.delete })).toBeNull();
  });

  it('names where it still is: only on GitHub, or only in the project folder', async () => {
    renderTicket(ghFinishedScenario({ localExists: false, headOnOrigin: true }));
    const c = await card();
    fireEvent.click(await within(c).findByRole('button', { name: M.delete }));
    expect(within(c).getByTestId('delete-confirm').textContent).toContain(
      `Deletes ${GH_BRANCH} on GitHub.`,
    );
  });

  it('gone everywhere: no button, the fact instead; unknown (an older server): neither', async () => {
    const view = renderWithApi(
      <TicketPage id={LOOP_TICKET_ID} />,
      server(ghFinishedScenario({ localExists: false, headOnOrigin: false })),
    );
    const c = await view.findByTestId('ticket-branch');
    expect((await within(c).findByTestId('branch-deleted')).textContent).toBe(M.deleted);
    expect(within(c).queryByRole('button', { name: M.delete })).toBeNull();
    view.unmount();

    const s = server(ghMergedScenario());
    renderWithApi(<TicketPage id={LOOP_TICKET_ID} />, s);
    const old = await screen.findByTestId('ticket-branch');
    await waitFor(() => expect(s.calls.some((call) => call.path === LOOP_BRANCH_PATH)).toBe(true));
    await act(() => new Promise((r) => setTimeout(r, 30)));
    expect(within(old).queryByRole('button', { name: M.delete })).toBeNull();
    expect(within(old).queryByTestId('branch-deleted')).toBeNull();
  });

  it('a refusal says why in the app’s words; Cancel sends nothing', async () => {
    const message =
      'feature/WEB-21-saved-searches is the branch the project folder is on, so the app will not delete it. Switch to another branch first.';
    const s = renderTicket(ghFinishedScenario({ localExists: true, headOnOrigin: false }), {
      [`POST ${BRANCH_DELETE_PATH}`]: refusal(409, 'branch_checked_out', message),
    });
    const c = await card();
    fireEvent.click(await within(c).findByRole('button', { name: M.delete }));
    fireEvent.click(within(c).getByRole('button', { name: M.cancel }));
    expect(posts(s, BRANCH_DELETE_PATH)).toHaveLength(0);
    fireEvent.click(within(c).getByRole('button', { name: M.delete }));
    fireEvent.click(within(c).getByRole('button', { name: M.confirmDelete }));
    const error = await within(c).findByTestId('delete-error');
    expect(within(error).getAllByRole('alert')[0]?.textContent).toBe(message);
    expect(within(c).getByRole('button', { name: M.delete })).toBeTruthy();
  });
});
