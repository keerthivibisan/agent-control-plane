import { lstat, readFile } from 'node:fs/promises';
import { HarnessManifestSchema } from '@acp/core';

/**
 * ADR-0027 §3: the folders setup steps create (`outputs`, e.g. `node_modules`) are never staged
 * in a helper's change, like the attachment copies (ADR-0026 §4). Pure helpers for the workspace
 * manager: which outputs a harness file declares, and its git pathspecs.
 */

/** A harness file is a short JSON file; anything bigger is ignored here (it is invalid anyway). */
const MAX_MANIFEST_BYTES = 64 * 1024;

/** `a/./b/` → `a/b`; a path that names the project folder itself (`.`, `./`) → null. */
function normalise(output: string): string | null {
  const path = output
    .split('/')
    .filter((seg) => seg !== '' && seg !== '.')
    .join('/');
  return path === '' ? null : path;
}

/**
 * The `outputs` of every setup step in a harness file's text, normalised (no `.` segments, no
 * trailing slash), each once. An unreadable, invalid or missing file declares none. An output that
 * names the project folder itself is ignored: it would keep the whole change out of the seal.
 */
export function setupOutputsOf(text: string | null): string[] {
  if (text === null || text.length > MAX_MANIFEST_BYTES) return [];
  let raw: unknown;
  try {
    raw = JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);
  } catch {
    return [];
  }
  const parsed = HarnessManifestSchema.safeParse(raw);
  if (!parsed.success) return [];
  const all = (parsed.data.setup ?? []).flatMap((s) => s.outputs ?? []);
  return [...new Set(all.flatMap((o) => normalise(o) ?? []))];
}

/** A regular file's text (never through a symlink), or null. */
export async function readSmallFile(path: string): Promise<string | null> {
  try {
    const info = await lstat(path);
    if (!info.isFile() || info.size > MAX_MANIFEST_BYTES) return null;
    return await readFile(path, 'utf8');
  } catch {
    return null;
  }
}

/**
 * Git pathspecs (from the top of the repository) for outputs relative to the project folder.
 * `literal`: a name with `*` or `?` means that very folder, never a pattern.
 */
export function outputPathspecs(
  projectPrefix: string,
  outputs: readonly string[],
  magic: 'top' | 'top,exclude',
): string[] {
  return outputs.map((o) => `:(${magic},literal)${projectPrefix}${o}`);
}
