import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApiClient } from '../../src/lib/api';
import { QueryStore } from '../../src/lib/query-store';
import { useEventStream, type EventSourceLike } from '../../src/lib/useEventStream';
import { fakeServer } from '../helpers';

class FakeEventSource implements EventSourceLike {
  static instances: FakeEventSource[] = [];
  readyState = 0;
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
  open() {
    this.readyState = 1;
    this.onopen?.(new Event('open'));
  }
  send(data: string) {
    this.onmessage?.(new MessageEvent('message', { data }));
  }
  fail() {
    this.readyState = 2;
    this.onerror?.(new Event('error'));
  }
}

const factory = (url: string) => new FakeEventSource(url);

describe('useEventStream', () => {
  beforeEach(() => {
    FakeEventSource.instances = [];
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  function setup() {
    const store = new QueryStore(createApiClient(fakeServer({}).fetch));
    const invalidate = vi.spyOn(store, 'invalidate');
    const hook = renderHook(() => useEventStream(store, factory));
    return { store, invalidate, hook };
  }

  it('connects to the stream and invalidates affected queries on a notice', () => {
    const { invalidate, hook } = setup();
    const es = FakeEventSource.instances[0];
    expect(es?.url).toBe('/api/events/stream');
    act(() => es?.open());
    expect(hook.result.current.status).toBe('open');
    act(() =>
      es?.send(
        JSON.stringify({
          kind: 'events-ingested',
          lastEventId: 12,
          sessionIds: ['s-1'],
          projectIds: [],
        }),
      ),
    );
    expect(invalidate).toHaveBeenCalledTimes(1);
    expect(hook.result.current.lastEventId).toBe(12);
  });

  it('counts an invalid notice instead of ignoring it', () => {
    const { invalidate, hook } = setup();
    act(() => FakeEventSource.instances[0]?.send('{"kind":"rows","data":[1]}'));
    expect(invalidate).not.toHaveBeenCalled();
    expect(hook.result.current.invalidNotices).toBe(1);
  });

  it('reconnects with backoff after the browser gives up, then refetches everything', () => {
    const { invalidate, hook } = setup();
    act(() => FakeEventSource.instances[0]?.fail());
    expect(hook.result.current.status).toBe('reconnecting');
    expect(FakeEventSource.instances).toHaveLength(1);
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(FakeEventSource.instances).toHaveLength(2);
    act(() => FakeEventSource.instances[1]?.open());
    expect(hook.result.current.status).toBe('open');
    expect(invalidate).toHaveBeenCalledTimes(1);
  });

  it('closes the connection on unmount', () => {
    const { hook } = setup();
    hook.unmount();
    expect(FakeEventSource.instances[0]?.closed).toBe(true);
  });
});
