import { StreamNoticeDtoSchema } from '@acp/core/api';
import { useEffect, useState } from 'react';
import { paths } from './api';
import { affectedBy } from './invalidation';
import type { QueryStore } from './query-store';

export type StreamStatus = 'connecting' | 'open' | 'reconnecting' | 'unsupported';

export interface StreamState {
  status: StreamStatus;
  /** Notices whose `data:` did not match StreamNoticeDto. Shown in the shell, never ignored. */
  invalidNotices: number;
  lastInvalidNotice: string | null;
  lastEventId: number | null;
}

/** The subset of EventSource the hook uses, so tests can drive it. */
export interface EventSourceLike {
  readonly readyState: number;
  onopen: ((ev: Event) => void) | null;
  onmessage: ((ev: MessageEvent) => void) | null;
  onerror: ((ev: Event) => void) | null;
  close(): void;
}
export type EventSourceFactory = (url: string) => EventSourceLike;

const CLOSED = 2;
const MAX_BACKOFF_MS = 30_000;

export const browserEventSource: EventSourceFactory | null =
  typeof EventSource === 'undefined' ? null : (url) => new EventSource(url);

/**
 * Subscribes to `/api/events/stream` and refetches affected queries on every notice.
 *
 * Reconnects: the browser retries dropped connections itself; when it gives up (readyState CLOSED,
 * e.g. the dev proxy answered 502), we reconnect with capped exponential backoff. After any
 * interruption every query is refetched, because notices may have been missed.
 */
export function useEventStream(
  store: QueryStore,
  factory: EventSourceFactory | null = browserEventSource,
): StreamState {
  const [state, setState] = useState<StreamState>({
    status: 'connecting',
    invalidNotices: 0,
    lastInvalidNotice: null,
    lastEventId: null,
  });

  useEffect(() => {
    if (factory === null) return;
    let source: EventSourceLike | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let attempt = 0;
    let interrupted = false;
    let disposed = false;

    const connect = () => {
      const es = factory(paths.stream());
      source = es;
      es.onopen = () => {
        attempt = 0;
        setState((s) => ({ ...s, status: 'open' }));
        if (interrupted) store.invalidateAll();
        interrupted = false;
      };
      es.onmessage = (ev: MessageEvent) => {
        let raw: unknown;
        try {
          raw = JSON.parse(String(ev.data));
        } catch {
          raw = undefined;
        }
        const parsed = StreamNoticeDtoSchema.safeParse(raw);
        if (!parsed.success) {
          setState((s) => ({
            ...s,
            invalidNotices: s.invalidNotices + 1,
            lastInvalidNotice: parsed.error.issues.map((i) => i.message).join('; '),
          }));
          return;
        }
        store.invalidate(affectedBy(parsed.data));
        setState((s) => ({ ...s, lastEventId: parsed.data.lastEventId }));
      };
      es.onerror = () => {
        interrupted = true;
        setState((s) => ({ ...s, status: 'reconnecting' }));
        if (es.readyState === CLOSED && !disposed) {
          es.close();
          const delay = Math.min(MAX_BACKOFF_MS, 1000 * 2 ** attempt);
          attempt += 1;
          timer = setTimeout(connect, delay);
        }
      };
    };

    connect();
    return () => {
      disposed = true;
      if (timer !== null) clearTimeout(timer);
      source?.close();
    };
  }, [store, factory]);

  return factory === null ? { ...state, status: 'unsupported' } : state;
}
