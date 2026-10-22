import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseDiff } from '../../src/components/diff';
import {
  COMMENT_MAX,
  REQUEST_CHANGES_MAX,
  REWORK_MAX,
  defaultChoice,
  reviewChoices,
} from '../../src/features/review/choices';
import {
  compileFor,
  compileReview,
  lineRef,
  sortComments,
} from '../../src/features/review/compile';
import { buildFileTree, filterFiles, treeOrder } from '../../src/features/review/file-tree';
import { shortcutFor } from '../../src/features/review/keyboard';
import {
  EMPTY_REVIEW,
  addComment,
  deleteComment,
  editComment,
  isEmptyReview,
  parsePending,
  pendingKey,
  readPending,
  setSummary,
  writePending,
  type PendingComment,
  type PendingReview,
} from '../../src/features/review/pending-review';
import { resetReviewStorageForTests } from '../../src/features/review/storage';
import {
  parseViewed,
  readViewed,
  toggleViewed,
  viewedKey,
  writeViewed,
} from '../../src/features/review/viewed';
import { ADDED, DELETED, MODIFIED, RENAMED_EDITED } from '../components/diff/fixtures';

/*
 * v0.3.0 D-A: the review page's rules, without a DOM: the pending review and its storage, the text
 * compiled for the owner's decision endpoints and their limits, the choices per state, the file
 * tree and its filter, the viewed files per commit, and the keys.
 */

const SCOPE = { runId: 'run-1', agentRunId: 'ag-1' };
const BRANCH = { runId: 'run-1', agentRunId: null };
const NOW = new Date(Date.UTC(2026, 9, 22, 9, 0));

function comment(over: Partial<PendingComment> = {}): PendingComment {
  return {
    id: 'c1',
    path: 'src/api.ts',
    side: 'new',
    line: 42,
    endLine: 42,
    body: 'cap the page size at 100.',
    commit: 'aaaaaaa1111',
    createdAt: NOW.toISOString(),
    ...over,
  };
}

beforeEach(() => {
  window.localStorage.clear();
  resetReviewStorageForTests();
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('pending review: add, edit, delete', () => {
  it('adds a trimmed comment and orders a range from low to high', () => {
    const r = addComment(
      EMPTY_REVIEW,
      { path: 'a.ts', side: 'old', line: 14, endLine: 10, body: '  why?  ', commit: null },
      'id-1',
      NOW,
    );
    expect(r.comments).toEqual([
      {
        id: 'id-1',
        path: 'a.ts',
        side: 'old',
        line: 10,
        endLine: 14,
        body: 'why?',
        commit: null,
        createdAt: NOW.toISOString(),
      },
    ]);
  });

  it('ignores an empty comment', () => {
    const r = addComment(
      EMPTY_REVIEW,
      { path: 'a.ts', side: 'new', line: 1, endLine: 1, body: '   ', commit: null },
      'x',
      NOW,
    );
    expect(r).toBe(EMPTY_REVIEW);
  });

  it('edits one comment, and an emptied comment is deleted', () => {
    const r: PendingReview = { comments: [comment(), comment({ id: 'c2' })], summary: '' };
    expect(editComment(r, 'c2', ' new text ').comments.map((c) => c.body)).toEqual([
      'cap the page size at 100.',
      'new text',
    ]);
    expect(editComment(r, 'c2', '  ').comments.map((c) => c.id)).toEqual(['c1']);
    expect(deleteComment(r, 'c1').comments.map((c) => c.id)).toEqual(['c2']);
  });

  it('is empty without comments and without an overall comment', () => {
    expect(isEmptyReview(EMPTY_REVIEW)).toBe(true);
    expect(isEmptyReview(setSummary(EMPTY_REVIEW, '  '))).toBe(true);
    expect(isEmptyReview(setSummary(EMPTY_REVIEW, 'ok'))).toBe(false);
  });
});

describe('pending review: kept in this browser', () => {
  it('persists per change and per ticket branch, and is removed once empty (after submit)', () => {
    const r = { comments: [comment()], summary: 'Otherwise good.' };
    writePending(SCOPE, r);
    expect(window.localStorage.getItem(pendingKey(SCOPE))).not.toBeNull();
    expect(readPending(SCOPE)).toEqual(r);
    expect(readPending(BRANCH)).toEqual(EMPTY_REVIEW);
    expect(pendingKey(BRANCH)).toBe('acp.review.pending.run-1:branch');

    // Submit clears it: nothing is left in storage.
    writePending(SCOPE, EMPTY_REVIEW);
    expect(window.localStorage.getItem(pendingKey(SCOPE))).toBeNull();
    expect(readPending(SCOPE)).toEqual(EMPTY_REVIEW);
  });

  it('reads stored text as data: junk is ignored and bad comments are dropped', () => {
    expect(parsePending('not json')).toEqual(EMPTY_REVIEW);
    expect(parsePending('[1,2]')).toEqual(EMPTY_REVIEW);
    expect(parsePending('null')).toEqual(EMPTY_REVIEW);
    const stored = JSON.stringify({
      v: 1,
      summary: 7,
      comments: [
        comment(),
        { ...comment({ id: 'bad-side' }), side: 'left' },
        { ...comment({ id: 'bad-line' }), line: 0 },
        { ...comment({ id: 'bad-range' }), line: 9, endLine: 3 },
        { ...comment({ id: 'blank' }), body: '  ' },
        { ...comment({ id: 'bad-commit' }), commit: 5 },
        'text',
      ],
    });
    expect(parsePending(stored)).toEqual({ comments: [comment()], summary: '' });
  });

  it('keeps the review for the page when storage refuses it', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    const r = { comments: [comment()], summary: '' };
    writePending(SCOPE, r);
    expect(window.localStorage.getItem(pendingKey(SCOPE))).toBeNull();
    expect(readPending(SCOPE)).toEqual(r);
  });

  it('reads nothing when storage itself is blocked', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    expect(readPending(SCOPE)).toEqual(EMPTY_REVIEW);
  });
});

describe('compiled text for the owner’s decision', () => {
  it('names each line like src/api.ts:42 (new) and a range with an en dash', () => {
    expect(lineRef(comment())).toBe('src/api.ts:42 (new)');
    expect(lineRef(comment({ line: 10, endLine: 14, side: 'old' }))).toBe('src/api.ts:10–14 (old)');
  });

  it('lists the comments in the diff’s order, then the overall comment', () => {
    const order = (p: string) => ['src/b.ts', 'src/api.ts'].indexOf(p);
    const r: PendingReview = {
      comments: [
        comment({ id: '3', line: 10, endLine: 14, side: 'old', body: 'keep this check.' }),
        comment({ id: '1', body: 'cap the page size at 100.' }),
        comment({ id: '2', path: 'src/b.ts', line: 3, endLine: 3, body: 'first file' }),
      ],
      summary: '  Please also update the docs.  ',
    };
    expect(compileReview(r, { order, commit: 'aaaaaaa1111' })).toBe(
      [
        'Review comments:',
        '- src/b.ts:3 (new): first file',
        '- src/api.ts:10–14 (old): keep this check.',
        '- src/api.ts:42 (new): cap the page size at 100.',
        'Please also update the docs.',
      ].join('\n'),
    );
  });

  it('indents a comment’s later lines and marks one written on an earlier commit', () => {
    const r: PendingReview = {
      comments: [comment({ body: 'first\n\nsecond', commit: 'bbbbbbb2222' })],
      summary: '',
    };
    expect(compileReview(r, { commit: 'aaaaaaa1111' })).toBe(
      'Review comments:\n- src/api.ts:42 (new, written on bbbbbbb): first\n\n  second',
    );
  });

  it('is only the overall comment without line comments, and empty with neither', () => {
    expect(compileReview(setSummary(EMPTY_REVIEW, 'Looks good.'))).toBe('Looks good.');
    expect(compileFor(EMPTY_REVIEW, REWORK_MAX)).toMatchObject({ text: '', empty: true });
  });

  it('measures against the endpoint’s limit and never cuts the text', () => {
    const long = { comments: [comment({ body: 'x'.repeat(REWORK_MAX) })], summary: '' };
    const rework = compileFor(long, REWORK_MAX);
    expect(rework.fits).toBe(false);
    expect(rework.length).toBe(rework.text.length);
    expect(rework.text.endsWith('x'.repeat(100))).toBe(true);
    expect(rework.length).toBeGreaterThan(REWORK_MAX);
    // The same review fits the lead's and the comment's larger limit.
    expect(compileFor(long, REQUEST_CHANGES_MAX).fits).toBe(true);
    expect(compileFor(long, COMMENT_MAX).fits).toBe(true);
    // Exactly at the limit fits.
    const exact = setSummary(EMPTY_REVIEW, 'y'.repeat(REWORK_MAX));
    expect(compileFor(exact, REWORK_MAX)).toMatchObject({ fits: true, length: REWORK_MAX });
  });

  it('sorts the old side before the new on the same line', () => {
    const sorted = sortComments([
      comment({ id: 'n', side: 'new', line: 5, endLine: 5 }),
      comment({ id: 'o', side: 'old', line: 5, endLine: 5 }),
    ]);
    expect(sorted.map((c) => c.id)).toEqual(['o', 'n']);
  });
});

describe('the choices by state', () => {
  const liveLead = { agents: [{ kind: 'lead', status: 'RUNNING' }] } as never;
  const endedLead = { agents: [{ kind: 'lead', status: 'SUCCEEDED' }] } as never;

  it('offers rework for a change that waits for the owner, Comment always', () => {
    const choices = reviewChoices({
      kind: 'change',
      run: liveLead,
      change: { state: 'needs-owner' },
    });
    expect(choices).toEqual([
      { id: 'rework', enabled: true, reason: null, max: 4000 },
      { id: 'comment', enabled: true, reason: null, max: 8000 },
    ]);
    expect(defaultChoice(choices)).toBe('rework');
  });

  it('opens rework once the lead has ended, for an undecided change', () => {
    const [rework] = reviewChoices({
      kind: 'change',
      run: endedLead,
      change: { state: 'decision' },
    });
    expect(rework?.enabled).toBe(true);
  });

  it('disables rework with the reason in every other state', () => {
    const reason = (state: string, run = liveLead) =>
      reviewChoices({ kind: 'change', run, change: { state } as never })[0]?.reason;
    expect(reason('reviewing')).toMatch(/The lead decides this change now/);
    expect(reason('merged', endedLead)).toMatch(/already merged/);
    expect(reason('discarded', endedLead)).toMatch(/was discarded/);
    expect(reason('no-changes', endedLead)).toMatch(/without changing any file/);
    expect(reason('sealing', endedLead)).toMatch(/still being saved/);
    const legacy = reviewChoices({ kind: 'change', run: liveLead, change: null });
    expect(legacy[0]?.enabled).toBe(false);
    expect(legacy[0]?.reason).toMatch(/no review loop/);
    expect(defaultChoice(legacy)).toBe('comment');
  });

  it('offers Request changes to the lead only while the branch waits for the final step', () => {
    const at = (status: string, state: 'open' | 'merged' | 'discarded' = 'open') =>
      reviewChoices({ kind: 'branch', run: { status } as never, branch: { state } })[0];
    expect(at('REVIEW')).toEqual({
      id: 'request-changes',
      enabled: true,
      reason: null,
      max: 8000,
    });
    expect(at('NEEDS_REVIEW')?.enabled).toBe(true);
    expect(at('RUNNING')?.reason).toMatch(/still working/);
    expect(at('FAILED')?.reason).toMatch(/no lead to send changes to/);
    expect(at('COMPLETED', 'merged')?.reason).toMatch(/already merged/);
    expect(at('COMPLETED', 'discarded')?.reason).toMatch(/was discarded/);
    expect(
      reviewChoices({ kind: 'branch', run: { status: 'RUNNING' } as never, branch: null })[0]
        ?.reason,
    ).toMatch(/no ticket branch yet/);
  });
});

describe('the file tree', () => {
  const files = parseDiff(
    [
      MODIFIED,
      ADDED,
      DELETED,
      RENAMED_EDITED,
      'diff --git a/README.md b/README.md\n--- a/README.md\n+++ b/README.md\n@@ -1 +1 @@\n-a\n+b',
    ].join('\n'),
  ).files;

  it('puts folders first, folds single-folder chains, and orders files by name', () => {
    const tree = buildFileTree(files);
    expect(tree.map((n) => n.name)).toEqual(['docs', 'lib', 'src', 'README.md']);
    const src = tree.find((n) => n.name === 'src');
    expect(src?.kind === 'folder' ? src.children.map((n) => n.name) : []).toEqual([
      'search',
      'old.ts',
    ]);
    expect(treeOrder(tree).map((f) => f.path)).toEqual([
      'docs/notes.md',
      'lib/helpers.py',
      'src/search/api.ts',
      'src/old.ts',
      'README.md',
    ]);
  });

  it('folds a chain of folders into one entry', () => {
    const deep = parseDiff(ADDED.replaceAll('docs/notes.md', 'a/b/c/notes.md')).files;
    const [only] = buildFileTree(deep);
    expect(only).toMatchObject({ kind: 'folder', name: 'a/b/c', path: 'a/b/c' });
  });

  it('filters by every word of the query, ignoring case, old paths included', () => {
    expect(filterFiles(files, '').length).toBe(5);
    expect(filterFiles(files, 'SEARCH').map((f) => f.path)).toEqual(['src/search/api.ts']);
    expect(filterFiles(files, 'src ts').map((f) => f.path)).toEqual([
      'src/search/api.ts',
      'src/old.ts',
    ]);
    // A rename matches by its old name too.
    expect(filterFiles(files, 'util.py').map((f) => f.path)).toEqual(['lib/helpers.py']);
    expect(filterFiles(files, 'nothing-like-this')).toEqual([]);
  });
});

describe('viewed files', () => {
  it('are kept per change and commit', () => {
    writeViewed(SCOPE, 'c1', new Set(['b.ts', 'a.ts']));
    expect([...readViewed(SCOPE, 'c1')].sort()).toEqual(['a.ts', 'b.ts']);
    expect(window.localStorage.getItem(viewedKey(SCOPE, 'c1'))).toBe('["a.ts","b.ts"]');
    expect(readViewed(SCOPE, 'c2').size).toBe(0);
    expect(readViewed(BRANCH, 'c1').size).toBe(0);
    expect(viewedKey(BRANCH, null)).toBe('acp.review.viewed.run-1:branch@none');
  });

  it('drops the lists of older commits when a new commit is marked', () => {
    writeViewed(SCOPE, 'c1', new Set(['a.ts']));
    writeViewed(BRANCH, 'c1', new Set(['a.ts']));
    writeViewed(SCOPE, 'c2', new Set(['b.ts']));
    expect(window.localStorage.getItem(viewedKey(SCOPE, 'c1'))).toBeNull();
    expect(readViewed(BRANCH, 'c1').size).toBe(1);
  });

  it('toggles a path and reads junk as nothing viewed', () => {
    expect([...toggleViewed(new Set(['a']), 'b')]).toEqual(['a', 'b']);
    expect([...toggleViewed(new Set(['a', 'b']), 'a')]).toEqual(['b']);
    expect(parseViewed('{"a":1}').size).toBe(0);
    expect(parseViewed('not json').size).toBe(0);
    expect([...parseViewed('["a", 3, null]')]).toEqual(['a']);
  });

  it('removes the entry once nothing is viewed', () => {
    writeViewed(SCOPE, 'c1', new Set(['a.ts']));
    writeViewed(SCOPE, 'c1', new Set());
    expect(window.localStorage.getItem(viewedKey(SCOPE, 'c1'))).toBeNull();
  });
});

describe('keys', () => {
  const key = (k: string, over: Partial<Parameters<typeof shortcutFor>[0]> = {}) =>
    shortcutFor({
      key: k,
      metaKey: false,
      ctrlKey: false,
      altKey: false,
      shiftKey: false,
      defaultPrevented: false,
      target: document.body,
      ...over,
    });

  it('maps j, k, v and c', () => {
    expect([key('j'), key('k'), key('v'), key('c'), key('x')]).toEqual([
      'next',
      'previous',
      'viewed',
      'comment',
      null,
    ]);
  });

  it('never fires while typing, with a modifier, or in a dialog', () => {
    const area = document.createElement('textarea');
    const dialog = document.createElement('div');
    dialog.setAttribute('role', 'dialog');
    const inside = document.createElement('button');
    dialog.append(inside);
    document.body.append(area, dialog);
    expect(key('j', { target: area })).toBeNull();
    expect(key('j', { target: inside })).toBeNull();
    expect(key('j', { metaKey: true })).toBeNull();
    expect(key('j', { ctrlKey: true })).toBeNull();
    expect(key('J', { shiftKey: true })).toBeNull();
    expect(key('j', { defaultPrevented: true })).toBeNull();
    area.remove();
    dialog.remove();
  });
});
