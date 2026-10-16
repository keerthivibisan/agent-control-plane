import { mkdir, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { HttpError } from '../errors.js';
import { SAFE_GIT_CONFIG, type GitRunner } from '../workspace/index.js';

/**
 * "Create a new repository" (ADR-0017 §1): `git init -b main` and a first commit, inside an
 * **existing absolute** parent folder, into a **new** folder. An existing folder is never touched:
 * the new one is made with an exclusive `mkdir`, so a name that exists is refused before anything
 * is written. Only `git` runs, with argument arrays (ADR-0013 §1).
 */

/** The first commit is the app's, so it never needs the owner's git identity. */
const COMMIT_CONFIG: readonly string[] = [
  '-c',
  'user.name=Agent Control Plane',
  '-c',
  'user.email=agent-control-plane@localhost',
  '-c',
  'commit.gpgsign=false',
];

export interface CreateRepoInput {
  /** Absolute; validated by `CreateRepoProjectRequestSchema`. */
  parentDir: string;
  /** A plain folder name (letters, digits, `.`, `-`, `_`; schema-validated). */
  name: string;
  /** Text of a first README.md; without it the first commit is empty. */
  readme?: string;
}

function code(error: unknown): string | undefined {
  const c = (error as { code?: unknown } | null)?.code;
  return typeof c === 'string' ? c : undefined;
}

/** Creates the repository and returns its real path. Refusals are `HttpError`s. */
export async function createRepository(input: CreateRepoInput, git: GitRunner): Promise<string> {
  let parent: string;
  try {
    parent = await realpath(input.parentDir);
    if (!(await stat(parent)).isDirectory()) throw new Error('not a folder');
  } catch {
    throw new HttpError(400, 'invalid_root', 'The parent folder does not exist or is not a folder');
  }
  const target = join(parent, input.name);
  try {
    await mkdir(target, { mode: 0o755 });
  } catch (error) {
    if (code(error) === 'EEXIST') {
      throw new HttpError(409, 'conflict', 'A file or folder with this name already exists');
    }
    throw new HttpError(400, 'invalid_root', 'The new folder could not be created there');
  }
  const run = (args: readonly string[]) => git([...SAFE_GIT_CONFIG, ...args], { cwd: target });
  try {
    await run(['init', '--quiet', '-b', 'main']);
    if (input.readme !== undefined && input.readme.trim() !== '') {
      await writeFile(join(target, 'README.md'), input.readme, { flag: 'wx' });
      await run(['add', '--', 'README.md']);
      await run([...COMMIT_CONFIG, 'commit', '--quiet', '-m', 'Initial commit']);
    } else {
      await run([...COMMIT_CONFIG, 'commit', '--quiet', '--allow-empty', '-m', 'Initial commit']);
    }
  } catch {
    // The folder is ours (made above, exclusively): remove the half-made repository.
    await rm(target, { recursive: true, force: true }).catch(() => undefined);
    throw new HttpError(500, 'git_failed', 'The repository could not be created');
  }
  return realpath(target);
}
