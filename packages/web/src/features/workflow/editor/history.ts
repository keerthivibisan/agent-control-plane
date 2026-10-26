import type { WorkflowGraph } from '@acp/core';
import {
  editorReducer,
  initialEditorState,
  sameGraph,
  stillThere,
  type EditorAction,
  type EditorState,
} from './state';

/**
 * Undo and redo for the graph editor (v0.3.1 P-C), around the pure editor reducer. Every action
 * that changes the graph (a link added, removed or moved, a block added, removed or moved, a panel
 * edit, a template, Tidy layout) puts the graph before it on the undo stack; selecting, refusing
 * and other actions that leave the graph as it was are not recorded. Typing in one field is one
 * step: consecutive edits of the same fields of one block (or one link's rounds) share an entry.
 * The stacks hold at most `HISTORY_LIMIT` graphs. Unsaved changes still follow the graph alone,
 * so undoing back to the saved graph clears "Unsaved changes".
 */

export const HISTORY_LIMIT = 50;

export type HistoryAction =
  | EditorAction
  | { type: 'undo' }
  | { type: 'redo' }
  /** Several actions as one step (a block and its links deleted with one key). */
  | { type: 'batch'; actions: readonly EditorAction[] };

export interface HistoryState extends EditorState {
  past: readonly WorkflowGraph[];
  future: readonly WorkflowGraph[];
  /** The last recorded edit's group, so the next edit of the same fields joins it. */
  group: string | null;
}

export function initialHistoryState(graph: WorkflowGraph): HistoryState {
  return { ...initialEditorState(graph), past: [], future: [], group: null };
}

/** Edits that join the previous one when they repeat (typing a name, stepping the rounds). */
function groupOf(action: EditorAction): string | null {
  if (action.type === 'update-node') {
    return `update:${action.id}:${Object.keys(action.patch).sort().join(',')}`;
  }
  if (action.type === 'set-rounds') return `rounds:${action.id}`;
  return null;
}

function editorPart(state: HistoryState): EditorState {
  return { graph: state.graph, selection: state.selection, refusal: state.refusal };
}

function record(state: HistoryState, next: EditorState, group: string | null): HistoryState {
  if (next.graph === state.graph || sameGraph(next.graph, state.graph)) {
    // Nothing changed in the graph: keep its identity (the canvas's memos) and the stacks.
    return { ...state, selection: next.selection, refusal: next.refusal };
  }
  const joins = group !== null && group === state.group && state.past.length > 0;
  return {
    ...next,
    past: joins ? state.past : [...state.past, state.graph].slice(-HISTORY_LIMIT),
    future: [],
    group,
  };
}

export function historyReducer(state: HistoryState, action: HistoryAction): HistoryState {
  switch (action.type) {
    case 'undo': {
      const previous = state.past[state.past.length - 1];
      if (previous === undefined) return state;
      return {
        graph: previous,
        selection: stillThere(previous, state.selection),
        refusal: null,
        past: state.past.slice(0, -1),
        future: [state.graph, ...state.future].slice(0, HISTORY_LIMIT),
        group: null,
      };
    }
    case 'redo': {
      const next = state.future[0];
      if (next === undefined) return state;
      return {
        graph: next,
        selection: stillThere(next, state.selection),
        refusal: null,
        past: [...state.past, state.graph].slice(-HISTORY_LIMIT),
        future: state.future.slice(1),
        group: null,
      };
    }
    case 'batch':
      return record(state, action.actions.reduce(editorReducer, editorPart(state)), null);
    default:
      return record(state, editorReducer(editorPart(state), action), groupOf(action));
  }
}
