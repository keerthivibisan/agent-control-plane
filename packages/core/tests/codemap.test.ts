// Synthetic paths only (CM-1, ADR-0034): the code map's pure helpers and views.
import { describe, expect, it } from 'vitest';
import {
  assembleCodeMapFile,
  buildCodeMapGraph,
  CodeMapPathSchema,
  codeMapFileDetail,
  countCodeMap,
  folderAtDepth,
  folderOf,
  isGeneratedOrVendored,
  isTestPath,
  languageOf,
  resolveCodeMapSpecifier,
  searchCodeMap,
  summarizeCodeMap,
  type CodeMapFile,
} from '../src/index.js';
import {
  CodeMapFileQuerySchema,
  CodeMapGraphDtoSchema,
  CodeMapGraphQuerySchema,
  CodeMapSearchQuerySchema,
  CodeMapSummaryDtoSchema,
} from '../src/api/index.js';

function file(path: string, partial: Partial<CodeMapFile> = {}): CodeMapFile {
  return {
    path,
    language: languageOf(path),
    sizeBytes: 10,
    lineCount: 1,
    isTest: isTestPath(path),
    symbols: [],
    imports: [],
    skipped: null,
    ...partial,
  };
}

const imp = (resolvedPath: string | null, specifier = 'x') => ({
  specifier,
  kind: 'import' as const,
  resolvedPath,
});

describe('code map helpers', () => {
  it('languageOf maps extensions and falls back to other', () => {
    expect(languageOf('a/b.ts')).toBe('typescript');
    expect(languageOf('a/b.mts')).toBe('typescript');
    expect(languageOf('a/b.tsx')).toBe('tsx');
    expect(languageOf('b.cjs')).toBe('javascript');
    expect(languageOf('b.jsx')).toBe('jsx');
    expect(languageOf('README.MD')).toBe('markdown');
    expect(languageOf('main.go')).toBe('go');
    expect(languageOf('Makefile')).toBe('other');
    expect(languageOf('.gitignore')).toBe('other');
  });

  it('isTestPath recognises common conventions', () => {
    for (const p of [
      'src/a.test.ts',
      'src/a.spec.tsx',
      'tests/a.ts',
      'pkg/__tests__/x.js',
      'x_test.go',
      'test_x.py',
      'e2e/flow.ts',
    ]) {
      expect(isTestPath(p), p).toBe(true);
    }
    for (const p of ['src/a.ts', 'src/testing.ts', 'latest/a.ts', 'contest.md']) {
      expect(isTestPath(p), p).toBe(false);
    }
  });

  it('isGeneratedOrVendored flags vendored folders, lockfiles, minified files and maps', () => {
    for (const p of [
      'node_modules/x/index.js',
      'packages/a/dist/index.js',
      'build/out.js',
      'web/.next/x.js',
      'vendor/lib.go',
      'coverage/lcov.info',
      'pnpm-lock.yaml',
      'sub/package-lock.json',
      'yarn.lock',
      'static/app.min.js',
      'static/app.js.map',
    ]) {
      expect(isGeneratedOrVendored(p), p).toBe(true);
    }
    for (const p of ['src/build.ts', 'src/distance.ts', 'package.json', 'docs/vendor.md']) {
      expect(isGeneratedOrVendored(p), p).toBe(false);
    }
  });

  it('folderOf and folderAtDepth', () => {
    expect(folderOf('a.ts')).toBe('.');
    expect(folderOf('a/b/c.ts')).toBe('a/b');
    expect(folderAtDepth('a/b/c', 2)).toBe('a/b');
    expect(folderAtDepth('a', 2)).toBe('a');
    expect(folderAtDepth('a/b', 0)).toBe('.');
  });

  it('CodeMapPathSchema refuses absolute, parent and empty segments', () => {
    expect(CodeMapPathSchema.safeParse('src/a.ts').success).toBe(true);
    for (const bad of ['/etc/passwd', '../x', 'a/../b', 'a//b', 'C:/x', 'a\\b', './a', '']) {
      expect(CodeMapPathSchema.safeParse(bad).success, bad).toBe(false);
    }
  });

  it('assembleCodeMapFile lines resolved paths up with imports; a skip hides the parse', () => {
    const blob = {
      language: 'typescript' as const,
      sizeBytes: 5,
      lineCount: 3,
      symbols: [{ name: 'a', kind: 'const' as const, line: 1, exported: true }],
      imports: [
        { specifier: './b.js', kind: 'import' as const },
        { specifier: 'zod', kind: 'import' as const },
      ],
      skipped: null,
    };
    const f = assembleCodeMapFile('src/a.test.ts', 5, blob, {
      resolved: ['src/b.ts', null],
      skipped: null,
    });
    expect(f).toMatchObject({ isTest: true, lineCount: 3, skipped: null });
    expect(f.imports.map((i) => i.resolvedPath)).toEqual(['src/b.ts', null]);
    const skipped = assembleCodeMapFile('big.ts', 9, null, { resolved: [], skipped: 'too-large' });
    expect(skipped).toMatchObject({ sizeBytes: 9, symbols: [], skipped: { reason: 'too-large' } });
  });

  it('countCodeMap totals indexed, skipped and unresolved', () => {
    const counts = countCodeMap(
      [
        file('a.ts', { symbols: [{ name: 'a', kind: 'function', line: 1, exported: false }] }),
        file('b.ts', { imports: [imp('a.ts'), imp(null)] }),
        file('c.bin', { skipped: { reason: 'binary' } }),
      ],
      { generated: 4, fileCap: 2 },
    );
    expect(counts).toEqual({
      files: 9,
      indexed: 2,
      skipped: { 'too-large': 0, binary: 1, generated: 4, 'file-cap': 2 },
      symbols: 1,
      imports: 2,
      unresolved: 1,
    });
  });
});

describe('resolveCodeMapSpecifier', () => {
  const paths = new Set([
    'src/a.ts',
    'src/b.tsx',
    'src/lib/index.ts',
    'src/plain.js',
    'src/esm.mts',
    'packages/core/src/index.ts',
  ]);
  const pkgs = new Map([['@acp/core', 'packages/core/src/index.ts']]);
  const r = (from: string, spec: string) => resolveCodeMapSpecifier(from, spec, paths, pkgs);

  it('resolves extensions, index files and the TS ESM .js to .ts mapping', () => {
    expect(r('src/x.ts', './a')).toBe('src/a.ts');
    expect(r('src/x.ts', './a.js')).toBe('src/a.ts');
    expect(r('src/x.ts', './b.js')).toBe('src/b.tsx');
    expect(r('src/x.ts', './b')).toBe('src/b.tsx');
    expect(r('src/x.ts', './lib')).toBe('src/lib/index.ts');
    expect(r('src/x.ts', './plain.js')).toBe('src/plain.js');
    expect(r('src/x.ts', './esm.mjs')).toBe('src/esm.mts');
    expect(r('src/deep/y.ts', '../a')).toBe('src/a.ts');
  });

  it('leaves bare packages, subpaths, misses and escapes unresolved; resolves workspace names', () => {
    expect(r('src/x.ts', 'zod')).toBeNull();
    expect(r('src/x.ts', '@acp/core')).toBe('packages/core/src/index.ts');
    expect(r('src/x.ts', '@acp/core/api')).toBeNull();
    expect(r('src/x.ts', './missing')).toBeNull();
    expect(r('src/x.ts', '../../../etc/passwd')).toBeNull();
  });
});

describe('code map views', () => {
  const files = [
    file('src/a.ts', {
      symbols: [
        { name: 'createThing', kind: 'function', line: 3, exported: true },
        { name: 'thing', kind: 'const', line: 1, exported: false },
      ],
      imports: [imp('src/b.ts'), imp(null, 'zod')],
    }),
    file('src/b.ts', { symbols: [{ name: 'Thing', kind: 'class', line: 2, exported: true }] }),
    file('tests/a.test.ts', { imports: [imp('src/a.ts')] }),
    file('docs/thing.md'),
    file('bin/blob.png', { skipped: { reason: 'binary' } }),
  ];

  it('builds a file graph with groups, counts and resolved edges only', () => {
    const g = buildCodeMapGraph(files);
    expect(g.level).toBe('file');
    expect(g.nodes.map((n) => n.id).sort()).toEqual([
      'docs/thing.md',
      'src/a.ts',
      'src/b.ts',
      'tests/a.test.ts',
    ]);
    expect(g.edges).toEqual([
      { from: 'src/a.ts', to: 'src/b.ts', weight: 1 },
      { from: 'tests/a.test.ts', to: 'src/a.ts', weight: 1 },
    ]);
    expect(g.nodes.find((n) => n.id === 'src/a.ts')).toMatchObject({
      importCount: 1,
      importedByCount: 1,
      symbolCount: 2,
      folder: 'src',
    });
    expect(g.groups.map((x) => x.path)).toEqual(['docs', 'src', 'tests']);
  });

  it('filters by folder prefix', () => {
    const g = buildCodeMapGraph(files, { folder: 'src' });
    expect(g.nodes.map((n) => n.id)).toEqual(['src/a.ts', 'src/b.ts']);
    expect(g.edges).toHaveLength(1);
  });

  it('collapses to folder nodes with weighted edges over the node cap', () => {
    const many: CodeMapFile[] = [];
    for (let i = 0; i < 1600; i++) {
      many.push(file(`pkg${i % 4}/sub${i % 8}/f${i}.ts`, { imports: [imp(`pkg0/sub0/f0.ts`)] }));
    }
    const g = buildCodeMapGraph(many);
    expect(g.level).toBe('folder');
    expect(g.depth).toBe(2);
    expect(g.nodes.length).toBe(8);
    expect(g.nodes.every((n) => n.kind === 'folder')).toBe(true);
    const fromOther = g.edges.find((e) => e.from === 'pkg1/sub1');
    expect(fromOther).toEqual({ from: 'pkg1/sub1', to: 'pkg0/sub0', weight: 200 });
    expect(g.groups.map((x) => x.path)).toEqual(['pkg0', 'pkg1', 'pkg2', 'pkg3']);
    expect(
      CodeMapGraphDtoSchema.safeParse({
        ...g,
        commit: 'a'.repeat(40),
        builtAt: '2026-11-08T00:00:00.000Z',
      }).success,
    ).toBe(true);
    const shallow = buildCodeMapGraph(many, { depth: 1 });
    expect(shallow.nodes.map((n) => n.id)).toEqual(['pkg0', 'pkg1', 'pkg2', 'pkg3']);
  });

  it('collapses when only the edge cap is exceeded', () => {
    const many: CodeMapFile[] = [];
    for (let i = 0; i < 100; i++) {
      const imports = [];
      for (let j = 0; j < 50; j++) imports.push(imp(`b/f${j}.ts`));
      many.push(file(`a/f${i}.ts`, { imports }));
    }
    for (let j = 0; j < 50; j++) many.push(file(`b/f${j}.ts`));
    const g = buildCodeMapGraph(many);
    expect(g.level).toBe('folder');
    expect(g.edges).toEqual([{ from: 'a', to: 'b', weight: 5000 }]);
  });

  it('file detail lists importers and the tests among them', () => {
    expect(codeMapFileDetail(files, 'src/a.ts')).toMatchObject({
      importedBy: ['tests/a.test.ts'],
      tests: ['tests/a.test.ts'],
    });
    expect(codeMapFileDetail(files, 'src/b.ts')?.tests).toEqual([]);
    expect(codeMapFileDetail(files, 'nope.ts')).toBeUndefined();
  });

  it('search ranks exact symbol, then prefix, then substring, case-insensitively', () => {
    const s = searchCodeMap(files, 'THING');
    expect(s.matches.map((m) => [m.rank, m.kind, m.name ?? m.path])).toEqual([
      ['exact', 'symbol', 'Thing'],
      ['exact', 'symbol', 'thing'],
      ['exact', 'file', 'docs/thing.md'],
      ['substring', 'symbol', 'createThing'],
    ]);
    expect(searchCodeMap(files, 'crea').matches[0]).toMatchObject({
      rank: 'prefix',
      name: 'createThing',
      line: 3,
    });
    expect(searchCodeMap(files, 'zzz')).toEqual({ matches: [], total: 0, truncated: false });
  });

  it('search caps at 50 matches', () => {
    const many = Array.from({ length: 80 }, (_, i) => file(`src/item${i}.ts`));
    const s = searchCodeMap(many, 'item');
    expect(s.matches).toHaveLength(50);
    expect(s).toMatchObject({ total: 80, truncated: true });
  });

  it('summarizes top folders and languages', () => {
    const s = summarizeCodeMap(files);
    expect(s.topFolders[0]).toEqual({ path: 'src', fileCount: 2, symbolCount: 3 });
    expect(s.languages[0]).toEqual({ language: 'typescript', fileCount: 3 });
    expect(
      CodeMapSummaryDtoSchema.safeParse({
        status: 'none',
        errorCode: null,
        failedCommit: null,
        manifest: null,
        ...s,
      }).success,
    ).toBe(true);
  });

  it('query schemas validate paths, depth and q', () => {
    expect(CodeMapFileQuerySchema.safeParse({ path: '../x' }).success).toBe(false);
    expect(CodeMapGraphQuerySchema.parse({ depth: '2' })).toEqual({ depth: 2 });
    expect(CodeMapGraphQuerySchema.safeParse({ depth: '0' }).success).toBe(false);
    expect(CodeMapSearchQuerySchema.safeParse({ q: '' }).success).toBe(false);
    expect(CodeMapSearchQuerySchema.safeParse({ q: 'x'.repeat(201) }).success).toBe(false);
  });
});
