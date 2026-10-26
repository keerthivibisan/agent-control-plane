import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { App } from '../../src/app/App';
import { DIFF_COPY } from '../../src/components/diff/copy';
import { ControlPanel } from '../../src/features/control/ControlPanel';
import { createApiClient, type FetchLike } from '../../src/lib/api';
import { QueryStore } from '../../src/lib/query-store';
import {
  BUILDER_ID,
  CSRF,
  LEAD_ID,
  RUN_ID,
  TESTER_ID,
  agent,
  approval,
  builder,
  lead,
  message,
  review,
  runDetail,
  runSummary,
  tester,
} from '../fixtures/control';
import { detail, project } from '../fixtures/dto';
import { fakeServer, jsonResponse, renderWithApi, type RouteTable } from '../helpers';

const RUN = `/api/runs/${RUN_ID}`;

/** A fake server that also records each request's CSRF header. */
function server(routes: RouteTable) {
  const base = fakeServer({
    '/api/projects': [project({ id: 'p-1', name: 'alpha' })],
    '/api/control/token': { token: CSRF },
    [RUN]: runDetail(),
    [`${RUN}/review`]: review(),
    '/api/sessions/s-lead': detail({ id: 's-lead' }),
    '/api/sessions/s-builder': detail({
      id: 's-builder',
      latestSnapshot: {
        occurredAt: '2026-10-11T09:04:00.000Z',
        scope: 'session',
        byModel: {},
        reportedCostUsd: { provenance: 'estimated', value: 0.42 },
      },
    }),
    ...routes,
  });
  const csrf: (string | null)[] = [];
  const fetch: FetchLike = (input, init) => {
    if (init?.method === 'POST') {
      const headers = (init.headers ?? {}) as Record<string, string>;
      csrf.push(headers['X-ACP-CSRF'] ?? null);
    }
    return base.fetch(input, init);
  };
  return { fetch, calls: base.calls, csrf };
}

type Server = ReturnType<typeof server>;

function renderPanel(runId: string | null, s: Server) {
  return renderWithApi(<ControlPanel runId={runId} />, s);
}

const posts = (s: Server) => s.calls.filter((c) => c.method === 'POST');

/** Text of `el` with every collapsed <details> removed: what a reader sees at first glance. */
function visibleText(el: HTMLElement): string {
  const copy = el.cloneNode(true) as HTMLElement;
  copy.querySelectorAll('details').forEach((d) => d.remove());
  return copy.textContent ?? '';
}

describe('control panel: starting a run', () => {
  it('asks for a project first when none is added, pointing to Setup', async () => {
    const s = server({ '/api/projects': [], '/api/runs': [] });
    renderPanel(null, s);
    expect(await screen.findByText('Add a project first')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Go to Setup' }).getAttribute('href')).toBe(
      '#/health/connection',
    );
  });

  it('refuses to start without a project and sends nothing', async () => {
    const s = server({ '/api/runs': [] });
    renderPanel(null, s);
    fireEvent.click(await screen.findByRole('button', { name: 'Start run' }));
    expect((await screen.findByRole('alert')).textContent).toBe('Choose a project.');
    expect(posts(s)).toEqual([]);
  });

  it('starts a run with the CSRF header, sends the first message and opens the run', async () => {
    const s = server({
      '/api/runs': [],
      'POST /api/runs': () => jsonResponse(201, runDetail({ messages: [] })),
      [`POST ${RUN}/chat`]: () => jsonResponse(201, message({ id: 'm-9', text: 'Build it' })),
    });
    renderPanel(null, s);
    fireEvent.change(await screen.findByLabelText('Project'), { target: { value: 'p-1' } });
    fireEvent.change(screen.getByLabelText('What should the agents do?'), {
      target: { value: '  Build it  ' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Start run' }));
    await waitFor(() => expect(window.location.hash).toBe(`#/p/p-1/runs/${RUN_ID}`));
    expect(posts(s).map((c) => [c.path, c.body])).toEqual([
      ['/api/runs', { projectId: 'p-1' }],
      [`${RUN}/chat`, { text: 'Build it' }],
    ]);
    expect(s.csrf).toEqual([CSRF, CSRF]);
  });

  it('sends a changed budget per agent', async () => {
    const s = server({
      '/api/runs': [],
      'POST /api/runs': () => jsonResponse(201, runDetail()),
    });
    renderPanel(null, s);
    fireEvent.change(await screen.findByLabelText('Project'), { target: { value: 'p-1' } });
    fireEvent.change(screen.getByLabelText('Budget per agent'), {
      target: { value: '200,000' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Start run' }));
    await waitFor(() => expect(posts(s)).toHaveLength(1));
    expect(posts(s)[0]?.body).toEqual({
      projectId: 'p-1',
      budget: { maxTokensPerAgent: 200_000, softCostUsdPerRun: null },
    });
  });

  it('lists earlier runs newest first with their status in words', async () => {
    const s = server({
      '/api/runs': [
        runSummary({
          id: 'r-old',
          title: 'Old run',
          status: 'COMPLETED',
          updatedAt: '2026-10-01T00:00:00.000Z',
        }),
        runSummary({ id: 'r-new', title: 'New run', pendingApprovals: 2 }),
      ],
    });
    renderPanel(null, s);
    const list = await screen.findByTestId('run-list');
    await within(list).findByText('New run');
    const links = within(list).getAllByRole('link');
    expect(links.map((l) => l.textContent)).toEqual(['New run', 'Old run']);
    expect(links[0]?.getAttribute('href')).toBe('#/p/p-1/runs/r-new');
    expect(list.textContent).toContain('Finished — all changes reviewed');
    expect(list.textContent).toContain('2 requests wait for your approval');
    expect(list.textContent).toContain('3 agents');
  });
});

describe('control panel: a run', () => {
  it('shows the chat in order, owner and lead apart', async () => {
    renderPanel(RUN_ID, server({}));
    const chat = await screen.findByTestId('chat');
    const bubbles = within(chat).getAllByTestId('chat-message');
    expect(bubbles.map((b) => b.dataset.role)).toEqual(['owner', 'lead']);
    expect(bubbles[0]?.textContent).toContain('You');
    expect(bubbles[1]?.textContent).toContain('Lead agent');
    expect(bubbles[1]?.textContent).toContain('Starting two helper agents.');
  });

  it('draws the lead on top and its helper agents nested beneath it', async () => {
    renderPanel(RUN_ID, server({}));
    const tree = await screen.findByTestId('agent-tree');
    const leadCard = within(tree).getByTestId(`agent-${LEAD_ID}`);
    const nested = within(tree).getByRole('list', { name: 'Started by Lead' });
    expect(nested.contains(leadCard)).toBe(false);
    expect(
      within(nested)
        .getAllByRole('article')
        .map((a) => a.getAttribute('aria-label')),
    ).toEqual(['Settings page builder', 'Test writer']);
    const b = within(tree).getByTestId(`agent-${BUILDER_ID}`);
    expect(b.textContent).toContain('Waiting for your approval');
    expect(b.textContent).toContain('Latest: Used tool: Edit');
    expect(b.textContent).toContain('Task: Add a settings page');
    expect(within(tree).getByTestId(`agent-${TESTER_ID}`).textContent).toContain(
      'Finished its task',
    );
  });

  it('shows the budget in budget tokens with its explanation, and the overshoot', async () => {
    renderPanel(RUN_ID, server({}));
    const b = await screen.findByTestId(`agent-${BUILDER_ID}`);
    const meter = within(b).getByRole('meter', { name: 'Budget tokens' });
    expect(meter.getAttribute('aria-valuetext')).toBe('120,000 of 500,000 budget tokens');
    const tip = within(b).getByRole('button', { name: 'About Budget tokens' });
    expect(tip.dataset.tip).toMatch(/Cache read tokens are not counted/);
    expect(tip.dataset.tip).toMatch(/soft/);
    const t = screen.getByTestId(`agent-${TESTER_ID}`);
    expect(t.textContent).toContain('512,000 of 500,000 budget tokens');
    expect(t.textContent).toContain('12,000 budget tokens over its budget');
  });

  it('shows each agent its own estimated cost from its session, or Not reported', async () => {
    renderPanel(RUN_ID, server({}));
    const b = await screen.findByTestId(`agent-${BUILDER_ID}`);
    await waitFor(() => expect(within(b).getByTestId('cost').textContent).toContain('~$0.42'));
    expect(within(b).getByTestId('cost').textContent).toContain('Estimated cost');
    const t = screen.getByTestId(`agent-${TESTER_ID}`);
    expect(within(t).getByTestId('cost').dataset.provenance).toBe('unavailable');
    expect(within(t).getByTestId('cost').textContent).toContain('Not reported');
  });

  it('approves a request with the CSRF header and lists earlier answers', async () => {
    const s = server({
      'POST /api/approvals/ap-1': () =>
        jsonResponse(
          200,
          approval({ id: 'ap-1', status: 'approved', decidedAt: '2026-10-11T09:06:00.000Z' }),
        ),
    });
    renderPanel(RUN_ID, s);
    const tray = await screen.findByTestId('approvals');
    expect(tray.textContent).toContain('The Settings page builder wants to:');
    expect(tray.textContent).toContain('Edit src/settings.tsx');
    expect(tray.textContent).toContain('denied automatically after 15 minutes');
    fireEvent.click(within(tray).getByRole('button', { name: 'Approve' }));
    await waitFor(() => expect(posts(s)).toHaveLength(1));
    expect(posts(s)[0]).toMatchObject({
      path: '/api/approvals/ap-1',
      body: { decision: 'approve' },
    });
    expect(s.csrf).toEqual([CSRF]);
    const history = screen.getByTestId('approval-history');
    expect(history.textContent).toContain('Earlier requests (1)');
    expect(history.textContent).toContain('Run npm test');
    expect(history.textContent).toContain('Approved');
  });

  it('explains a budget request in words', async () => {
    const s = server({
      [RUN]: runDetail({
        approvals: [
          approval({ id: 'ap-b', kind: 'budget-raise', toolName: null, summary: 'Budget reached' }),
        ],
      }),
    });
    renderPanel(RUN_ID, s);
    const tray = await screen.findByTestId('approvals');
    expect(tray.textContent).toContain(
      'The Settings page builder used up its budget. Approve to let it continue, or deny to stop it.',
    );
    fireEvent.click(within(tray).getByRole('button', { name: 'Deny' }));
    await waitFor(() => expect(posts(s)[0]?.body).toEqual({ decision: 'deny' }));
  });

  it('stops an agent only after confirming', async () => {
    const s = server({
      [`POST ${RUN}/agents/${BUILDER_ID}/stop`]: () =>
        jsonResponse(200, agent({ ...builder, status: 'CANCELLED' })),
    });
    renderPanel(RUN_ID, s);
    const b = await screen.findByTestId(`agent-${BUILDER_ID}`);
    fireEvent.click(within(b).getByRole('button', { name: 'Stop' }));
    expect(posts(s)).toEqual([]);
    const ask = within(b).getByTestId('confirm');
    expect(ask.textContent).toContain('Stop the Settings page builder?');
    fireEvent.click(within(ask).getByRole('button', { name: 'Keep running' }));
    expect(posts(s)).toEqual([]);
    fireEvent.click(within(b).getByRole('button', { name: 'Stop' }));
    fireEvent.click(within(b).getByRole('button', { name: 'Stop agent' }));
    await waitFor(() => expect(posts(s)).toHaveLength(1));
    expect(posts(s)[0]?.path).toBe(`${RUN}/agents/${BUILDER_ID}/stop`);
    // A finished agent has no Stop button.
    expect(
      within(screen.getByTestId(`agent-${TESTER_ID}`)).queryByRole('button', { name: 'Stop' }),
    ).toBeNull();
  });

  it('stops everything only after confirming', async () => {
    const s = server({
      [`POST ${RUN}/stop`]: () =>
        jsonResponse(200, runSummary({ id: RUN_ID, status: 'CANCELLING' })),
    });
    renderPanel(RUN_ID, s);
    fireEvent.click(await screen.findByRole('button', { name: 'Stop all' }));
    expect(posts(s)).toEqual([]);
    expect(screen.getByTestId('confirm').textContent).toContain('every helper agent');
    fireEvent.click(screen.getByRole('button', { name: 'Stop everything' }));
    await waitFor(() => expect(posts(s).map((c) => c.path)).toEqual([`${RUN}/stop`]));
  });

  it('Message on a helper agent prefills the chat to the lead', async () => {
    renderPanel(RUN_ID, server({}));
    const b = await screen.findByTestId(`agent-${BUILDER_ID}`);
    fireEvent.click(within(b).getByRole('button', { name: 'Message' }));
    const box = screen.getByLabelText<HTMLTextAreaElement>('Message to the lead agent');
    expect(box.value).toBe('Please tell the Settings page builder: ');
    expect(document.activeElement).toBe(box);
  });

  it('sends a chat message on Enter and clears the box', async () => {
    const s = server({
      [`POST ${RUN}/chat`]: () => jsonResponse(201, message({ id: 'm-3', text: 'Go on' })),
    });
    renderPanel(RUN_ID, s);
    const box = await screen.findByLabelText<HTMLTextAreaElement>('Message to the lead agent');
    fireEvent.change(box, { target: { value: 'Go on' } });
    fireEvent.keyDown(box, { key: 'Enter', shiftKey: true });
    expect(posts(s)).toEqual([]);
    fireEvent.keyDown(box, { key: 'Enter' });
    await waitFor(() => expect(box.value).toBe(''));
    expect(posts(s)[0]).toMatchObject({ path: `${RUN}/chat`, body: { text: 'Go on' } });
  });

  it('keeps the draft and explains when a message is refused', async () => {
    const s = server({
      [`POST ${RUN}/chat`]: () =>
        jsonResponse(409, {
          error: { code: 'run_ended', message: 'The run has ended.', requestId: 'r' },
        }),
    });
    renderPanel(RUN_ID, s);
    const box = await screen.findByLabelText<HTMLTextAreaElement>('Message to the lead agent');
    fireEvent.change(box, { target: { value: 'Hello?' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    const alert = await screen.findByText(/Your message wasn't sent\./);
    expect(alert.textContent).toContain('The run has ended.');
    expect(box.value).toBe('Hello?');
  });

  it('fetches a fresh CSRF token and retries once after a 403', async () => {
    let tokenCalls = 0;
    let chatCalls = 0;
    const s = server({
      '/api/control/token': () => {
        tokenCalls += 1;
        return jsonResponse(200, { token: tokenCalls === 1 ? CSRF : `${CSRF}-new` });
      },
      [`POST ${RUN}/chat`]: () => {
        chatCalls += 1;
        return chatCalls === 1
          ? jsonResponse(403, { error: { code: 'csrf', message: 'Bad token.', requestId: 'r' } })
          : jsonResponse(201, message({ id: 'm-4', text: 'Retry' }));
      },
    });
    renderPanel(RUN_ID, s);
    const box = await screen.findByLabelText('Message to the lead agent');
    fireEvent.change(box, { target: { value: 'Retry' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(chatCalls).toBe(2));
    expect(s.csrf).toEqual([CSRF, `${CSRF}-new`]);
  });

  it('reviews a helper agent: files with line counts, a readable diff, and the size note', async () => {
    renderPanel(RUN_ID, server({}));
    const r = await screen.findByTestId(`review-${TESTER_ID}`);
    expect(r.textContent).toContain('To merge into main');
    expect(r.textContent).toContain('Waiting for your review');
    expect(r.textContent).toContain('2 changed files');
    expect(r.textContent).toContain('tests/settings.test.ts');
    // In the file list (and again in the diff viewer's own file headers).
    expect(within(r).getAllByText('2 lines added').length).toBeGreaterThan(0);
    // G-D: the shared diff viewer (components/diff), open while the change waits for review.
    const diff = within(r).getByTestId('diff-viewer');
    expect(
      within(diff)
        .getAllByTestId('diff-file')
        .map((f) => f.dataset.path),
    ).toEqual(['tests/settings.test.ts', 'src/settings.tsx']);
    expect(diff.textContent).toContain("return 'new';");
    expect(diff.textContent).not.toContain('index ');
    expect(within(r).getByTestId('diff-truncated').textContent).toBe(DIFF_COPY.truncated);
  });

  it('merges only after confirming, and shows a refusal with its reason', async () => {
    const s = server({
      [`POST ${RUN}/review`]: () =>
        jsonResponse(409, {
          error: {
            code: 'dirty_base',
            message: 'main has uncommitted changes.',
            requestId: 'r',
          },
        }),
    });
    renderPanel(RUN_ID, s);
    const r = await screen.findByTestId(`review-${TESTER_ID}`);
    fireEvent.click(within(r).getByRole('button', { name: 'Merge' }));
    expect(posts(s)).toEqual([]);
    expect(within(r).getByTestId('confirm').textContent).toContain(
      "Merge the Test writer's changes into main?",
    );
    fireEvent.click(within(r).getByRole('button', { name: 'Merge changes' }));
    await waitFor(() => expect(posts(s)).toHaveLength(1));
    expect(posts(s)[0]?.body).toEqual({ agentRunId: TESTER_ID, action: 'merge' });
    expect((await within(r).findByText(/^That didn't work./)).textContent).toContain(
      'main has uncommitted changes.',
    );
  });

  it('discards only after confirming', async () => {
    const s = server({
      [`POST ${RUN}/review`]: () => jsonResponse(200, review()),
    });
    renderPanel(RUN_ID, s);
    const r = await screen.findByTestId(`review-${TESTER_ID}`);
    fireEvent.click(within(r).getByRole('button', { name: 'Discard' }));
    expect(within(r).getByTestId('confirm').textContent).toContain("can't be undone");
    fireEvent.click(within(r).getByRole('button', { name: 'Discard changes' }));
    await waitFor(() =>
      expect(posts(s)[0]?.body).toEqual({ agentRunId: TESTER_ID, action: 'discard' }),
    );
  });

  it('holds Merge back while the agent is still working', async () => {
    const s = server({
      [RUN]: runDetail({
        agents: [lead, { ...tester, status: 'RUNNING', endedAt: null }, builder],
      }),
    });
    renderPanel(RUN_ID, s);
    const r = await screen.findByTestId(`review-${TESTER_ID}`);
    expect(r.textContent).toContain('once this agent has stopped');
    expect(within(r).queryByRole('button', { name: 'Merge' })).toBeNull();
  });

  it('a finished run says so, closes the chat and offers no Stop all', async () => {
    const s = server({
      [RUN]: runDetail({
        status: 'COMPLETED',
        pendingApprovals: 0,
        approvals: [],
        endedAt: '2026-10-11T10:00:00.000Z',
        agents: [
          { ...lead, status: 'SUCCEEDED' },
          { ...tester, review: { state: 'merged', changedFiles: 2 } },
        ],
      }),
      [`${RUN}/review`]: review({
        agents: [{ ...review().agents[0]!, state: 'merged' }],
      }),
    });
    renderPanel(RUN_ID, s);
    const facts = await screen.findByTestId('run-facts');
    expect(facts.textContent).toContain('Finished — all changes reviewed');
    expect(screen.getByText('This run has ended, so the chat is closed.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Stop all' })).toBeNull();
    expect(screen.queryByTestId('approvals')).toBeNull();
    const r = await screen.findByTestId(`review-${TESTER_ID}`);
    expect(r.textContent).toContain('Merged into your project');
    expect(within(r).queryByRole('button', { name: 'Merge' })).toBeNull();
  });

  it('explains an interrupted run', async () => {
    renderPanel(RUN_ID, server({ [RUN]: runDetail({ status: 'NEEDS_REVIEW' }) }));
    const note = await screen.findByRole('status');
    expect(note.textContent).toContain('Interrupted — check its work');
    expect(note.textContent).toContain('not restarted');
  });

  it('shows no raw ids outside Technical details', async () => {
    renderPanel(RUN_ID, server({}));
    await screen.findByTestId(`review-${TESTER_ID}`);
    await screen.findByText('~$0.42');
    const text = visibleText(document.body);
    for (const id of [RUN_ID, LEAD_ID, BUILDER_ID, TESTER_ID, 's-lead', 's-builder', 'ap-1']) {
      expect(text).not.toContain(id);
    }
    expect(text).not.toMatch(/completed/i);
  });

  it('says when a run does not exist', async () => {
    renderPanel('nope', server({}));
    expect(await screen.findByText('Run not found')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'All runs' }).getAttribute('href')).toBe('#/control');
  });
});

describe('control panel: navigation', () => {
  // Redesign (R-A): no sidebar entry any more. `#/control/new` (the Phase 3 start page) redirects
  // to `#/p/:projectId/runs/new`, and a run's page is `#/p/:projectId/runs/:runId`.
  it('opens the start page from #/control/new under a project, with no sidebar entry', async () => {
    const s = server({ '/api/runs': [] });
    window.location.hash = '#/control/new';
    render(<App store={new QueryStore(createApiClient(s.fetch))} eventSource={null} />);
    expect(await screen.findByRole('heading', { name: 'Control panel', level: 1 })).toBeTruthy();
    expect(window.location.hash).toMatch(/^#\/p\/[^/]+\/runs\/new$/);
    const nav = screen.getByRole('navigation', { name: 'Main' });
    expect(within(nav).queryByRole('link', { name: 'Control panel' })).toBeNull();
  });

  it('#/control/:runId opens the run page of a run without a ticket', async () => {
    const s = server({ [`/api/runs/${RUN_ID}`]: runDetail({ ticketId: null }) });
    window.location.hash = `#/control/${RUN_ID}`;
    const before = window.history.length;
    render(<App store={new QueryStore(createApiClient(s.fetch))} eventSource={null} />);
    await waitFor(() => expect(window.location.hash).toBe(`#/p/p-1/runs/${RUN_ID}`));
    expect(window.history.length).toBe(before);
    expect(await screen.findByTestId('run-facts')).toBeTruthy();
  });

  it('#/control/:runId of a ticket run goes to the ticket page', async () => {
    const s = server({ [`/api/runs/${RUN_ID}`]: runDetail({ ticketId: 't-7' }) });
    window.location.hash = `#/control/${RUN_ID}`;
    render(<App store={new QueryStore(createApiClient(s.fetch))} eventSource={null} />);
    await waitFor(() => expect(window.location.hash).toBe('#/p/p-1/tickets/t-7'));
  });

  it('#/control/:runId says when the run does not exist', async () => {
    window.location.hash = '#/control/nope';
    render(<App store={new QueryStore(createApiClient(server({}).fetch))} eventSource={null} />);
    expect(await screen.findByText('Run not found')).toBeTruthy();
  });
});
