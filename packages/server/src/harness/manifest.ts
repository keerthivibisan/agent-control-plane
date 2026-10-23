import { lstat, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import {
  HARNESS_MANIFEST_PATH,
  HarnessManifestSchema,
  type HarnessManifest,
  type HarnessStatus,
} from '@acp/core';
import type { z } from 'zod';
import { realDirectory, resolveInside } from './paths.js';

/**
 * Reads `.acp/harness.json` from a checkout and turns it into a `HarnessStatus` (README §3, §6.1;
 * ADR-0017 §2). Every problem is a plain sentence the owner can act on, never a zod dump.
 *
 * - none: no manifest file;
 * - invalid: the file is unreadable, not JSON, or fails `HarnessManifestSchema`;
 * - partial: valid, but no check is required, so nothing would block a merge;
 * - ready: valid with at least one required check.
 */

/** A manifest is a short JSON file; anything bigger is refused before parsing. */
export const MAX_MANIFEST_BYTES = 64 * 1024;
/** The UI lists problems; past this many, the rest add nothing. */
const MAX_PROBLEMS = 20;

export interface HarnessReadResult {
  status: HarnessStatus;
  /** The parsed manifest when the state is `ready` or `partial`; otherwise null. */
  manifest: HarnessManifest | null;
}

export interface ReadHarnessOptions {
  now?: () => Date;
}

/**
 * Reads the manifest under `root` (an absolute checkout path: the project, an agent's worktree, or
 * the temporary main checkout). Throws `HarnessError('invalid-root')` only when `root` itself is
 * not a folder; every problem with the manifest is reported in the status.
 */
export async function readHarness(
  root: string,
  options: ReadHarnessOptions = {},
): Promise<HarnessReadResult> {
  const now = options.now ?? (() => new Date());
  const realRoot = await realDirectory(root);
  const checkedAt = now().toISOString();
  const invalid = (problem: string): HarnessReadResult => ({
    status: { state: 'invalid', checkedAt, problems: [problem], checks: [] },
    manifest: null,
  });

  try {
    await lstat(join(realRoot, HARNESS_MANIFEST_PATH));
  } catch {
    return {
      status: {
        state: 'none',
        checkedAt,
        problems: [`This project has no harness file (${HARNESS_MANIFEST_PATH}) yet.`],
        checks: [],
      },
      manifest: null,
    };
  }
  const file = await resolveInside(realRoot, HARNESS_MANIFEST_PATH);
  if (file === null) {
    return invalid(
      `The harness file ${HARNESS_MANIFEST_PATH} points outside the repository, so it was not read.`,
    );
  }
  const info = await stat(file);
  if (!info.isFile()) {
    return invalid(`${HARNESS_MANIFEST_PATH} is not a regular file.`);
  }
  if (info.size > MAX_MANIFEST_BYTES) {
    return invalid(`The harness file is larger than ${MAX_MANIFEST_BYTES / 1024} KiB.`);
  }
  let raw: unknown;
  try {
    const text = await readFile(file, 'utf8');
    raw = JSON.parse(text.replace(/^\uFEFF/, ''));
  } catch {
    return invalid(`The harness file ${HARNESS_MANIFEST_PATH} is not valid JSON.`);
  }
  return harnessStatusOf(raw, checkedAt);
}

/** Validates an already-parsed manifest value. Exported for tests and for P4-D previews. */
export function harnessStatusOf(raw: unknown, checkedAt: string): HarnessReadResult {
  const parsed = HarnessManifestSchema.safeParse(raw);
  if (!parsed.success) {
    const problems = [...new Set(parsed.error.issues.map((i) => describeIssue(i, raw)))];
    return {
      status: {
        state: 'invalid',
        checkedAt,
        problems: problems.slice(0, MAX_PROBLEMS),
        checks: [],
      },
      manifest: null,
    };
  }
  const manifest = parsed.data;
  const checks = manifest.checks.map((c) => ({ ...c }));
  const hasRequired = checks.some((c) => c.required);
  return {
    status: {
      state: hasRequired ? 'ready' : 'partial',
      checkedAt,
      problems: hasRequired
        ? []
        : ['No check is marked as required, so a failing check never blocks a merge.'],
      checks,
      // ADR-0027 §1: the setup steps as declared (empty when the file has none).
      setup: (manifest.setup ?? []).map((step) => ({ ...step })),
    },
    manifest,
  };
}

const FIELD_LABELS: Readonly<Record<string, string>> = {
  id: 'id',
  name: 'name',
  argv: 'command',
  cwd: 'folder (cwd)',
  timeoutSec: 'timeout (timeoutSec)',
  required: '"required" flag',
  description: 'description',
  context: 'context file list',
  notes: 'notes',
  checks: 'check list',
  setup: 'setup step list',
  network: '"network" flag',
  outputs: 'output folder list',
  labels: 'label list',
  version: 'version',
};

type Issue = z.core.$ZodIssue;

/** One zod issue as a sentence, e.g. "Check 'test': the timeout (timeoutSec) is missing." */
export function describeIssue(issue: Issue, raw: unknown): string {
  const path = issue.path;
  if (path.length === 0) {
    if (issue.code === 'invalid_type') return 'The harness file must be a JSON object.';
    return sentence(issue.message);
  }
  const [top, index, field] = path;
  if (top === 'version') return 'The harness file must say "version": 1.';
  if (top === 'checks' && typeof index === 'number') {
    const subject = `Check ${checkLabel(raw, index)}`;
    if (field === undefined) return `${subject} must be an object.`;
    const label = FIELD_LABELS[String(field)] ?? String(field);
    return `${subject}: the ${label} ${detail(issue, valueAt(raw, path))}.`;
  }
  if (top === 'setup' && typeof index === 'number') {
    // ADR-0027 §1: setup steps read like checks ("Setup step 'install': the command …").
    const id = valueAt(raw, ['setup', index, 'id']);
    const subject = `Setup step ${typeof id === 'string' && /^[a-z0-9][a-z0-9-]{0,39}$/.test(id) ? `'${id}'` : `number ${index + 1}`}`;
    if (field === undefined) return `${subject} must be an object.`;
    const label = FIELD_LABELS[String(field)] ?? String(field);
    return `${subject}: the ${label} ${detail(issue, valueAt(raw, path))}.`;
  }
  if (top === 'context' && typeof index === 'number') {
    return `Context file ${index + 1} ${detail(issue, valueAt(raw, path))}.`;
  }
  const label = FIELD_LABELS[String(top)] ?? String(top);
  return sentence(`The ${label} ${detail(issue, valueAt(raw, path))}`);
}

function detail(issue: Issue, value: unknown): string {
  switch (issue.code) {
    case 'invalid_type':
      if (value === undefined) return 'is missing';
      return `must be ${article(issue.expected)}`;
    case 'too_small':
      return `must ${bound('at least', issue.origin, issue.minimum)}`;
    case 'too_big':
      return `must ${bound('at most', issue.origin, issue.maximum)}`;
    case 'invalid_value':
      return `must be ${issue.values.map((v) => JSON.stringify(v)).join(' or ')}`;
    case 'invalid_format':
      // Our own regex messages describe the rule ("lowercase letters, digits and dashes").
      return `must use ${issue.message}`;
    default:
      return issue.message.startsWith('must ') ? issue.message : `is not valid: ${issue.message}`;
  }
}

function bound(word: string, origin: string, limit: number | bigint): string {
  const n = Number(limit);
  switch (origin) {
    case 'string':
      return `be ${word} ${n} character${n === 1 ? '' : 's'} long`;
    case 'array':
    case 'set':
      return `have ${word} ${n} entr${n === 1 ? 'y' : 'ies'}`;
    case 'number':
    case 'int':
      return `be ${word} ${n}`;
    default:
      return `be ${word} ${n}`;
  }
}

function article(expected: string): string {
  if (expected === 'array') return 'a list';
  if (expected === 'object') return 'an object';
  if (expected === 'boolean') return 'true or false';
  return `a ${expected}`;
}

function checkLabel(raw: unknown, index: number): string {
  const id = valueAt(raw, ['checks', index, 'id']);
  return typeof id === 'string' && /^[a-z0-9][a-z0-9-]{0,39}$/.test(id)
    ? `'${id}'`
    : `number ${index + 1}`;
}

function valueAt(raw: unknown, path: readonly PropertyKey[]): unknown {
  let cur: unknown = raw;
  for (const key of path) {
    if (cur === null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<PropertyKey, unknown>)[key];
  }
  return cur;
}

function sentence(text: string): string {
  const t = text.trim();
  const capped = t.charAt(0).toUpperCase() + t.slice(1);
  return /[.!?]$/.test(capped) ? capped : `${capped}.`;
}
