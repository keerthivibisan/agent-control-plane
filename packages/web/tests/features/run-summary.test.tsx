// The app's own comments on a ticket (ADR-0024 §3, v0.3.0 S-B): the run summary card and the line
// after a merge, next to the owner's, the lead's and the reviewer's comments, which are unchanged.
// Synthetic data only.
import { screen, within } from '@testing-library/react';
import { TicketDetailDtoSchema, type TicketCommentDto } from '@acp/core/api';
import { describe, expect, it } from 'vitest';
import { TicketInfo } from '../../src/features/ticket/TicketInfo';
import { ticketDetail, ticketDto } from '../fixtures/board';
import { runSummary } from '../fixtures/control';
import { fakeServer, renderWithApi } from '../helpers';

const SUMMARY = [
  'Run summary',
  '',
  'What the lead says:',
  'The login form now checks the email.',
  'Nothing else changed.',
  '',
  'Changes:',
  '- Frontend helper: 3 files, +40 −2; checks passed; merged',
  '- API helper: no changes',
  '',
  'Something the web does not know yet',
].join('\n');

function comment(over: Partial<TicketCommentDto> & { id: string }): TicketCommentDto {
  return {
    ticketId: 't-1',
    runId: 'run-2',
    planId: null,
    author: 'owner',
    body: 'A comment',
    createdAt: '2026-10-21T09:00:00.000Z',
    ...over,
  };
}

function renderComments(comments: TicketCommentDto[]) {
  const base = ticketDetail(ticketDto({ id: 't-1', key: 'WEB-12' }));
  const detail = TicketDetailDtoSchema.parse({
    ...base,
    runs: [
      runSummary({ id: 'run-2', ticketId: 't-1' }),
      runSummary({ id: 'run-1', ticketId: 't-1' }),
    ],
    comments,
  });
  renderWithApi(
    <TicketInfo detail={detail} shownRunId="run-2" onShowRun={() => {}} />,
    fakeServer({}),
  );
  return screen.getByTestId('comments');
}

const byAuthor = (list: HTMLElement, author: string) =>
  [...list.querySelectorAll(`li[data-author="${author}"]`)] as HTMLElement[];

describe('ticket comments by the app', () => {
  it('shows a run summary as its own card, with headings, lists and the rest as written', () => {
    const list = renderComments([comment({ id: 'c-app', author: 'app', body: SUMMARY })]);
    const card = within(list).getByTestId('run-summary');
    expect(card.getAttribute('aria-label')).toBe('Run summary, Run 2');
    expect(within(card).getByRole('heading', { name: 'Run summary', level: 4 })).toBeTruthy();
    expect(within(card).getByTestId('comment-author').textContent).toBe('Agent Control Plane');
    expect(within(card).getByText('Run 2')).toBeTruthy();
    const headings = within(card)
      .getAllByRole('heading', { level: 5 })
      .map((h) => h.textContent);
    expect(headings).toEqual(['What the lead says', 'Changes']);
    const items = within(card)
      .getAllByRole('listitem')
      .map((li) => li.textContent);
    expect(items).toEqual([
      'Frontend helper: 3 files, +40 −2; checks passed; merged',
      'API helper: no changes',
    ]);
    // Line breaks kept inside a paragraph; unknown text shown as is.
    const body = within(card).getByTestId('run-summary-body');
    const paragraphs = [...body.querySelectorAll('p')].map((p) => p.textContent);
    expect(paragraphs).toEqual([
      'The login form now checks the email.\nNothing else changed.',
      'Something the web does not know yet',
    ]);
    expect(body.querySelector('p')?.className).toContain('whitespace-pre-wrap');
    // The title line is the card's heading, not repeated in the body.
    expect(body.textContent).not.toContain('Run summary');
  });

  it('shows the merge note as a small line, not a card', () => {
    const list = renderComments([
      comment({ id: 'c-merge', author: 'app', body: 'Merged acp/WEB-12 into main at 1a2b3c4' }),
    ]);
    expect(within(list).queryByTestId('run-summary')).toBeNull();
    const line = within(list).getByTestId('merge-line');
    expect(line.textContent).toContain('Merged acp/WEB-12 into main at 1a2b3c4');
    expect([...line.querySelectorAll('code')].map((c) => c.textContent)).toEqual([
      'acp/WEB-12',
      'main',
      '1a2b3c4',
    ]);
    // Screen readers hear who wrote it.
    expect(line.textContent).toContain('Agent Control Plane');
  });

  it('shows the tip checks after the commit in the merge note', () => {
    const list = renderComments([
      comment({
        id: 'c-merge',
        author: 'app',
        body: 'Merged acp/WEB-12 into main at 1a2b3c4; checks passed on the tip (2).',
      }),
    ]);
    const line = within(list).getByTestId('merge-line');
    expect([...line.querySelectorAll('code')].map((c) => c.textContent)).toEqual([
      'acp/WEB-12',
      'main',
      '1a2b3c4',
    ]);
    expect(within(line).getByTestId('merge-detail').textContent).toBe(
      '; checks passed on the tip (2)',
    );
    expect(line.textContent).toContain('1a2b3c4; checks passed on the tip (2)');
  });

  it('shows a summary without a run, and a summary of plain text, as a card too', () => {
    const list = renderComments([
      comment({ id: 'c-1', author: 'app', runId: null, body: 'Stopped before the handover.' }),
    ]);
    const card = within(list).getByTestId('run-summary');
    expect(card.getAttribute('aria-label')).toBe('Run summary');
    expect(within(card).getByText('Stopped before the handover.')).toBeTruthy();
  });

  it('leaves the owner’s, the lead’s and the reviewer’s comments as they were', () => {
    const list = renderComments([
      comment({
        id: 'c-o',
        author: 'owner',
        body: 'Please add tests',
        createdAt: '2026-10-21T08:00:00.000Z',
      }),
      comment({
        id: 'c-l',
        author: 'lead',
        body: 'Will do',
        createdAt: '2026-10-21T08:01:00.000Z',
      }),
      comment({
        id: 'c-r',
        author: 'reviewer',
        body: 'Two findings',
        createdAt: '2026-10-21T08:02:00.000Z',
      }),
      comment({ id: 'c-a', author: 'app', body: SUMMARY, createdAt: '2026-10-21T08:03:00.000Z' }),
    ]);
    const label = (author: string) =>
      within(byAuthor(list, author)[0] as HTMLElement).getByTestId('comment-author').textContent;
    expect(label('owner')).toBe('You');
    expect(label('lead')).toBe('Lead agent');
    expect(label('reviewer')).toBe('Reviewer');
    expect(label('app')).toBe('Agent Control Plane');
    for (const author of ['owner', 'lead', 'reviewer']) {
      const li = byAuthor(list, author)[0] as HTMLElement;
      expect(within(li).queryByTestId('run-summary')).toBeNull();
    }
    // Oldest first, the summary last.
    expect(
      [...list.querySelectorAll('li[data-author]')].map((li) => li.getAttribute('data-author')),
    ).toEqual(['owner', 'lead', 'reviewer', 'app']);
  });
});
