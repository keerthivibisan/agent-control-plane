import {
  ChatMessageDtoSchema,
  RunDetailDtoSchema,
  TicketDetailDtoSchema,
  type RunDetailDto,
} from '@acp/core/api';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  CSRF,
  FOLLOW_UP_MESSAGES,
  LEAD,
  OLD_RUN_ID,
  PLANNER,
  RUN_ID,
  TICKET_ID,
  doneScenario,
  followUpLeadAnswer,
  followUpOwnerMessage,
  followUpScenario,
  reviewedScenario,
  workingScenario,
  type FollowUpFixture,
  type TicketScenario,
} from '../../e2e/ticket-fixtures';
import { leadFollowUp } from '../../src/features/ticket/ticket-state';
import { TicketPage } from '../../src/features/ticket/TicketPage';
import type { FetchLike } from '../../src/lib/api';
import { fakeServer, jsonResponse, renderWithApi, type RouteTable } from '../helpers';

/*
 * WP R-J (web): the lead's chat after the lead ends (docs/redesign/README.md §6b, ADR-0020). The
 * server reports `RunDetailDto.followUp` once the lead has ended; the owner's message goes through
 * the existing chat route, and the server starts the follow-up turn itself.
 */

const TICKET = `/api/tickets/${TICKET_ID}`;
const RUN = `/api/runs/${RUN_ID}`;

// The live workflow is React Flow, which measures the DOM; jsdom has no layout (as in
// tests/features/ticket.test.tsx).
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

async function openPanel(s: Server) {
  // The agents are on the Agents tab (v0.3.0 D-B).
  window.location.hash = '#?tab=agents';
  renderWithApi(<TicketPage id={TICKET_ID} />, s);
  const panel = await screen.findByTestId('side-panel');
  expect(within(panel).getByRole('heading', { name: 'Lead' })).toBeTruthy();
  expect(within(panel).getByRole('tab', { name: 'Chat' }).getAttribute('aria-selected')).toBe(
    'true',
  );
  return panel;
}

const available: FollowUpFixture = { state: 'available', reason: null };
const running: FollowUpFixture = { state: 'running', reason: null };

const runOf = (sc: TicketScenario) => RunDetailDtoSchema.parse(sc.routes[RUN]);

describe('follow-up fixtures', () => {
  it('match the API contract', () => {
    for (const sc of [
      followUpScenario(null),
      followUpScenario(available, { messages: FOLLOW_UP_MESSAGES }),
      followUpScenario(running),
      followUpScenario({ state: 'unavailable', reason: 'session-gone' }),
    ]) {
      expect(() => TicketDetailDtoSchema.parse(sc.routes[TICKET])).not.toThrow();
      expect(() => RunDetailDtoSchema.parse(sc.routes[RUN])).not.toThrow();
    }
    expect(runOf(followUpScenario(null)).followUp).toBeUndefined();
    expect(() => ChatMessageDtoSchema.parse(followUpOwnerMessage('Hi'))).not.toThrow();
    expect(() => ChatMessageDtoSchema.parse(followUpLeadAnswer())).not.toThrow();
  });
});

describe('leadFollowUp', () => {
  const run = (followUp?: RunDetailDto['followUp']) => (followUp === undefined ? {} : { followUp });
  it("is the server's state on the lead's panel, and null elsewhere or while the lead is live", () => {
    expect(leadFollowUp(run(available), { kind: 'lead' })).toEqual(available);
    expect(leadFollowUp(run(), { kind: 'lead' })).toBeNull();
    // A follow-up turn resumes the lead, never the planner or a helper.
    expect(leadFollowUp(run(available), { kind: 'planner' })).toBeNull();
    expect(leadFollowUp(run(available), { kind: 'worker' })).toBeNull();
  });
});

describe('ticket page: the chat after the lead ends (R-J)', () => {
  it('keeps the chat as before while followUp is absent: closed on an ended run, open while live', async () => {
    const panel = await openPanel(server(doneScenario()));
    expect(within(panel).queryByRole('textbox')).toBeNull();
    expect(within(panel).getByText('This run has ended, so the chat is closed.')).toBeTruthy();
    expect(within(panel).queryByTestId('chat-notice')).toBeNull();
  });

  it('keeps the live lead’s chat unchanged (no notice, no tags)', async () => {
    const panel = await openPanel(server(workingScenario()));
    const box = within(panel).getByRole('textbox', { name: 'Message to the lead agent' });
    expect((box as HTMLTextAreaElement).disabled).toBe(false);
    expect(box.getAttribute('placeholder')).toBe('Message the lead agent…');
    expect(within(panel).queryByTestId('chat-notice')).toBeNull();
    expect(within(panel).queryByTestId('chat-tag')).toBeNull();
    expect(within(panel).queryByTestId('chat-divider')).toBeNull();
  });

  it('offers the box on an ended run when a follow-up is available, with what it does', async () => {
    const panel = await openPanel(server(followUpScenario(available)));
    expect(within(panel).getByTestId('chat-notice').textContent).toBe(
      'The lead has finished. A message brings it back to answer questions; it can’t change code. New work needs a new run.',
    );
    const box = within(panel).getByRole('textbox', { name: 'Message to the lead agent' });
    expect((box as HTMLTextAreaElement).disabled).toBe(false);
    expect(box.getAttribute('placeholder')).toBe('Ask the lead about this run…');
    expect(box.getAttribute('aria-describedby')).toContain(
      within(panel).getByTestId('chat-notice').id,
    );
    // The run's status words don't change: it is still done.
    expect(screen.getByTestId('ticket-stage').textContent).toContain('Done');
  });

  it('disables the box while the lead answers', async () => {
    const panel = await openPanel(
      server(
        followUpScenario(running, { messages: [followUpOwnerMessage('Where is the store?')] }),
      ),
    );
    expect(within(panel).getByRole('status').textContent).toBe('The lead is answering…');
    const box = within(panel).getByRole('textbox', { name: 'Message to the lead agent' });
    expect((box as HTMLTextAreaElement).disabled).toBe(true);
    expect(within(panel).getByRole<HTMLButtonElement>('button', { name: 'Send' }).disabled).toBe(
      true,
    );
  });

  it.each([
    ['no-session', 'This lead never started a conversation, so it can’t be continued.'],
    [
      'session-gone',
      'Claude Code no longer has this conversation (it ages out after 30 days), so it can’t be continued.',
    ],
    ['managed-off', 'Managed agents are off in this app, so this chat can’t be continued.'],
  ] as const)('explains why a chat can’t be continued (%s), with no box', async (reason, text) => {
    const panel = await openPanel(server(followUpScenario({ state: 'unavailable', reason })));
    expect(within(panel).queryByRole('textbox')).toBeNull();
    expect(within(panel).getByText(text)).toBeTruthy();
    expect(within(panel).queryByTestId('chat-notice')).toBeNull();
  });

  it('tags follow-up messages and puts a divider before the first one', async () => {
    const panel = await openPanel(
      server(followUpScenario(available, { messages: FOLLOW_UP_MESSAGES })),
    );
    const bubbles = within(panel).getAllByTestId('chat-message');
    expect(bubbles.map((b) => within(b).queryByTestId('chat-tag')?.textContent ?? null)).toEqual([
      null,
      null,
      'Follow-up',
      'Follow-up',
    ]);
    expect(within(bubbles[2] as HTMLElement).getByTestId('chat-speaker').textContent).toBe('You');
    expect(within(bubbles[3] as HTMLElement).getByTestId('chat-speaker').textContent).toBe(
      'Lead agent',
    );
    const dividers = within(panel).getAllByTestId('chat-divider');
    expect(dividers).toHaveLength(1);
    expect(dividers[0]?.textContent).toBe('After the run ended');
    // Right before the first follow-up bubble.
    expect(dividers[0]?.nextElementSibling).toBe(bubbles[2]);
  });

  it('sends through the chat route with CSRF, then waits for the answer', async () => {
    let sent = false;
    const sc = followUpScenario(available);
    const s = server(sc, {
      [RUN]: () =>
        jsonResponse(
          200,
          sent
            ? {
                ...runOf(sc),
                followUp: running,
                messages: [...runOf(sc).messages, followUpOwnerMessage('Where is the store?')],
              }
            : runOf(sc),
        ),
      [`POST ${RUN}/chat`]: () => {
        sent = true;
        return jsonResponse(
          201,
          ChatMessageDtoSchema.parse(followUpOwnerMessage('Where is the store?')),
        );
      },
    });
    const panel = await openPanel(s);
    const box = within(panel).getByRole('textbox', { name: 'Message to the lead agent' });
    fireEvent.change(box, { target: { value: '  Where is the store?  ' } });
    fireEvent.keyDown(box, { key: 'Enter' });
    await waitFor(() => expect(mutations(s)).toHaveLength(1));
    expect(mutations(s)[0]).toMatchObject({
      method: 'POST',
      path: `${RUN}/chat`,
      body: { text: 'Where is the store?' },
    });
    expect(s.csrf).toEqual([CSRF]);
    // The run is refetched after the send: the box waits, the question is tagged.
    expect((await within(panel).findByRole('status')).textContent).toBe('The lead is answering…');
    expect((box as HTMLTextAreaElement).value).toBe('');
    expect((box as HTMLTextAreaElement).disabled).toBe(true);
    const last = within(panel).getAllByTestId('chat-message').at(-1) as HTMLElement;
    expect(within(last).getByTestId('chat-tag').textContent).toBe('Follow-up');
  });

  it('shows the server’s refusal when a turn is already running', async () => {
    const s = server(followUpScenario(available), {
      [`POST ${RUN}/chat`]: () =>
        jsonResponse(409, {
          error: {
            code: 'follow_up_running',
            message: 'The lead is still answering your last message.',
            requestId: 'req-1',
          },
        }),
    });
    const panel = await openPanel(s);
    const box = within(panel).getByRole('textbox', { name: 'Message to the lead agent' });
    fireEvent.change(box, { target: { value: 'One more thing' } });
    fireEvent.click(within(panel).getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(mutations(s)).toHaveLength(1));
    const alert = (await within(panel).findAllByRole('alert'))[0] as HTMLElement;
    expect(alert.textContent).toContain("Your message wasn't sent.");
    expect(alert.textContent).toContain('The lead is still answering your last message.');
    // The draft is kept so the owner can send it once the answer is in.
    expect((box as HTMLTextAreaElement).value).toBe('One more thing');
  });

  it('works on an earlier run picked in the run picker, and sends to that run', async () => {
    const old = {
      ...runOf(followUpScenario(available)),
      id: OLD_RUN_ID,
      createdAt: '2026-10-14T15:00:00.000Z',
      messages: [],
    };
    const s = server(workingScenario(), {
      [`/api/runs/${OLD_RUN_ID}`]: RunDetailDtoSchema.parse(old),
      [`/api/runs/${OLD_RUN_ID}/checks`]: [],
      [`POST /api/runs/${OLD_RUN_ID}/chat`]: () =>
        jsonResponse(201, { ...followUpOwnerMessage('Why did this run fail?'), runId: OLD_RUN_ID }),
    });
    // The agents are on the Agents tab (v0.3.0 D-B).
    window.location.hash = '#?tab=agents';
    renderWithApi(<TicketPage id={TICKET_ID} />, s);
    fireEvent.change(await screen.findByRole('combobox', { name: 'Run' }), {
      target: { value: OLD_RUN_ID },
    });
    expect(
      await screen.findByText('You are looking at an earlier run of this ticket.'),
    ).toBeTruthy();
    const panel = await screen.findByTestId('side-panel');
    expect(await within(panel).findByTestId('chat-notice')).toBeTruthy();
    fireEvent.change(within(panel).getByRole('textbox', { name: 'Message to the lead agent' }), {
      target: { value: 'Why did this run fail?' },
    });
    fireEvent.click(within(panel).getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(mutations(s)).toHaveLength(1));
    expect(mutations(s)[0]).toMatchObject({ path: `/api/runs/${OLD_RUN_ID}/chat` });
  });

  it('reaches the ended lead on a run still in review; the planner’s chat stays closed', async () => {
    const sc = reviewedScenario();
    const run = { ...runOf(sc), followUp: available };
    const detail = { ...TicketDetailDtoSchema.parse(sc.routes[TICKET]), currentRun: run };
    const s = server(sc, { [RUN]: run, [TICKET]: detail });
    const panel = await openPanel(s);
    expect(within(panel).getByTestId('chat-notice')).toBeTruthy();
    expect(within(screen.getByTestId(`agent-${LEAD}`)).queryByRole('textbox')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Show the Planner in the side panel' }));
    const planner = screen.getByTestId('side-panel');
    expect(within(planner).getByRole('heading', { name: 'Planner' })).toBeTruthy();
    expect(within(planner).queryByRole('textbox')).toBeNull();
    expect(within(screen.getByTestId(`agent-${PLANNER}`)).queryByRole('textbox')).toBeNull();
  });
});
