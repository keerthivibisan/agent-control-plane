import type {
  CodeMapFileDto,
  CodeMapGraphDto,
  CodeMapGraphNode,
  CodeMapSearchDto,
  CodeMapStatus,
  CodeMapSummaryDto,
} from '@acp/core/api';

/*
 * Synthetic code map DTOs (ADR-0034, CM-4 tests). No real repository: the paths, symbols and
 * commit below are made up. One symbol name is adversarial markup, to prove names render as text.
 */

export const CM_PROJECT_ID = 'proj-cm';
export const COMMIT = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678';
export const BUILT_AT = '2026-11-08T09:00:00.000Z';
export const XSS_NAME = '<img src=x onerror=alert(1)>';

export function summary(
  status: CodeMapStatus,
  { withManifest = status === 'ready', builtAt = BUILT_AT } = {},
): CodeMapSummaryDto {
  return {
    status,
    errorCode: status === 'failed' ? 'git_failed' : null,
    failedCommit: status === 'failed' ? COMMIT : null,
    manifest: withManifest
      ? {
          projectId: CM_PROJECT_ID,
          commit: COMMIT,
          builtAt,
          indexerVersion: 1,
          counts: {
            files: 12,
            indexed: 9,
            skipped: { 'too-large': 1, binary: 1, generated: 1, 'file-cap': 0 },
            symbols: 42,
            imports: 20,
            unresolved: 5,
          },
        }
      : null,
    topFolders: [{ path: 'src', fileCount: 6, symbolCount: 30 }],
    languages: [{ language: 'typescript', fileCount: 8 }],
  };
}

function file(id: string, folder: string, extra: Partial<CodeMapGraphNode> = {}): CodeMapGraphNode {
  return {
    id,
    kind: 'file',
    folder,
    language: 'typescript',
    isTest: false,
    fileCount: 1,
    symbolCount: 2,
    importCount: 0,
    importedByCount: 0,
    ...extra,
  };
}

/** A file-level view: three folders, one test, one unlinked JSON file. */
export function fileGraph(): CodeMapGraphDto {
  return {
    level: 'file',
    depth: 2,
    folder: null,
    nodes: [
      file('src/index.ts', 'src', { importCount: 1 }),
      file('src/lib/util.ts', 'src/lib', { importedByCount: 2 }),
      file('src/lib/data.json', 'src/lib', { language: 'json', symbolCount: 0 }),
      file('tests/util.test.ts', 'tests', { isTest: true, importCount: 1 }),
    ],
    groups: [
      { path: 'src', fileCount: 1, depth: 1 },
      { path: 'src/lib', fileCount: 2, depth: 2 },
      { path: 'tests', fileCount: 1, depth: 1 },
    ],
    edges: [
      { from: 'src/index.ts', to: 'src/lib/util.ts', weight: 1 },
      { from: 'tests/util.test.ts', to: 'src/lib/util.ts', weight: 1 },
    ],
    totalEdges: 2,
    truncated: false,
    commit: COMMIT,
    builtAt: BUILT_AT,
  };
}

/** A folder-level view (over the caps), cut further: `truncated`. */
export function folderGraph({ truncated = false } = {}): CodeMapGraphDto {
  const folder = (id: string, files: number, extra: Partial<CodeMapGraphNode> = {}) =>
    file(id, '.', { kind: 'folder', fileCount: files, ...extra });
  return {
    level: 'folder',
    depth: 1,
    folder: null,
    nodes: [
      folder('.', 2),
      folder('packages', 1400, { importCount: 3 }),
      folder('tests', 300, { isTest: true, importCount: 2 }),
    ],
    groups: [{ path: '.', fileCount: 1702, depth: 0 }],
    edges: [{ from: 'tests', to: 'packages', weight: 37 }],
    totalEdges: truncated ? 4100 : 1,
    truncated,
    commit: COMMIT,
    builtAt: BUILT_AT,
  };
}

/** The view inside `packages` after drilling in. */
export function packagesGraph(): CodeMapGraphDto {
  return {
    ...fileGraph(),
    folder: 'packages',
    nodes: [
      file('packages/a/index.ts', 'packages/a', { importCount: 1 }),
      file('packages/b/index.ts', 'packages/b', { importedByCount: 1 }),
    ],
    groups: [
      { path: 'packages/a', fileCount: 1, depth: 2 },
      { path: 'packages/b', fileCount: 1, depth: 2 },
    ],
    edges: [{ from: 'packages/a/index.ts', to: 'packages/b/index.ts', weight: 1 }],
    totalEdges: 1,
  };
}

export function utilFile(): CodeMapFileDto {
  return {
    file: {
      path: 'src/lib/util.ts',
      language: 'typescript',
      sizeBytes: 2458,
      lineCount: 87,
      isTest: false,
      symbols: [
        { name: 'formatThing', kind: 'function', line: 3, exported: true },
        { name: XSS_NAME, kind: 'const', line: 9, exported: false },
      ],
      imports: [
        { specifier: './data.json', kind: 'import', resolvedPath: 'src/lib/data.json' },
        { specifier: 'zod', kind: 'import', resolvedPath: null },
        { specifier: 'node:fs', kind: 'import', resolvedPath: null },
      ],
      skipped: null,
    },
    importedBy: ['src/index.ts', 'tests/util.test.ts'],
    tests: ['tests/util.test.ts'],
    commit: COMMIT,
  };
}

export function indexFile(): CodeMapFileDto {
  return {
    file: {
      path: 'src/index.ts',
      language: 'typescript',
      sizeBytes: 300,
      lineCount: 10,
      isTest: false,
      symbols: [],
      imports: [{ specifier: './lib/util', kind: 'import', resolvedPath: 'src/lib/util.ts' }],
      skipped: null,
    },
    importedBy: [],
    tests: [],
    commit: COMMIT,
  };
}

export function skippedFile(): CodeMapFileDto {
  return {
    file: {
      path: 'assets/logo.png',
      language: 'other',
      sizeBytes: 9000,
      lineCount: 0,
      isTest: false,
      symbols: [],
      imports: [],
      skipped: { reason: 'binary' },
    },
    importedBy: [],
    tests: [],
    commit: COMMIT,
  };
}

export function searchResult(query: string): CodeMapSearchDto {
  return {
    matches: [
      {
        kind: 'symbol',
        path: 'src/lib/util.ts',
        name: 'formatThing',
        symbolKind: 'function',
        line: 3,
        exported: true,
        rank: 'exact',
      },
      {
        kind: 'file',
        path: 'src/index.ts',
        name: null,
        symbolKind: null,
        line: null,
        exported: null,
        rank: 'substring',
      },
    ],
    total: 2,
    truncated: false,
    commit: COMMIT,
    query,
  };
}
