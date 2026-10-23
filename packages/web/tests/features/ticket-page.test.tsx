// The ticket page as a pull request page (v0.3.0 D-B; C-B, ADR-0026: Comments first, Conversation
// last): the tabs in the address, what each tab holds and the sidebar's values. Synthetic data only.
import { TicketDetailDtoSchema } from '@acp/core/api';
import { fireEvent, screen, within } from '@testing-library/react';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  CSRF,
  L_LEAD,
  LOOP_BRANCH,
  LOOP_RUN_PATH,
  LOOP_TICKET_ID,
  LOOP_TICKET_PATH,
  PROJECT_ID,
  loopReviewScenario,
  loopWorkingScenario,
  type LoopScenario,
} from '../../e2e/review-loop-fixtures';
import { TicketPage } from '../../src/features/ticket/TicketPage';
import { hashWithTab, tabFromHash } from '../../src/features/ticket/ticket-tabs';
import { detail as sessionDetail } from '../fixtures/dto';
import { fakeServer, renderWithApi, type RouteTable } from '../helpers';

// The live graph is React Flow, which measures the DOM; jsdom has no layout.
beforeAll(() => {
  if (typeof globalThis.DOMMatrixReadOnly === 'undefined') {
    class Matrix {
      m22 = 1;
    }
    Object.assign(globalThis, { DOMMatrixReadOnly: Matrix });
  }
  for (const prop of ['offsetWidth', 'offsetHeight'] as const) {
    Object.defineProperty(HTMLElement.prototype, prop, { configurable: true, get: () => 800 });
  }
});

const TICKET_HASH = `#/p/${PROJECT_ID}/tickets/${LOOP_TICKET_ID}`;

function render(sc: LoopScenario, hash = TICKET_HASH, routes: RouteTable = {}) {
  window.location.hash = hash;
  const s = fakeServer({ '/api/control/token': { token: CSRF }, ...sc.routes, ...routes });
  renderWithApi(<TicketPage id={LOOP_TICKET_ID} />, s);
  return s;
}

const selected = () =>
  screen.getAllByRole('tab').find((t) => t.getAttribute('aria-selected') === 'true')?.textContent;

describe('the tab in the address', () => {
  it('reads ?tab=, with the old section names as aliases, and Comments by default', () => {
    expect(tabFromHash(TICKET_HASH)).toBe('comments');
    expect(tabFromHash(`${TICKET_HASH}?tab=agents`)).toBe('agents');
    expect(tabFromHash(`${TICKET_HASH}?tab=checks`)).toBe('checks');
    expect(tabFromHash(`${TICKET_HASH}?tab=files`)).toBe('files');
    expect(tabFromHash(`${TICKET_HASH}?tab=changes`)).toBe('files');
    expect(tabFromHash(`${TICKET_HASH}?tab=conversation`)).toBe('conversation');
    expect(tabFromHash(`${TICKET_HASH}?tab=activity`)).toBe('conversation');
    expect(tabFromHash(`${TICKET_HASH}?tab=comments`)).toBe('comments');
    // The plan under review is on Comments; the live workflow on Agents.
    expect(tabFromHash(`${TICKET_HASH}?tab=plan`)).toBe('comments');
    expect(tabFromHash(`${TICKET_HASH}?tab=Workflow`)).toBe('agents');
    expect(tabFromHash(`${TICKET_HASH}?tab=nonsense`)).toBe('comments');
  });

  it('writes the tab, keeps other parameters, and leaves the default out', () => {
    expect(hashWithTab(TICKET_HASH, 'agents')).toBe(`${TICKET_HASH}?tab=agents`);
    expect(hashWithTab(TICKET_HASH, 'conversation')).toBe(`${TICKET_HASH}?tab=conversation`);
    expect(hashWithTab(`${TICKET_HASH}?tab=agents`, 'comments')).toBe(TICKET_HASH);
    expect(hashWithTab(`${TICKET_HASH}?x=1&tab=agents`, 'checks')).toBe(
      `${TICKET_HASH}?x=1&tab=checks`,
    );
  });

  it('opens the tab the address names, and a click puts the new one in the address', async () => {
    render(loopReviewScenario(), `${TICKET_HASH}?tab=checks`);
    expect(await screen.findByTestId('checks-tab')).toBeTruthy();
    expect(selected()).toContain('Checks');
    const before = window.history.length;
    fireEvent.click(screen.getByRole('tab', { name: /Agents/ }));
    expect(window.location.hash).toBe(`${TICKET_HASH}?tab=agents`);
    expect(await screen.findByTestId('agent-canvas')).toBeTruthy();
    fireEvent.click(screen.getByRole('tab', { name: /Conversation/ }));
    expect(window.location.hash).toBe(`${TICKET_HASH}?tab=conversation`);
    expect(await screen.findByTestId('activity')).toBeTruthy();
    fireEvent.click(screen.getByRole('tab', { name: /Comments/ }));
    expect(window.location.hash).toBe(TICKET_HASH);
    // Tabs replace the address: Back leaves the ticket instead of replaying them.
    expect(window.history.length).toBe(before);
  });

  it('an old link to the changes lands on Files changed', async () => {
    render(loopReviewScenario(), `${TICKET_HASH}?tab=changes`);
    expect(await screen.findByTestId('files-tab')).toBeTruthy();
    expect(selected()).toContain('Files changed');
  });
});

describe('each tab shows its own part', () => {
  it('the tabs, in order: Comments, Agents, Files changed, Checks, Conversation', async () => {
    render(loopReviewScenario());
    await screen.findByTestId('comments-tab');
    expect(screen.getAllByRole('tab').map((t) => t.getAttribute('data-testid'))).toEqual([
      'ticket-tab-comments',
      'ticket-tab-agents',
      'ticket-tab-files',
      'ticket-tab-checks',
      'ticket-tab-conversation',
    ]);
  });

  it('Comments: the thread, the final step, the comment box and the sidebar', async () => {
    render(loopReviewScenario());
    expect(await screen.findByTestId('comments-tab')).toBeTruthy();
    expect(screen.getByTestId('ticket-branch')).toBeTruthy();
    expect(screen.getByLabelText('Add a comment')).toBeTruthy();
    expect(screen.getByTestId('ticket-sidebar')).toBeTruthy();
    expect(screen.queryByTestId('agent-canvas')).toBeNull();
    expect(screen.queryByTestId('files-tab')).toBeNull();
  });

  it('Agents: the live graph, the tree and the side panel; no sidebar', async () => {
    render(loopWorkingScenario(), `${TICKET_HASH}?tab=agents`);
    expect(await screen.findByTestId('agent-canvas')).toBeTruthy();
    expect(screen.getByTestId('side-panel')).toBeTruthy();
    expect(screen.queryByTestId('ticket-sidebar')).toBeNull();
    expect(screen.queryByTestId('comments')).toBeNull();
  });

  it('Files changed: "Changes from", then the review UI with one file list and one diff', async () => {
    render(loopReviewScenario(), `${TICKET_HASH}?tab=files`);
    const tab = await screen.findByTestId('files-tab');
    expect(within(tab).getByTestId('change-picker').dataset['value']).toBe('');
    expect(await within(tab).findByTestId('review-files')).toBeTruthy();
    expect(within(tab).getAllByTestId('review-bar')).toHaveLength(1);
    expect(within(tab).queryByTestId('changes-overview')).toBeNull();
    expect(within(tab).queryByTestId('branch-diff')).toBeNull();
    expect(screen.queryByTestId('ticket-sidebar')).toBeNull();
  });

  it('Checks: by place (H-D): each change before the lead’s merge, then the tip', async () => {
    render(loopReviewScenario(), `${TICKET_HASH}?tab=checks`);
    const tab = await screen.findByTestId('checks-tab');
    expect(within(tab).getByTestId('tip-checks')).toBeTruthy();
    expect(within(tab).getByRole('heading', { name: /Before the lead’s merge/ })).toBeTruthy();
    const order = [...tab.querySelectorAll('[data-testid]')].map((e) =>
      e.getAttribute('data-testid'),
    );
    expect(order.indexOf('merge-checks')).toBeLessThan(order.indexOf('tip-checks'));
  });

  it('counts on the tabs: comments, agents, files and checks', async () => {
    render(loopReviewScenario());
    await screen.findByTestId('comments-tab');
    const detail = TicketDetailDtoSchema.parse(loopReviewScenario().routes[LOOP_TICKET_PATH]);
    // People's comments (and the lead's summary) only; the rest is on Conversation.
    expect(screen.getByTestId('tab-count-comments').textContent).toBe(
      String(detail.comments.filter((c) => c.author === 'owner').length),
    );
    expect(screen.getByTestId('tab-count-agents').textContent).toBe(
      String(detail.currentRun?.agents.length),
    );
    expect((await screen.findByTestId('tab-count-files')).textContent).toBe('3');
  });
});

describe('the header', () => {
  it('reads like "wants to merge": the branch into its target, changes merged, agents', async () => {
    render(loopReviewScenario());
    const line = await screen.findByTestId('ticket-summary');
    expect(within(line).getByTestId('pr-line-branch').textContent).toBe(LOOP_BRANCH);
    expect(within(line).getByTestId('pr-line-target').textContent).toBe('main');
    expect(line.textContent).toContain('1 change merged');
    expect(line.textContent).toMatch(/\d agents/);
    expect(screen.getByTestId('ticket-stage').textContent).toBe('In review');
  });
});

describe('the sidebar', () => {
  /** The review scenario with the lead linked to a session the app started. */
  function withLeadSession(): LoopScenario {
    const sc = loopReviewScenario();
    const detail = sc.routes[LOOP_TICKET_PATH] as Record<string, unknown>;
    const run = detail['currentRun'] as Record<string, unknown>;
    const agents = (run['agents'] as Record<string, unknown>[]).map((a) =>
      a['id'] === L_LEAD ? { ...a, sessionId: 's-lead' } : a,
    );
    const edited = { ...run, agents };
    return {
      routes: {
        ...sc.routes,
        [LOOP_TICKET_PATH]: { ...detail, currentRun: edited },
        [LOOP_RUN_PATH]: edited,
        '/api/sessions/s-lead': sessionDetail({
          id: 's-lead',
          managed: {
            runId: 'run-21',
            agentRunId: L_LEAD,
            ticketKey: 'WEB-21',
            kind: 'lead',
            label: 'Lead',
          },
        }),
      },
    };
  }

  it('lists the branch, pull request, run options, labels, this run and the sessions', async () => {
    render(withLeadSession());
    const side = await screen.findByTestId('ticket-sidebar');
    expect(within(side).getByTestId('ticket-branch-actual').textContent).toBe(LOOP_BRANCH);
    expect(within(side).getByTestId('ticket-branch-actual-target').textContent).toBe('main');
    expect(within(side).getByTestId('sidebar-pull-request').textContent).toContain('None yet');
    expect(within(side).getByTestId('ticket-run-options')).toBeTruthy();
    expect(
      [...within(side).getByTestId('ticket-labels').querySelectorAll('[data-tone]')].map(
        (t) => t.textContent,
      ),
    ).toEqual(['Feature', 'Medium priority', 'search']);
    const run = within(side).getByTestId('sidebar-run');
    expect(run.textContent).toContain('Run 1 of 1');
    expect(within(run).getByTestId('run-budget').textContent).toMatch(/budget tokens used/);
    const sessions = within(side).getByTestId('sidebar-sessions');
    const link = await within(sessions).findByRole('link', { name: 'WEB-21 · Lead' });
    expect(link.getAttribute('href')).toBe('#/sessions/s-lead');
  });

  it('stacks under the content: it comes after the comments in the page', async () => {
    render(loopReviewScenario());
    const conversation = await screen.findByTestId('comments-tab');
    const side = screen.getByTestId('ticket-sidebar');
    expect(conversation.compareDocumentPosition(side) & Node.DOCUMENT_POSITION_FOLLOWING).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
  });
});
