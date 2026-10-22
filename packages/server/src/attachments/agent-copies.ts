import { chmod, mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Attachment } from '@acp/core';
import type { AttachmentFiles } from './files.js';

/**
 * The owner's attachments for agents (ADR-0026 §4): read-only (0444) copies outside the owner's
 * checkout that are never committed, listed by name and path in the agent's brief.
 *
 * - A helper or tester gets them in its own worktree, in `.acp-attachments/`, whose own
 *   `.gitignore` (`*`) ignores the folder and everything in it: the app's seal (`git add --all`)
 *   never stages them, and they never reach the ticket branch or the owner's checkout.
 * - A reviewer gets them the same way in its temporary read-only checkout.
 * - The lead reads the owner's checkout in place, so its copies are in the run's data folder
 *   (`<dataDir>/runs/<runId>/attachments`); reading one asks the owner, like any read outside its
 *   folder. The planner, which may only read inside its folder, is not given them.
 */

/** The folder of the copies inside an agent's worktree or checkout. */
export const AGENT_ATTACHMENTS_DIR = '.acp-attachments';
/** The folder of the lead's copies inside `<dataDir>/runs/<runId>/`. */
export const RUN_ATTACHMENTS_DIR = 'attachments';

export interface AgentCopy {
  name: string;
  mimeType: string;
  sizeBytes: number;
  path: string;
}

/** Unique file names in one folder: a repeated name gets a number (`2-shot.png`). */
function fileNames(attachments: readonly Attachment[]): string[] {
  const seen = new Set<string>();
  return attachments.map((a) => {
    let name = a.name;
    for (let n = 2; seen.has(name); n++) name = `${n}-${a.name}`;
    seen.add(name);
    return name;
  });
}

/**
 * Replaces `dir` with read-only copies of `attachments` (and, with `gitignore`, a `.gitignore`
 * that ignores the whole folder). Returns what it placed, in the given order.
 */
export async function placeAgentCopies(
  files: AttachmentFiles,
  attachments: readonly Attachment[],
  dir: string,
  options: { gitignore: boolean },
): Promise<AgentCopy[]> {
  await rm(dir, { recursive: true, force: true });
  if (attachments.length === 0) return [];
  await mkdir(dir, { recursive: true, mode: 0o755 });
  if (options.gitignore) {
    const ignore = join(dir, '.gitignore');
    await writeFile(ignore, '# Agent Control Plane: read-only attachments, never committed.\n*\n');
    await chmod(ignore, 0o444);
  }
  const names = fileNames(attachments);
  const copies: AgentCopy[] = [];
  for (const [i, attachment] of attachments.entries()) {
    const path = join(dir, names[i] ?? attachment.id);
    await files.copyReadOnly(attachment.sha256, path);
    copies.push({
      name: attachment.name,
      mimeType: attachment.mimeType,
      sizeBytes: attachment.sizeBytes,
      path,
    });
  }
  return copies;
}

function size(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** The brief's lines for the copies; empty without any. */
export function attachmentsBrief(copies: readonly AgentCopy[], asksOwner: boolean): string {
  if (copies.length === 0) return '';
  return [
    `The owner attached ${copies.length === 1 ? 'a file' : `${copies.length} files`} to this ticket. Read-only copies (read them if they help; never copy them into the project${asksOwner ? '; reading one asks the owner' : ''}):`,
    ...copies.map((c) => `- ${c.name} (${c.mimeType}, ${size(c.sizeBytes)}): ${c.path}`),
  ].join('\n');
}
