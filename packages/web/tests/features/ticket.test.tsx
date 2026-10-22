import {
  ChatMessageDtoSchema,
  ProjectWorkflowDtoSchema,
  ReviewDtoSchema,
  RunDetailDtoSchema,
  RunWorkflowDtoSchema,
  TicketDetailDtoSchema,
} from '@acp/core/api';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  CSRF,
  LEAD,
  MIGRATION,
  PLAN_V1,
  PLAN_V2,
  PLANNER,
  PROJECT_ID,
  PROJECT_WORKFLOW_PATH,
  REVIEWER,
  RUN_ID,
  RUN_WORKFLOW_PATH,
  STORE,
  TESTER,
  TICKET_ID,
  TOKENS,
  UI,
  branchOf,
  doneScenario,
  heldScenario,
  inReviewScenario,
  planReviewScenario,
  plannerReviewScenario,
  reviewedScenario,
  stagesScenario,
  workingScenario,
  type TicketScenario,
} from '../../e2e/ticket-fixtures';
import { App } from '../../src/app/App';
import { shortBranch } from '../../src/features/ticket/AgentCanvas';
import { TicketPage } from '../../src/features/ticket/TicketPage';
import { createApiClient, updateTicket, type FetchLike } from '../../src/lib/api';
import { parseRoute } from '../../src/lib/router';
import { QueryStore } from '../../src/lib/query-store';
import { project } from '../fixtures/dto';
import {
  fakeServer,
  jsonResponse,
  renderWithApi,
  type FakeServer,
  type RouteTable,
} from '../helpers';

const TICKET = `/api/tickets/${TICKET_ID}`;
const webApp = project({ id: PROJECT_ID, name: 'web-app' });
const RUN = `/api/runs/${RUN_ID}`;

// The live workflow is React Flow, which measures the DOM; jsdom has no layout (as in
// tests/features/workflow.test.tsx).
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

/** A fake server for one scenario that also records each mutation's CSRF header. */
function server(sc: TicketScenario, routes: RouteTable = {}) {
  const base = fakeServer({ ...sc.routes, ...routes });
  const csrf: (string | null)[] = [];
  const fetch: FetchLike = (input, init) => {
    if (init?.method !== undefined && init.method !== 'GET') {
      const headers = (init.headers ?? {}) as Record<string, string>;
      csrf.push(headers['X-ACP-CSRF'] ?? null);
    }
    return base.fetch(input, init);
  };
  return { fetch, calls: base.calls, csrf };
}

type Server = ReturnType<typeof server>;

const mutations = (s: Server) => s.calls.filter((c) => c.method !== 'GET');

/**
 * The page on one of its tabs (v0.3.0 D-B): the tab is the address's `?tab=`, Comments when none
 * is given (C-B).
 */
function renderTicket(s: Server, tab?: 'agents' | 'files' | 'checks' | 'conversation') {
  window.location.hash = `#/p/${PROJECT_ID}/tickets/${TICKET_ID}${tab ? `?tab=${tab}` : ''}`;
  return renderWithApi(<TicketPage id={TICKET_ID} />, s);
}

describe('ticket fixtures', () => {
  it('match the API contract', () => {
    for (const sc of [
      planReviewScenario(),
      workingScenario(),
      inReviewScenario(),
      doneScenario(),
      stagesScenario(),
      reviewedScenario(),
      heldScenario(),
      plannerReviewScenario(),
    ]) {
      expect(() => TicketDetailDtoSchema.parse(sc.routes[TICKET])).not.toThrow();
      expect(() => RunDetailDtoSchema.parse(sc.routes[RUN])).not.toThrow();
      const review = sc.routes[`${RUN}/review`];
      if (review !== undefined) expect(() => ReviewDtoSchema.parse(review)).not.toThrow();
      const runWorkflow = sc.routes[RUN_WORKFLOW_PATH];
      if (runWorkflow !== undefined) {
        expect(() => RunWorkflowDtoSchema.parse(runWorkflow)).not.toThrow();
      }
      expect(() => ProjectWorkflowDtoSchema.parse(sc.routes[PROJECT_WORKFLOW_PATH])).not.toThrow();
    }
  });
});

describe('ticket page: routes', () => {
  // Redesign (R-A): tickets live at #/p/:projectId/tickets/:id; #/tickets/:id redirects there.
  it('parses #/p/:projectId/tickets/:id and the old #/tickets/:id', () => {
    expect(parseRoute('#/p/p-web/tickets/t-12')).toEqual({
      name: 'ticket',
      projectId: 'p-web',
      id: 't-12',
    });
    expect(parseRoute('#/tickets/a%2Fb')).toEqual({
      name: 'legacy',
      legacy: { kind: 'ticket', ticketId: 'a/b' },
    });
    expect(parseRoute('#/tickets/a/b').name).toBe('not-found');
  });

  it('sends #/control to the board without a history entry', async () => {
    const s = server(planReviewScenario(), { '/api/projects': [webApp] });
    window.location.hash = '#/control';
    const before = window.history.length;
    render(<App store={new QueryStore(createApiClient(s.fetch))} eventSource={null} />);
    await waitFor(() => expect(window.location.hash).toBe(`#/p/${PROJECT_ID}/board`));
    expect(window.history.length).toBe(before);
  });

  it('keeps the Phase 3 start page, now under the project at runs/new', async () => {
    const s = server(planReviewScenario(), { '/api/runs': [], '/api/projects': [webApp] });
    window.location.hash = '#/control/new';
    render(<App store={new QueryStore(createApiClient(s.fetch))} eventSource={null} />);
    expect(await screen.findByRole('heading', { name: 'Control panel', level: 1 })).toBeTruthy();
    expect(window.location.hash).toBe(`#/p/${PROJECT_ID}/runs/new`);
  });

  it('redirects #/tickets/:id to the ticket page under its project', async () => {
    const s = server(planReviewScenario());
    window.location.hash = `#/tickets/${TICKET_ID}`;
    render(<App store={new QueryStore(createApiClient(s.fetch))} eventSource={null} />);
    expect(await screen.findByRole('heading', { name: /WEB-12\s*Dark mode toggle/ })).toBeTruthy();
    expect(window.location.hash).toBe(`#/p/${PROJECT_ID}/tickets/${TICKET_ID}`);
  });

  it('says when a ticket does not exist', async () => {
    renderTicket(server({ routes: {} }));
    expect(await screen.findByText('Ticket not found')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Open board' }).getAttribute('href')).toBe('#/');
  });
});

describe('ticket page: plan review', () => {
  it('shows the plan first on Comments, with its steps and version', async () => {
    renderTicket(server(planReviewScenario()));
    const card = await screen.findByTestId('plan-card');
    // The agents are on their own tab (v0.3.0 D-B).
    expect(screen.queryByTestId('agent-canvas')).toBeNull();
    expect(within(card).getByText('Version 2')).toBeTruthy();
    expect(within(card).getByText('3 helper agents planned')).toBeTruthy();
    const steps = within(card).getAllByRole('list', { name: 'Plan' })[0];
    expect(steps).toBeDefined();
    expect(within(steps as HTMLElement).getAllByRole('listitem')).toHaveLength(3);
    expect(within(steps as HTMLElement).getByText('Settings toggle')).toBeTruthy();
    expect(screen.getByTestId('ticket-stage').textContent).toContain('Plan review');
    // The comment that sent version 1 back is on Comments, with the version it was about.
    const thread = screen.getByTestId('comments');
    const sentBack = within(thread)
      .getAllByTestId('comment')
      .find((c) => c.textContent?.includes('Keep the old settings page'));
    expect(sentBack?.textContent).toContain('on plan version 1');
    // Every version is on Conversation (C-B), oldest first and collapsed.
    fireEvent.click(screen.getByRole('tab', { name: /Conversation/ }));
    const timeline = await screen.findByTestId('activity');
    const plans = within(timeline).getAllByTestId('timeline-plan');
    expect(plans.map((p) => p.textContent)).toEqual([
      expect.stringContaining('Plan version 1'),
      expect.stringContaining('Plan version 2'),
    ]);
    expect(plans[0]?.querySelector('details')?.hasAttribute('open')).toBe(false);
  });

  it('approves the plan with the CSRF header', async () => {
    const s = server(planReviewScenario(), {
      [`POST ${TICKET}/plans/${PLAN_V2}/decision`]: () =>
        jsonResponse(200, workingScenario().routes[TICKET]),
    });
    renderTicket(s);
    fireEvent.click(await screen.findByRole('button', { name: 'Approve plan' }));
    await waitFor(() => expect(mutations(s)).toHaveLength(1));
    expect(mutations(s)[0]).toMatchObject({
      method: 'POST',
      path: `${TICKET}/plans/${PLAN_V2}/decision`,
      body: { decision: 'approve' },
    });
    expect(s.csrf).toEqual([CSRF]);
  });

  it('asks for a comment before requesting changes, then sends it', async () => {
    const s = server(planReviewScenario(), {
      [`POST ${TICKET}/plans/${PLAN_V2}/decision`]: () =>
        jsonResponse(200, planReviewScenario().routes[TICKET]),
    });
    renderTicket(s);
    fireEvent.click(await screen.findByRole('button', { name: 'Request changes' }));
    expect(screen.getByText('Say what should change.')).toBeTruthy();
    expect(mutations(s)).toEqual([]);

    fireEvent.change(screen.getByLabelText('What should change?'), {
      target: { value: '  Put the switch next to the language setting.  ' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Request changes' }));
    await waitFor(() => expect(mutations(s)).toHaveLength(1));
    expect(mutations(s)[0]?.body).toEqual({
      decision: 'request-changes',
      comment: 'Put the switch next to the language setting.',
    });
  });

  it('shows the server refusal when the decision fails', async () => {
    const s = server(planReviewScenario(), {
      [`POST ${TICKET}/plans/${PLAN_V2}/decision`]: () =>
        jsonResponse(409, {
          error: { code: 'plan_superseded', message: 'A newer plan exists.', requestId: 'r' },
        }),
    });
    renderTicket(s);
    fireEvent.click(await screen.findByRole('button', { name: 'Approve plan' }));
    const [alert] = await screen.findAllByRole('alert');
    expect(alert?.textContent).toContain('A newer plan exists.');
  });
});

describe('ticket page: agents working', () => {
  it('draws the tree from parentAgentRunId, with depth-2 helpers under their parent', async () => {
    renderTicket(server(workingScenario()), 'agents');
    const canvas = await screen.findByTestId('agent-canvas');
    const underLead = within(canvas).getByRole('list', { name: 'Started by Lead' });
    expect(within(underLead).getByTestId(`agent-${UI}`)).toBeTruthy();
    const underStore = within(canvas).getByRole('list', { name: 'Started by Theme store' });
    expect(
      within(underStore)
        .getAllByRole('article')
        .map((a) => a.getAttribute('aria-label')),
    ).toEqual(['Migration helper']);
    const underUi = within(canvas).getByRole('list', { name: 'Started by Settings UI' });
    expect(within(underUi).getByTestId(`agent-${TOKENS}`)).toBeTruthy();
    // Each card: role, status in words, budget in words.
    const store = within(canvas).getByTestId(`agent-${STORE}`);
    expect(within(store).getByText('Waiting for your approval')).toBeTruthy();
    expect(within(store).getByText('8,200 of 50,000 budget tokens')).toBeTruthy();
    expect(within(store).getByText(/1 request for you/)).toBeTruthy();
    // A parent helper shows its helpers' budget next to its own, never instead of it.
    expect(within(store).getByText('With its helpers: 11,300 budget tokens')).toBeTruthy();
  });

  it("shows each helper's branch from the start, else the review's, else no branch yet", async () => {
    renderTicket(server(workingScenario()), 'agents');
    const canvas = await screen.findByTestId('agent-canvas');
    // The agent reports its own branch while it works, before any review exists for it.
    const ui = within(canvas).getByTestId(`agent-${UI}`);
    expect(within(ui).getByTestId('agent-branch').textContent).toBe(`…/${UI}`);
    expect(within(ui).getByTitle(branchOf(UI))).toBeTruthy();
    // No branch on the agent: the review's is used once it loads.
    await waitFor(() =>
      expect(within(canvas).getByTestId(`agent-${TOKENS}`).textContent).toContain(`…/${TOKENS}`),
    );
    expect(
      within(within(canvas).getByTestId(`agent-${MIGRATION}`)).getByTestId('agent-branch')
        .textContent,
    ).toBe('No branch yet');
    // The lead has no worktree, so its card has no branch line.
    expect(
      within(within(canvas).getByTestId(`agent-${LEAD}`)).queryByTestId('agent-branch'),
    ).toBeNull();
  });

  it('lists what waits for the owner first on Conversation, in the header and the sidebar', async () => {
    renderTicket(server(workingScenario()));
    const approvals = await screen.findByTestId('approvals');
    expect(within(approvals).getByText('Edit src/theme/store.ts')).toBeTruthy();
    expect(screen.getByTestId('ticket-summary').textContent).toContain('1 request waits for you');
    expect(screen.getByTestId('run-budget').textContent).toContain('92,700 budget tokens used');
  });

  it('opens the lead in the side panel with the chat; helpers have no chat tab', async () => {
    renderTicket(server(workingScenario()), 'agents');
    const panel = await screen.findByTestId('side-panel');
    expect(within(panel).getByRole('heading', { name: 'Lead' })).toBeTruthy();
    expect(within(panel).getByRole('tab', { name: 'Chat' }).getAttribute('aria-selected')).toBe(
      'true',
    );
    expect(within(panel).getByText(/My plan is ready for you/)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Show the Theme store in the side panel' }));
    const next = screen.getByTestId('side-panel');
    expect(within(next).getByRole('heading', { name: 'Theme store' })).toBeTruthy();
    expect(within(next).queryByRole('tab', { name: 'Chat' })).toBeNull();
    expect(within(next).getByRole('tab', { name: /Approvals/ }).textContent).toContain('1');
    fireEvent.click(within(next).getByRole('tab', { name: /Approvals/ }));
    expect(within(next).getByRole('button', { name: 'Approve' })).toBeTruthy();
  });

  it('moves between tabs with the arrow keys', async () => {
    renderTicket(server(workingScenario()), 'agents');
    const panel = await screen.findByTestId('side-panel');
    const chat = within(panel).getByRole('tab', { name: 'Chat' });
    // The shared Tabs (Radix) move focus, and with it the selection, on the next tick.
    fireEvent.keyDown(chat, { key: 'ArrowRight' });
    await waitFor(() =>
      expect(
        within(panel).getByRole('tab', { name: 'Activity' }).getAttribute('aria-selected'),
      ).toBe('true'),
    );
    fireEvent.keyDown(chat, { key: 'End' });
    await waitFor(() =>
      expect(
        within(panel).getByRole('tab', { name: 'Details' }).getAttribute('aria-selected'),
      ).toBe('true'),
    );
    expect(within(panel).getByTestId('details').textContent).toContain(LEAD);
  });

  it("shows a helper's own branch in the Details tab before any review exists", async () => {
    renderTicket(server(workingScenario()), 'agents');
    await screen.findByTestId('side-panel');
    fireEvent.click(screen.getByRole('button', { name: 'Show the Settings UI in the side panel' }));
    const panel = screen.getByTestId('side-panel');
    fireEvent.click(within(panel).getByRole('tab', { name: 'Details' }));
    expect(within(panel).getByTestId('details').textContent).toContain(branchOf(UI));
  });

  it("sends a helper's prompt box through message_agent, the lead's through the chat", async () => {
    const s = server(workingScenario(), {
      [`POST ${RUN}/agents/${MIGRATION}/message`]: () =>
        jsonResponse(200, (workingScenario().routes[RUN] as { agents: unknown[] }).agents[4]),
      [`POST ${RUN}/chat`]: () =>
        jsonResponse(
          201,
          ChatMessageDtoSchema.parse({
            id: 'm-9',
            runId: RUN_ID,
            role: 'owner',
            text: 'Go on',
            createdAt: '2026-10-15T09:40:00.000Z',
          }),
        ),
    });
    renderTicket(s, 'agents');
    const helper = await screen.findByTestId(`agent-${MIGRATION}`);
    fireEvent.change(within(helper).getByLabelText('Message to the Migration helper'), {
      target: { value: 'Keep the old flag readable. ' },
    });
    fireEvent.click(within(helper).getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(mutations(s)).toHaveLength(1));
    expect(mutations(s)[0]).toMatchObject({
      path: `${RUN}/agents/${MIGRATION}/message`,
      body: { text: 'Keep the old flag readable.' },
    });

    const lead = screen.getByTestId(`agent-${LEAD}`);
    fireEvent.change(within(lead).getByLabelText('Message to the Lead'), {
      target: { value: 'Go on' },
    });
    fireEvent.submit(within(lead).getByLabelText('Message to the Lead'));
    await waitFor(() => expect(mutations(s)).toHaveLength(2));
    expect(mutations(s)[1]).toMatchObject({ path: `${RUN}/chat`, body: { text: 'Go on' } });
    expect(s.csrf).toEqual([CSRF, CSRF]);
  });

  it('offers no prompt box on a helper that has stopped', async () => {
    renderTicket(server(workingScenario()), 'agents');
    const tokens = await screen.findByTestId(`agent-${TOKENS}`);
    expect(within(tokens).queryByRole('textbox')).toBeNull();
    expect(within(tokens).queryByRole('button', { name: 'Stop' })).toBeNull();
  });
});

describe('ticket page: in review', () => {
  async function openUi(s: Server) {
    renderTicket(s);
    const list = await screen.findByTestId('review-list');
    const uiRow = within(list).getByText('Settings UI').closest('li') as HTMLElement;
    expect(uiRow.textContent).toContain('A required check failed');
    fireEvent.click(within(uiRow).getByRole('button', { name: 'Review' }));
    return screen.getByTestId('side-panel');
  }

  it('shows the harness results, the failed required check first with its output', async () => {
    const panel = await openUi(server(inReviewScenario()));
    fireEvent.click(within(panel).getByRole('tab', { name: 'Checks' }));
    const checks = within(panel).getByTestId('checks');
    expect(checks.textContent).toContain('2 of 3 checks passed');
    const build = within(checks).getByTestId('check-build');
    expect(build.textContent).toContain('Failed');
    expect(build.textContent).toContain('Required');
    expect(build.textContent).toContain('exit status 2');
    expect(build.textContent).toContain('took 22s');
    expect(build.textContent).toContain("Type 'string' is not assignable");
  });

  it('blocks Merge on a failed required check; Merge anyway needs a reason', async () => {
    const s = server(inReviewScenario(), {
      [`POST ${RUN}/review`]: () => jsonResponse(200, inReviewScenario().routes[`${RUN}/review`]),
    });
    const panel = await openUi(s);
    expect(within(panel).getByRole('tab', { name: 'Changes' }).getAttribute('aria-selected')).toBe(
      'true',
    );
    await within(panel).findByTestId('changes');
    expect(within(panel).getByTestId('merge-blocked').textContent).toContain('Build');
    expect(within(panel).queryByRole('button', { name: 'Merge' })).toBeNull();

    fireEvent.click(within(panel).getByRole('button', { name: 'Merge anyway…' }));
    const form = within(panel).getByTestId('merge-anyway');
    const confirm = within(form).getByRole('button', { name: 'Merge anyway' });
    expect((confirm as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(within(form).getByLabelText('Why merge anyway?'), {
      target: { value: '  The build fails on main too. ' },
    });
    fireEvent.click(confirm);
    await waitFor(() => expect(mutations(s)).toHaveLength(1));
    expect(mutations(s)[0]).toMatchObject({
      path: `${RUN}/review`,
      body: { agentRunId: UI, action: 'merge-anyway', reason: 'The build fails on main too.' },
    });
    expect(s.csrf).toEqual([CSRF]);
  });

  it('offers a plain Merge when the required checks passed (an earlier failure was rerun)', async () => {
    const s = server(inReviewScenario(), {
      [`POST ${RUN}/review`]: () => jsonResponse(200, inReviewScenario().routes[`${RUN}/review`]),
    });
    renderTicket(s, 'agents');
    fireEvent.click(
      await screen.findByRole('button', { name: 'Show the Theme store in the side panel' }),
    );
    const panel = screen.getByTestId('side-panel');
    fireEvent.click(within(panel).getByRole('tab', { name: 'Checks' }));
    expect(within(panel).getByText('Earlier check runs (1)')).toBeTruthy();
    fireEvent.click(within(panel).getByRole('tab', { name: 'Changes' }));
    await within(panel).findByTestId('changes');
    expect(within(panel).queryByTestId('merge-blocked')).toBeNull();
    fireEvent.click(within(panel).getByRole('button', { name: 'Merge' }));
    fireEvent.click(within(panel).getByRole('button', { name: 'Merge changes' }));
    await waitFor(() => expect(mutations(s)).toHaveLength(1));
    expect(mutations(s)[0]?.body).toEqual({ agentRunId: STORE, action: 'merge' });
  });

  it('offers no Stop all once every agent has stopped', async () => {
    renderTicket(server(inReviewScenario()));
    await screen.findByTestId('review-list');
    expect(screen.queryByRole('button', { name: 'Stop all' })).toBeNull();
  });
});

describe('ticket page: history and quick actions', () => {
  it('re-runs a Done ticket', async () => {
    const s = server(doneScenario(), {
      [`POST ${TICKET}/start`]: () => jsonResponse(200, planReviewScenario().routes[TICKET]),
    });
    renderTicket(s);
    fireEvent.click(await screen.findByRole('button', { name: 'Re-run' }));
    await waitFor(() => expect(mutations(s)).toHaveLength(1));
    expect(mutations(s)[0]).toMatchObject({ method: 'POST', path: `${TICKET}/start` });
  });

  it('offers Stop all while agents work', async () => {
    renderTicket(server(workingScenario()));
    expect(await screen.findByRole('button', { name: 'Stop all' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Re-run' })).toBeNull();
  });

  it('lists the runs and comments, and shows an earlier run on request', async () => {
    const s = server(workingScenario(), {
      '/api/runs/run-1': RunDetailDtoSchema.parse({
        ...(workingScenario().routes[RUN] as object),
        id: 'run-1',
        status: 'FAILED',
        agents: [],
        approvals: [],
        messages: [],
      }),
      '/api/runs/run-1/checks': [],
    });
    renderTicket(s);
    // The owner's comment on a plan says which version (Comments).
    expect((await screen.findByTestId('comments')).textContent).toContain('on plan version 1');
    // v0.3.0 D-B, C-B: each run is a line on Conversation, oldest first.
    fireEvent.click(screen.getByRole('tab', { name: /Conversation/ }));
    const timeline = await screen.findByTestId('activity');
    const runs = within(timeline).getAllByTestId('timeline-run');
    expect(runs.map((r) => r.textContent)).toEqual([
      expect.stringContaining('Run 1 started'),
      expect.stringContaining('Run 2 started'),
    ]);
    expect(runs[1]?.textContent).toContain('Shown on this page');
    fireEvent.click(within(runs[0] as HTMLElement).getByRole('button', { name: 'Show this run' }));
    expect(
      await screen.findByText('You are looking at an earlier run of this ticket.'),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole('tab', { name: /Agents/ }));
    expect(await screen.findByText(/No agents yet/)).toBeTruthy();
  });

  it('adds a comment', async () => {
    const s = server(workingScenario(), {
      [`POST ${TICKET}/comments`]: () =>
        jsonResponse(201, {
          id: 'c-9',
          ticketId: TICKET_ID,
          runId: null,
          planId: null,
          author: 'owner',
          body: 'Looks good',
          createdAt: '2026-10-15T09:50:00.000Z',
        }),
    });
    renderTicket(s);
    const comments = await screen.findByTestId('comments');
    fireEvent.change(within(comments).getByLabelText('Add a comment'), {
      target: { value: 'Looks good' },
    });
    fireEvent.click(within(comments).getByRole('button', { name: 'Comment' }));
    await waitFor(() => expect(mutations(s)).toHaveLength(1));
    expect(mutations(s)[0]).toMatchObject({
      path: `${TICKET}/comments`,
      body: { body: 'Looks good' },
    });
  });

  it('edits the description with PATCH and the CSRF header', async () => {
    const s = server(workingScenario(), {
      [`PATCH ${TICKET}`]: () => jsonResponse(200, workingScenario().routes[TICKET]),
    });
    renderTicket(s);
    // The description is the timeline's first box (v0.3.0 D-B); its Edit sends only it.
    const info = await screen.findByTestId('ticket-info');
    fireEvent.click(within(info).getByRole('button', { name: 'Edit the description' }));
    fireEvent.change(within(info).getByRole('textbox'), {
      target: { value: 'Shorter.' },
    });
    fireEvent.click(within(info).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(mutations(s)).toHaveLength(1));
    expect(mutations(s)[0]).toMatchObject({
      method: 'PATCH',
      path: TICKET,
      body: { description: 'Shorter.' },
    });
    expect(s.csrf).toEqual([CSRF]);
  });

  it('edits the title in the header with PATCH', async () => {
    const s = server(workingScenario(), {
      [`PATCH ${TICKET}`]: () => jsonResponse(200, workingScenario().routes[TICKET]),
    });
    renderTicket(s);
    const header = await screen.findByTestId('ticket-header');
    fireEvent.click(within(header).getByRole('button', { name: 'Edit the title' }));
    const field = within(header).getByLabelText<HTMLInputElement>('Title');
    expect(field.value).toBe('Dark mode toggle');
    fireEvent.change(field, { target: { value: '  ' } });
    expect(within(header).getByRole<HTMLButtonElement>('button', { name: 'Save' }).disabled).toBe(
      true,
    );
    fireEvent.change(field, { target: { value: ' Dark mode switch ' } });
    fireEvent.click(within(header).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(mutations(s)).toHaveLength(1));
    expect(mutations(s)[0]).toMatchObject({
      method: 'PATCH',
      path: TICKET,
      body: { title: 'Dark mode switch' },
    });
    expect(s.csrf).toEqual([CSRF]);
  });

  it('never says "completed" and keeps ids out of the first glance', async () => {
    renderTicket(server(inReviewScenario()));
    await screen.findByTestId('review-list');
    const copy = document.body.cloneNode(true) as HTMLElement;
    copy.querySelectorAll('details').forEach((d) => d.remove());
    const text = copy.textContent ?? '';
    expect(text).not.toMatch(/completed/i);
    expect(text).not.toContain(RUN_ID);
    expect(text).not.toContain(PLAN_V1);
  });
});

describe('ticket page: live workflow (redesign R-H)', () => {
  const graph = () => screen.findByTestId('live-workflow');
  const stageOf = (stage: string) => screen.getByTestId(`live-${stage}`);

  it('shows the run’s stages with their states, reusing the Workflow page’s nodes', async () => {
    renderTicket(server(planReviewScenario()), 'agents');
    const card = await graph();
    expect(within(card).getByRole('heading', { name: 'Workflow' })).toBeTruthy();
    expect(stageOf('plan').dataset.state).toBe('needs-you');
    expect(within(stageOf('plan')).getByTestId('stage-state-word').textContent).toBe('Needs you');
    expect(stageOf('orchestrate').dataset.state).toBe('waiting');
    // The plan approval is ringed while a plan waits; the stages that are off say so once.
    expect(screen.getByTestId('live-approve').dataset.state).toBe('needs-you');
    expect(stageOf('code-review').dataset.state).toBe('off');
    expect(within(stageOf('code-review')).queryByTestId('stage-state-word')).toBeNull();
    // Lead mode: one lead agent covers Plan and Orchestrate (R-B's node, read-only).
    expect(within(stageOf('plan')).getByTestId('same-agent')).toBeTruthy();
    expect(within(card).queryByRole('button', { name: /^Change / })).toBeNull();
  });

  it('a separate planner and the post-merge stages show as such while helpers work', async () => {
    renderTicket(server(stagesScenario()), 'agents');
    await graph();
    expect(screen.getByTestId('wf-node-plan').dataset.role).toBe('planner');
    expect(stageOf('plan').dataset.state).toBe('done');
    expect(stageOf('helpers').dataset.state).toBe('active');
    expect(stageOf('code-review').dataset.state).toBe('waiting');
    expect(stageOf('unit-tests').dataset.state).toBe('waiting');
    expect(screen.getByTestId('live-helpers-row').textContent).toBe('2 agents2 working');
    // The agent tree stays under the graph.
    expect(screen.getByTestId('agent-canvas')).toBeTruthy();
  });

  it('hides the graph when the run has no workflow (an older run or managed agents off)', async () => {
    const sc = workingScenario();
    delete sc.routes[RUN_WORKFLOW_PATH];
    renderTicket(server(sc), 'agents');
    await screen.findByTestId('agent-canvas');
    expect(screen.queryByTestId('live-workflow')).toBeNull();
  });

  it('clicking a stage shows its agent in the side panel', async () => {
    renderTicket(server(stagesScenario()), 'agents');
    await graph();
    fireEvent.click(screen.getByTestId('wf-node-plan'));
    const panel = screen.getByTestId('side-panel');
    expect(within(panel).getByRole('heading', { name: 'Planner' })).toBeTruthy();
  });

  it('a held stage offers Continue with a plain explanation, sent with the CSRF header', async () => {
    const s = server(heldScenario(), {
      [`POST /api/runs/${RUN_ID}/continue`]: heldScenario().routes[RUN] as object,
    });
    renderTicket(s, 'agents');
    const held = await screen.findByTestId('held-stage');
    expect(held.dataset.stage).toBe('code-review');
    expect(held.textContent).toContain('Final code review is waiting for you');
    expect(held.textContent).toContain('The app restarted before final code review started');
    fireEvent.click(within(held).getByRole('button', { name: 'Continue' }));
    await waitFor(() =>
      expect(mutations(s).map((c) => `${c.method} ${c.path}`)).toEqual([
        `POST /api/runs/${RUN_ID}/continue`,
      ]),
    );
    expect(s.csrf).toEqual([CSRF]);
  });

  it('explains a refused Continue in words', async () => {
    renderTicket(
      server(heldScenario(), {
        [`POST /api/runs/${RUN_ID}/continue`]: jsonResponse(409, {
          error: { code: 'run_not_active', message: 'Nothing waits', requestId: 'r-c' },
        }),
      }),
      'agents',
    );
    const held = await screen.findByTestId('held-stage');
    fireEvent.click(within(held).getByRole('button', { name: 'Continue' }));
    expect(await within(held).findByText(/The stage didn’t start/)).toBeTruthy();
  });

  it('offers no Continue when the tester’s own change waits for review', async () => {
    renderTicket(server(reviewedScenario()), 'agents');
    await graph();
    expect(stageOf('unit-tests').dataset.state).toBe('needs-you');
    expect(screen.queryByTestId('held-stage')).toBeNull();
    // The tester's change is in the review list like a helper's (on Comments).
    fireEvent.click(screen.getByRole('tab', { name: /Comments/ }));
    expect(within(screen.getByTestId('review-list')).getByText('Tester')).toBeTruthy();
  });
});

describe('ticket page: new roles, reviewer comments and chat (redesign R-H)', () => {
  it('labels planner, reviewer and tester cards; only the tester has a branch', async () => {
    renderTicket(server(reviewedScenario()), 'agents');
    const term = (id: string) =>
      within(screen.getByTestId(`agent-${id}`)).getByTestId('agent-term').textContent;
    await screen.findByTestId('agent-canvas');
    expect(term(PLANNER)).toBe('Planner agent');
    expect(term(LEAD)).toBe('Lead agent');
    expect(term(UI)).toBe('Helper agent');
    expect(term(REVIEWER)).toBe('Reviewer agent');
    expect(term(TESTER)).toBe('Tester agent');
    expect(within(screen.getByTestId(`agent-${PLANNER}`)).queryByTestId('agent-branch')).toBeNull();
    expect(
      within(screen.getByTestId(`agent-${REVIEWER}`)).queryByTestId('agent-branch'),
    ).toBeNull();
    expect(
      within(screen.getByTestId(`agent-${TESTER}`)).getByTestId('agent-branch').textContent,
    ).toBe(`…/${TESTER}`);
    // The tree follows the flow: planner first, the reviewer and tester after the lead's helpers.
    const order = [...screen.getByTestId('agent-canvas').querySelectorAll('article')].map((a) =>
      a.getAttribute('data-kind'),
    );
    expect(order).toEqual(['planner', 'lead', 'worker', 'worker', 'reviewer', 'tester']);
  });

  it('shows reviewer comments with their own label, and points to them from the graph', async () => {
    renderTicket(server(reviewedScenario()), 'conversation');
    // The reviewer's findings are on Conversation (C-B, ADR-0026); the owner's comments are not.
    const activity = await screen.findByTestId('activity');
    const reviewer = activity.querySelector<HTMLElement>('[data-author="reviewer"]');
    if (reviewer === null) throw new Error('no reviewer comment');
    expect(within(reviewer).getByTestId('comment-author').textContent).toBe('Reviewer');
    expect(within(reviewer).getByTestId('comment-author').dataset.tone).toBe('accent');
    expect(reviewer.textContent).toContain('a selector would avoid re-renders');
    expect(activity.querySelector('[data-author="owner"]')).toBeNull();
    fireEvent.click(screen.getByRole('tab', { name: /Comments/ }));
    const comments = await screen.findByTestId('comments');
    const owner = comments.querySelector<HTMLElement>('[data-author="owner"]');
    expect(owner && within(owner).getByTestId('comment-author').textContent).toBe('You');
    expect(comments.querySelector('[data-author="reviewer"]')).toBeNull();
    // The graph is on Agents; its link goes to the Conversation tab.
    fireEvent.click(screen.getByRole('tab', { name: /Agents/ }));
    const link = await screen.findByTestId('reviewer-findings-link');
    expect(link.textContent).toBe('1 finding from the reviewer in the conversation');
    fireEvent.click(link);
    expect(screen.getByRole('tab', { name: /Conversation/ }).getAttribute('aria-selected')).toBe(
      'true',
    );
    expect(await screen.findByTestId('activity')).toBeTruthy();
  });

  it('names the planner and the lead in the chat from when the planner ended (decision C)', async () => {
    renderTicket(server(stagesScenario()), 'agents');
    const panel = await screen.findByTestId('side-panel');
    // The run is past planning: the panel opens on the lead, the agent the chat reaches now.
    expect(within(panel).getByRole('heading', { name: 'Lead' })).toBeTruthy();
    const speakers = within(panel)
      .getAllByTestId('chat-speaker')
      .map((s) => s.textContent);
    expect(speakers).toEqual(['Planner agent', 'You', 'Lead agent']);
    // The planner keeps its chat tab; its finished card has no prompt box.
    fireEvent.click(screen.getByRole('button', { name: 'Show the Planner in the side panel' }));
    expect(
      within(screen.getByTestId('side-panel')).getByRole('tab', { name: 'Chat' }),
    ).toBeTruthy();
    expect(within(screen.getByTestId(`agent-${PLANNER}`)).queryByRole('textbox')).toBeNull();
    expect(within(screen.getByTestId(`agent-${LEAD}`)).getByRole('textbox')).toBeTruthy();
  });

  it('closes the chat once the agent it reaches has stopped, though the run is in review', async () => {
    renderTicket(server(heldScenario()), 'agents');
    const panel = await screen.findByTestId('side-panel');
    expect(within(panel).getByRole('heading', { name: 'Lead' })).toBeTruthy();
    expect(within(panel).queryByRole('textbox')).toBeNull();
    expect(within(panel).getByText(/has finished its work, so the chat is closed/)).toBeTruthy();
    expect(within(screen.getByTestId(`agent-${LEAD}`)).queryByRole('textbox')).toBeNull();
  });

  it('uses one word for plan review: the stage pill, not a second run status', async () => {
    renderTicket(server(planReviewScenario()));
    await screen.findByTestId('plan-card');
    expect(screen.getByTestId('ticket-stage').textContent).toContain('Plan review');
    expect(screen.getByTestId('ticket-summary').textContent).not.toContain('Plan');
    // The run picker uses the same word as the pill.
    expect(screen.getByRole('combobox', { name: 'Run' }).textContent).toContain(
      'Run 2 of 2 · Plan review',
    );
    expect(document.body.textContent).not.toContain('Plan ready for you');
    expect(screen.getByTestId('ticket-summary').textContent).toContain('1 agent');
  });
});

describe('ticket page: R-R visual fixes', () => {
  const graph = () => screen.findByTestId('live-workflow');
  const status = (id: string) =>
    within(screen.getByTestId(`agent-${id}`)).getByText(/^(Finished|Stopped|Finished its task)$/)
      .textContent;

  it('names the planner in the chat while the planner holds it', async () => {
    renderTicket(server(plannerReviewScenario()), 'agents');
    const panel = await screen.findByTestId('side-panel');
    expect(within(panel).getByRole('heading', { name: 'Planner' })).toBeTruthy();
    const chat = within(panel).getByTestId('chat');
    expect(within(chat).getByRole('heading', { name: 'Chat with the planner agent' })).toBeTruthy();
    const box = within(panel).getByRole('textbox', { name: 'Message to the planner agent' });
    expect(box.getAttribute('placeholder')).toBe('Message the planner agent…');
    expect(panel.textContent).not.toContain('lead agent');
  });

  it('shortens an engine branch to 8 characters, keeping short names', () => {
    const uuid = '0ff5eab0-6f16-4c02-9b1e-3c3d4e5f6a7b';
    expect(shortBranch(`acp/2c91dc6e-ffa2-465d-b30c-baca5569d5ce/${uuid}`)).toBe('…/0ff5eab0');
    expect(shortBranch('acp/run-1/agent-ui')).toBe('…/agent-ui');
    expect(shortBranch('feature/x')).toBe('feature/x');
  });

  it('a lead the engine closed for the next stage reads "Finished", with its status kept', async () => {
    renderTicket(server(reviewedScenario()), 'agents');
    await screen.findByTestId('agent-canvas');
    expect(status(LEAD)).toBe('Finished');
    expect(
      within(screen.getByTestId(`agent-${LEAD}`))
        .getByText('Finished')
        .closest('[data-status]')
        ?.getAttribute('data-status'),
    ).toBe('CANCELLED');
    fireEvent.click(screen.getByRole('button', { name: 'Show the Lead in the side panel' }));
    expect(within(screen.getByTestId('side-panel')).getByText('Finished')).toBeTruthy();
  });

  it('a lead the owner stopped still reads "Stopped"', async () => {
    const sc = reviewedScenario();
    const run = sc.routes[RUN] as { agents: { id: string; endedAt: string | null }[] };
    // Stopped earlier, on its own: not the instant the reviewer started.
    for (const a of run.agents) if (a.id === LEAD) a.endedAt = '2026-10-15T09:40:00.000Z';
    renderTicket(server(sc), 'agents');
    await screen.findByTestId('agent-canvas');
    expect(status(LEAD)).toBe('Stopped');
  });

  it('lights the Done node once the run completed, and only then', async () => {
    const { unmount } = renderTicket(server(doneScenario()), 'agents');
    await graph();
    const done = await screen.findByTestId('live-done');
    expect(done.dataset.state).toBe('done');
    expect(screen.getByTestId('live-ticket').dataset.state).toBeUndefined();
    unmount();
    renderTicket(server(reviewedScenario()), 'agents');
    await graph();
    expect((await screen.findByTestId('live-done')).dataset.state).toBeUndefined();
  });
});

describe('ticket api client', () => {
  it('validates a PATCH body before it leaves the browser', async () => {
    const s = server(workingScenario());
    const client = createApiClient(s.fetch);
    await expect(updateTicket(client, TICKET_ID, { title: '   ' })).rejects.toMatchObject({
      kind: 'parse',
    });
    expect(mutations(s)).toEqual([]);
  });
});

// --- UI refresh (U-D): the ticket page's loading shape and header tags -------------------------

describe('ticket page: look (UI refresh U-D)', () => {
  it('shows a page-shaped skeleton while the ticket loads, with the loading words kept', () => {
    // The ticket never answers: the page stays in its loading state.
    const pending: FakeServer = { fetch: () => new Promise<Response>(() => {}), calls: [] };
    const { container } = renderWithApi(<TicketPage id={TICKET_ID} />, pending);
    const loading = container.querySelector('[data-loading]');
    expect(loading).not.toBeNull();
    expect(loading?.textContent).toBe('Loading the ticket…');
    expect(loading?.querySelectorAll('[data-skeleton]').length).toBeGreaterThan(3);
    expect(screen.queryByRole('heading', { level: 1 })).toBeNull();
  });

  it('shows the type, priority and labels as tags, urgency in the tone as well as the word', async () => {
    renderTicket(server(workingScenario()));
    // In the sidebar's Labels since v0.3.0 D-B.
    const header = await screen.findByTestId('ticket-labels');
    const tags = [...header.querySelectorAll('[data-tone]')].map((t) => [
      t.textContent,
      t.getAttribute('data-tone'),
    ]);
    expect(tags).toEqual([
      ['Feature', 'neutral'],
      ['High priority', 'warning'],
      ['ui', 'neutral'],
      ['settings', 'neutral'],
    ]);
  });
});
