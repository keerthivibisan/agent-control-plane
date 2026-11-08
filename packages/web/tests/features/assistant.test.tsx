import {
  AssistantProposalDtoSchema,
  AssistantSessionDtoSchema,
  type AssistantProposalDto,
  type AssistantSessionDto,
  type AssistantStreamEvent,
} from '@acp/core/api';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { App } from '../../src/app/App';
import { AssistantDock } from '../../src/features/assistant/AssistantDock';
import { assistantPaths, createApiClient, type FetchLike } from '../../src/lib/api';
import { ASSISTANT_COPY } from '../../src/lib/copy';
import { QueryStore } from '../../src/lib/query-store';
import type { EventSourceLike } from '../../src/lib/useEventStream';
import { CSRF } from '../fixtures/board';
import { project } from '../fixtures/dto';
import { fakeServer, jsonResponse, renderWithApi, type RouteTable } from '../helpers';

/*
 * AS-2 (ADR-0035): the floating project assistant against synthetic DTOs on the AS-1 routes, with
 * a fake EventSource for the chat stream. Nothing here is real chat content.
 */

const C = ASSISTANT_COPY;
const P = 'p-assist';
const SESSION = `POST ${assistantPaths.session(P)}`;
const MESSAGES = `POST ${assistantPaths.messages(P)}`;
const MODE = `POST ${assistantPaths.mode(P)}`;
const END = `POST ${assistantPaths.end(P)}`;

function session(over: Partial<AssistantSessionDto> = {}): AssistantSessionDto {
  return {
    id: 's-1',
    projectId: P,
    provider: 'claude-code',
    model: 'sonnet',
    effort: 'medium',
    mode: 'approve',
    status: 'ready',
    failure: null,
    budget: { used: 12_000, limit: 300_000 },
    startedAt: '2026-11-09T10:00:00.000Z',
    ...over,
  };
}

function proposal(over: Partial<AssistantProposalDto> = {}): AssistantProposalDto {
  return {
    id: 'pr-1',
    kind: 'skill',
    slug: 'api-tests',
    path: '.claude/skills/api-tests/SKILL.md',
    content: '---\nname: api-tests\n---\nRun the API tests.\n',
    replace: false,
    state: 'pending',
    problem: null,
    ...over,
  };
}

class FakeEventSource implements EventSourceLike {
  static instances: FakeEventSource[] = [];
  readyState = 1;
  onopen: ((ev: Event) => void) | null = null;
  onmessage: ((ev: MessageEvent) => void) | null = null;
  onerror: ((ev: Event) => void) | null = null;
  closed = false;
  constructor(readonly url: string) {
    FakeEventSource.instances.push(this);
  }
  close() {
    this.closed = true;
    this.readyState = 2;
  }
  emit(event: AssistantStreamEvent, id: number) {
    act(() => {
      this.onmessage?.(
        new MessageEvent('message', { data: JSON.stringify(event), lastEventId: String(id) }),
      );
    });
  }
}

const latest = () => {
  const es = FakeEventSource.instances.at(-1);
  if (!es) throw new Error('no stream');
  return es;
};

/** The fake server, with each mutation's CSRF header recorded. */
function server(routes: RouteTable) {
  const base = fakeServer({ '/api/control/token': { token: CSRF }, ...routes });
  const csrf: (string | null)[] = [];
  const fetch: FetchLike = (input, init) => {
    if (init?.method !== undefined && init.method !== 'GET') {
      csrf.push(((init.headers ?? {}) as Record<string, string>)['X-ACP-CSRF'] ?? null);
    }
    return base.fetch(input, init);
  };
  return { fetch, calls: base.calls, csrf };
}

const posts = (s: ReturnType<typeof server>) =>
  s.calls.filter((c) => c.method === 'POST').map((c) => c.path);

const baseRoutes = (extra: RouteTable = {}): RouteTable => ({
  [SESSION]: () => jsonResponse(201, session()),
  [MESSAGES]: () => jsonResponse(200, session({ status: 'working' })),
  [END]: () => new Response(null, { status: 204 }),
  ...extra,
});

function renderDock(routes: RouteTable = baseRoutes()) {
  const s = server(routes);
  const view = renderWithApi(
    <AssistantDock
      projectId={P}
      projectName="alpha"
      eventSource={(url) => new FakeEventSource(url)}
    />,
    s,
  );
  return { s, ...view };
}

const button = () => screen.getByTestId('assistant-button');
const panel = () => screen.getByRole('dialog', { name: C.dialog('alpha') });
const input = () => screen.getByRole('textbox', { name: C.input });

function openPanel() {
  fireEvent.click(button());
  return panel();
}

async function sendMessage(text: string) {
  fireEvent.change(input(), { target: { value: text } });
  fireEvent.keyDown(input(), { key: 'Enter' });
  await waitFor(() => expect(input()).not.toHaveProperty('disabled', true));
}

/** Opens the panel and starts a chat with one message; returns the stream. */
async function startChat(routes?: RouteTable) {
  const view = renderDock(routes);
  openPanel();
  await sendMessage('hello');
  await waitFor(() => expect(posts(view.s)).toContain(assistantPaths.messages(P)));
  return { ...view, es: latest() };
}

beforeEach(() => {
  FakeEventSource.instances = [];
});

describe('assistant fixtures', () => {
  it('match the API contract', () => {
    expect(() => AssistantSessionDtoSchema.parse(session())).not.toThrow();
    expect(() => AssistantProposalDtoSchema.parse(proposal())).not.toThrow();
  });
});

describe('assistant button', () => {
  function renderApp(hash: string) {
    window.location.hash = hash;
    const s = fakeServer({ '/api/projects': [project({ id: 'p-1', name: 'alpha' })] });
    render(<App store={new QueryStore(createApiClient(s.fetch))} eventSource={null} />);
  }

  it('shows on project pages', async () => {
    renderApp('#/p/p-1/board');
    expect(await screen.findByRole('button', { name: C.open })).toBeTruthy();
  });

  it('is not on global pages', async () => {
    for (const hash of ['#/projects', '#/health']) {
      renderApp(hash);
      await screen.findByRole('navigation', { name: 'Main' });
      expect(screen.queryByTestId('assistant-button')).toBeNull();
      document.body.innerHTML = '';
    }
  });
});

describe('assistant panel', () => {
  it('opens with focus in the input, closes with the button and with Esc', async () => {
    renderDock();
    const dialog = openPanel();
    expect(dialog.getAttribute('aria-modal')).toBe('false');
    expect(within(dialog).getByText('alpha')).toBeTruthy();
    expect(document.activeElement).toBe(input());
    expect(button().getAttribute('aria-label')).toBe(C.close);

    fireEvent.click(button());
    expect(screen.queryByRole('dialog')).toBeNull();

    openPanel();
    fireEvent.keyDown(input(), { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(button());
    // Nothing was sent by opening and closing.
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('shows the empty state; a chip sends its prompt', async () => {
    const { s } = renderDock();
    const dialog = openPanel();
    expect(within(dialog).getByTestId('assistant-empty').textContent).toContain(C.empty);
    fireEvent.click(within(dialog).getByRole('button', { name: C.suggestions[0].label }));
    await waitFor(() =>
      expect(s.calls.find((c) => c.path === assistantPaths.messages(P))?.body).toEqual({
        text: C.suggestions[0].label,
      }),
    );
  });

  it('the template chip only fills the input', () => {
    const { s } = renderDock();
    const dialog = openPanel();
    fireEvent.click(within(dialog).getByRole('button', { name: C.suggestions[2].label }));
    expect((input() as HTMLTextAreaElement).value).toBe(C.template);
    expect(posts(s)).toEqual([]);
  });

  it('the first message starts a session with the pickers, then posts the message', async () => {
    const { s } = renderDock();
    const dialog = openPanel();
    fireEvent.change(within(dialog).getByLabelText(C.effort), { target: { value: 'high' } });
    const model = within(dialog).getByLabelText(C.model);
    expect((model as HTMLInputElement).value).toBe('sonnet');
    fireEvent.change(model, { target: { value: 'opus' } });
    fireEvent.blur(model);
    await sendMessage('What is left?');
    await waitFor(() =>
      expect(posts(s)).toEqual([assistantPaths.session(P), assistantPaths.messages(P)]),
    );
    expect(
      s.calls.find((c) => c.method === 'POST' && c.path === assistantPaths.session(P))?.body,
    ).toEqual({
      provider: 'claude-code',
      model: 'opus',
      effort: 'high',
      mode: 'approve',
    });
    expect(s.calls.find((c) => c.path === assistantPaths.messages(P))?.body).toEqual({
      text: 'What is left?',
    });
    expect(screen.getByTestId('assistant-owner').textContent).toContain('What is left?');
    expect(latest().url).toBe(assistantPaths.stream(P));
  });

  it('Shift+Enter does not send', () => {
    const { s } = renderDock();
    openPanel();
    fireEvent.change(input(), { target: { value: 'line' } });
    fireEvent.keyDown(input(), { key: 'Enter', shiftKey: true });
    expect(posts(s)).toEqual([]);
  });

  it('renders text and activity events, the working line, and skips repeated ids', async () => {
    const { es } = await startChat();
    es.emit({ type: 'status', session: session({ status: 'working' }) }, 1);
    expect(screen.getByTestId('assistant-working')).toBeTruthy();
    es.emit({ type: 'activity', summary: 'Checked the tickets' }, 2);
    es.emit({ type: 'text', full: 'Two tickets are in review.' }, 3);
    es.emit({ type: 'text', full: 'Two tickets are in review.' }, 3);
    es.emit({ type: 'status', session: session({ status: 'ready' }) }, 4);
    expect(screen.getByTestId('assistant-activity').textContent).toBe('Checked the tickets');
    expect(screen.getAllByTestId('assistant-text').map((e) => e.textContent)).toEqual([
      `${C.assistant}: Two tickets are in review.`,
    ]);
    expect(screen.queryByTestId('assistant-working')).toBeNull();
  });

  it('applies a proposal: the card shows, Apply posts, the state updates in place', async () => {
    const { es, s } = await startChat(
      baseRoutes({
        [`POST ${assistantPaths.apply(P, 'pr-1')}`]: () =>
          jsonResponse(200, proposal({ state: 'applied' })),
      }),
    );
    es.emit({ type: 'proposal', proposal: proposal() }, 5);
    const card = screen.getByTestId('assistant-proposal');
    expect(card.textContent).toContain('Skill');
    expect(card.textContent).toContain('api-tests');
    expect(card.textContent).toContain('.claude/skills/api-tests/SKILL.md');
    expect(screen.queryByTestId('assistant-proposal-replace')).toBeNull();
    fireEvent.click(
      within(card).getByRole('button', { name: C.proposal.applyLabel(proposal().path) }),
    );
    await waitFor(() =>
      expect(screen.getByTestId('assistant-proposal').getAttribute('data-state')).toBe('applied'),
    );
    expect(posts(s)).toContain(assistantPaths.apply(P, 'pr-1'));
    expect(screen.getAllByTestId('assistant-proposal')).toHaveLength(1);
    expect(screen.getByTestId('assistant-proposal-state').textContent).toBe('Applied');
    expect(screen.queryByRole('button', { name: /^Apply / })).toBeNull();
  });

  it('discards a proposal', async () => {
    const { es, s } = await startChat(
      baseRoutes({
        [`POST ${assistantPaths.discard(P, 'pr-1')}`]: () =>
          jsonResponse(200, proposal({ state: 'discarded' })),
      }),
    );
    es.emit({ type: 'proposal', proposal: proposal() }, 5);
    fireEvent.click(screen.getByRole('button', { name: C.proposal.discardLabel(proposal().path) }));
    await waitFor(() =>
      expect(screen.getByTestId('assistant-proposal-state').textContent).toBe('Discarded'),
    );
    expect(posts(s)).toContain(assistantPaths.discard(P, 'pr-1'));
  });

  it('a stream event with the same id updates the card in place', async () => {
    const { es } = await startChat();
    es.emit({ type: 'proposal', proposal: proposal() }, 5);
    es.emit(
      { type: 'proposal', proposal: proposal({ state: 'failed', problem: 'Too large.' }) },
      6,
    );
    expect(screen.getAllByTestId('assistant-proposal')).toHaveLength(1);
    expect(screen.getByTestId('assistant-proposal-state').textContent).toBe('Failed');
    expect(screen.getByTestId('assistant-proposal').textContent).toContain('Too large.');
  });

  it('shows the replace warning', async () => {
    const { es } = await startChat();
    es.emit({ type: 'proposal', proposal: proposal({ replace: true }) }, 5);
    expect(screen.getByTestId('assistant-proposal-replace').textContent).toBe(C.proposal.replaces);
  });

  it('renders proposal content with <script> as text', async () => {
    const { es } = await startChat();
    const content = '<script>window.hacked = true</script><b>bold</b>';
    es.emit({ type: 'proposal', proposal: proposal({ content }) }, 5);
    const pre = screen.getByTestId('assistant-proposal-content');
    expect(pre.textContent).toBe(content);
    expect(pre.querySelector('script')).toBeNull();
    expect(pre.querySelector('b')).toBeNull();
    expect((window as { hacked?: boolean }).hacked).toBeUndefined();
  });

  it('Auto mode: a warning badge with its tooltip, and a written card has no buttons', async () => {
    const { es } = await startChat(
      baseRoutes({ [SESSION]: () => jsonResponse(201, session({ mode: 'auto' })) }),
    );
    const badge = screen.getByTestId('assistant-mode-badge');
    expect(badge.textContent).toBe('Auto');
    expect(badge.getAttribute('data-tone')).toBe('warning');
    expect(badge.getAttribute('title')).toBe('Writes skills and agent files without asking.');
    es.emit({ type: 'proposal', proposal: proposal({ state: 'written' }) }, 5);
    const card = screen.getByTestId('assistant-proposal');
    expect(within(card).getByTestId('assistant-proposal-state').textContent).toBe('Written (Auto)');
    expect(within(card).queryAllByRole('button')).toHaveLength(0);
  });

  it('switching the mode posts it without a restart', async () => {
    const { s } = await startChat(
      baseRoutes({ [MODE]: () => jsonResponse(200, session({ mode: 'auto' })) }),
    );
    fireEvent.change(screen.getByLabelText(C.modeLabel), { target: { value: 'auto' } });
    await waitFor(() =>
      expect(screen.getByTestId('assistant-mode-badge').textContent).toBe('Auto'),
    );
    expect(s.calls.find((c) => c.path === assistantPaths.mode(P))?.body).toEqual({ mode: 'auto' });
    expect(posts(s).filter((p) => p === assistantPaths.session(P))).toHaveLength(1);
    expect(posts(s)).not.toContain(assistantPaths.end(P));
    expect(screen.queryByTestId('assistant-restart')).toBeNull();
  });

  it('changing the provider while a chat runs confirms, ends it and starts a new one', async () => {
    let started = 0;
    const { s } = await startChat(
      baseRoutes({
        [SESSION]: (body: unknown) => {
          started += 1;
          const b = body as { provider: 'claude-code' | 'codex' };
          return jsonResponse(201, session({ id: `s-${started}`, provider: b.provider }));
        },
      }),
    );
    fireEvent.change(screen.getByLabelText(C.provider), { target: { value: 'codex' } });
    const confirm = screen.getByTestId('assistant-restart');
    expect(confirm.textContent).toContain(C.restart.question);
    expect(posts(s)).not.toContain(assistantPaths.end(P));
    fireEvent.click(within(confirm).getByRole('button', { name: C.restart.confirm }));
    await waitFor(() => expect(started).toBe(2));
    const sent = posts(s);
    expect(sent.indexOf(assistantPaths.end(P))).toBeGreaterThan(-1);
    expect(sent.lastIndexOf(assistantPaths.session(P))).toBeGreaterThan(
      sent.indexOf(assistantPaths.end(P)),
    );
    expect(s.calls.filter((c) => c.path === assistantPaths.session(P)).at(-1)?.body).toEqual({
      provider: 'codex',
      model: null,
      effort: 'medium',
      mode: 'approve',
    });
    // The chat starts fresh.
    expect(screen.queryByTestId('assistant-owner')).toBeNull();
    expect(screen.getByTestId('assistant-empty')).toBeTruthy();
  });

  it('cancelling the change keeps the chat and the provider', async () => {
    const { s } = await startChat();
    fireEvent.change(screen.getByLabelText(C.provider), { target: { value: 'codex' } });
    fireEvent.click(screen.getByRole('button', { name: C.restart.cancel }));
    expect(screen.getByLabelText<HTMLSelectElement>(C.provider).value).toBe('claude-code');
    expect(posts(s)).not.toContain(assistantPaths.end(P));
    expect(screen.getByTestId('assistant-owner')).toBeTruthy();
  });

  it('a 409 shows why the provider is unavailable, with the Codex hint', async () => {
    renderDock(
      baseRoutes({
        [SESSION]: () =>
          jsonResponse(409, {
            error: {
              code: 'provider_unavailable',
              message: 'Codex is not logged in',
              requestId: 'r-1',
            },
          }),
      }),
    );
    openPanel();
    fireEvent.change(screen.getByLabelText(C.provider), { target: { value: 'codex' } });
    await sendMessage('hi');
    const error = await screen.findByTestId('assistant-error');
    expect(error.textContent).toContain(C.unavailable('Codex is not logged in'));
    expect(error.textContent).toContain(C.codexHint);
  });

  it('ended: shows the reason and starts a new chat', async () => {
    const { es, s } = await startChat();
    es.emit({ type: 'ended', reason: 'budget', message: 'The chat reached its budget.' }, 9);
    const ended = screen.getByTestId('assistant-ended');
    expect(ended.textContent).toContain('The chat reached its budget.');
    expect(screen.queryByRole('textbox', { name: C.input })).toBeNull();
    fireEvent.click(within(ended).getByRole('button', { name: C.startNew }));
    await waitFor(() => expect(screen.getByTestId('assistant-empty')).toBeTruthy());
    expect(input()).toBeTruthy();
    // The chat had already ended: nothing to end on the server.
    expect(posts(s)).not.toContain(assistantPaths.end(P));
  });

  it('End posts and shows the ended state', async () => {
    const { s } = await startChat();
    fireEvent.click(screen.getByRole('button', { name: C.end }));
    await screen.findByTestId('assistant-ended');
    expect(posts(s)).toContain(assistantPaths.end(P));
  });

  it('closing the panel closes the stream and keeps the chat; reopening reattaches', async () => {
    const { es, s } = await startChat();
    es.emit({ type: 'text', full: 'Hello there.' }, 2);
    fireEvent.click(button());
    expect(es.closed).toBe(true);
    openPanel();
    expect(FakeEventSource.instances).toHaveLength(2);
    expect(latest().closed).toBe(false);
    expect(screen.getByTestId('assistant-text').textContent).toContain('Hello there.');
    expect(posts(s)).not.toContain(assistantPaths.end(P));
  });

  it('after a reload, opening finds the session and attaches the stream', async () => {
    renderDock(baseRoutes({ [assistantPaths.session(P)]: session({ mode: 'auto' }) }));
    openPanel();
    await waitFor(() => expect(FakeEventSource.instances).toHaveLength(1));
    expect(screen.getByTestId('assistant-mode-badge').textContent).toBe('Auto');
    latest().emit({ type: 'proposal', proposal: proposal() }, 3);
    expect(screen.getByTestId('assistant-proposal')).toBeTruthy();
  });

  it('every POST sends the CSRF header', async () => {
    const { es, s } = await startChat(
      baseRoutes({
        [MODE]: () => jsonResponse(200, session({ mode: 'auto' })),
        [`POST ${assistantPaths.apply(P, 'pr-1')}`]: () =>
          jsonResponse(200, proposal({ state: 'applied' })),
      }),
    );
    es.emit({ type: 'proposal', proposal: proposal() }, 5);
    fireEvent.click(screen.getByRole('button', { name: C.proposal.applyLabel(proposal().path) }));
    await screen.findByText('Applied');
    fireEvent.change(screen.getByLabelText(C.modeLabel), { target: { value: 'auto' } });
    await waitFor(() => expect(posts(s)).toContain(assistantPaths.mode(P)));
    fireEvent.click(screen.getByRole('button', { name: C.end }));
    await waitFor(() => expect(posts(s)).toContain(assistantPaths.end(P)));
    expect(s.csrf.length).toBe(posts(s).length);
    expect(s.csrf.length).toBeGreaterThanOrEqual(5);
    expect(s.csrf.every((t) => t === CSRF)).toBe(true);
  });
});
