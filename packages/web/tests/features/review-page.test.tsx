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
  loopNeedsYouScenario,
  loopReviewScenario,
  loopWorkingScenario,
  ticketBranchReview,
  type LoopScenario,
} from '../../e2e/review-loop-fixtures';
import { pendingKey, writePending } from '../../src/features/review/pending-review';
import { ReviewPage } from '../../src/features/review/ReviewPage';
import { resetReviewStorageForTests } from '../../src/features/review/storage';
import { viewedKey } from '../../src/features/review/viewed';
import { fakeServer, jsonResponse, renderWithApi, type RouteTable } from '../helpers';

/*
 * v0.3.0 D-A: the review page on the review loop's synthetic fixtures: the context, the files and
 * the tree, Viewed, comments on lines as a pending review, and Review changes sending the compiled
 * text through the owner's existing endpoints, with the choices each state allows.
 */

const COMMENT_PATH = `${LOOP_TICKET_PATH}/comments`;
const ok = (body: unknown) => () => jsonResponse(200, body);

function render(sc: LoopScenario, agentRunId: string | null, routes: RouteTable = {}) {
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
  renderWithApi(
    <ReviewPage
      projectId={PROJECT_ID}
      ticketId={LOOP_TICKET_ID}
      agentRunId={agentRunId}
      runId={null}
    />,
    s,
  );
  return s;
}

const posts = (s: ReturnType<typeof render>) => s.calls.filter((c) => c.method === 'POST');
const fileBox = (path: string) => {
  const el = document.querySelector<HTMLElement>(`[data-review-file="${path}"]`);
  if (el === null) throw new Error(`no file ${path}`);
  return el;
};

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

beforeEach(() => {
  window.localStorage.clear();
  resetReviewStorageForTests();
});

describe('a helper’s change', () => {
  it('shows the change in context: helper, state, round, checks, and the link back', async () => {
    render(loopNeedsYouScenario(), L_UI);
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Files changed by Search UI' }),
    ).toBeTruthy();
    const context = screen.getByTestId('review-context');
    expect(within(context).getByTestId('change-state').dataset['state']).toBe('needs-owner');
    expect(context.textContent).toContain('Round 1');
    expect(within(context).getByTestId('change-checks')).toBeTruthy();
    expect(screen.getByTestId('review-back').getAttribute('href')).toBe(
      `#/p/${PROJECT_ID}/tickets/${LOOP_TICKET_ID}`,
    );
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
    await screen.findByTestId('review-sent');
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

  it('says so when the run has no such change', async () => {
    render(loopNeedsYouScenario(), 'ag-nobody');
    expect(await screen.findByText('Change not found')).toBeTruthy();
  });

  it('says so when the server no longer lists the change’s lines', async () => {
    const sc = loopNeedsYouScenario();
    render(sc, L_API, { [LOOP_REVIEW_PATH]: { runId: LOOP_RUN_ID, agents: [] } });
    expect((await screen.findByTestId('review-unavailable')).textContent).toContain(
      'no longer available',
    );
  });
});

describe('the ticket branch', () => {
  it('sends Request changes to the lead at the final step', async () => {
    const s = render(loopReviewScenario(), null);
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Files changed on the ticket branch' }),
    ).toBeTruthy();
    await screen.findByTestId('review-files');
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

  it('posts Comment as an owner ticket comment while the agents work', async () => {
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
      [COMMENT_PATH, { body: 'Looks right so far.' }],
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

  it('says there is nothing to review once the branch is merged', async () => {
    const sc = loopReviewScenario();
    const detail = sc.routes[LOOP_TICKET_PATH] as Record<string, unknown>;
    const run = detail['currentRun'] as Record<string, unknown>;
    const merged = {
      ...run,
      status: 'COMPLETED',
      ticketBranch: { ...(run['ticketBranch'] as object), state: 'merged' },
    };
    render(
      { routes: { ...sc.routes, [LOOP_TICKET_PATH]: { ...detail, currentRun: merged } } },
      null,
      { [LOOP_RUN_PATH]: merged },
    );
    expect((await screen.findByTestId('review-unavailable')).textContent).toBe(
      'This branch is merged into main, so there is nothing left to review here.',
    );
  });
});
