import {
  ProjectWorkflowDtoSchema,
  ReviewDtoSchema,
  RunDetailDtoSchema,
  RunWorkflowDtoSchema,
  TicketBranchReviewDtoSchema,
  TicketDetailDtoSchema,
} from '@acp/core/api';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  CSRF,
  L_API,
  L_LEAD,
  L_UI,
  LOOP_BRANCH,
  LOOP_BRANCH_PATH,
  LOOP_PROJECT_WORKFLOW_PATH,
  LOOP_REVIEW_PATH,
  LOOP_RUN_ID,
  LOOP_RUN_PATH,
  LOOP_RUN_WORKFLOW_PATH,
  LOOP_TICKET_ID,
  LOOP_TICKET_PATH,
  loopDoneScenario,
  loopNeedsYouScenario,
  loopReviewScenario,
  loopWorkingScenario,
  type LoopScenario,
} from '../../e2e/review-loop-fixtures';
import { inReviewScenario, TICKET_ID } from '../../e2e/ticket-fixtures';
import { roundSentence } from '../../src/features/review-loop/ChangeCard';
import {
  isReviewLoopRun,
  ownerMayDecide,
  ticketBranchMode,
} from '../../src/features/review-loop/logic';
import { liveGraph } from '../../src/features/ticket/LiveWorkflow';
import { TicketPage } from '../../src/features/ticket/TicketPage';
import { activityText } from '../../src/lib/activity';
import type { FetchLike } from '../../src/lib/api';
import { changeStateWord, REVIEW_LOOP_COPY } from '../../src/lib/copy';
import { fakeServer, jsonResponse, renderWithApi, type RouteTable } from '../helpers';

/*
 * RL-D (ADR-0021): the ticket page of a review-loop run: change cards per state, the owner's
 * override, the ticket-branch card and its actions, the Start dialog, the live graph's additions,
 * and legacy runs unchanged. Fixtures are synthetic (e2e/review-loop-fixtures.ts).
 */

beforeAll(() => {
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

const ok = (body: unknown) => () => jsonResponse(200, body);

function server(sc: LoopScenario, routes: RouteTable = {}) {
  const detail = sc.routes[LOOP_TICKET_PATH];
  const base = fakeServer({
    ...sc.routes,
    [`POST ${LOOP_REVIEW_PATH}`]: ok(sc.routes[LOOP_REVIEW_PATH]),
    [`POST ${LOOP_BRANCH_PATH}`]: ok(sc.routes[LOOP_RUN_PATH]),
    [`POST ${LOOP_TICKET_PATH}/start`]: ok(detail),
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
const mutations = (s: Server) => s.calls.filter((c) => c.method !== 'GET');

function render(sc: LoopScenario, routes: RouteTable = {}) {
  const s = server(sc, routes);
  renderWithApi(<TicketPage id={LOOP_TICKET_ID} />, s);
  return s;
}

/** A scenario whose run detail is changed by `edit` (in the ticket and the run route). */
function withRun(
  sc: LoopScenario,
  edit: (run: Record<string, unknown>) => Record<string, unknown>,
) {
  const detail = sc.routes[LOOP_TICKET_PATH] as Record<string, unknown>;
  const run = edit(detail['currentRun'] as Record<string, unknown>);
  return {
    routes: {
      ...sc.routes,
      [LOOP_TICKET_PATH]: { ...detail, currentRun: run },
      [LOOP_RUN_PATH]: run,
    },
  };
}

const panel = () => screen.getByTestId('side-panel');
async function openChange(role: string) {
  const overview = await screen.findByTestId('changes-overview');
  const row = within(overview)
    .getAllByTestId('change-row')
    .find((r) => r.textContent?.includes(role));
  if (!row) throw new Error(`no change row ${role}`);
  fireEvent.click(within(row).getByRole('button', { name: 'Open' }));
  return within(panel()).findByTestId('change-card');
}

describe('review-loop fixtures', () => {
  it('match the API contract', () => {
    for (const sc of [
      loopWorkingScenario(),
      loopNeedsYouScenario(),
      loopReviewScenario(),
      loopReviewScenario({ failing: true, baseMoved: true }),
      loopDoneScenario(),
    ]) {
      expect(() => TicketDetailDtoSchema.parse(sc.routes[LOOP_TICKET_PATH])).not.toThrow();
      expect(() => RunDetailDtoSchema.parse(sc.routes[LOOP_RUN_PATH])).not.toThrow();
      expect(() => RunWorkflowDtoSchema.parse(sc.routes[LOOP_RUN_WORKFLOW_PATH])).not.toThrow();
      expect(() => ReviewDtoSchema.parse(sc.routes[LOOP_REVIEW_PATH])).not.toThrow();
      expect(() =>
        ProjectWorkflowDtoSchema.parse(sc.routes[LOOP_PROJECT_WORKFLOW_PATH]),
      ).not.toThrow();
      const branch = sc.routes[LOOP_BRANCH_PATH];
      if (branch !== undefined)
        expect(() => TicketBranchReviewDtoSchema.parse(branch)).not.toThrow();
    }
  });
});

describe('words and rules', () => {
  it('names every change state', () => {
    const o = { round: 1, max: 2, branch: LOOP_BRANCH };
    expect(
      (
        [
          'sealing',
          'ready',
          'reviewing',
          'decision',
          'rework',
          'needs-owner',
          'merged',
          'discarded',
          'no-changes',
        ] as const
      ).map((s) => changeStateWord(s, o)),
    ).toEqual([
      'Ready',
      'Ready',
      'In review',
      'Needs lead decision',
      'Rework round 1 of 2',
      'Needs you',
      'Merged into acp/WEB-21',
      'Discarded',
      'No changes',
    ]);
  });

  it('words control tools in "Latest" and leaves everything else as sent', () => {
    expect(activityText('Used tool: mcp__acp__agent_status')).toBe("Checked a helper's status");
    expect(activityText('mcp__acp__merge_change')).toBe("Merged a helper's change");
    expect(activityText('Used tool: request_rework')).toBe('Asked a helper to rework its change');
    expect(activityText('Used tool: Edit')).toBe('Used tool: Edit');
    expect(activityText('Used tool: mcp__other__thing')).toBe('Used tool: mcp__other__thing');
    expect(activityText('Merged API builder into acp/WEB-21')).toBe(
      'Merged API builder into acp/WEB-21',
    );
    expect(activityText('agent_status')).toBe('agent_status');
  });

  it('describes a round in words', () => {
    const base = {
      id: 'r',
      round: 0,
      reviewerAgentRunId: null,
      commentId: null,
      createdAt: '2026-10-17T09:00:00.000Z',
      decidedAt: null,
    };
    expect(
      roundSentence({ ...base, reviewer: 'agent', verdict: null, decision: null, decidedBy: null }),
    ).toBe('Review agent reviewing…');
    expect(
      roundSentence({
        ...base,
        reviewer: 'agent',
        verdict: 'rework',
        decision: 'rework',
        decidedBy: 'lead',
      }),
    ).toBe('Review agent asked for rework · Lead sent it back for rework');
    expect(
      roundSentence({
        ...base,
        reviewer: 'lead',
        verdict: null,
        decision: 'merge',
        decidedBy: 'lead',
      }),
    ).toBe('Lead merged it');
  });

  it('a run without changes or a ticket branch is a legacy run', () => {
    expect(isReviewLoopRun({})).toBe(false);
    expect(isReviewLoopRun({ ticketBranch: null })).toBe(true);
    expect(isReviewLoopRun({ changes: [] })).toBe(true);
  });

  it('the owner decides only needs-owner changes, or undecided ones once the lead ended', () => {
    const live = { agents: [{ kind: 'lead', status: 'RUNNING' }] } as never;
    const ended = { agents: [{ kind: 'lead', status: 'SUCCEEDED' }] } as never;
    expect(ownerMayDecide({ state: 'needs-owner' }, live)).toBe(true);
    expect(ownerMayDecide({ state: 'decision' }, live)).toBe(false);
    expect(ownerMayDecide({ state: 'decision' }, ended)).toBe(true);
    expect(ownerMayDecide({ state: 'rework' }, ended)).toBe(true);
    expect(ownerMayDecide({ state: 'merged' }, ended)).toBe(false);
    expect(ownerMayDecide({ state: 'sealing' }, ended)).toBe(false);
  });

  it('the ticket branch: merge at review, discard only once stopped, closed once decided', () => {
    expect(ticketBranchMode({ status: 'RUNNING' }, { state: 'open' })).toBe('waiting');
    expect(ticketBranchMode({ status: 'REVIEW' }, { state: 'open' })).toBe('merge');
    expect(ticketBranchMode({ status: 'CANCELLED' }, { state: 'open' })).toBe('discard-only');
    expect(ticketBranchMode({ status: 'COMPLETED' }, { state: 'merged' })).toBe('closed');
  });

  it('records which rule approved an action automatically', () => {
    expect(REVIEW_LOOP_COPY.autoApproved).toEqual({
      'edit-in-own-worktree': 'Approved automatically: edit in its own copy',
      'run-harness-check': 'Approved automatically: harness check',
      'command-allowlist': 'Approved automatically: allowed command',
    });
  });
});

describe('ticket page: a review-loop run at work', () => {
  it('lists each change with its state, checks and rounds; no owner buttons while the lead decides', async () => {
    render(loopWorkingScenario());
    const overview = await screen.findByTestId('changes-overview');
    const rows = within(overview).getAllByTestId('change-row');
    expect(rows.map((r) => within(r).getByTestId('change-state').dataset.state)).toEqual([
      'rework',
      'reviewing',
    ]);
    expect(rows[0]?.textContent).toContain('Rework round 1 of 2');
    expect(rows[0]?.textContent).toContain('1 required check failed');
    expect(rows[0]?.textContent).toContain('Rework ×1');
    expect(rows[1]?.textContent).toContain('In review');
    expect(rows[1]?.textContent).toContain('2 of 2 checks passed');
    expect(screen.queryByTestId('changes-need-you')).toBeNull();
    expect(screen.queryByTestId('owner-decision')).toBeNull();
    // The run's approval mode is in the summary.
    expect(screen.getByTestId('run-approval-mode').textContent).toBe('Approvals: Auto edits');
    // The legacy review list is not shown for a review-loop run.
    expect(screen.queryByTestId('review-list')).toBeNull();
  });

  it('the ticket branch says it waits while agents work, without loading the diff', async () => {
    const s = render(loopWorkingScenario());
    const card = await screen.findByTestId('ticket-branch');
    expect(within(card).getByTestId('branch-name').textContent).toBe(LOOP_BRANCH);
    expect(within(card).getByTestId('branch-state').dataset.state).toBe('open');
    expect(card.textContent).toContain('You can merge once every change is decided');
    expect(within(card).queryByTestId('branch-actions')).toBeNull();
    expect(s.calls.some((c) => c.path === LOOP_BRANCH_PATH)).toBe(false);
  });

  it('a change card shows the decisions with the reviewer’s findings, and the diff', async () => {
    render(loopWorkingScenario());
    const card = await openChange('API builder');
    expect(within(panel()).getByRole('tab', { name: 'Changes', selected: true })).toBeTruthy();
    const history = within(card).getByTestId('change-history');
    expect(history.textContent).toContain('Round 1');
    expect(history.textContent).toContain(
      'Review agent asked for rework · Lead sent it back for rework',
    );
    expect(within(history).getByTestId('change-finding').textContent).toContain(
      'Cap pageSize at 100',
    );
    expect(within(card).getByText('3 changed files')).toBeTruthy();
    expect(within(card).getByTestId('change-checks').dataset.checks).toBe('failed');
    expect(within(card).getByText('b7e2d91')).toBeTruthy();
    // The files and diff come from the run's review.
    expect(within(card).getAllByText('src/search/api.ts').length).toBeGreaterThan(0);
  });

  it('a helper waiting for review says so, and "Latest" words control tools', async () => {
    render(loopWorkingScenario());
    const canvas = await screen.findByTestId('agent-canvas');
    expect(canvas.textContent).toContain('Waiting for review');
    // The lead's raw "mcp__acp__request_rework" reads as core's label.
    expect(canvas.textContent).toContain('Asked a helper to rework its change');
    expect(canvas.textContent).not.toContain('mcp__acp__');
  });

  it('the request history records which rule approved an action automatically', async () => {
    render(loopWorkingScenario());
    await openChange('API builder');
    fireEvent.click(within(panel()).getByRole('tab', { name: 'Approvals' }));
    fireEvent.click(within(panel()).getByText('Earlier requests (2)'));
    expect(within(panel()).getByText('Approved automatically: edit in its own copy')).toBeTruthy();
    expect(within(panel()).getByText('Approved automatically: harness check')).toBeTruthy();
  });

  it('once the lead has ended, undecided changes offer the owner’s buttons; merged ones never', async () => {
    const sc = withRun(loopWorkingScenario(), (run) => ({
      ...run,
      agents: (run['agents'] as Record<string, unknown>[]).map((a) =>
        a['id'] === L_LEAD ? { ...a, status: 'SUCCEEDED', endedAt: '2026-10-17T09:40:00.000Z' } : a,
      ),
    }));
    render(sc);
    const need = await screen.findByTestId('changes-need-you');
    expect(within(need).getAllByRole('listitem')).toHaveLength(2);
    const card = await openChange('API builder');
    expect(within(card).getByTestId('owner-decision').textContent).toContain('The lead has ended');
  });
});

describe('ticket page: a change that needs the owner', () => {
  it('surfaces it above the agents, with its conflicts', async () => {
    render(loopNeedsYouScenario());
    const need = await screen.findByTestId('changes-need-you');
    expect(need.textContent).toContain('1 change needs your decision');
    expect(need.textContent).toContain('Search UI');
    const card = await openChange('Search UI');
    expect(within(card).getByTestId('change-state').dataset.state).toBe('needs-owner');
    expect(within(card).getByTestId('change-conflicts').textContent).toContain(
      'Conflicts with acp/WEB-21 in:src/search/api.ts',
    );
    expect(within(card).getByTestId('owner-decision').textContent).toContain(
      'The lead asked you to decide.',
    );
    // The merged change has no buttons.
    const merged = await openChange('API builder');
    expect(within(merged).queryByTestId('owner-decision')).toBeNull();
    expect(within(merged).getByTestId('change-state').textContent).toContain(
      'Merged into acp/WEB-21',
    );
    expect(within(merged).getByTestId('change-history').textContent).toContain('Round 2');
  });

  it('merge asks first, then posts the review action with the CSRF token', async () => {
    const s = render(loopNeedsYouScenario());
    const card = await openChange('Search UI');
    const decide = within(card).getByTestId('owner-decision');
    fireEvent.click(within(decide).getByRole('button', { name: `Merge into ${LOOP_BRANCH}` }));
    expect(mutations(s)).toHaveLength(0);
    fireEvent.click(within(decide).getByRole('button', { name: 'Merge' }));
    await waitFor(() => expect(mutations(s)).toHaveLength(1));
    expect(mutations(s)[0]).toMatchObject({
      method: 'POST',
      path: LOOP_REVIEW_PATH,
      body: { agentRunId: L_UI, action: 'merge' },
    });
    expect(s.csrf).toEqual([CSRF]);
  });

  it('rework needs a comment; it is sent with it', async () => {
    const s = render(loopNeedsYouScenario());
    const card = await openChange('Search UI');
    fireEvent.click(within(card).getByRole('button', { name: 'Send back for rework…' }));
    const form = within(card).getByTestId('change-rework');
    const send = within(form).getByRole('button', { name: 'Send back' });
    expect(send).toHaveProperty('disabled', true);
    fireEvent.change(within(form).getByRole('textbox'), {
      target: { value: 'Debounce the query and leave src/search/api.ts to the API builder.' },
    });
    fireEvent.click(send);
    await waitFor(() => expect(mutations(s)).toHaveLength(1));
    expect(mutations(s)[0]?.body).toEqual({
      agentRunId: L_UI,
      action: 'rework',
      comment: 'Debounce the query and leave src/search/api.ts to the API builder.',
    });
  });

  it('discard asks first; a refusal shows the server’s reason', async () => {
    const s = render(loopNeedsYouScenario(), {
      [`POST ${LOOP_REVIEW_PATH}`]: jsonResponse(409, {
        error: { code: 'change_not_decidable', message: 'The lead decided it.', requestId: 'r' },
      }),
    });
    const card = await openChange('Search UI');
    fireEvent.click(within(card).getByRole('button', { name: 'Discard' }));
    fireEvent.click(within(card).getByRole('button', { name: 'Discard change' }));
    await waitFor(() => expect(mutations(s)).toHaveLength(1));
    expect(mutations(s)[0]?.body).toEqual({ agentRunId: L_UI, action: 'discard' });
    await waitFor(() =>
      expect(
        within(card)
          .getAllByRole('alert')
          .some((a) => a.textContent?.includes('The lead decided it.')),
      ).toBe(true),
    );
  });
});

describe('ticket page: the owner’s merge of the ticket branch', () => {
  it('loads the combined change: the tip’s checks, the files and the diff', async () => {
    render(loopReviewScenario());
    const card = await screen.findByTestId('ticket-branch');
    expect(await within(card).findByTestId('branch-checks')).toBeTruthy();
    expect(within(card).getByText('3 changed files')).toBeTruthy();
    expect(within(card).getByTestId('branch-diff')).toBeTruthy();
    expect(within(card).getByRole('button', { name: 'Merge into main' })).toBeTruthy();
    expect(within(card).queryByTestId('branch-blocked')).toBeNull();
    // No change waits for the owner any more.
    expect(screen.queryByTestId('changes-need-you')).toBeNull();
  });

  it('Merge into main asks first, then posts the action', async () => {
    const s = render(loopReviewScenario());
    const card = await screen.findByTestId('ticket-branch');
    fireEvent.click(await within(card).findByRole('button', { name: 'Merge into main' }));
    expect(within(card).getByTestId('confirm').textContent).toContain(
      `Merge ${LOOP_BRANCH} into main?`,
    );
    fireEvent.click(within(card).getByRole('button', { name: 'Merge' }));
    await waitFor(() => expect(mutations(s)).toHaveLength(1));
    expect(mutations(s)[0]).toMatchObject({
      method: 'POST',
      path: LOOP_BRANCH_PATH,
      body: { action: 'merge' },
    });
    expect(s.csrf).toEqual([CSRF]);
  });

  it('Request changes sends a comment to the lead; Discard asks first', async () => {
    const s = render(loopReviewScenario());
    const card = await screen.findByTestId('ticket-branch');
    fireEvent.click(await within(card).findByRole('button', { name: 'Request changes…' }));
    const form = within(card).getByTestId('branch-request-changes');
    fireEvent.change(within(form).getByRole('textbox'), {
      target: { value: 'Keep the saved searches when the user signs out.' },
    });
    fireEvent.click(within(form).getByRole('button', { name: 'Send to the lead' }));
    await waitFor(() => expect(mutations(s)).toHaveLength(1));
    expect(mutations(s)[0]?.body).toEqual({
      action: 'request-changes',
      comment: 'Keep the saved searches when the user signs out.',
    });
    fireEvent.click(within(card).getByRole('button', { name: 'Discard branch' }));
    expect(within(card).getByTestId('confirm').textContent).toContain('can’t be undone');
    fireEvent.click(
      within(within(card).getByTestId('confirm')).getByRole('button', {
        name: 'Discard branch',
      }),
    );
    await waitFor(() => expect(mutations(s)).toHaveLength(2));
    expect(mutations(s)[1]?.body).toEqual({ action: 'discard' });
  });

  it('a failed check on the tip blocks Merge: merge anyway needs a reason', async () => {
    const s = render(loopReviewScenario({ failing: true }));
    const card = await screen.findByTestId('ticket-branch');
    expect((await within(card).findByTestId('branch-blocked')).textContent).toContain('Unit tests');
    expect(within(card).queryByRole('button', { name: 'Merge into main' })).toBeNull();
    fireEvent.click(within(card).getByRole('button', { name: 'Merge anyway…' }));
    const form = within(card).getByTestId('branch-merge-anyway');
    fireEvent.change(within(form).getByRole('textbox'), {
      target: { value: 'The cap test is flaky on CI; tracked in WEB-30.' },
    });
    fireEvent.click(within(form).getByRole('button', { name: 'Merge anyway' }));
    await waitFor(() => expect(mutations(s)).toHaveLength(1));
    expect(mutations(s)[0]?.body).toEqual({
      action: 'merge-anyway',
      reason: 'The cap test is flaky on CI; tracked in WEB-30.',
    });
  });

  it('when main moved: Merge waits and Update from main is offered', async () => {
    const s = render(loopReviewScenario({ baseMoved: true }));
    const card = await screen.findByTestId('ticket-branch');
    const moved = await within(card).findByTestId('branch-base-moved');
    expect(within(card).getByRole('button', { name: 'Merge into main' })).toHaveProperty(
      'disabled',
      true,
    );
    fireEvent.click(within(moved).getByRole('button', { name: 'Update from main' }));
    await waitFor(() => expect(mutations(s)).toHaveLength(1));
    expect(mutations(s)[0]?.body).toEqual({ action: 'update-from-base' });
  });

  it('a stopped run’s open branch can only be discarded', async () => {
    const sc = withRun(loopReviewScenario(), (run) => ({ ...run, status: 'CANCELLED' }));
    render(sc);
    const card = await screen.findByTestId('ticket-branch');
    const actions = await within(card).findByTestId('branch-actions');
    expect(actions.textContent).toContain('can only be discarded');
    expect(within(card).queryByRole('button', { name: 'Merge into main' })).toBeNull();
    expect(within(actions).getByRole('button', { name: 'Discard branch' })).toBeTruthy();
  });

  it('once merged: the branch reads merged into main, with no actions', async () => {
    const s = render(loopDoneScenario());
    const card = await screen.findByTestId('ticket-branch');
    expect(within(card).getByTestId('branch-state').textContent).toBe('Merged into main');
    expect(within(card).queryByTestId('branch-actions')).toBeNull();
    expect(card.textContent).toContain('main is now at e1f2a3b');
    expect(s.calls.some((c) => c.path === LOOP_BRANCH_PATH)).toBe(false);
  });
});

describe('the live graph’s review-loop additions', () => {
  const graphOf = (sc: LoopScenario) =>
    liveGraph(
      RunDetailDtoSchema.parse(sc.routes[LOOP_RUN_PATH]),
      ProjectWorkflowDtoSchema.parse(sc.routes[LOOP_PROJECT_WORKFLOW_PATH]),
      RunWorkflowDtoSchema.parse(sc.routes[LOOP_RUN_WORKFLOW_PATH]),
    );

  it('adds the owner’s merge, the rework edge with its count, and the review counts', () => {
    const g = graphOf(loopNeedsYouScenario());
    expect(g.nodes.map((n) => n.id)).toContain('owner-merge');
    expect(g.edges.find((e) => e.id === 'loop:review->helpers')?.label).toBe('Rework ×1');
    expect(g.nodes.find((n) => n.id === 'review')?.data).toMatchObject({
      loop: { reviewer: 'agent', maxReworkRounds: 2, counts: { needsOwner: 1, merged: 1 } },
    });
  });

  it('a legacy run keeps its graph', () => {
    const sc = inReviewScenario();
    const g = liveGraph(
      RunDetailDtoSchema.parse(sc.routes[`/api/runs/run-2`]),
      ProjectWorkflowDtoSchema.parse(sc.routes['/api/projects/p-web/workflow']),
      RunWorkflowDtoSchema.parse(sc.routes['/api/runs/run-2/workflow']),
    );
    expect(g.nodes.map((n) => n.id)).not.toContain('owner-merge');
    expect(g.edges.some((e) => e.id === 'loop:review->helpers')).toBe(false);
  });

  it('on the page: review counts, waiting helpers, and the merge gate’s state', async () => {
    render(loopNeedsYouScenario());
    const counts = await screen.findByTestId('review-counts');
    expect(counts.textContent).toBe('1 for you · 1 merged');
    expect(screen.getByTestId('helpers-waiting-review').textContent).toBe('1 waiting for review');
    expect(screen.getByTestId('live-owner-merge').dataset.state).toBe('waiting');
  });

  it('the merge gate waits for you at review and is done once merged', async () => {
    render(loopReviewScenario());
    expect((await screen.findByTestId('live-owner-merge')).dataset.state).toBe('needs-you');
  });

  it('the merge gate is done once merged', async () => {
    render(loopDoneScenario());
    expect((await screen.findByTestId('live-owner-merge')).dataset.state).toBe('done');
  });
});

describe('legacy runs render as before', () => {
  it('no ticket branch, no change cards, the review list and Merge as always', async () => {
    const sc = inReviewScenario();
    const s = fakeServer(sc.routes);
    renderWithApi(<TicketPage id={TICKET_ID} />, s);
    expect(await screen.findByTestId('review-list')).toBeTruthy();
    expect(screen.queryByTestId('ticket-branch')).toBeNull();
    expect(screen.queryByTestId('changes-overview')).toBeNull();
    expect(screen.queryByTestId('run-approval-mode')).toBeNull();
    expect(screen.queryByTestId('live-owner-merge')).toBeNull();
  });
});

describe('the Start dialog (ticket page Re-run)', () => {
  it('starts from the project’s settings; no change posts an empty body', async () => {
    const s = render(loopDoneScenario());
    fireEvent.click(await screen.findByRole('button', { name: 'Re-run WEB-21 with options' }));
    const dialog = await screen.findByTestId('start-dialog');
    expect(within(dialog).getByRole('heading', { name: 'Re-run WEB-21' })).toBeTruthy();
    const mode = await within(dialog).findByLabelText<HTMLInputElement>(
      /Auto edits \(recommended\) · Project setting/,
    );
    expect(mode.checked).toBe(true);
    expect(
      within(dialog).getByLabelText<HTMLInputElement>(
        /Review agent \(recommended\) · Project setting/,
      ).checked,
    ).toBe(true);
    expect(
      within(dialog).getByRole<HTMLInputElement>('radio', { name: '2 rework rounds' }).checked,
    ).toBe(true);
    expect(within(dialog).getByTestId('start-dialog-summary').textContent).toBe(
      'Same as the project’s settings.',
    );
    fireEvent.click(within(dialog).getByRole('button', { name: 'Re-run' }));
    await waitFor(() => expect(mutations(s)).toHaveLength(1));
    expect(mutations(s)[0]).toMatchObject({
      method: 'POST',
      path: `${LOOP_TICKET_PATH}/start`,
      body: {},
    });
    await waitFor(() => expect(screen.queryByTestId('start-dialog')).toBeNull());
  });

  it('sends only the overrides; widening the mode shows the warning', async () => {
    const s = render(loopDoneScenario());
    fireEvent.click(await screen.findByRole('button', { name: 'Re-run WEB-21 with options' }));
    const dialog = await screen.findByTestId('start-dialog');
    fireEvent.click(await within(dialog).findByLabelText(/^AutoLike/));
    expect(within(dialog).getByTestId('approvals-warning')).toBeTruthy();
    fireEvent.click(within(dialog).getByLabelText(/^The lead/));
    fireEvent.click(within(dialog).getByRole('radio', { name: 'No rework: merge or discard' }));
    expect(within(dialog).getByTestId('start-dialog-summary').textContent).toBe(
      '3 choices differ from the project, for this run only.',
    );
    fireEvent.click(within(dialog).getByRole('button', { name: 'Re-run' }));
    await waitFor(() => expect(mutations(s)).toHaveLength(1));
    expect(mutations(s)[0]?.body).toEqual({
      approvalMode: 'auto',
      reviewer: 'lead',
      maxReworkRounds: 0,
    });
  });

  it('the plain Re-run stays one click with an empty body', async () => {
    const s = render(loopDoneScenario());
    fireEvent.click(await screen.findByRole('button', { name: 'Re-run' }));
    await waitFor(() => expect(mutations(s)).toHaveLength(1));
    expect(mutations(s)[0]?.body).toEqual({});
    expect(screen.queryByTestId('start-dialog')).toBeNull();
  });

  it('keeps the dialog open with the reason when the start is refused', async () => {
    render(loopDoneScenario(), {
      [`POST ${LOOP_TICKET_PATH}/start`]: jsonResponse(409, {
        error: { code: 'conflict', message: 'A run is already under way.', requestId: 'r' },
      }),
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Re-run WEB-21 with options' }));
    const dialog = await screen.findByTestId('start-dialog');
    await within(dialog).findByLabelText(/^Manual/);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Re-run' }));
    await waitFor(() =>
      expect(
        within(dialog)
          .getAllByRole('alert')
          .some((a) => a.textContent?.includes('A run is already under way.')),
      ).toBe(true),
    );
    expect(screen.getByTestId('start-dialog')).toBeTruthy();
  });
});

// Unused imports guard: the run id is part of the paths above.
void LOOP_RUN_ID;
void L_API;
