import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  L_API,
  L_UI,
  LOOP_BRANCH_PATH,
  LOOP_REVIEW_PATH,
  LOOP_RUN_ID,
  LOOP_RUN_PATH,
  LOOP_TICKET_ID,
  LOOP_TICKET_PATH,
  PROJECT_ID,
  loopDoneScenario,
  loopNeedsYouScenario,
  loopReviewScenario,
  loopWorkingScenario,
  ticketBranchReview,
  type LoopScenario,
} from '../../e2e/review-loop-fixtures';
import { pendingKey, writePending } from '../../src/features/review/pending-review';
import { resetReviewStorageForTests } from '../../src/features/review/storage';
import { viewedKey } from '../../src/features/review/viewed';
import { TicketPage } from '../../src/features/ticket/TicketPage';
import { fakeServer, jsonResponse, renderWithApi, type RouteTable } from '../helpers';

/*
 * v0.3.0 D-A's review UI, the ticket's Files changed tab since C-D, on the review loop's synthetic
 * fixtures: "Changes from" (all changes or one helper's change, in the address), the files and
 * the tree, Viewed, comments on lines as a pending review, and Review changes sending the compiled
 * text through the owner's existing endpoints; merged and closed work read only; and the files of
 * merged work that are no longer available (410).
 */

const COMMENT_PATH = `${LOOP_TICKET_PATH}/comments`;
const TICKET_HASH = `#/p/${PROJECT_ID}/tickets/${LOOP_TICKET_ID}`;
const ok = (body: unknown) => () => jsonResponse(200, body);

function render(sc: LoopScenario, agentRunId: string | null, routes: RouteTable = {}) {
  window.location.hash = `${TICKET_HASH}?tab=files${agentRunId !== null ? `&change=${agentRunId}` : ''}`;
  const s = fakeServer({
    ...sc.routes,
    [LOOP_BRANCH_PATH]: sc.routes[LOOP_BRANCH_PATH] ?? ticketBranchReview(),
    [`POST ${LOOP_REVIEW_PATH}`]: ok(sc.routes[LOOP_REVIEW_PATH]),
    [`POST ${LOOP_BRANCH_PATH}`]: ok(sc.routes[LOOP_BRANCH_PATH] ?? ticketBranchReview()),
    [`POST ${COMMENT_PATH}`]: (body: unknown) =>
      jsonResponse(201, {
        id: 'cm-1',
        ticketId: LOOP_TICKET_ID,
        runId: null,
        planId: null,
        author: 'owner',
        body: (body as { body: string }).body,
        createdAt: '2026-10-22T09:00:00.000Z',
      }),
    ...routes,
  });
  renderWithApi(<TicketPage id={LOOP_TICKET_ID} />, s);
  return s;
}

const posts = (s: ReturnType<typeof render>) => s.calls.filter((c) => c.method === 'POST');
const fileBox = (path: string) => {
  const el = document.querySelector<HTMLElement>(`[data-review-file="${path}"]`);
  if (el === null) throw new Error(`no file ${path}`);
  return el;
};
const head = () => within(screen.getByTestId('files-head'));

async function addComment(path: string, button: string, text: string, shiftFrom?: string) {
  const box = within(fileBox(path));
  if (shiftFrom !== undefined) fireEvent.click(box.getByRole('button', { name: shiftFrom }));
  fireEvent.click(box.getByRole('button', { name: button }), { shiftKey: shiftFrom !== undefined });
  const form = await box.findByTestId('review-comment-form');
  fireEvent.change(within(form).getByRole('textbox'), { target: { value: text } });
  fireEvent.click(within(form).getByRole('button', { name: 'Add to review' }));
  await waitFor(() => expect(box.queryByTestId('review-comment-form')).toBeNull());
}

async function openReview() {
  fireEvent.click(screen.getByTestId('review-changes'));
  return screen.findByRole('dialog', { name: 'Finish your review' });
}

/** Opens "Changes from" and picks an option by its words. */
async function pick(name: RegExp) {
  fireEvent.click(await screen.findByTestId('change-picker'));
  const menu = await screen.findByRole('menu', { name: 'Show changes from' });
  fireEvent.click(within(menu).getByRole('menuitemradio', { name }));
}

/** No way to write or send anything: no "+" on lines, no Review changes. */
function expectReadOnly() {
  expect(screen.queryByTestId('review-changes')).toBeNull();
  expect(screen.queryAllByRole('button', { name: /^Comment on / })).toHaveLength(0);
  expect(document.querySelectorAll('[data-line-button]')).toHaveLength(0);
  expect(screen.getByTestId('files-read-only').textContent).toBe('Read only');
}

beforeEach(() => {
  window.localStorage.clear();
  resetReviewStorageForTests();
});

describe('Changes from', () => {
  it('shows all changes by default, and the address picks one helper’s change', async () => {
    render(loopReviewScenario(), null);
    await screen.findByTestId('review-files');
    const picker = screen.getByTestId('change-picker');
    expect(picker.dataset['value']).toBe('');
    expect(picker.getAttribute('aria-label')).toBe('Changes from: All changes');
    expect(head().getByTestId('files-state').dataset['state']).toBe('open');
    expect(head().getByTestId('files-branch').textContent).toBe('acp/WEB-21intomain');
    expect(screen.getByTestId('review-summary-line').textContent).toContain('2 files changed');
    // One file list and one diff: no summary table, no second viewer.
    expect(screen.queryByTestId('branch-files')).toBeNull();
    expect(screen.queryByTestId('changes-overview')).toBeNull();
    expect(screen.queryByTestId('branch-diff')).toBeNull();
  });

  it('lists every change with its state, and choosing one puts it in the address', async () => {
    render(loopNeedsYouScenario(), null);
    await screen.findByTestId('review-files');
    fireEvent.click(screen.getByTestId('change-picker'));
    const menu = await screen.findByRole('menu', { name: 'Show changes from' });
    const items = within(menu).getAllByRole('menuitemradio');
    expect(items.map((i) => i.textContent)).toEqual([
      expect.stringContaining('All changes'),
      expect.stringContaining('API builder’s change'),
      expect.stringContaining('Search UI’s change'),
    ]);
    expect(items[0]?.getAttribute('aria-checked')).toBe('true');
    expect(within(items[2] as HTMLElement).getByTestId('change-state').dataset['state']).toBe(
      'needs-owner',
    );
    fireEvent.click(items[2] as HTMLElement);
    await waitFor(() =>
      expect(window.location.hash).toBe(`${TICKET_HASH}?tab=files&change=${L_UI}`),
    );
    expect((await screen.findByTestId('files-change')).dataset['agent']).toBe(L_UI);
    expect(screen.getByTestId('change-picker').getAttribute('aria-label')).toBe(
      'Changes from: Search UI’s change',
    );
    await screen.findByTestId('review-files');
    expect(screen.getByTestId('review-summary-line').textContent).toContain('2 files changed');
    // And back to all changes.
    await pick(/All changes/);
    await waitFor(() => expect(window.location.hash).toBe(`${TICKET_HASH}?tab=files`));
    expect(screen.queryByTestId('files-change')).toBeNull();
  });

  it('another tab drops the change from the address', async () => {
    render(loopNeedsYouScenario(), L_UI);
    await screen.findByTestId('review-files');
    fireEvent.click(screen.getByRole('tab', { name: /Checks/ }));
    expect(window.location.hash).toBe(`${TICKET_HASH}?tab=checks`);
  });
});

describe('a helper’s change', () => {
  it('shows the change in context: state, round, checks, commit and Open in Agents', async () => {
    render(loopNeedsYouScenario(), L_UI);
    const change = await screen.findByTestId('files-change');
    expect(within(change).getByTestId('change-state').dataset['state']).toBe('needs-owner');
    expect(change.textContent).toContain('Round 1');
    expect(within(change).getByTestId('change-checks')).toBeTruthy();
    expect(head().getByRole('button', { name: 'Open Search UI in Agents' })).toBeTruthy();
    await screen.findByTestId('review-files');
    expect(screen.getByTestId('review-summary-line').textContent).toContain('2 files changed');
    // Side by side until the owner chooses.
    expect(screen.getByTestId('review-files').dataset['view']).toBe('split');
  });

  it('collects line comments as a pending review and sends them back as rework', async () => {
    const s = render(loopNeedsYouScenario(), L_UI);
    await screen.findByTestId('review-files');
    await addComment(
      'src/search/api.ts',
      'Comment on src/search/api.ts line 3 (after)',
      'Keep 50 as the default.',
    );
    await addComment(
      'src/server/routes.ts',
      'Comment on src/server/routes.ts line 14 (after)',
      'One route per line.',
      'Comment on src/server/routes.ts line 13 (after)',
    );
    expect(screen.getByTestId('review-count').textContent).toBe('2');
    expect(screen.getByTestId('review-changes').getAttribute('aria-label')).toBe(
      'Review changes, 2 pending comments',
    );
    // Kept in this browser.
    expect(
      window.localStorage.getItem(pendingKey({ runId: LOOP_RUN_ID, agentRunId: L_UI })),
    ).toContain('One route per line.');

    const pop = await openReview();
    expect(within(pop).getByRole('radio', { name: 'Request changes' })).toHaveProperty(
      'checked',
      true,
    );
    fireEvent.change(within(pop).getByLabelText('Overall comment'), {
      target: { value: 'Otherwise good.' },
    });
    fireEvent.click(within(pop).getByTestId('review-submit'));
    const sent = await screen.findByTestId('review-sent');
    expect(within(sent).getByRole('link', { name: 'Open Conversation' }).getAttribute('href')).toBe(
      `${TICKET_HASH}?tab=conversation`,
    );
    expect(posts(s).map((c) => [c.path, c.body])).toEqual([
      [
        LOOP_REVIEW_PATH,
        {
          agentRunId: L_UI,
          action: 'rework',
          comment: [
            'Review comments:',
            '- src/search/api.ts:3 (new): Keep 50 as the default.',
            '- src/server/routes.ts:13–14 (new): One route per line.',
            'Otherwise good.',
          ].join('\n'),
        },
      ],
    ]);
    // Cleared after the submit.
    expect(screen.queryByTestId('review-count')).toBeNull();
    expect(
      window.localStorage.getItem(pendingKey({ runId: LOOP_RUN_ID, agentRunId: L_UI })),
    ).toBeNull();
  });

  it('edits and deletes a pending comment', async () => {
    render(loopNeedsYouScenario(), L_UI);
    await screen.findByTestId('review-files');
    await addComment('src/search/api.ts', 'Comment on src/search/api.ts line 1 (after)', 'Typo');
    const box = within(fileBox('src/search/api.ts'));
    fireEvent.click(box.getByRole('button', { name: 'Edit your comment on line 1 (after)' }));
    const edit = box.getByTestId('review-comment-edit');
    fireEvent.change(within(edit).getByRole('textbox'), { target: { value: 'Fixed typo' } });
    fireEvent.click(within(edit).getByRole('button', { name: 'Save' }));
    expect((await box.findByTestId('review-comment')).textContent).toContain('Fixed typo');
    fireEvent.click(box.getByRole('button', { name: 'Delete your comment on line 1 (after)' }));
    await waitFor(() => expect(box.queryByTestId('review-comment')).toBeNull());
    expect(screen.queryByTestId('review-count')).toBeNull();
  });

  it('says when the review is over the rework limit and waits, without cutting it', async () => {
    writePending(
      { runId: LOOP_RUN_ID, agentRunId: L_UI },
      {
        comments: [
          {
            id: 'long',
            path: 'src/search/api.ts',
            side: 'new',
            line: 3,
            endLine: 3,
            body: 'x'.repeat(4100),
            commit: null,
            createdAt: '2026-10-22T09:00:00.000Z',
          },
        ],
        summary: '',
      },
    );
    const s = render(loopNeedsYouScenario(), L_UI);
    await screen.findByTestId('review-files');
    const pop = await openReview();
    expect(within(pop).getByTestId('review-too-long').textContent).toMatch(
      /Request changes takes at most 4,000\. .*Nothing is cut for you\./,
    );
    expect(within(pop).getByTestId('review-submit')).toHaveProperty('disabled', true);
    // Comment allows 8,000: it fits there.
    fireEvent.click(within(pop).getByRole('radio', { name: 'Comment' }));
    expect(within(pop).getByTestId('review-length').textContent).toContain('of 8,000 characters');
    expect(within(pop).getByTestId('review-submit')).toHaveProperty('disabled', false);
    expect(posts(s)).toEqual([]);
  });

  it('disables Request changes with the reason while the lead decides', async () => {
    render(loopWorkingScenario(), L_UI);
    await screen.findByTestId('review-files');
    const pop = await openReview();
    expect(within(pop).getByRole('radio', { name: 'Request changes' })).toHaveProperty(
      'disabled',
      true,
    );
    expect(within(pop).getByTestId('review-choice-rework').textContent).toContain(
      'The lead decides this change now.',
    );
    expect(within(pop).getByRole('radio', { name: 'Comment' })).toHaveProperty('checked', true);
    expect(within(pop).getByTestId('review-empty').textContent).toBe(
      'Add a comment on a line or an overall comment first.',
    );
    expect(within(pop).getByTestId('review-submit')).toHaveProperty('disabled', true);
  });

  it('marks a file viewed, collapsing it, kept per change and commit', async () => {
    render(loopNeedsYouScenario(), L_UI);
    await screen.findByTestId('review-files');
    const box = within(fileBox('src/server/routes.ts'));
    fireEvent.click(box.getByRole('checkbox', { name: 'Mark src/server/routes.ts as viewed' }));
    await waitFor(() => expect(box.getByTestId('diff-file').dataset['open']).toBe('false'));
    expect(screen.getByTestId('review-viewed-count').textContent).toBe('1 of 2 viewed');
    const key = viewedKey(
      { runId: LOOP_RUN_ID, agentRunId: L_UI },
      'd9e8f7a6b5c4d3e2f1a0b9c8d7e6f5a4b3c2d1e0',
    );
    expect(window.localStorage.getItem(key)).toBe('["src/server/routes.ts"]');
    // Its header still opens it.
    fireEvent.click(box.getByTestId('diff-file-toggle'));
    expect(box.getByTestId('diff-file').dataset['open']).toBe('true');
  });

  it('filters the file tree and jumps to a file', async () => {
    render(loopNeedsYouScenario(), L_UI);
    await screen.findByTestId('review-files');
    // jsdom is narrow: the tree starts hidden behind its toggle.
    fireEvent.click(screen.getByRole('button', { name: 'Show file tree' }));
    const tree = within(screen.getByTestId('review-tree'));
    expect(tree.getAllByTestId('review-tree-file')).toHaveLength(2);
    fireEvent.change(tree.getByRole('searchbox', { name: 'Filter files' }), {
      target: { value: 'ROUTES' },
    });
    expect(tree.getAllByTestId('review-tree-file').map((b) => b.dataset['path'])).toEqual([
      'src/server/routes.ts',
    ]);
    expect(tree.getByRole('status').textContent).toBe('1 of 2 files');
    fireEvent.click(tree.getByTestId('review-tree-file'));
    expect(document.activeElement).toBe(
      within(fileBox('src/server/routes.ts')).getByTestId('diff-file-toggle'),
    );
    fireEvent.change(tree.getByRole('searchbox', { name: 'Filter files' }), {
      target: { value: 'nothing' },
    });
    expect(tree.getByRole('status').textContent).toBe('No changed file matches.');
  });

  it('opens a fold that holds a commented line, and lists comments off the diff', async () => {
    const ctx = (from: number, n: number) =>
      Array.from({ length: n }, (_, i) => ` export const LIMIT_${from + i} = ${from + i};`);
    const diff = [
      'diff --git a/src/limits.ts b/src/limits.ts',
      '--- a/src/limits.ts',
      '+++ b/src/limits.ts',
      '@@ -1,21 +1,21 @@',
      ...ctx(1, 10),
      '-export const MAX = 50;',
      '+export const MAX = 100;',
      ...ctx(12, 10),
      '',
    ].join('\n');
    const sc = loopNeedsYouScenario();
    const review = structuredClone(sc.routes[LOOP_REVIEW_PATH]) as {
      agents: Record<string, unknown>[];
    };
    review.agents = review.agents.map((a) =>
      a['agentRunId'] === L_UI
        ? {
            ...a,
            diff,
            files: [{ path: 'src/limits.ts', status: 'modified', additions: 1, deletions: 1 }],
          }
        : a,
    );
    const at = (id: string, line: number, path = 'src/limits.ts') => ({
      id,
      path,
      side: 'new' as const,
      line,
      endLine: line,
      body: `note ${id}`,
      commit: null,
      createdAt: '2026-10-22T09:00:00.000Z',
    });
    writePending(
      { runId: LOOP_RUN_ID, agentRunId: L_UI },
      {
        comments: [at('folded', 2), at('gone', 90), at('elsewhere', 1, 'src/old.ts')],
        summary: '',
      },
    );
    render(sc, L_UI, { [LOOP_REVIEW_PATH]: review });
    await screen.findByTestId('review-files');
    const box = within(fileBox('src/limits.ts'));
    // Line 2 sits in the fold before the change; its comment keeps it open.
    expect(box.getByTestId('review-comment').textContent).toContain('note folded');
    expect(box.getAllByTestId('diff-expand')).toHaveLength(1);
    const off = within(screen.getByTestId('review-off-diff'));
    expect(off.getAllByTestId('review-comment').map((c) => c.dataset['ref'])).toEqual([
      'src/limits.ts:90 (new)',
      'src/old.ts:1 (new)',
    ]);
  });

  it('says so when the run has no such change, with a way back to all changes', async () => {
    render(loopNeedsYouScenario(), 'ag-nobody');
    const empty = await screen.findByTestId('files-no-change');
    expect(empty.textContent).toContain('Change not found');
    fireEvent.click(within(empty).getByRole('button', { name: 'Show all changes' }));
    await waitFor(() => expect(window.location.hash).toBe(`${TICKET_HASH}?tab=files`));
    expect(await screen.findByTestId('review-files')).toBeTruthy();
  });

  it('says so when the server no longer lists the change’s lines', async () => {
    const sc = loopNeedsYouScenario();
    render(sc, L_API, { [LOOP_REVIEW_PATH]: { runId: LOOP_RUN_ID, agents: [] } });
    const note = await screen.findByTestId('review-unavailable');
    expect(note.textContent).toContain('no longer available');
    expect(within(note).getByRole('button', { name: 'Show all changes' })).toBeTruthy();
  });
});

describe('all changes (the ticket branch)', () => {
  it('sends Request changes to the lead at the final step', async () => {
    const s = render(loopReviewScenario(), null);
    await screen.findByTestId('review-files');
    expect(head().getByTestId('files-commit').textContent).toBe('Tipa1b2c3d');
    expect(head().getByTestId('change-checks')).toBeTruthy();
    await addComment(
      'src/search/api.ts',
      'Comment on src/search/api.ts line 6 (after)',
      'Use the shared limit.',
    );
    const pop = await openReview();
    expect(within(pop).getByRole('radio', { name: 'Request changes' })).toHaveProperty(
      'checked',
      true,
    );
    expect(within(pop).getByTestId('review-length').textContent).toContain('of 8,000');
    fireEvent.click(within(pop).getByTestId('review-submit'));
    expect((await screen.findByTestId('review-sent')).textContent).toContain('Sent to the lead.');
    expect(posts(s).map((c) => [c.path, c.body])).toEqual([
      [
        LOOP_BRANCH_PATH,
        {
          action: 'request-changes',
          comment: 'Review comments:\n- src/search/api.ts:6 (new): Use the shared limit.',
        },
      ],
    ]);
  });

  it('posts Comment as the owner’s review (Conversation) while the agents work', async () => {
    const s = render(loopWorkingScenario(), null);
    await screen.findByTestId('review-files');
    const pop = await openReview();
    expect(within(pop).getByTestId('review-choice-request-changes').textContent).toContain(
      'The agents are still working.',
    );
    fireEvent.change(within(pop).getByLabelText('Overall comment'), {
      target: { value: 'Looks right so far.' },
    });
    fireEvent.click(within(pop).getByTestId('review-submit'));
    await screen.findByTestId('review-sent');
    expect(posts(s).map((c) => [c.path, c.body])).toEqual([
      [COMMENT_PATH, { body: 'Looks right so far.', kind: 'review' }],
    ]);
  });

  it('shows the server’s refusal and keeps the pending review', async () => {
    render(loopReviewScenario(), null, {
      [`POST ${LOOP_BRANCH_PATH}`]: () =>
        jsonResponse(409, {
          error: { code: 'run_not_in_review', message: 'The run moved on.', requestId: 'r' },
        }),
    });
    await screen.findByTestId('review-files');
    const pop = await openReview();
    fireEvent.change(within(pop).getByLabelText('Overall comment'), {
      target: { value: 'Please rename it.' },
    });
    fireEvent.click(within(pop).getByTestId('review-submit'));
    const [alert] = await within(pop).findAllByRole('alert');
    expect(alert?.textContent).toContain('Your review wasn’t sent. The run moved on.');
    expect(
      window.localStorage.getItem(pendingKey({ runId: LOOP_RUN_ID, agentRunId: null })),
    ).toContain('Please rename it.');
  });
});

/** The done scenario (merged into main), with the merged branch's files from its commits. */
function merged(routes: RouteTable = {}) {
  const sc = loopDoneScenario();
  const run = (sc.routes[LOOP_TICKET_PATH] as { currentRun: { ticketBranch: unknown } }).currentRun;
  return render(sc, null, {
    [LOOP_BRANCH_PATH]: { ...ticketBranchReview(), ticketBranch: run.ticketBranch },
    ...routes,
  });
}

describe('merged or closed work: the same layout, read only', () => {
  it('merged: the purple Merged label, the target and merge commit, files and Viewed only', async () => {
    merged();
    await screen.findByTestId('review-files');
    const label = head().getByTestId('files-state');
    expect(label.dataset['state']).toBe('merged');
    expect(label.textContent).toBe('Merged');
    expect(label.className).toContain('bg-done');
    expect(head().getByTestId('files-branch').textContent).toBe('acp/WEB-21merged intomain');
    expect(head().getByTestId('files-commit').textContent).toBe('Merge commite1f2a3b');
    expect(screen.getByTestId('review-summary-line').textContent).toContain('2 files changed');
    expectReadOnly();
    // Viewed still works, in this browser only.
    const box = within(fileBox('src/search/api.ts'));
    fireEvent.click(box.getByRole('checkbox', { name: 'Mark src/search/api.ts as viewed' }));
    expect(screen.getByTestId('review-viewed-count').textContent).toBe('1 of 2 viewed');
  });

  it('merged: a pending review kept from before is neither shown nor sendable', async () => {
    writePending(
      { runId: LOOP_RUN_ID, agentRunId: null },
      {
        comments: [
          {
            id: 'old',
            path: 'src/search/api.ts',
            side: 'new',
            line: 6,
            endLine: 6,
            body: 'Left before the merge.',
            commit: null,
            createdAt: '2026-10-22T09:00:00.000Z',
          },
        ],
        summary: '',
      },
    );
    merged();
    await screen.findByTestId('review-files');
    expect(screen.queryByText('Left before the merge.')).toBeNull();
    expectReadOnly();
  });

  it('merged: a helper’s change is read only too', async () => {
    const sc = loopDoneScenario();
    render(sc, L_API);
    await screen.findByTestId('files-change');
    expect(head().getByTestId('files-state').dataset['state']).toBe('merged');
    await screen.findByTestId('review-files');
    expectReadOnly();
  });

  it('merged files no longer available (410): a clear empty state in the same frame', async () => {
    merged({
      [LOOP_BRANCH_PATH]: () =>
        jsonResponse(410, {
          error: {
            code: 'diff_unavailable',
            message: 'This branch’s commits are no longer in the repository',
            requestId: 'r',
          },
        }),
    });
    const empty = await screen.findByTestId('files-unavailable');
    expect(empty.textContent).toContain('Files no longer available');
    // The frame stays: the picker and the Merged label.
    expect(head().getByTestId('change-picker')).toBeTruthy();
    expect(head().getByTestId('files-state').dataset['state']).toBe('merged');
    expect(screen.queryByTestId('review-files')).toBeNull();
    expect(screen.queryByTestId('review-changes')).toBeNull();
  });

  it('discarded: the Closed label, read only', async () => {
    const sc = loopReviewScenario();
    const detail = sc.routes[LOOP_TICKET_PATH] as Record<string, unknown>;
    const run = detail['currentRun'] as Record<string, unknown>;
    const branch = { ...(run['ticketBranch'] as object), state: 'discarded' };
    const closed = { ...run, status: 'COMPLETED', ticketBranch: branch };
    render(
      { routes: { ...sc.routes, [LOOP_TICKET_PATH]: { ...detail, currentRun: closed } } },
      null,
      {
        [LOOP_RUN_PATH]: closed,
        [LOOP_BRANCH_PATH]: { ...ticketBranchReview(), ticketBranch: branch },
      },
    );
    await screen.findByTestId('review-files');
    expect(head().getByTestId('files-state').textContent).toBe('Closed');
    expect(head().getByTestId('files-branch').textContent).toBe('acp/WEB-21was discarded');
    expectReadOnly();
  });
});
