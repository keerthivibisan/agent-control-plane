import { z } from 'zod';
import { IsoTimestampSchema } from '../domain/time.js';

/**
 * The project code map (ADR-0034): source-derived metadata about the files of a repository at one
 * commit. Paths, languages, sizes, top-level symbol names with lines, and import specifiers. Never
 * source text, comments or string literals other than import specifiers; no conversation content
 * (ADR-0009). Symbol names and paths are data, never instructions.
 */

/** Bumped whenever the parse result for the same blob would change; older blob rows are re-parsed. */
export const CODE_MAP_INDEXER_VERSION = 1;
/** ADR-0034 §2 caps. */
export const MAX_CODE_MAP_FILES = 20_000;
export const MAX_CODE_MAP_FILE_BYTES = 512 * 1024;
/** A NUL byte in this many leading bytes marks a blob as binary. */
export const CODE_MAP_BINARY_SNIFF_BYTES = 8 * 1024;
/** Per-file bounds, so one generated-looking file cannot bloat the store. */
export const MAX_CODE_MAP_SYMBOLS_PER_FILE = 2_000;
export const MAX_CODE_MAP_IMPORTS_PER_FILE = 2_000;
export const MAX_CODE_MAP_NAME_LENGTH = 512;
export const MAX_CODE_MAP_SPECIFIER_LENGTH = 1_024;
export const MAX_CODE_MAP_PATH_LENGTH = 1_024;

/** A repository-relative path with `/` separators: no absolute paths, no `..`, no empty segment. */
export const CodeMapPathSchema = z
  .string()
  .min(1)
  .max(MAX_CODE_MAP_PATH_LENGTH)
  .refine(
    (p) =>
      !p.startsWith('/') &&
      !/^[A-Za-z]:/.test(p) &&
      !p.includes('\\') &&
      !p.includes('\0') &&
      p.split('/').every((seg) => seg !== '..' && seg !== '.' && seg !== ''),
    'must be a path inside the repository',
  );

/** A full commit id: the map always names the exact commit it describes (ADR-0034 §3). */
export const CodeMapCommitSchema = z
  .string()
  .regex(/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/, 'a commit id');
/** A git object id. */
export const CodeMapBlobShaSchema = CodeMapCommitSchema;

export const CODE_MAP_LANGUAGES = [
  'typescript',
  'tsx',
  'javascript',
  'jsx',
  'json',
  'markdown',
  'css',
  'html',
  'yaml',
  'toml',
  'python',
  'go',
  'rust',
  'java',
  'kotlin',
  'swift',
  'c',
  'cpp',
  'csharp',
  'ruby',
  'php',
  'shell',
  'sql',
  'other',
] as const;
export const CodeMapLanguageSchema = z.enum(CODE_MAP_LANGUAGES);
export type CodeMapLanguage = z.infer<typeof CodeMapLanguageSchema>;

export const CodeMapSymbolKindSchema = z.enum([
  'function',
  'class',
  'interface',
  'type',
  'enum',
  'namespace',
  'const',
  'let',
  'var',
]);
export type CodeMapSymbolKind = z.infer<typeof CodeMapSymbolKindSchema>;

export const CodeMapSymbolSchema = z.object({
  name: z.string().min(1).max(MAX_CODE_MAP_NAME_LENGTH),
  kind: CodeMapSymbolKindSchema,
  /** 1-based line of the declaration. */
  line: z.number().int().min(1),
  exported: z.boolean(),
});
export type CodeMapSymbol = z.infer<typeof CodeMapSymbolSchema>;

export const CodeMapImportKindSchema = z.enum(['import', 'require', 'dynamic', 'export-from']);
export type CodeMapImportKind = z.infer<typeof CodeMapImportKindSchema>;

/** An import as parsed: path-independent, so it is cached per blob. */
export const CodeMapImportSpecSchema = z.object({
  specifier: z.string().min(1).max(MAX_CODE_MAP_SPECIFIER_LENGTH),
  kind: CodeMapImportKindSchema,
});
export type CodeMapImportSpec = z.infer<typeof CodeMapImportSpecSchema>;

/** An import in a manifest: resolved against that manifest's path set, or null. */
export const CodeMapImportSchema = CodeMapImportSpecSchema.extend({
  resolvedPath: CodeMapPathSchema.nullable(),
});
export type CodeMapImport = z.infer<typeof CodeMapImportSchema>;

export const CodeMapSkipReasonSchema = z.enum(['too-large', 'binary', 'generated', 'file-cap']);
export type CodeMapSkipReason = z.infer<typeof CodeMapSkipReasonSchema>;

/**
 * The cached parse result of one blob (keyed by project and blob SHA). Imports carry specifiers
 * only: resolution depends on the manifest's path set. `language` is the parser the blob was read
 * with, so a blob seen under another kind of path is parsed again.
 */
export const CodeMapBlobSchema = z.object({
  language: CodeMapLanguageSchema,
  sizeBytes: z.number().int().nonnegative(),
  lineCount: z.number().int().nonnegative(),
  symbols: z.array(CodeMapSymbolSchema).max(MAX_CODE_MAP_SYMBOLS_PER_FILE),
  imports: z.array(CodeMapImportSpecSchema).max(MAX_CODE_MAP_IMPORTS_PER_FILE),
  /** Only content-based reasons (`too-large`, `binary`) are blob properties. */
  skipped: z.object({ reason: CodeMapSkipReasonSchema }).nullable(),
});
export type CodeMapBlob = z.infer<typeof CodeMapBlobSchema>;

/**
 * The per-manifest part of a file: resolved paths aligned with the blob's imports, and a
 * path-based skip reason (or a content-based one recorded without a blob row).
 */
export const CodeMapEntryDataSchema = z.object({
  resolved: z.array(CodeMapPathSchema.nullable()).max(MAX_CODE_MAP_IMPORTS_PER_FILE),
  skipped: CodeMapSkipReasonSchema.nullable(),
});
export type CodeMapEntryData = z.infer<typeof CodeMapEntryDataSchema>;

export const CodeMapFileSchema = z.object({
  path: CodeMapPathSchema,
  language: CodeMapLanguageSchema,
  sizeBytes: z.number().int().nonnegative(),
  lineCount: z.number().int().nonnegative(),
  isTest: z.boolean(),
  symbols: z.array(CodeMapSymbolSchema),
  imports: z.array(CodeMapImportSchema),
  skipped: z.object({ reason: CodeMapSkipReasonSchema }).nullable(),
});
export type CodeMapFile = z.infer<typeof CodeMapFileSchema>;

const count = z.number().int().nonnegative();

export const CodeMapCountsSchema = z.object({
  /** Regular files in the commit's tree (symlinks and submodules are not files). */
  files: count,
  /** Files with a map entry that was not skipped. */
  indexed: count,
  skipped: z.object({
    'too-large': count,
    binary: count,
    generated: count,
    'file-cap': count,
  }),
  symbols: count,
  imports: count,
  /** Imports with no repository path: bare packages and specifiers that match no file. */
  unresolved: count,
});
export type CodeMapCounts = z.infer<typeof CodeMapCountsSchema>;

export const CodeMapManifestSchema = z.object({
  projectId: z.string().min(1),
  commit: CodeMapCommitSchema,
  builtAt: IsoTimestampSchema,
  indexerVersion: z.number().int().min(1),
  counts: CodeMapCountsSchema,
});
export type CodeMapManifest = z.infer<typeof CodeMapManifestSchema>;

/** Why a build failed; a short machine code, never a message. */
export const CodeMapErrorCodeSchema = z.enum(['git_failed', 'commit_not_found', 'index_failed']);
export type CodeMapErrorCode = z.infer<typeof CodeMapErrorCodeSchema>;

// ---------------------------------------------------------------- pure helpers

const EXTENSION_LANGUAGE: Readonly<Record<string, CodeMapLanguage>> = {
  ts: 'typescript',
  mts: 'typescript',
  cts: 'typescript',
  tsx: 'tsx',
  js: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  jsx: 'jsx',
  json: 'json',
  jsonc: 'json',
  md: 'markdown',
  mdx: 'markdown',
  css: 'css',
  scss: 'css',
  less: 'css',
  html: 'html',
  htm: 'html',
  yml: 'yaml',
  yaml: 'yaml',
  toml: 'toml',
  py: 'python',
  go: 'go',
  rs: 'rust',
  java: 'java',
  kt: 'kotlin',
  kts: 'kotlin',
  swift: 'swift',
  c: 'c',
  h: 'c',
  cc: 'cpp',
  cpp: 'cpp',
  cxx: 'cpp',
  hpp: 'cpp',
  cs: 'csharp',
  rb: 'ruby',
  php: 'php',
  sh: 'shell',
  bash: 'shell',
  zsh: 'shell',
  sql: 'sql',
};

function baseName(path: string): string {
  const slash = path.lastIndexOf('/');
  return slash === -1 ? path : path.slice(slash + 1);
}

/** The language of a path, from its extension; `other` when unknown. */
export function languageOf(path: string): CodeMapLanguage {
  const name = baseName(path).toLowerCase();
  const dot = name.lastIndexOf('.');
  if (dot <= 0) return 'other';
  return EXTENSION_LANGUAGE[name.slice(dot + 1)] ?? 'other';
}

/** Languages parsed with the TypeScript compiler API for symbols and imports. */
export function isScriptLanguage(language: CodeMapLanguage): boolean {
  return (
    language === 'typescript' ||
    language === 'tsx' ||
    language === 'javascript' ||
    language === 'jsx'
  );
}

const TEST_DIRS = new Set(['__tests__', '__test__', 'test', 'tests', 'spec', 'specs', 'e2e']);

/** True for test files by common conventions (test folders, `.test.`/`.spec.`, `_test.go`, …). */
export function isTestPath(path: string): boolean {
  const segments = path.split('/');
  const name = (segments.pop() ?? '').toLowerCase();
  if (segments.some((s) => TEST_DIRS.has(s.toLowerCase()))) return true;
  if (/\.(test|spec)\.[^.]+$/.test(name)) return true;
  if (/_test\.(go|py)$/.test(name)) return true;
  if (/^test_.+\.py$/.test(name)) return true;
  return false;
}

const VENDOR_DIRS = new Set([
  'node_modules',
  'dist',
  'build',
  '.next',
  'vendor',
  'coverage',
  'bower_components',
]);
const LOCKFILES = new Set([
  'pnpm-lock.yaml',
  'package-lock.json',
  'yarn.lock',
  'npm-shrinkwrap.json',
  'bun.lockb',
  'bun.lock',
  'cargo.lock',
  'poetry.lock',
  'composer.lock',
  'gemfile.lock',
  'go.sum',
]);

/** Generated or vendored paths, skipped with reason `generated` (ADR-0034 §2). */
export function isGeneratedOrVendored(path: string): boolean {
  const segments = path.split('/');
  const name = (segments.pop() ?? '').toLowerCase();
  if (segments.some((s) => VENDOR_DIRS.has(s))) return true;
  if (LOCKFILES.has(name)) return true;
  return /\.min\.(js|css)$/.test(name) || name.endsWith('.map');
}

/** The folder of a path; `.` for a file at the repository root. */
export function folderOf(path: string): string {
  const slash = path.lastIndexOf('/');
  return slash === -1 ? '.' : path.slice(0, slash);
}

/** Number of segments of a folder; the root `.` is depth 0. */
export function folderDepth(folder: string): number {
  return folder === '.' ? 0 : folder.split('/').length;
}

/** A folder cut to at most `depth` segments (depth 0 gives the root `.`). */
export function folderAtDepth(folder: string, depth: number): string {
  if (folder === '.' || depth <= 0) return '.';
  const segments = folder.split('/');
  return segments.length <= depth ? folder : segments.slice(0, depth).join('/');
}

/** True when `path` is `folder` itself or inside it; every path is inside the root `.`. */
export function isUnderFolder(path: string, folder: string): boolean {
  return folder === '.' || path === folder || path.startsWith(`${folder}/`);
}

/**
 * One file of a manifest from its cached blob and its per-manifest data. `skipped` on the entry
 * (path-based reasons) wins over the blob's; resolved paths line up with the blob's imports.
 */
export function assembleCodeMapFile(
  path: string,
  sizeBytes: number,
  blob: CodeMapBlob | null,
  entry: CodeMapEntryData,
): CodeMapFile {
  const language = languageOf(path);
  const skippedReason = entry.skipped ?? blob?.skipped?.reason ?? null;
  // Symbols and imports only from a parse of the same kind (a script parse for a script path).
  const parsed =
    skippedReason === null &&
    blob !== null &&
    isScriptLanguage(blob.language) === isScriptLanguage(language);
  return {
    path,
    language,
    sizeBytes: blob?.sizeBytes ?? sizeBytes,
    lineCount: parsed ? blob.lineCount : 0,
    isTest: isTestPath(path),
    symbols: parsed ? blob.symbols : [],
    imports: parsed
      ? blob.imports.map((spec, i) => ({ ...spec, resolvedPath: entry.resolved[i] ?? null }))
      : [],
    skipped: skippedReason === null ? null : { reason: skippedReason },
  };
}

/** Manifest counts from its files plus the counts of files that got no entry. */
export function countCodeMap(
  files: readonly CodeMapFile[],
  unlisted: { generated: number; fileCap: number },
): CodeMapCounts {
  const skipped = { 'too-large': 0, binary: 0, generated: unlisted.generated, 'file-cap': 0 };
  skipped['file-cap'] = unlisted.fileCap;
  let indexed = 0;
  let symbols = 0;
  let imports = 0;
  let unresolved = 0;
  for (const f of files) {
    if (f.skipped !== null) {
      skipped[f.skipped.reason]++;
      continue;
    }
    indexed++;
    symbols += f.symbols.length;
    imports += f.imports.length;
    for (const i of f.imports) if (i.resolvedPath === null) unresolved++;
  }
  return {
    files: files.length + unlisted.generated + unlisted.fileCap,
    indexed,
    skipped,
    symbols,
    imports,
    unresolved,
  };
}
