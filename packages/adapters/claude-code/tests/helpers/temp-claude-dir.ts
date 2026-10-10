import { mkdir, mkdtemp, realpath, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

/** A throwaway Claude data root. Tests never touch the real `~/.claude`. */
export async function makeTempDir(prefix = 'acp-cc-'): Promise<string> {
  // realpath: on macOS the temp dir is behind a symlink (/var -> /private/var).
  return realpath(await mkdtemp(path.join(tmpdir(), prefix)));
}

export async function put(
  root: string,
  relative: string,
  content: string | Buffer,
): Promise<string> {
  const file = path.join(root, relative);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, content);
  return file;
}

export const jsonl = (...records: unknown[]): string =>
  records.map((r) => JSON.stringify(r)).join('\n') + '\n';

export const SID_1 = '11111111-1111-4111-8111-111111111111';
export const SID_2 = '22222222-2222-4222-8222-222222222222';
export const SID_3 = '33333333-3333-4333-8333-333333333333';
export const SID_4 = '44444444-4444-4444-8444-444444444444';
export const SID_5 = '55555555-5555-4555-8555-555555555555';
export const PROJECT_DIR = '-home-user-project';
