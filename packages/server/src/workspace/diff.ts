import type { z } from 'zod';
import type { ChangedFileDtoSchema } from '@acp/core/api';

/** Parsers for `git diff -z --name-status` and `--numstat` output. Pure; no git calls. */

export type ChangedFile = z.infer<typeof ChangedFileDtoSchema>;
type FileStatus = ChangedFile['status'];

function toStatus(letter: string): FileStatus {
  switch (letter) {
    case 'A':
    case 'C': // a copy is a new file at the destination path
      return 'added';
    case 'D':
      return 'deleted';
    case 'R':
      return 'renamed';
    default: // M, T (type change), U and anything newer
      return 'modified';
  }
}

/** `-z --name-status -M`: `M\0path\0`, or `R100\0old\0new\0` for renames and copies. */
export function parseNameStatus(output: string): { path: string; status: FileStatus }[] {
  const parts = output.split('\0');
  const files: { path: string; status: FileStatus }[] = [];
  let i = 0;
  while (i < parts.length) {
    const code = parts[i++];
    if (code === undefined || code === '') continue;
    const letter = code.charAt(0);
    if (letter === 'R' || letter === 'C') {
      i++; // the source path; the review lists the destination
      const dest = parts[i++];
      if (dest !== undefined && dest !== '') files.push({ path: dest, status: toStatus(letter) });
    } else {
      const path = parts[i++];
      if (path !== undefined && path !== '') files.push({ path, status: toStatus(letter) });
    }
  }
  return files;
}

/**
 * `-z --numstat -M`: `add\tdel\tpath\0`, or `add\tdel\t\0old\0new\0` for renames. Binary files
 * report `-`, which becomes null: the line count is unavailable, not zero (AGENTS.md §3.1).
 */
export function parseNumstat(
  output: string,
): Map<string, { additions: number | null; deletions: number | null }> {
  const parts = output.split('\0');
  const counts = new Map<string, { additions: number | null; deletions: number | null }>();
  let i = 0;
  while (i < parts.length) {
    const record = parts[i++];
    if (record === undefined || record === '') continue;
    // Split on the first two tabs only: the path itself may contain tabs.
    const firstTab = record.indexOf('\t');
    const secondTab = record.indexOf('\t', firstTab + 1);
    if (firstTab === -1 || secondTab === -1) continue;
    const add = record.slice(0, firstTab);
    const del = record.slice(firstTab + 1, secondTab);
    let path = record.slice(secondTab + 1);
    if (path === '') {
      i++; // rename source
      path = parts[i++] ?? '';
    }
    if (path === '') continue;
    counts.set(path, { additions: toCount(add), deletions: toCount(del) });
  }
  return counts;
}

function toCount(value: string): number | null {
  return /^\d+$/.test(value) ? Number(value) : null;
}

export function changedFiles(nameStatus: string, numstat: string): ChangedFile[] {
  const counts = parseNumstat(numstat);
  return parseNameStatus(nameStatus).map(({ path, status }) => ({
    path,
    status,
    additions: counts.get(path)?.additions ?? null,
    deletions: counts.get(path)?.deletions ?? null,
  }));
}
