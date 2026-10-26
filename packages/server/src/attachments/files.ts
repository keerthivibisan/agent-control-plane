import { randomUUID } from 'node:crypto';
import { chmod, copyFile, mkdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';

/**
 * The attachments' bytes in the app's data folder (ADR-0026 §4), content-addressed:
 * `<root>/<sha256[0:2]>/<sha256>`, read-only for the owner. The same content uploaded twice is
 * stored once; the database rows hold the names and types. The root is injected, so tests use a
 * temp folder; the server uses `<dataDir>/attachments`.
 */

export const ATTACHMENTS_DIR = 'attachments';

const SHA256 = /^[0-9a-f]{64}$/;

export interface AttachmentFiles {
  readonly root: string;
  /** The stored file of this content (whether or not it exists). */
  pathOf(sha256: string): string;
  /** Stores `bytes` under `sha256` (computed by the caller); a no-op when already there. */
  put(sha256: string, bytes: Uint8Array): Promise<void>;
  /** Removes the stored file; a no-op when it is not there. */
  remove(sha256: string): Promise<void>;
  /**
   * A read-only (0444) copy of the stored file at `target`, replacing any earlier copy, for an
   * agent to read (ADR-0026 §4). The folder must exist.
   */
  copyReadOnly(sha256: string, target: string): Promise<void>;
}

function checked(sha256: string): string {
  // The hash is the file name: never a path the caller could steer.
  if (!SHA256.test(sha256)) throw new Error('not a sha256 hex digest');
  return sha256;
}

export function createAttachmentFiles(options: { root: string }): AttachmentFiles {
  const root = options.root;
  if (!isAbsolute(root)) throw new Error('the attachments folder must be an absolute path');
  const pathOf = (sha256: string) => join(root, checked(sha256).slice(0, 2), sha256);

  return {
    root,
    pathOf,
    async put(sha256, bytes) {
      const target = pathOf(sha256);
      const dir = join(root, sha256.slice(0, 2));
      await mkdir(dir, { recursive: true, mode: 0o700 });
      const existing = await stat(target).catch(() => null);
      if (existing?.isFile() === true && existing.size === bytes.byteLength) return;
      // Written beside the target, then renamed: a reader never sees half a file.
      const temp = join(dir, `.${randomUUID()}.tmp`);
      try {
        await writeFile(temp, bytes, { mode: 0o400, flag: 'wx' });
        await rename(temp, target);
      } finally {
        await rm(temp, { force: true });
      }
    },
    async remove(sha256) {
      await rm(pathOf(sha256), { force: true });
    },
    async copyReadOnly(sha256, target) {
      await rm(target, { force: true });
      await copyFile(pathOf(sha256), target);
      await chmod(target, 0o444);
    },
  };
}
