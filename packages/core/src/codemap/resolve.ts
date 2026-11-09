import { folderOf } from './codemap.js';

/**
 * Import resolution against one manifest's path set (ADR-0034 §1). Pure: the caller supplies the
 * paths of the commit and the workspace packages it found. Anything that does not match a path of
 * the commit stays unresolved (null); nothing is guessed from names or folders.
 */

/** Extensions tried, in order, for an extensionless relative specifier. */
export const CODE_MAP_RESOLVE_EXTENSIONS = [
  '.ts',
  '.tsx',
  '.d.ts',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.mts',
  '.cts',
] as const;

/** TS ESM: `./x.js` in source names `./x.ts` on disk (NodeNext). */
const TS_ESM_MAPPING: Readonly<Record<string, readonly string[]>> = {
  '.js': ['.ts', '.tsx', '.d.ts'],
  '.jsx': ['.tsx'],
  '.mjs': ['.mts'],
  '.cjs': ['.cts'],
};

/** Joins and normalizes a repository-relative path; null when it climbs above the root. */
export function joinRepoPath(folder: string, specifier: string): string | null {
  const out: string[] = folder === '.' ? [] : folder.split('/');
  for (const seg of specifier.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') {
      if (out.length === 0) return null;
      out.pop();
      continue;
    }
    out.push(seg);
  }
  return out.length === 0 ? null : out.join('/');
}

/** The first existing path among `base` with each extension, then `base/index` with each. */
export function resolveFileCandidates(base: string, paths: ReadonlySet<string>): string | null {
  if (paths.has(base)) return base;
  const dot = base.lastIndexOf('.');
  const slash = base.lastIndexOf('/');
  if (dot > slash + 1) {
    const ext = base.slice(dot);
    const mapped = TS_ESM_MAPPING[ext];
    if (mapped !== undefined) {
      const stem = base.slice(0, dot);
      for (const m of mapped) if (paths.has(stem + m)) return stem + m;
    }
  }
  for (const ext of CODE_MAP_RESOLVE_EXTENSIONS) if (paths.has(base + ext)) return base + ext;
  for (const ext of CODE_MAP_RESOLVE_EXTENSIONS) {
    if (paths.has(`${base}/index${ext}`)) return `${base}/index${ext}`;
  }
  return null;
}

export function isRelativeSpecifier(specifier: string): boolean {
  return (
    specifier === '.' ||
    specifier === '..' ||
    specifier.startsWith('./') ||
    specifier.startsWith('../')
  );
}

/**
 * The repository path an import names, or null. Relative specifiers resolve against the importing
 * file's folder; a bare specifier resolves only when it is exactly a workspace package's name
 * (`packages` maps name to its entry path). Subpaths and npm packages stay null.
 */
export function resolveCodeMapSpecifier(
  fromPath: string,
  specifier: string,
  paths: ReadonlySet<string>,
  packages: ReadonlyMap<string, string>,
): string | null {
  if (isRelativeSpecifier(specifier)) {
    const base = joinRepoPath(folderOf(fromPath), specifier);
    return base === null ? null : resolveFileCandidates(base, paths);
  }
  return packages.get(specifier) ?? null;
}
