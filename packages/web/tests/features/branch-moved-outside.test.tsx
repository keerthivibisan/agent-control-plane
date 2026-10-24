import { fireEvent, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { MovedOutsideBanner } from '../../src/features/review-loop/MovedOutsideBanner';
import { ticketBranchResetPath } from '../../src/lib/api';
import { BRANCH_GUARD_COPY } from '../../src/lib/copy';
import { fakeServer, jsonResponse, renderWithApi } from '../helpers';

/*
 * F-1: the final step warns when the ticket branch was changed outside the app and offers the
 * owner's "Reset to the last reviewed commit" (CSRF, compare-and-swap from the tip shown). Synthetic
 * data; the routes are fakes.
 */

const C = BRANCH_GUARD_COPY;
const RUN = 'run-1';
const REVIEWED = 'da31ba6aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const NOW = '8a06973bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const BRANCH = {
  branch: 'feature/ACPGIT-3-branding',
  headCommit: REVIEWED,
  state: 'open' as const,
  movedOutside: { tip: NOW },
};

function server(answer: () => Response) {
  return fakeServer({
    '/api/control/token': { token: 'csrf-token-0123456789abcdef0123456789' },
    [`POST ${ticketBranchResetPath(RUN)}`]: answer,
  });
}

const okAnswer = () => jsonResponse(200, {});

describe('MovedOutsideBanner (F-1)', () => {
  it('says where the branch is now and what was last reviewed', () => {
    renderWithApi(<MovedOutsideBanner runId={RUN} branch={BRANCH} />, server(okAnswer));
    expect(screen.getByTestId('branch-moved-outside').textContent).toContain(
      'feature/ACPGIT-3-branding was changed outside the app (now 8a06973, last reviewed da31ba6)',
    );
    expect(screen.getByRole('button', { name: C.reset })).toHaveProperty('disabled', false);
  });

  it('shows nothing when the branch is where the app left it, or is closed', () => {
    const { container } = renderWithApi(
      <MovedOutsideBanner runId={RUN} branch={{ ...BRANCH, movedOutside: undefined }} />,
      server(okAnswer),
    );
    expect(container.innerHTML).toBe('');
    renderWithApi(
      <MovedOutsideBanner runId={RUN} branch={{ ...BRANCH, state: 'merged' }} />,
      server(okAnswer),
    );
    expect(screen.queryByTestId('branch-moved-outside')).toBeNull();
  });

  it('asks first, then resets from the tip shown, with the CSRF token', async () => {
    const s = server(okAnswer);
    renderWithApi(<MovedOutsideBanner runId={RUN} branch={BRANCH} />, s);
    fireEvent.click(screen.getByRole('button', { name: C.reset }));
    expect(screen.getByText(C.confirmReset(BRANCH.branch, 'da31ba6'))).toBeTruthy();
    expect(s.calls.some((c) => c.method === 'POST')).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: C.confirmResetButton }));
    await waitFor(() => expect(s.calls.some((c) => c.method === 'POST')).toBe(true));
    const post = s.calls.find((c) => c.method === 'POST');
    expect(post?.path).toBe(ticketBranchResetPath(RUN));
    expect(post?.body).toEqual({ from: NOW });
  });

  it('shows the refusal in plain words', async () => {
    const s = server(() =>
      jsonResponse(409, {
        error: {
          code: 'ticket_branch_checked_out',
          message: 'feature/ACPGIT-3-branding is checked out in a worktree, so it is not moved.',
          requestId: 'r-1',
        },
      }),
    );
    renderWithApi(<MovedOutsideBanner runId={RUN} branch={BRANCH} />, s);
    fireEvent.click(screen.getByRole('button', { name: C.reset }));
    fireEvent.click(screen.getByRole('button', { name: C.confirmResetButton }));
    const alert = await screen.findByText(/The branch was not reset/);
    expect(alert.textContent).toContain('is checked out in a worktree');
  });
});
