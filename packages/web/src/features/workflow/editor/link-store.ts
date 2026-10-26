import { createContext, useContext, useSyncExternalStore } from 'react';
import type { LinkTarget } from './nodes';

/**
 * What the canvas is linking right now (v0.3.1 P-C), outside React state: a link being dragged,
 * a link started with a click, or a link end being moved. The blocks and links read only their own
 * part (`useLinkState` with a selector), so while the pointer moves only the block under it and the
 * one it leaves re-render, never the whole graph.
 */

export type LinkMode = 'drag' | 'click' | 'reconnect';

export interface LinkState {
  /** The block the link starts from (for a moved end: the end that stays). */
  from: string | null;
  mode: LinkMode | null;
  /** Every drawn block: the start, a valid end or not (core's `canConnect`). */
  targets: ReadonlyMap<string, LinkTarget> | null;
  /** The block the link would end on if dropped now (under the pointer, or the nearest valid). */
  snap: string | null;
}

export const IDLE: LinkState = { from: null, mode: null, targets: null, snap: null };

export interface LinkStore {
  get: () => LinkState;
  set: (patch: Partial<LinkState>) => void;
  reset: () => void;
  subscribe: (listener: () => void) => () => void;
}

export function createLinkStore(): LinkStore {
  let state = IDLE;
  const listeners = new Set<() => void>();
  const emit = () => {
    for (const l of listeners) l();
  };
  return {
    get: () => state,
    set: (patch) => {
      const next = { ...state, ...patch };
      if (
        next.from === state.from &&
        next.mode === state.mode &&
        next.targets === state.targets &&
        next.snap === state.snap
      ) {
        return;
      }
      state = next;
      emit();
    },
    reset: () => {
      if (state === IDLE) return;
      state = IDLE;
      emit();
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

export const LinkStoreContext = createContext<LinkStore | null>(null);

const noSubscribe = () => () => undefined;

/**
 * A part of the link state (a primitive, so React compares it cheaply); the idle state when there
 * is no store (a block drawn outside the editor's canvas).
 */
export function useLinkState<T>(select: (s: LinkState) => T, own?: LinkStore | null): T {
  const fromContext = useContext(LinkStoreContext);
  const store = own ?? fromContext;
  return useSyncExternalStore(
    store?.subscribe ?? noSubscribe,
    () => select(store?.get() ?? IDLE),
    () => select(IDLE),
  );
}

/** What a block's click-to-link connector does (set by the canvas). */
export interface LinkActions {
  /** A click (or Enter) on a block's connector: start a link from it, or end the pending one. */
  connector: (nodeId: string) => void;
}

export const LinkActionsContext = createContext<LinkActions | null>(null);
