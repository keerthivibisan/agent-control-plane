import type {
  CodeMapFileView,
  CodeMapGraphEdge,
  CodeMapGraphGroup,
  CodeMapGraphNode,
  CodeMapGraphView,
  CodeMapSearchMatch,
  CodeMapSearchView,
  CodeMapSummaryDto,
} from '../api/code-map.js';
import {
  folderAtDepth,
  folderDepth,
  folderOf,
  isUnderFolder,
  type CodeMapFile,
  type CodeMapLanguage,
} from './codemap.js';

/**
 * Pure views over one manifest's files (ADR-0034 §5, CM-1): the owner's graph, a file's details,
 * search, and the summary's folder and language counts. They only rearrange stored metadata.
 */

// Kept equal to the api constants (a type-only import keeps core/api out of this module's runtime).
const MAX_NODES = 1_500;
const MAX_EDGES = 4_000;
const MAX_RESULTS = 50;
const MAX_FOLDERS = 50;

export interface CodeMapGraphOptions {
  folder?: string | undefined;
  depth?: number | undefined;
}

function mostCommon(languages: Map<CodeMapLanguage, number>): CodeMapLanguage {
  let best: CodeMapLanguage = 'other';
  let bestCount = -1;
  for (const [language, n] of languages) {
    if (n > bestCount || (n === bestCount && language < best)) {
      best = language;
      bestCount = n;
    }
  }
  return best;
}

const edgeKey = (from: string, to: string): string => `${from}\0${to}`;

/**
 * The import graph of the indexed (not skipped) files, optionally under `folder`. Edges are
 * resolved imports between files of the view. Over 1500 nodes or 4000 edges it collapses to
 * folder nodes at `depth` (or the deepest level that fits) with weighted folder-to-folder edges;
 * whatever still does not fit is cut, and `truncated` says so.
 */
export function buildCodeMapGraph(
  files: readonly CodeMapFile[],
  options: CodeMapGraphOptions = {},
): CodeMapGraphView {
  const scopeFolder = options.folder ?? null;
  const scope = files.filter(
    (f) => f.skipped === null && (scopeFolder === null || isUnderFolder(f.path, scopeFolder)),
  );
  const inScope = new Set(scope.map((f) => f.path));
  const fileEdges: { from: string; to: string }[] = [];
  const seen = new Set<string>();
  for (const f of scope) {
    for (const i of f.imports) {
      const to = i.resolvedPath;
      if (to === null || to === f.path || !inScope.has(to)) continue;
      const key = edgeKey(f.path, to);
      if (seen.has(key)) continue;
      seen.add(key);
      fileEdges.push({ from: f.path, to });
    }
  }
  const maxDepth = scope.reduce((m, f) => Math.max(m, folderDepth(folderOf(f.path))), 0);

  if (scope.length <= MAX_NODES && fileEdges.length <= MAX_EDGES) {
    const depth = Math.min(options.depth ?? maxDepth, maxDepth);
    const out = new Map<string, number>();
    const into = new Map<string, number>();
    for (const e of fileEdges) {
      out.set(e.from, (out.get(e.from) ?? 0) + 1);
      into.set(e.to, (into.get(e.to) ?? 0) + 1);
    }
    const groupCounts = new Map<string, number>();
    const nodes: CodeMapGraphNode[] = scope.map((f) => {
      const group = folderAtDepth(folderOf(f.path), depth);
      groupCounts.set(group, (groupCounts.get(group) ?? 0) + 1);
      return {
        id: f.path,
        kind: 'file',
        folder: group,
        language: f.language,
        isTest: f.isTest,
        fileCount: 1,
        symbolCount: f.symbols.length,
        importCount: out.get(f.path) ?? 0,
        importedByCount: into.get(f.path) ?? 0,
      };
    });
    return {
      level: 'file',
      depth,
      folder: scopeFolder,
      nodes,
      groups: groupsOf(groupCounts),
      edges: fileEdges.map((e) => ({ ...e, weight: 1 })),
      totalEdges: fileEdges.length,
      truncated: false,
    };
  }

  // Folder level: the requested depth, else the deepest one with at most MAX_NODES folders.
  let depth = options.depth === undefined ? Math.max(maxDepth, 1) : options.depth;
  if (options.depth === undefined) {
    while (depth > 1 && distinctFolders(scope, depth) > MAX_NODES) depth--;
  }
  interface FolderAcc {
    files: number;
    tests: number;
    symbols: number;
    out: number;
    into: number;
    languages: Map<CodeMapLanguage, number>;
  }
  const folders = new Map<string, FolderAcc>();
  const folderOfFile = new Map<string, string>();
  for (const f of scope) {
    const id = folderAtDepth(folderOf(f.path), depth);
    folderOfFile.set(f.path, id);
    let acc = folders.get(id);
    if (acc === undefined) {
      acc = { files: 0, tests: 0, symbols: 0, out: 0, into: 0, languages: new Map() };
      folders.set(id, acc);
    }
    acc.files++;
    if (f.isTest) acc.tests++;
    acc.symbols += f.symbols.length;
    acc.languages.set(f.language, (acc.languages.get(f.language) ?? 0) + 1);
  }
  let kept = [...folders.keys()];
  let truncated = false;
  if (kept.length > MAX_NODES) {
    kept.sort((a, b) => (folders.get(b)?.files ?? 0) - (folders.get(a)?.files ?? 0) || cmp(a, b));
    kept = kept.slice(0, MAX_NODES);
    truncated = true;
  }
  const keptSet = new Set(kept);
  const weights = new Map<string, CodeMapGraphEdge>();
  for (const e of fileEdges) {
    const from = folderOfFile.get(e.from);
    const to = folderOfFile.get(e.to);
    if (from === undefined || to === undefined || from === to) continue;
    if (!keptSet.has(from) || !keptSet.has(to)) continue;
    const key = edgeKey(from, to);
    const edge = weights.get(key);
    if (edge === undefined) weights.set(key, { from, to, weight: 1 });
    else edge.weight++;
  }
  let edges = [...weights.values()];
  const totalEdges = edges.length;
  if (edges.length > MAX_EDGES) {
    edges.sort((a, b) => b.weight - a.weight || cmp(a.from, b.from) || cmp(a.to, b.to));
    edges = edges.slice(0, MAX_EDGES);
    truncated = true;
  }
  for (const e of edges) {
    const from = folders.get(e.from);
    const to = folders.get(e.to);
    if (from) from.out += e.weight;
    if (to) to.into += e.weight;
  }
  const groupDepth = Math.max(depth - 1, 0);
  const groupCounts = new Map<string, number>();
  const nodes: CodeMapGraphNode[] = kept.sort(cmp).map((id) => {
    // Every kept id came from `folders`.
    const acc = folders.get(id) as FolderAcc;
    const group = folderAtDepth(id, groupDepth);
    groupCounts.set(group, (groupCounts.get(group) ?? 0) + acc.files);
    return {
      id,
      kind: 'folder',
      folder: group,
      language: mostCommon(acc.languages),
      isTest: acc.tests === acc.files,
      fileCount: acc.files,
      symbolCount: acc.symbols,
      importCount: acc.out,
      importedByCount: acc.into,
    };
  });
  return {
    level: 'folder',
    depth,
    folder: scopeFolder,
    nodes,
    groups: groupsOf(groupCounts),
    edges,
    totalEdges,
    truncated,
  };
}

function distinctFolders(files: readonly CodeMapFile[], depth: number): number {
  return new Set(files.map((f) => folderAtDepth(folderOf(f.path), depth))).size;
}

function groupsOf(counts: Map<string, number>): CodeMapGraphGroup[] {
  return [...counts.entries()]
    .sort(([a], [b]) => cmp(a, b))
    .map(([path, fileCount]) => ({ path, fileCount, depth: folderDepth(path) }));
}

function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** One file with the files that import it and the tests among them; undefined when absent. */
export function codeMapFileDetail(
  files: readonly CodeMapFile[],
  path: string,
): CodeMapFileView | undefined {
  const file = files.find((f) => f.path === path);
  if (file === undefined) return undefined;
  const importers = new Map<string, boolean>();
  for (const f of files) {
    if (f.path === path) continue;
    if (f.imports.some((i) => i.resolvedPath === path)) importers.set(f.path, f.isTest);
  }
  const importedBy = [...importers.keys()].sort(cmp);
  return { file, importedBy, tests: importedBy.filter((p) => importers.get(p) === true) };
}

const RANK_ORDER = { exact: 0, prefix: 1, substring: 2 } as const;

function rankOf(name: string, q: string): CodeMapSearchMatch['rank'] | null {
  if (name === q) return 'exact';
  if (name.startsWith(q)) return 'prefix';
  if (name.includes(q)) return 'substring';
  return null;
}

/**
 * Case-insensitive substring search over symbol names and paths, at most 50 matches, ranked:
 * exact name (symbols before files), then prefix, then substring; then exported symbols first,
 * shorter names, path and line.
 */
export function searchCodeMap(files: readonly CodeMapFile[], query: string): CodeMapSearchView {
  const q = query.toLowerCase();
  const matches: CodeMapSearchMatch[] = [];
  for (const f of files) {
    for (const s of f.symbols) {
      const rank = rankOf(s.name.toLowerCase(), q);
      if (rank === null) continue;
      matches.push({
        kind: 'symbol',
        path: f.path,
        name: s.name,
        symbolKind: s.kind,
        line: s.line,
        exported: s.exported,
        rank,
      });
    }
    const lowerPath = f.path.toLowerCase();
    const base = lowerPath.slice(lowerPath.lastIndexOf('/') + 1);
    const dot = base.indexOf('.');
    const stem = dot > 0 ? base.slice(0, dot) : base;
    const rank: CodeMapSearchMatch['rank'] | null =
      base === q || stem === q
        ? 'exact'
        : base.startsWith(q)
          ? 'prefix'
          : lowerPath.includes(q)
            ? 'substring'
            : null;
    if (rank !== null) {
      matches.push({
        kind: 'file',
        path: f.path,
        name: null,
        symbolKind: null,
        line: null,
        exported: null,
        rank,
      });
    }
  }
  matches.sort(
    (a, b) =>
      RANK_ORDER[a.rank] - RANK_ORDER[b.rank] ||
      (a.kind === b.kind ? 0 : a.kind === 'symbol' ? -1 : 1) ||
      (a.exported === b.exported ? 0 : a.exported === true ? -1 : 1) ||
      (a.name?.length ?? a.path.length) - (b.name?.length ?? b.path.length) ||
      cmp(a.path, b.path) ||
      (a.line ?? 0) - (b.line ?? 0),
  );
  return {
    matches: matches.slice(0, MAX_RESULTS),
    total: matches.length,
    truncated: matches.length > MAX_RESULTS,
  };
}

/** The summary's top-level folders (most files first, at most 50) and language counts. */
export function summarizeCodeMap(
  files: readonly CodeMapFile[],
): Pick<CodeMapSummaryDto, 'topFolders' | 'languages'> {
  const folders = new Map<string, { fileCount: number; symbolCount: number }>();
  const languages = new Map<CodeMapLanguage, number>();
  for (const f of files) {
    const top = folderAtDepth(folderOf(f.path), 1);
    const acc = folders.get(top) ?? { fileCount: 0, symbolCount: 0 };
    acc.fileCount++;
    acc.symbolCount += f.symbols.length;
    folders.set(top, acc);
    languages.set(f.language, (languages.get(f.language) ?? 0) + 1);
  }
  return {
    topFolders: [...folders.entries()]
      .map(([path, c]) => ({ path, ...c }))
      .sort((a, b) => b.fileCount - a.fileCount || cmp(a.path, b.path))
      .slice(0, MAX_FOLDERS),
    languages: [...languages.entries()]
      .map(([language, fileCount]) => ({ language, fileCount }))
      .sort((a, b) => b.fileCount - a.fileCount || cmp(a.language, b.language)),
  };
}
