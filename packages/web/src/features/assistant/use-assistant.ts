import type { AgentEffort, ManagedProviderId } from '@acp/core';
import {
  AssistantStreamEventSchema,
  type AssistantMode,
  type AssistantProposalDto,
  type AssistantSessionDto,
  type AssistantStreamEvent,
} from '@acp/core/api';
import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import {
  ApiError,
  applyAssistantProposal,
  assistantPaths,
  discardAssistantProposal,
  endAssistant,
  getAssistantSession,
  sendAssistantMessage,
  setAssistantMode,
  startAssistant,
} from '../../lib/api';
import { ASSISTANT_COPY } from '../../lib/copy';
import { useQueryStore } from '../../lib/query';
import type { EventSourceFactory, EventSourceLike } from '../../lib/useEventStream';

const C = ASSISTANT_COPY;

/** The header's choices. `model` '' means the provider's default (sent as null). */
export interface AssistantPickers {
  provider: ManagedProviderId;
  model: string;
  effort: AgentEffort;
  mode: AssistantMode;
}

/** `sonnet` for Claude Code; Codex runs its own default (ADR-0035 §2). */
export function defaultModel(provider: ManagedProviderId): string {
  return provider === 'claude-code' ? 'sonnet' : '';
}

export const DEFAULT_PICKERS: AssistantPickers = {
  provider: 'claude-code',
  model: defaultModel('claude-code'),
  effort: 'medium',
  mode: 'approve',
};

export type ChatItem =
  | { key: string; kind: 'owner' | 'assistant' | 'activity'; text: string }
  | { key: string; kind: 'proposal'; id: string }
  | { key: string; kind: 'error'; text: string; hint: string | null }
  | { key: string; kind: 'ended'; text: string };

interface ChatState {
  session: AssistantSessionDto | null;
  items: ChatItem[];
  proposals: Record<string, AssistantProposalDto>;
}

type Action =
  | { type: 'session'; session: AssistantSessionDto | null }
  | { type: 'mode'; mode: AssistantMode }
  | { type: 'append'; item: ChatItem }
  | { type: 'proposal'; proposal: AssistantProposalDto }
  | { type: 'ended'; key: string; text: string }
  | { type: 'reset' };

const EMPTY: ChatState = { session: null, items: [], proposals: {} };

function reducer(state: ChatState, action: Action): ChatState {
  switch (action.type) {
    case 'session':
      return { ...state, session: action.session };
    case 'mode':
      return state.session ? { ...state, session: { ...state.session, mode: action.mode } } : state;
    case 'append':
      return { ...state, items: [...state.items, action.item] };
    case 'proposal': {
      const { proposal } = action;
      const known = proposal.id in state.proposals;
      return {
        ...state,
        proposals: { ...state.proposals, [proposal.id]: proposal },
        // A changed proposal updates its card in place; a new one adds a card.
        items: known
          ? state.items
          : [...state.items, { key: `proposal:${proposal.id}`, kind: 'proposal', id: proposal.id }],
      };
    }
    case 'ended': {
      const session =
        state.session && live(state.session)
          ? { ...state.session, status: 'ended' as const }
          : state.session;
      // One "ended" line per chat: the server's reason replaces the panel's own words.
      const at = state.items.findIndex((i) => i.kind === 'ended');
      const item: ChatItem = { key: action.key, kind: 'ended', text: action.text };
      const items =
        at === -1 ? [...state.items, item] : state.items.map((i, n) => (n === at ? item : i));
      return { ...state, session, items };
    }
    case 'reset':
      return EMPTY;
  }
}

/** A session that can still take messages. */
export function live(session: AssistantSessionDto | null): session is AssistantSessionDto {
  return session !== null && session.status !== 'ended' && session.status !== 'failed';
}

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

let keySeq = 0;
const nextKey = (prefix: string) => `${prefix}:local:${++keySeq}`;

/**
 * The project assistant's chat (ADR-0035): the session, the messages and proposals of this page's
 * life (never stored: a reload starts empty, and the stream then sends the status and any pending
 * proposal), and the stream, open while the panel is open and a session exists.
 *
 * Stream ids: a fresh connection sends the status and every pending proposal under one id, so only
 * the events that append to the chat (text, activity, error, ended) are skipped when their id was
 * seen; a status or proposal replaces what the panel shows, so a repeat changes nothing.
 */
export function useAssistant({
  projectId,
  open,
  eventSource,
}: {
  projectId: string;
  open: boolean;
  eventSource: EventSourceFactory | null;
}) {
  const client = useQueryStore().client;
  const [state, dispatch] = useReducer(reducer, EMPTY);
  const [pickers, setPickers] = useState<AssistantPickers>(DEFAULT_PICKERS);
  const [sending, setSending] = useState(false);
  const [busy, setBusy] = useState(false);

  const sessionRef = useRef<AssistantSessionDto | null>(null);
  const sourceRef = useRef<EventSourceLike | null>(null);
  const seen = useRef(new Set<string>());
  // Sessions the owner left (New chat, a restart): their late events are not this chat's.
  const abandoned = useRef(new Set<string>());

  const setSession = useCallback((session: AssistantSessionDto | null) => {
    sessionRef.current = session;
    dispatch({ type: 'session', session });
  }, []);

  const showError = useCallback(
    (e: unknown, provider: ManagedProviderId) => {
      const unavailable = e instanceof ApiError && e.kind === 'http' && e.status === 409;
      dispatch({
        type: 'append',
        item: {
          key: nextKey('error'),
          kind: 'error',
          text: unavailable ? C.unavailable(e.message) : message(e),
          hint: unavailable && provider === 'codex' ? C.codexHint : null,
        },
      });
    },
    [dispatch],
  );

  const onEvent = useCallback(
    (event: AssistantStreamEvent, id: string) => {
      if (event.type === 'status') {
        const s = event.session;
        if (s === null) {
          if (sessionRef.current !== null && live(sessionRef.current)) setSession(null);
          return;
        }
        if (abandoned.current.has(s.id)) return;
        setSession(s);
        return;
      }
      // Nothing is this chat's before it has a session (e.g. late events of an abandoned one).
      if (sessionRef.current === null) return;
      if (event.type === 'proposal') {
        dispatch({ type: 'proposal', proposal: event.proposal });
        return;
      }
      const key = `${event.type}:${id}`;
      if (id !== '') {
        if (seen.current.has(key)) return;
        seen.current.add(key);
      }
      const itemKey = id === '' ? nextKey(event.type) : key;
      switch (event.type) {
        case 'text':
          dispatch({ type: 'append', item: { key: itemKey, kind: 'assistant', text: event.full } });
          return;
        case 'activity':
          dispatch({
            type: 'append',
            item: { key: itemKey, kind: 'activity', text: event.summary },
          });
          return;
        case 'error':
          dispatch({
            type: 'append',
            item: { key: itemKey, kind: 'error', text: event.message, hint: null },
          });
          return;
        case 'ended': {
          const s = sessionRef.current;
          if (live(s)) sessionRef.current = { ...s, status: 'ended' };
          dispatch({ type: 'ended', key: itemKey, text: event.message });
          return;
        }
      }
    },
    [setSession],
  );

  const attach = useCallback(() => {
    if (eventSource === null || sourceRef.current !== null) return;
    const es = eventSource(assistantPaths.stream(projectId));
    sourceRef.current = es;
    es.onmessage = (ev: MessageEvent) => {
      let raw: unknown;
      try {
        raw = JSON.parse(String(ev.data));
      } catch {
        raw = undefined;
      }
      const parsed = AssistantStreamEventSchema.safeParse(raw);
      if (!parsed.success) {
        dispatch({
          type: 'append',
          item: { key: nextKey('bad'), kind: 'error', text: C.badEvent, hint: null },
        });
        return;
      }
      onEvent(parsed.data, ev.lastEventId ?? '');
    };
    // Reconnecting is the browser's own (the server sends `retry:`); nothing to do here.
    es.onerror = null;
  }, [eventSource, projectId, onEvent]);

  const detach = useCallback(() => {
    sourceRef.current?.close();
    sourceRef.current = null;
  }, []);

  const hasSession = state.session !== null;

  // Opening the panel finds a chat that outlived a reload (or another tab started).
  useEffect(() => {
    if (!open || sessionRef.current !== null) return;
    let cancelled = false;
    getAssistantSession(client, projectId).then(
      (s) => {
        if (cancelled || s === null || sessionRef.current !== null) return;
        setSession(s);
        setPickers({ provider: s.provider, model: s.model ?? '', effort: s.effort, mode: s.mode });
      },
      () => {
        // No chat to show; the first message starts one and reports any error.
      },
    );
    return () => {
      cancelled = true;
    };
  }, [open, client, projectId, setSession]);

  useEffect(() => {
    if (open && hasSession) attach();
    if (!open) detach();
  }, [open, hasSession, attach, detach]);

  useEffect(() => detach, [detach]);

  const start = useCallback(
    async (p: AssistantPickers) => {
      const s = await startAssistant(client, projectId, {
        provider: p.provider,
        model: p.model.trim() === '' ? null : p.model.trim(),
        effort: p.effort,
        mode: p.mode,
      });
      setSession(s);
      attach();
      return s;
    },
    [client, projectId, setSession, attach],
  );

  /** The first message starts the chat with the header's choices, then the message goes. */
  const send = useCallback(
    async (text: string) => {
      const t = text.trim();
      if (t === '' || sending) return false;
      setSending(true);
      dispatch({ type: 'append', item: { key: nextKey('owner'), kind: 'owner', text: t } });
      try {
        if (!live(sessionRef.current)) await start(pickers);
        const after = await sendAssistantMessage(client, projectId, t);
        // With the stream attached its status is newer than this answer; without it, use this.
        if (sourceRef.current === null) setSession(after);
        return true;
      } catch (e) {
        showError(e, pickers.provider);
        return false;
      } finally {
        setSending(false);
      }
    },
    [sending, start, pickers, client, projectId, setSession, showError],
  );

  /** Leaves the current chat: its late events are ignored, the panel starts empty. */
  const leave = useCallback(async () => {
    const s = sessionRef.current;
    if (s !== null) abandoned.current.add(s.id);
    setSession(null);
    dispatch({ type: 'reset' });
    if (live(s)) await endAssistant(client, projectId);
  }, [client, projectId, setSession]);

  const run = useCallback(
    async (work: () => Promise<unknown>, provider: ManagedProviderId) => {
      setBusy(true);
      try {
        await work();
      } catch (e) {
        showError(e, provider);
      } finally {
        setBusy(false);
      }
    },
    [showError],
  );

  /** Provider, model or effort changed: a new chat with the new choices (ADR-0035 §2). */
  const restart = useCallback(
    (next: AssistantPickers) =>
      run(async () => {
        setPickers(next);
        await leave();
        await start(next);
      }, next.provider),
    [run, leave, start],
  );

  const newChat = useCallback(() => run(leave, pickers.provider), [run, leave, pickers.provider]);

  const end = useCallback(
    () =>
      run(async () => {
        await endAssistant(client, projectId);
        const s = sessionRef.current;
        if (live(s)) sessionRef.current = { ...s, status: 'ended' };
        dispatch({ type: 'ended', key: nextKey('ended'), text: C.ended });
      }, pickers.provider),
    [run, client, projectId, pickers.provider],
  );

  /** Mode switches without a restart: the server's chat keeps going. */
  const changeMode = useCallback(
    (mode: AssistantMode) => {
      setPickers((p) => ({ ...p, mode }));
      if (!live(sessionRef.current)) return Promise.resolve();
      return run(async () => {
        const s = await setAssistantMode(client, projectId, mode);
        dispatch({ type: 'mode', mode: s.mode });
      }, pickers.provider);
    },
    [run, client, projectId, pickers.provider],
  );

  const decide = useCallback(
    async (proposalId: string, decision: 'apply' | 'discard') => {
      const call = decision === 'apply' ? applyAssistantProposal : discardAssistantProposal;
      const proposal = await call(client, projectId, proposalId);
      dispatch({ type: 'proposal', proposal });
    },
    [client, projectId],
  );

  return {
    session: state.session,
    items: state.items,
    proposals: state.proposals,
    pickers,
    setPickers,
    sending,
    busy,
    send,
    restart,
    newChat,
    end,
    changeMode,
    decide,
  };
}

export type AssistantChat = ReturnType<typeof useAssistant>;
