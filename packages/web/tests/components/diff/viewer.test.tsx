import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DiffSection, DiffViewer } from '../../../src/components/diff';
import { tokenize } from '../../../src/components/diff/highlight';
import {
  readViewMode,
  resetViewModeForTests,
  SPLIT_MIN_REM,
  splitFits,
  VIEW_MODE_KEY,
} from '../../../src/components/diff/view-mode';
import {
  ADDED,
  BINARY,
  DELETED,
  MODIFIED,
  NO_NEWLINE,
  RENAMED_EDITED,
  bigFile,
  join,
  longContextDiff,
} from './fixtures';

// Shiki itself is mocked here (the real thing is in highlight.test.ts): each test says what
// `tokenize` answers.
vi.mock('../../../src/components/diff/highlight', () => ({ tokenize: vi.fn() }));
const tokenizeMock = vi.mocked(tokenize);

/** Every line as one token in the keyword color, as a stand-in for Shiki's answer. */
function keywordTokens(code: string) {
  return code
    .split('\n')
    .map((line) =>
      line.length === 0 ? [] : [{ content: line, color: 'var(--shiki-token-keyword)' }],
    );
}

beforeEach(() => {
  window.localStorage.clear();
  resetViewModeForTests();
  tokenizeMock.mockReset();
  tokenizeMock.mockImplementation((code) => Promise.resolve(keywordTokens(code)));
});

afterEach(() => {
  vi.restoreAllMocks();
});

const files = () => screen.getAllByTestId('diff-file');
const fileByPath = (path: string) => {
  const f = files().find((el) => el.dataset.path === path);
  if (f === undefined) throw new Error(`no file ${path}`);
  return f;
};

describe('DiffViewer', () => {
  it('lists the files with status and counts, and draws each file with line numbers', async () => {
    render(
      <DiffViewer
        diff={join(MODIFIED, ADDED, DELETED, RENAMED_EDITED, BINARY)}
        truncated={false}
      />,
    );
    expect(screen.getByTestId('diff-summary').textContent).toBe('5 files · 5 added · 4 removed');
    const links = within(screen.getByTestId('diff-file-list')).getAllByTestId('diff-file-link');
    expect(links.map((l) => l.textContent)).toEqual([
      'Changed: src/search/api.ts+2 2 lines added−1 1 line removed',
      'New: docs/notes.md+2 2 lines added−0 0 lines removed',
      'Deleted: src/old.ts+0 0 lines added−2 2 lines removed',
      'Renamed: lib/util.py → lib/helpers.py+1 1 line added−1 1 line removed',
      'New: assets/logo.png Binary',
    ]);
    const api = fileByPath('src/search/api.ts');
    const rows = [...api.querySelectorAll('tr[data-kind]')];
    expect(rows.map((r) => r.getAttribute('data-kind'))).toEqual([
      'context',
      'context',
      'del',
      'add',
      'add',
      'context',
      'context',
      'context',
    ]);
    // Line numbers before and after, and the hunk header.
    const cells = (i: number) =>
      [...(rows[i]?.querySelectorAll('td') ?? [])].map((c) => c.textContent);
    expect(cells(2).slice(0, 2)).toEqual(['12', '']);
    expect(cells(3).slice(0, 2)).toEqual(['', '12']);
    expect(within(api).getByTestId('diff-hunk').textContent).toBe(
      '@@ -10,6 +10,7 @@export function search(query: string) {',
    );
    expect(within(fileByPath('assets/logo.png')).getByText(/Binary file/)).toBeTruthy();
    expect(within(fileByPath('lib/helpers.py')).getByText('87% similar')).toBeTruthy();
    await waitFor(() => expect(api.dataset.syntax).toBe('highlighted'));
  });

  it('labels added and removed lines for screen readers, not by color alone', () => {
    render(<DiffViewer diff={MODIFIED} truncated={false} />);
    const del = document.querySelector('tr[data-kind="del"]');
    const add = document.querySelector('tr[data-kind="add"]');
    expect(del?.textContent).toContain('Removed line: ');
    expect(add?.textContent).toContain('Added line: ');
    // The visible sign is decorative.
    expect(del?.querySelector('td[aria-hidden="true"]')?.textContent).toBe('−');
    expect(screen.getAllByRole('columnheader').map((h) => h.textContent)).toContain('Line before');
  });

  it('marks the changed words inside a changed line pair', () => {
    render(<DiffViewer diff={MODIFIED} truncated={false} />);
    const del = document.querySelector('tr[data-kind="del"]');
    const add = document.querySelector('tr[data-kind="add"]');
    expect(
      [...(del?.querySelectorAll('[data-word-change]') ?? [])].map((m) => m.textContent),
    ).toEqual(['50']);
    expect(
      [...(add?.querySelectorAll('[data-word-change]') ?? [])].map((m) => m.textContent),
    ).toEqual(['Math.min(requested, 100)']);
  });

  it('notes a missing newline at the end of a file', () => {
    render(<DiffViewer diff={NO_NEWLINE} truncated={false} />);
    expect(screen.getAllByText('No newline at end of file')).toHaveLength(2);
  });

  it('collapses one file, and all files, and expands them again', () => {
    render(<DiffViewer diff={join(MODIFIED, ADDED)} truncated={false} />);
    const toggle = within(fileByPath('docs/notes.md')).getByTestId('diff-file-toggle');
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(fileByPath('docs/notes.md').querySelector('tr[data-kind]')).toBeNull();
    expect(fileByPath('src/search/api.ts').querySelector('tr[data-kind]')).not.toBeNull();

    const all = screen.getByTestId('diff-collapse-all');
    expect(all.textContent).toBe('Collapse all');
    fireEvent.click(all);
    expect(files().map((f) => f.dataset.open)).toEqual(['false', 'false']);
    expect(all.textContent).toBe('Expand all');
    fireEvent.click(all);
    expect(files().map((f) => f.dataset.open)).toEqual(['true', 'true']);
  });

  it('jumps to a file from the list, opening it if collapsed; arrows move along the list', () => {
    const scroll = vi.spyOn(Element.prototype, 'scrollIntoView').mockImplementation(() => {});
    render(<DiffViewer diff={join(MODIFIED, ADDED, DELETED)} truncated={false} />);
    const notes = within(fileByPath('docs/notes.md')).getByTestId('diff-file-toggle');
    fireEvent.click(notes);
    const links = screen.getAllByTestId('diff-file-link');
    // One tab stop for the list.
    expect(links.map((l) => l.tabIndex)).toEqual([0, -1, -1]);
    fireEvent.click(links[1] as HTMLElement);
    expect(notes.getAttribute('aria-expanded')).toBe('true');
    expect(scroll).toHaveBeenCalled();
    expect(document.activeElement).toBe(notes);

    (links[0] as HTMLElement).focus();
    fireEvent.keyDown(links[0] as HTMLElement, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(links[1]);
    fireEvent.keyDown(links[1] as HTMLElement, { key: 'End' });
    expect(document.activeElement).toBe(links[2]);
    expect(links.map((l) => l.tabIndex)).toEqual([-1, -1, 0]);
    fireEvent.keyDown(links[2] as HTMLElement, { key: 'Home' });
    expect(document.activeElement).toBe(links[0]);
  });

  it('hides long unchanged runs behind "Show N hidden lines"', () => {
    render(<DiffViewer diff={longContextDiff()} truncated={false} />);
    const expanders = screen.getAllByTestId('diff-expand');
    expect(expanders.map((b) => b.textContent)).toEqual([
      'Show 7 hidden lines',
      'Show 7 hidden lines',
    ]);
    expect(expanders[0]?.getAttribute('aria-label')).toBe(
      'Show 7 lines of unchanged code hidden here',
    );
    expect(document.querySelectorAll('tr[data-kind]')).toHaveLength(8);
    fireEvent.click(expanders[0] as HTMLElement);
    expect(screen.getAllByTestId('diff-expand')).toHaveLength(1);
    expect(document.querySelectorAll('tr[data-kind]')).toHaveLength(15);
    expect(document.querySelector('tr[data-kind] td')?.textContent).toBe('1');
  });

  it('switches to side by side and remembers the choice in this browser', () => {
    const { unmount } = render(<DiffViewer diff={MODIFIED} truncated={false} />);
    const group = screen.getByRole('group', { name: 'Show the changes' });
    const unified = within(group).getByRole('button', { name: 'Unified' });
    const split = within(group).getByRole('button', { name: 'Side by side' });
    expect(unified.getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByTestId('diff-viewer').dataset.view).toBe('unified');

    fireEvent.click(split);
    expect(split.getAttribute('aria-pressed')).toBe('true');
    expect(window.localStorage.getItem(VIEW_MODE_KEY)).toBe('split');
    // Removed and added side by side: the first change row has both.
    const change = document.querySelector('tr[data-kind="change"]');
    expect(change?.textContent).toContain('Removed line: ');
    expect(change?.textContent).toContain('Added line: ');
    expect(document.querySelectorAll('tr[data-kind="change"]')).toHaveLength(2);
    unmount();

    resetViewModeForTests();
    render(<DiffViewer diff={MODIFIED} truncated={false} />);
    expect(screen.getByTestId('diff-viewer').dataset.view).toBe('split');
  });

  it('every viewer on the page follows the same choice', () => {
    render(
      <>
        <DiffViewer diff={MODIFIED} truncated={false} testId="one" />
        <DiffViewer diff={ADDED} truncated={false} testId="two" />
      </>,
    );
    fireEvent.click(
      within(screen.getByTestId('one')).getByRole('button', { name: 'Side by side' }),
    );
    expect(screen.getByTestId('two').dataset.view).toBe('split');
  });

  it('works without storage: the choice lasts for the page only', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(readViewMode()).toBe('unified');
    render(<DiffViewer diff={MODIFIED} truncated={false} />);
    fireEvent.click(screen.getByRole('button', { name: 'Side by side' }));
    expect(screen.getByTestId('diff-viewer').dataset.view).toBe('split');
  });

  it('the large-diff guard holds back big files until "Show this file"', () => {
    render(
      <DiffViewer diff={join(bigFile('small.ts', 20), bigFile('big.ts', 450))} truncated={false} />,
    );
    expect(screen.getByTestId('diff-large').textContent).toBe(
      'This diff is large: 1 of 2 files are shown. Use “Show this file” for the others.',
    );
    const big = fileByPath('big.ts');
    expect(big.dataset.shown).toBe('false');
    expect(big.querySelector('tr[data-kind]')).toBeNull();
    expect(within(big).getByTestId('diff-held-back').textContent).toContain(
      '450 lines not shown, to keep the page fast.',
    );
    // A held-back file is not highlighted either.
    expect(tokenizeMock.mock.calls.every(([code]) => !code.includes('line 450'))).toBe(true);
    fireEvent.click(within(big).getByRole('button', { name: 'Show this file' }));
    expect(big.dataset.shown).toBe('true');
    expect(big.querySelectorAll('tr[data-kind]')).toHaveLength(450);
    expect(screen.queryByTestId('diff-large')).toBeNull();
  });

  it('says when the server cut the diff, marks the cut file, and names the files after it', () => {
    const cut = [
      'diff --git a/src/a.ts b/src/a.ts',
      '--- a/src/a.ts',
      '+++ b/src/a.ts',
      '@@ -1,9 +1,9 @@',
      ' one',
      '-two',
      '+TWO',
      '',
    ].join('\n');
    render(<DiffViewer diff={cut} truncated files={['src/a.ts', 'src/b.ts', 'src/c.ts']} />);
    expect(screen.getByTestId('diff-truncated').textContent).toBe(
      'The server cut this diff at its size limit: only its start is shown.',
    );
    const a = fileByPath('src/a.ts');
    expect(within(a).getByText('Cut')).toBeTruthy();
    expect(within(a).getByRole('note').textContent).toBe(
      'The diff stops here: the server cut it at its size limit.',
    );
    const missing = screen.getByTestId('diff-missing');
    expect(within(missing).getByText('2 files not in this diff (after the cut)')).toBeTruthy();
    expect(
      within(missing)
        .getAllByRole('listitem')
        .map((l) => l.textContent),
    ).toEqual(['src/b.ts', 'src/c.ts']);
  });

  it('an empty diff says so (and still says when it was cut)', () => {
    render(<DiffViewer diff="" truncated />);
    expect(screen.getByText('No line-by-line changes to show.')).toBeTruthy();
    expect(screen.getByTestId('diff-truncated')).toBeTruthy();
  });
});

describe('syntax highlighting (Shiki mocked)', () => {
  it('colors the code once Shiki answers, plain text until then', async () => {
    let answer: (v: ReturnType<typeof keywordTokens>) => void = () => {};
    tokenizeMock.mockImplementation(
      (code) =>
        new Promise((resolve) => {
          answer = (v) => resolve(v);
          void code;
        }),
    );
    render(<DiffViewer diff={ADDED} truncated={false} />);
    const file = fileByPath('docs/notes.md');
    expect(file.dataset.syntax).toBe('loading');
    const code = () => file.querySelector('tr[data-kind="add"] td:last-child span:not(.sr-only)');
    expect((code() as HTMLElement | null)?.style.color).toBe('');
    expect(tokenizeMock).toHaveBeenCalledWith(
      '# Notes\nSearch is capped at 100 results.',
      'markdown',
    );
    await act(async () => {
      answer(keywordTokens('# Notes\nSearch is capped at 100 results.'));
      await Promise.resolve();
    });
    await waitFor(() => expect(file.dataset.syntax).toBe('highlighted'));
    expect((code() as HTMLElement | null)?.style.color).toBe('var(--shiki-token-keyword)');
    expect(code()?.textContent).toBe('# Notes');
  });

  it('highlights the old and new sides separately, by the file’s language', async () => {
    render(<DiffViewer diff={MODIFIED} truncated={false} />);
    await waitFor(() => expect(fileByPath('src/search/api.ts').dataset.syntax).toBe('highlighted'));
    expect(tokenizeMock.mock.calls.map(([code, lang]) => [code.split('\n').length, lang])).toEqual([
      [6, 'typescript'],
      [7, 'typescript'],
    ]);
  });

  it('falls back to plain text when Shiki fails', async () => {
    tokenizeMock.mockRejectedValue(new Error('chunk failed'));
    render(<DiffViewer diff={MODIFIED} truncated={false} />);
    const file = fileByPath('src/search/api.ts');
    await waitFor(() => expect(file.dataset.syntax).toBe('failed'));
    expect(file.querySelector('tr[data-kind="del"]')?.textContent).toContain(
      'const pageSize = 50;',
    );
    expect(file.querySelector('[style*="shiki"]')).toBeNull();
  });

  it('leaves unknown languages and binary files plain, without loading Shiki', () => {
    render(
      <DiffViewer
        diff={join(
          BINARY,
          'diff --git a/Makefile b/Makefile\n--- a/Makefile\n+++ b/Makefile\n@@ -1 +1 @@\n-a\n+b',
        )}
        truncated={false}
      />,
    );
    expect(files().map((f) => f.dataset.syntax)).toEqual(['plain', 'plain']);
    expect(tokenizeMock).not.toHaveBeenCalled();
  });
});

describe('DiffSection', () => {
  it('draws the viewer (and loads Shiki) only once opened', () => {
    render(
      <DiffSection
        summary="The changes, line by line"
        diff={MODIFIED}
        truncated={false}
        testId="sec"
      />,
    );
    const section = screen.getByTestId('sec');
    expect(within(section).queryByTestId('diff-viewer')).toBeNull();
    expect(tokenizeMock).not.toHaveBeenCalled();
    const details = section as HTMLDetailsElement;
    details.open = true;
    fireEvent(details, new Event('toggle'));
    expect(within(section).getByTestId('diff-viewer')).toBeTruthy();
    expect(tokenizeMock).toHaveBeenCalled();
  });

  it('opens at once with defaultOpen', () => {
    render(
      <DiffSection summary="Diff" diff={MODIFIED} truncated={false} defaultOpen testId="sec" />,
    );
    expect(within(screen.getByTestId('sec')).getByTestId('diff-viewer')).toBeTruthy();
  });
});

describe('narrow places (G-D)', () => {
  /** A stand-in ResizeObserver: the test says how wide the viewer is, then resizes it. */
  class FakeObserver {
    static all: FakeObserver[] = [];
    private readonly cb: ResizeObserverCallback;
    constructor(cb: ResizeObserverCallback) {
      this.cb = cb;
      FakeObserver.all.push(this);
    }
    observe() {}
    unobserve() {}
    disconnect() {
      FakeObserver.all = FakeObserver.all.filter((o) => o !== this);
    }
    resize(width: number) {
      const entry = { contentRect: { width } } as unknown as ResizeObserverEntry;
      this.cb([entry], this);
    }
  }
  const resizeAll = (width: number) =>
    act(() => {
      for (const o of FakeObserver.all) o.resize(width);
    });

  beforeEach(() => {
    FakeObserver.all = [];
    vi.stubGlobal('ResizeObserver', FakeObserver);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('knows when side by side fits: 36rem and the file card’s border, or not laid out yet', () => {
    expect(SPLIT_MIN_REM).toBe(36);
    expect(splitFits(578, 16)).toBe(true);
    expect(splitFits(577, 16)).toBe(false);
    expect(splitFits(390, 16)).toBe(false);
    expect(splitFits(722, 20)).toBe(true);
    expect(splitFits(700, 20)).toBe(false);
    expect(splitFits(0, 16)).toBe(true);
  });

  it('shows unified where it is too narrow, with Side by side off and why; the choice is kept', () => {
    window.localStorage.setItem(VIEW_MODE_KEY, 'split');
    render(<DiffViewer diff={MODIFIED} truncated={false} />);
    const viewer = screen.getByTestId('diff-viewer');
    expect(viewer.dataset.view).toBe('split');

    resizeAll(360);
    expect(viewer.dataset.view).toBe('unified');
    expect(viewer.dataset.narrow).toBe('');
    expect(document.querySelectorAll('tr[data-kind="change"]')).toHaveLength(0);
    const group = screen.getByRole('group', { name: 'Show the changes' });
    const split = within(group).getByRole('button', { name: 'Side by side' });
    const unified = within(group).getByRole('button', { name: 'Unified' });
    expect(unified.getAttribute('aria-pressed')).toBe('true');
    expect(split.getAttribute('aria-pressed')).toBe('false');
    expect(split.getAttribute('aria-disabled')).toBe('true');
    expect(split.getAttribute('title')).toBe('Not enough room here');
    const describedBy = split.getAttribute('aria-describedby') ?? '';
    expect(document.getElementById(describedBy)?.textContent).toBe('Not enough room here');
    // A click does nothing here, and the saved choice is untouched.
    fireEvent.click(split);
    expect(viewer.dataset.view).toBe('unified');
    expect(window.localStorage.getItem(VIEW_MODE_KEY)).toBe('split');

    // Wider again: the owner's choice comes back.
    resizeAll(900);
    expect(viewer.dataset.view).toBe('split');
    expect(viewer.dataset.narrow).toBeUndefined();
    expect(split.getAttribute('aria-disabled')).toBeNull();
    expect(split.getAttribute('title')).toBeNull();
  });

  it('a narrow viewer leaves the others on the page as chosen', () => {
    window.localStorage.setItem(VIEW_MODE_KEY, 'split');
    render(
      <>
        <DiffViewer diff={MODIFIED} truncated={false} testId="wide" />
        <DiffViewer diff={ADDED} truncated={false} testId="narrow" />
      </>,
    );
    act(() => {
      FakeObserver.all[0]?.resize(1000);
      FakeObserver.all[1]?.resize(300);
    });
    expect(screen.getByTestId('wide').dataset.view).toBe('split');
    expect(screen.getByTestId('narrow').dataset.view).toBe('unified');
    // Choosing in the wide one is still the owner's choice for every place.
    fireEvent.click(within(screen.getByTestId('wide')).getByRole('button', { name: 'Unified' }));
    expect(window.localStorage.getItem(VIEW_MODE_KEY)).toBe('unified');
  });

  it('stops following the size once it is gone', () => {
    const { unmount } = render(<DiffViewer diff={MODIFIED} truncated={false} />);
    expect(FakeObserver.all).toHaveLength(1);
    unmount();
    expect(FakeObserver.all).toHaveLength(0);
  });
});
