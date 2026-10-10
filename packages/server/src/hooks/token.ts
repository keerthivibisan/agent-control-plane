import { randomBytes, timingSafeEqual } from 'node:crypto';
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

/**
 * The hook receiver's shared secret. Created once, mode 0600, never logged or returned by the API.
 * Claude Code hook commands read it from the environment variable the user configures (we never
 * write Claude settings).
 */
export async function ensureHookToken(path: string): Promise<string> {
  try {
    const existing = (await readFile(path, 'utf8')).trim();
    if (existing.length >= 32) {
      await chmod(path, 0o600);
      return existing;
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  const token = randomBytes(32).toString('hex');
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await writeFile(path, `${token}\n`, { mode: 0o600 });
  await chmod(path, 0o600);
  return token;
}

/** Constant-time comparison; length differences are not hidden because the token length is fixed. */
export function tokenMatches(expected: string, provided: string | undefined): boolean {
  if (provided === undefined) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(provided);
  return a.length === b.length && timingSafeEqual(a, b);
}
