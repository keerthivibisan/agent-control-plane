import {
  assembleCodeMapFile,
  CODE_MAP_BINARY_SNIFF_BYTES,
  CODE_MAP_INDEXER_VERSION,
  CodeMapCommitSchema,
  CodeMapPathSchema,
  countCodeMap,
  folderOf,
  isGeneratedOrVendored,
  isScriptLanguage,
  joinRepoPath,
  languageOf,
  MAX_CODE_MAP_FILE_BYTES,
  MAX_CODE_MAP_FILES,
  resolveCodeMapSpecifier,
  resolveFileCandidates,
  type CodeMapBlob,
  type CodeMapFile,
} from '@acp/core';
import type { CodeMapEntryInput, CodeMapManifestRecord, CodeMapRepository } from '@acp/db';
import type { Logger } from '../logger.js';
import type { GitRunner } from '../workspace/git.js';
import { CodeMapBuildError } from './errors.js';
import { parseScript, type SourceParser } from './ts-parser.js';

/**
 * Builds the code map of one commit (ADR-0034 §2). Git is the only process, always as an argument
 * array (ADR-0013): `ls-tree` for paths, blob SHAs and sizes (so `.gitignore` is respected), and
 * `cat-file blob` for blobs the cache does not have yet. Content is read into memory, parsed and
 * dropped: only metadata is stored. Nothing is logged but counts.
 */

export interface CodeMapIndexerDeps {
  git: GitRunner;
  repo: CodeMapRepository;
  logger: Logger;
  now: () => Date;
  parse?: SourceParser;
  /** Parallel `git cat-file` reads; default 8. */
  concurrency?: number;
  /** Test hook for the file cap; default MAX_CODE_MAP_FILES. */
  maxFiles?: number;
}

export interface CodeMapIndexProject {
  id: string;
  rootPath: string;
}

export interface CodeMapIndexOutcome {
  record: CodeMapManifestRecord;
  /** True when a ready map for the commit already existed. */
  reused: boolean;
  /** Blobs read and analysed in this build (0 when reused). */
  analysedBlobs: number;
}

interface TreeEntry {
  path: string;
  sha: string;
  size: number;
}

/** At most this many `package.json` files are read for workspace package names. */
const MAX_PACKAGE_MANIFESTS = 200;
const PACKAGE_NAME = /^(?:@[a-z0-9][a-z0-9._~-]*\/)?[a-z0-9][a-z0-9._~-]*$/i;
const TREE_LINE = /^(\d{6}) (\w+) ([0-9a-f]{40}|[0-9a-f]{64}) +(\d+|-)\t([\s\S]+)$/;

function lineCountOf(text: string): number {
  if (text.length === 0) return 0;
  let lines = 1;
  for (let i = text.indexOf('\n'); i !== -1; i = text.indexOf('\n', i + 1)) lines++;
  return text.endsWith('\n') ? lines - 1 : lines;
}

/** Runs `fn` over `items` with at most `limit` in flight. */
async function mapBounded<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i] as T);
    }
  });
  await Promise.all(workers);
  return out;
}

export interface CodeMapIndexer {
  indexCommit(project: CodeMapIndexProject, commit: string): Promise<CodeMapIndexOutcome>;
}

export function createCodeMapIndexer(deps: CodeMapIndexerDeps): CodeMapIndexer {
  const parse = deps.parse ?? parseScript;
  const concurrency = deps.concurrency ?? 8;
  const maxFiles = deps.maxFiles ?? MAX_CODE_MAP_FILES;
  const git = (args: string[], cwd: string, input?: string) =>
    deps.git(args, input === undefined ? { cwd } : { cwd, input });

  async function readTree(
    cwd: string,
    commit: string,
  ): Promise<{
    entries: TreeEntry[];
    invalidPaths: number;
  }> {
    const { stdout } = await git(['ls-tree', '-r', '-l', '--full-tree', '-z', commit], cwd);
    const entries: TreeEntry[] = [];
    let invalidPaths = 0;
    for (const record of stdout.split('\0')) {
      if (record === '') continue;
      const m = TREE_LINE.exec(record);
      // Submodules (`commit`) and symlinks (120000) are not files of this repository.
      if (m === null || m[2] !== 'blob' || m[1] === '120000' || m[4] === '-') continue;
      const path = m[5] as string;
      if (!CodeMapPathSchema.safeParse(path).success) {
        invalidPaths++;
        continue;
      }
      entries.push({ path, sha: m[3] as string, size: Number(m[4]) });
    }
    entries.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
    return { entries, invalidPaths };
  }

  /**
   * Reads blobs through `git cat-file --batch`, one process per chunk (at most 500 objects or
   * 16 MiB), instead of one process per blob: a first build of a large repository would otherwise
   * start thousands of processes. A missing object is simply absent from the result.
   */
  async function readBlobs(
    cwd: string,
    entries: readonly TreeEntry[],
  ): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    const chunks: TreeEntry[][] = [];
    let chunk: TreeEntry[] = [];
    let bytes = 0;
    for (const e of entries) {
      if (chunk.length > 0 && (chunk.length >= 500 || bytes + e.size > 16 * 1024 * 1024)) {
        chunks.push(chunk);
        chunk = [];
        bytes = 0;
      }
      chunk.push(e);
      bytes += e.size;
    }
    if (chunk.length > 0) chunks.push(chunk);
    await mapBounded(chunks, Math.min(concurrency, 4), async (part) => {
      const { raw } = await git(
        ['cat-file', '--batch'],
        cwd,
        `${part.map((e) => e.sha).join('\n')}\n`,
      );
      if (raw === undefined) throw new CodeMapBuildError('git_failed');
      let offset = 0;
      while (offset < raw.length) {
        const newline = raw.indexOf(0x0a, offset);
        if (newline === -1) break;
        const [sha, type, size] = raw.toString('utf8', offset, newline).split(' ');
        if (type === 'missing' || size === undefined || sha === undefined) {
          offset = newline + 1;
          continue;
        }
        const end = newline + 1 + Number(size);
        out.set(sha, raw.toString('utf8', newline + 1, end));
        // The content is followed by one newline.
        offset = end + 1;
      }
    });
    return out;
  }

  async function readBlob(cwd: string, sha: string): Promise<string> {
    return (await git(['cat-file', 'blob', sha], cwd)).stdout;
  }

  function analyse(entry: TreeEntry, text: string | undefined): CodeMapBlob {
    const language = languageOf(entry.path);
    const empty = { lineCount: 0, symbols: [], imports: [] };
    if (entry.size > MAX_CODE_MAP_FILE_BYTES) {
      return { language, sizeBytes: entry.size, ...empty, skipped: { reason: 'too-large' } };
    }
    if (text === undefined) throw new CodeMapBuildError('git_failed');
    // A NUL in the first 8 KiB (decoded text keeps U+0000 where the byte was).
    if (text.slice(0, CODE_MAP_BINARY_SNIFF_BYTES).includes('\0')) {
      return { language, sizeBytes: entry.size, ...empty, skipped: { reason: 'binary' } };
    }
    const lineCount = lineCountOf(text);
    if (!isScriptLanguage(language)) {
      return {
        language,
        sizeBytes: entry.size,
        lineCount,
        symbols: [],
        imports: [],
        skipped: null,
      };
    }
    const parsed = parse(entry.path, text);
    return { language, sizeBytes: entry.size, lineCount, ...parsed, skipped: null };
  }

  /** Workspace package name to its entry file: `src/index.*`, else `main`, in the same commit. */
  async function workspacePackages(
    cwd: string,
    entries: readonly TreeEntry[],
    paths: ReadonlySet<string>,
  ): Promise<Map<string, string>> {
    const manifests = entries
      .filter((e) => e.path === 'package.json' || e.path.endsWith('/package.json'))
      .filter((e) => e.size <= 64 * 1024)
      .slice(0, MAX_PACKAGE_MANIFESTS);
    const read = await mapBounded(manifests, concurrency, async (e) => {
      try {
        const json: unknown = JSON.parse(await readBlob(cwd, e.sha));
        return { path: e.path, json };
      } catch {
        return { path: e.path, json: null };
      }
    });
    const packages = new Map<string, string>();
    for (const { path, json } of read) {
      if (typeof json !== 'object' || json === null) continue;
      const { name, main } = json as { name?: unknown; main?: unknown };
      if (typeof name !== 'string' || !PACKAGE_NAME.test(name) || packages.has(name)) continue;
      const dir = folderOf(path);
      const prefix = dir === '.' ? '' : `${dir}/`;
      let entry = resolveFileCandidates(`${prefix}src/index`, paths);
      if (entry === null && typeof main === 'string') {
        const base = joinRepoPath(dir, main);
        if (base !== null) entry = resolveFileCandidates(base, paths);
      }
      if (entry !== null) packages.set(name, entry);
    }
    return packages;
  }

  return {
    async indexCommit(project, commit) {
      const existing = deps.repo.getManifest(project.id, commit);
      if (existing?.status === 'ready' && existing.indexerVersion === CODE_MAP_INDEXER_VERSION) {
        return { record: existing, reused: true, analysedBlobs: 0 };
      }
      // A full commit id only: never a ref name or anything git could read as an option.
      if (!CodeMapCommitSchema.safeParse(commit).success) {
        throw new CodeMapBuildError('commit_not_found');
      }
      const started = deps.now().getTime();
      const cwd = project.rootPath;
      const { entries, invalidPaths } = await readTree(cwd, commit);

      let generated = 0;
      const kept: TreeEntry[] = [];
      for (const e of entries) {
        if (isGeneratedOrVendored(e.path)) generated++;
        else kept.push(e);
      }
      const candidates = kept.slice(0, maxFiles);
      const fileCap = kept.length - candidates.length;
      const paths = new Set(candidates.map((e) => e.path));

      const cached = deps.repo.getBlobs(
        project.id,
        candidates.map((e) => e.sha),
      );
      // One analysis per blob SHA; a cached blob read with another parser kind is read again.
      const todo = new Map<string, TreeEntry>();
      for (const e of candidates) {
        const blob = cached.get(e.sha);
        const stale =
          blob !== undefined &&
          blob.skipped === null &&
          isScriptLanguage(languageOf(e.path)) &&
          !isScriptLanguage(blob.language);
        if ((blob === undefined || stale) && !todo.has(e.sha)) todo.set(e.sha, e);
      }
      const pending = [...todo.values()];
      const texts = await readBlobs(
        cwd,
        pending.filter((e) => e.size <= MAX_CODE_MAP_FILE_BYTES),
      );
      const analysed = pending.map((e) => ({ blobSha: e.sha, blob: analyse(e, texts.get(e.sha)) }));
      for (let i = 0; i < analysed.length; i += 500) {
        deps.repo.putBlobs(project.id, analysed.slice(i, i + 500));
      }
      const blobs = new Map(cached);
      for (const a of analysed) blobs.set(a.blobSha, a.blob);

      const packages = await workspacePackages(cwd, candidates, paths);
      const files: CodeMapFile[] = [];
      const rows: CodeMapEntryInput[] = [];
      for (const e of candidates) {
        const blob = blobs.get(e.sha) ?? null;
        const script =
          blob !== null &&
          blob.skipped === null &&
          isScriptLanguage(blob.language) === isScriptLanguage(languageOf(e.path));
        const data = {
          resolved: script
            ? blob.imports.map((i) => resolveCodeMapSpecifier(e.path, i.specifier, paths, packages))
            : [],
          skipped: null,
        };
        files.push(assembleCodeMapFile(e.path, e.size, blob, data));
        rows.push({ path: e.path, blobSha: e.sha, sizeBytes: e.size, data });
      }
      const counts = countCodeMap(files, { generated, fileCap });
      const record = deps.repo.insertManifest({
        projectId: project.id,
        commit,
        builtAt: deps.now().toISOString(),
        indexerVersion: CODE_MAP_INDEXER_VERSION,
        counts,
        entries: rows,
      });
      deps.logger.log('info', 'code map built', {
        files: counts.files,
        indexed: counts.indexed,
        symbols: counts.symbols,
        imports: counts.imports,
        unresolved: counts.unresolved,
        analysedBlobs: analysed.length,
        reusedBlobs: candidates.length - analysed.length,
        invalidPaths,
        durationMs: Math.max(0, deps.now().getTime() - started),
      });
      return { record, reused: false, analysedBlobs: analysed.length };
    },
  };
}
