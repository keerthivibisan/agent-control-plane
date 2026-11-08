import {
  CodeMapFileDtoSchema,
  CodeMapGraphDtoSchema,
  CodeMapSearchDtoSchema,
  CodeMapSummaryDtoSchema,
} from '@acp/core/api';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { beforeAll, describe, expect, it } from 'vitest';
import { CodeMapPage } from '../../src/features/code-map/CodeMapPage';
import { codeMapPaths, type FetchLike } from '../../src/lib/api';
import { CODE_MAP_COPY } from '../../src/lib/copy';
import { CSRF } from '../fixtures/board';
import {
  CM_PROJECT_ID,
  COMMIT,
  XSS_NAME,
  fileGraph,
  folderGraph,
  indexFile,
  packagesGraph,
  searchResult,
  skippedFile,
  summary,
  utilFile,
} from '../fixtures/code-map';
import { fakeServer, jsonResponse, renderWithApi, type RouteTable } from '../helpers';

/*
 * CM-4 (ADR-0034 §5): the Code map page against synthetic DTOs (tests/fixtures/code-map.ts) on
 * the CM-1 routes: the summary, the refresh POST (CSRF), the graph, a file and search.
 */

const C = CODE_MAP_COPY;
const P = CM_PROJECT_ID;
const SUMMARY = codeMapPaths.summary(P);
const GRAPH = codeMapPaths.graph(P, null);
const REFRESH = `POST ${codeMapPaths.refresh(P)}`;
const now = () => new Date('2026-11-08T09:05:00.000Z');

beforeAll(() => {
  // React Flow measures the DOM; jsdom has no layout (as in live-graph.test.tsx).
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

function renderPage(routes: RouteTable, props: { pollMs?: number; pollLimitMs?: number } = {}) {
  const s = server(routes);
  const view = renderWithApi(
    <CodeMapPage projectId={P} now={now} pollMs={props.pollMs ?? 10} {...props} />,
    s,
  );
  return { s, ...view };
}

/** Answers `values` in turn, then keeps answering the last one. */
function sequence(values: unknown[]) {
  let i = 0;
  return () => {
    const v = values[Math.min(i, values.length - 1)];
    i += 1;
    return jsonResponse(200, v);
  };
}

const ready = (extra: RouteTable = {}) => ({
  [SUMMARY]: summary('ready'),
  [GRAPH]: fileGraph(),
  ...extra,
});

/** A drawn node by path. React Flow keeps nodes hidden from the accessibility tree until jsdom
 * "measures" them, so tests find them by their data attributes. */
function nodeOf(testId: 'code-map-file' | 'code-map-folder', path: string): HTMLElement {
  const el = document.querySelector<HTMLElement>(`[data-testid="${testId}"][data-path="${path}"]`);
  if (el === null) throw new Error(`no ${testId} ${path}`);
  return el;
}
const fileNode = (path: string) => nodeOf('code-map-file', path);
async function findFileNode(path: string): Promise<HTMLElement> {
  let el: HTMLElement | null = null;
  await waitFor(() => {
    el = fileNode(path);
  });
  return el as unknown as HTMLElement;
}
const heading = (el: HTMLElement) => within(el).getByRole('heading', { level: 2 }).textContent;

const filesShown = () =>
  screen.queryAllByTestId('code-map-file').map((el) => el.getAttribute('data-path'));

describe('code map fixtures', () => {
  it('match the API contract', () => {
    for (const s of ['none', 'building', 'ready', 'failed'] as const) {
      expect(() => CodeMapSummaryDtoSchema.parse(summary(s))).not.toThrow();
    }
    for (const g of [fileGraph(), folderGraph(), folderGraph({ truncated: true }), packagesGraph()])
      expect(() => CodeMapGraphDtoSchema.parse(g)).not.toThrow();
    for (const f of [utilFile(), indexFile(), skippedFile()])
      expect(() => CodeMapFileDtoSchema.parse(f)).not.toThrow();
    expect(() => CodeMapSearchDtoSchema.parse(searchResult('format'))).not.toThrow();
  });
});

describe('Code map page: states', () => {
  it('none: says what the map is and builds it with the CSRF header', async () => {
    const { s } = renderPage({
      [SUMMARY]: sequence([summary('none'), summary('building'), summary('ready')]),
      [REFRESH]: () => jsonResponse(202, summary('building')),
      [GRAPH]: fileGraph(),
    });
    const empty = await screen.findByTestId('code-map-empty');
    expect(empty.textContent).toContain(C.empty.text);
    expect(screen.queryByTestId('code-map-refresh')).toBeNull();
    fireEvent.click(within(empty).getByRole('button', { name: C.empty.build }));

    await waitFor(() => expect(s.calls.some((c) => c.method === 'POST')).toBe(true));
    const post = s.calls.find((c) => c.method === 'POST');
    expect(post?.path).toBe(codeMapPaths.refresh(P));
    expect(post?.body).toEqual({});
    expect(s.csrf).toEqual([CSRF]);
    // Polled until ready, then the graph loads.
    await waitFor(() =>
      expect(screen.getByTestId('code-map-status').getAttribute('data-status')).toBe('ready'),
    );
    expect(await screen.findByTestId('code-map-graph')).toBeTruthy();
  });

  it('building: polls the summary and stops once it is ready', async () => {
    const { s } = renderPage({
      [SUMMARY]: sequence([summary('building'), summary('building'), summary('ready')]),
      [GRAPH]: fileGraph(),
    });
    expect((await screen.findByTestId('code-map-building')).textContent).toContain(
      C.status.building,
    );
    const refresh = screen.getByTestId('code-map-refresh');
    expect((refresh as HTMLButtonElement).disabled).toBe(true);
    await waitFor(() =>
      expect(screen.getByTestId('code-map-status').getAttribute('data-status')).toBe('ready'),
    );
    const reads = () => s.calls.filter((c) => c.path === SUMMARY).length;
    expect(reads()).toBe(3);
    await new Promise((r) => setTimeout(r, 80));
    expect(reads()).toBe(3);
    expect(screen.queryByTestId('code-map-building')).toBeNull();
  });

  it('building: stops polling after the limit and says so', async () => {
    const { s } = renderPage({ [SUMMARY]: summary('building') }, { pollMs: 10, pollLimitMs: 30 });
    await waitFor(() =>
      expect(screen.getByTestId('code-map-building').textContent).toContain(C.status.buildingSlow),
    );
    const reads = s.calls.filter((c) => c.path === SUMMARY).length;
    // The first read, then at most 3 polls (30 ms / 10 ms).
    expect(reads).toBeGreaterThanOrEqual(2);
    expect(reads).toBeLessThanOrEqual(4);
    await new Promise((r) => setTimeout(r, 60));
    expect(s.calls.filter((c) => c.path === SUMMARY).length).toBe(reads);
  });

  it('failed: shows the error as plain words and retries', async () => {
    const { s } = renderPage({
      [SUMMARY]: summary('failed'),
      [REFRESH]: () => jsonResponse(202, summary('building')),
    });
    const failed = await screen.findByTestId('code-map-failed');
    expect(failed.textContent).toContain(C.failed.codes.git_failed);
    expect(failed.textContent).not.toContain('git_failed');
    // No map was ever built: no graph.
    expect(screen.queryByTestId('code-map-explorer')).toBeNull();
    fireEvent.click(within(failed).getByRole('button', { name: C.failed.retry }));
    await waitFor(() => expect(s.csrf).toEqual([CSRF]));
  });

  it('failed with an earlier map: still shows that map', async () => {
    renderPage({
      [SUMMARY]: summary('failed', { withManifest: true }),
      [GRAPH]: fileGraph(),
    });
    expect((await screen.findByTestId('code-map-failed')).textContent).toContain(C.status.lastGood);
    expect(await screen.findByTestId('code-map-graph')).toBeTruthy();
  });

  it('a refresh refused for no commits explains it plainly', async () => {
    renderPage({
      [SUMMARY]: summary('none'),
      [REFRESH]: () =>
        jsonResponse(409, {
          error: { code: 'no_commits', message: 'no commit', requestId: 'r1' },
        }),
    });
    fireEvent.click(await screen.findByRole('button', { name: C.empty.build }));
    expect((await screen.findByRole('alert')).textContent).toContain(C.refreshErrors.no_commits);
  });

  it('ready: the header shows status, short commit, age and counts', async () => {
    renderPage(ready());
    const status = await screen.findByTestId('code-map-status');
    expect(within(status).getByText('Ready')).toBeTruthy();
    const commit = within(status).getByTestId('code-map-commit');
    expect(commit.textContent).toBe(COMMIT.slice(0, 7));
    expect(commit.getAttribute('title')).toContain(COMMIT);
    expect(within(status).getByText('5 min ago')).toBeTruthy();
    const stat = (label: string) =>
      within(status).getByText(label).closest('div')?.querySelector('dd')?.textContent;
    expect(stat(C.status.files)).toBe('12');
    expect(stat(C.status.indexed)).toBe('9');
    expect(stat(C.status.skipped)).toBe('3');
    expect(stat(C.status.symbols)).toBe('42');
    expect(stat(C.status.unresolved)).toBe('5');
    expect(screen.getByTestId('code-map-refresh').textContent).toBe(C.refresh);
  });
});

describe('Code map page: graph', () => {
  it('draws files grouped by folder at file level, with no view note', async () => {
    renderPage(ready());
    await screen.findByTestId('code-map-graph');
    await waitFor(() => expect(filesShown()).toHaveLength(4));
    const groups = screen.getAllByTestId('code-map-group').map((g) => g.getAttribute('data-path'));
    expect(groups).toEqual(['src', 'src/lib', 'tests']);
    expect(screen.queryByTestId('code-map-view-note')).toBeNull();
    const util = fileNode('src/lib/util.ts');
    expect(util.tagName).toBe('BUTTON');
    expect(util.getAttribute('aria-label')).toBe(C.graph.openFile('src/lib/util.ts'));
  });

  it('draws folders at folder level, says so, and drills in with breadcrumbs back', async () => {
    const { s } = renderPage({
      [SUMMARY]: summary('ready'),
      [GRAPH]: folderGraph(),
      [codeMapPaths.graph(P, 'packages')]: packagesGraph(),
    });
    const note = await screen.findByTestId('code-map-view-note');
    expect(note.textContent).toBe(C.graph.folderLevel);
    await waitFor(() => expect(screen.getAllByTestId('code-map-folder')).toHaveLength(3));
    // The root's own files can't be a folder query: not a button.
    expect(nodeOf('code-map-folder', '.').tagName).toBe('DIV');
    const packages = nodeOf('code-map-folder', 'packages');
    expect(packages.getAttribute('aria-label')).toBe(C.graph.openFolder('packages'));
    fireEvent.click(packages);
    await waitFor(() =>
      expect(filesShown()).toEqual(['packages/a/index.ts', 'packages/b/index.ts']),
    );
    expect(s.calls.some((c) => c.path === codeMapPaths.graph(P, 'packages'))).toBe(true);
    const crumbs = screen.getByTestId('code-map-breadcrumbs');
    expect(within(crumbs).getByText('packages').getAttribute('aria-current')).toBe('page');

    fireEvent.click(within(crumbs).getByRole('button', { name: C.graph.root }));
    await waitFor(() => expect(screen.getAllByTestId('code-map-folder')).toHaveLength(3));
  });

  it('says when the view was cut to fit the caps', async () => {
    renderPage({ [SUMMARY]: summary('ready'), [GRAPH]: folderGraph({ truncated: true }) });
    const note = await screen.findByTestId('code-map-view-note');
    expect(note.textContent).toBe(C.graph.truncated(3, 1, 4100));
  });

  it('filters by language, hides tests, and keeps only files with imports', async () => {
    renderPage(ready());
    await waitFor(() => expect(filesShown()).toHaveLength(4));
    const language = screen.getByRole('combobox');
    expect(
      within(language)
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual([C.filters.allLanguages, 'json', 'typescript']);

    fireEvent.change(language, { target: { value: 'json' } });
    await waitFor(() => expect(filesShown()).toEqual(['src/lib/data.json']));
    fireEvent.change(language, { target: { value: '' } });

    fireEvent.click(screen.getByLabelText(C.filters.hideTests));
    await waitFor(() => expect(filesShown()).not.toContain('tests/util.test.ts'));
    expect(filesShown()).toHaveLength(3);

    fireEvent.click(screen.getByLabelText(C.filters.linkedOnly));
    await waitFor(() => expect(filesShown()).toEqual(['src/index.ts', 'src/lib/util.ts']));
    expect(screen.getByTestId('code-map-count').textContent).toBe('2 of 4 nodes');

    fireEvent.click(screen.getByLabelText(C.filters.hideTests));
    fireEvent.change(language, { target: { value: 'json' } });
    expect(await screen.findByTestId('code-map-no-match')).toBeTruthy();
  });

  it('highlights a node’s links on hover', async () => {
    renderPage(ready());
    const util = await findFileNode('src/lib/util.ts');
    fireEvent.mouseEnter(util);
    expect(screen.getByTestId('code-map-graph').getAttribute('data-hovered')).toBe(
      'src/lib/util.ts',
    );
    fireEvent.mouseLeave(util);
    expect(screen.getByTestId('code-map-graph').getAttribute('data-hovered')).toBeNull();
  });
});

describe('Code map page: file panel', () => {
  const fileRoutes = () =>
    ready({
      [codeMapPaths.file(P, 'src/lib/util.ts')]: utilFile(),
      [codeMapPaths.file(P, 'src/index.ts')]: indexFile(),
      [codeMapPaths.file(P, 'src/lib/data.json')]: jsonResponse(404, {
        error: { code: 'code_map_file_not_found', message: 'gone', requestId: 'r' },
      }),
    });

  it('shows facts, symbols, imports, imported-by and tests; paths open other files', async () => {
    renderPage(fileRoutes());
    fireEvent.click(await findFileNode('src/lib/util.ts'));
    const panel = await screen.findByTestId('code-map-file-panel');
    await within(panel).findByText('2.4 KB');
    expect(within(panel).getByText('87')).toBeTruthy();
    expect(within(panel).getByText('typescript')).toBeTruthy();
    // The node is marked as the open file.
    expect(fileNode('src/lib/util.ts').getAttribute('data-active')).toBe('true');

    const symbols = within(panel).getByRole('list', { name: C.file.symbols });
    const rows = within(symbols).getAllByTestId('code-map-symbol');
    expect(rows[0]?.textContent).toContain('formatThing');
    expect(rows[0]?.textContent).toContain('function');
    expect(rows[0]?.textContent).toContain('line 3');
    expect(within(rows[0] as HTMLElement).getByText(C.file.exported)).toBeTruthy();
    expect(within(rows[1] as HTMLElement).queryByText(C.file.exported)).toBeNull();

    const unresolved = within(panel).getByTestId('code-map-unresolved');
    expect(unresolved.textContent).toContain(C.file.unresolved(2));
    expect(within(unresolved).getByText('zod').tagName).toBe('CODE');
    expect(within(unresolved).queryByRole('button')).toBeNull();

    const importedBy = within(panel).getByRole('list', { name: C.file.importedBy });
    expect(within(importedBy).getAllByRole('button')).toHaveLength(2);
    const tests = within(panel).getByRole('list', { name: C.file.tests });
    expect(within(tests).getByRole('button', { name: C.file.open('tests/util.test.ts') }));

    // An imported-by path opens that file's details.
    fireEvent.click(within(importedBy).getByRole('button', { name: C.file.open('src/index.ts') }));
    const next = await screen.findByTestId('code-map-file-panel');
    await waitFor(() => expect(heading(next)).toBe('src/index.ts'));
    expect(await within(next).findByText(C.file.noSymbols)).toBeTruthy();
    // And its import goes back.
    const imports = within(next).getByRole('list', { name: C.file.imports });
    fireEvent.click(within(imports).getByRole('button', { name: C.file.open('src/lib/util.ts') }));
    await waitFor(() =>
      expect(heading(screen.getByTestId('code-map-file-panel'))).toBe('src/lib/util.ts'),
    );

    fireEvent.click(screen.getByRole('button', { name: C.file.close }));
    expect(screen.queryByTestId('code-map-file-panel')).toBeNull();
  });

  it('renders an adversarial symbol name as text only', async () => {
    renderPage(fileRoutes());
    fireEvent.click(await findFileNode('src/lib/util.ts'));
    const panel = await screen.findByTestId('code-map-file-panel');
    const name = await within(panel).findByText(XSS_NAME);
    expect(name.tagName).toBe('CODE');
    expect(name.children).toHaveLength(0);
    expect(panel.querySelector('img')).toBeNull();
    expect(panel.querySelector('a')).toBeNull();
  });

  it('a file not in the map says so; a skipped file shows its reason', async () => {
    renderPage({
      ...fileRoutes(),
      [codeMapPaths.search(P, 'logo')]: {
        ...searchResult('logo'),
        matches: [
          {
            kind: 'file',
            path: 'assets/logo.png',
            name: null,
            symbolKind: null,
            line: null,
            exported: null,
            rank: 'prefix',
          },
        ],
        total: 1,
      },
      [codeMapPaths.file(P, 'assets/logo.png')]: skippedFile(),
    });
    fireEvent.click(await findFileNode('src/lib/data.json'));
    expect(
      await within(screen.getByTestId('code-map-file-panel')).findByText(C.file.notFound),
    ).toBeTruthy();

    fireEvent.change(screen.getByRole('searchbox', { name: C.search.label }), {
      target: { value: 'logo' },
    });
    fireEvent.click(await screen.findByTestId('code-map-search-match'));
    expect((await screen.findByTestId('code-map-skipped')).textContent).toContain(
      C.file.skipReasons.binary,
    );
  });
});

describe('Code map page: search', () => {
  it('waits 250 ms after typing, lists symbol and file matches, and opens the pick', async () => {
    const { s } = renderPage(
      ready({
        [codeMapPaths.search(P, 'format')]: searchResult('format'),
        [codeMapPaths.file(P, 'src/lib/util.ts')]: utilFile(),
      }),
    );
    const box = await screen.findByRole('searchbox', { name: C.search.label });
    await waitFor(() => expect(filesShown()).toHaveLength(4));
    fireEvent.change(box, { target: { value: 'f' } });
    fireEvent.change(box, { target: { value: 'fo' } });
    fireEvent.change(box, { target: { value: 'format' } });
    const searches = () => s.calls.filter((c) => c.path.includes('/code-map/search'));
    await new Promise((r) => setTimeout(r, 120));
    expect(searches()).toHaveLength(0);

    const results = await screen.findByRole('list', { name: C.search.results });
    expect(searches().map((c) => c.path)).toEqual([codeMapPaths.search(P, 'format')]);
    const [symbol, file] = within(results).getAllByTestId('code-map-search-match');
    expect(symbol?.dataset.kind).toBe('symbol');
    expect(symbol?.textContent).toContain('formatThing');
    expect(symbol?.textContent).toContain('function');
    expect(symbol?.textContent).toContain('src/lib/util.ts:3');
    expect(file?.dataset.kind).toBe('file');
    expect(file?.textContent).toContain('src/index.ts');

    fireEvent.click(symbol as HTMLElement);
    expect(screen.queryByRole('list', { name: C.search.results })).toBeNull();
    const panel = await screen.findByTestId('code-map-file-panel');
    expect(heading(panel)).toBe('src/lib/util.ts');
    expect(fileNode('src/lib/util.ts').getAttribute('data-active')).toBe('true');
  });

  it('says when nothing matches', async () => {
    renderPage(
      ready({ [codeMapPaths.search(P, 'zzz')]: { ...searchResult('zzz'), matches: [], total: 0 } }),
    );
    fireEvent.change(await screen.findByRole('searchbox', { name: C.search.label }), {
      target: { value: 'zzz' },
    });
    expect(await screen.findByText(C.search.none)).toBeTruthy();
  });
});
