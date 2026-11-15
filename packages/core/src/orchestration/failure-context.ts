import type { FailedTest } from './orchestration.js';

/**
 * ADR-0038 §2 (FR-2): the failure context. Every failure event in a ticket run (tests failed,
 * checks failed, a review asking for rework, a harness that cannot run, a merge conflict) is
 * described by one `FailureContext`: what failed, where, the likely authors of the failing code
 * and the rounds used. The engine builds it and renders it as quoted data for the lead (always)
 * and for a fix target. Pure: the author match below decides from file paths only.
 */

export const FAILURE_EVENTS = [
  'tests-failed',
  'checks-failed',
  'review-rework',
  'harness-failed',
  'merge-conflict',
] as const;
export type FailureEvent = (typeof FAILURE_EVENTS)[number];

/** A helper whose sealed or merged change touched the failing files, and which of its files. */
export interface FailureAuthor {
  agentId: string;
  nodeId: string;
  label: string;
  /** Its changed files that match the failure (all its changed files when `authorsKnown` is false). */
  files: readonly string[];
}

/** One failing check, as reported by the check runner: its name, how it ended, its output's end. */
export interface FailureCheck {
  name: string;
  /** Plain words: `exit 1`, `timed out`, `could not run`, … */
  how: string;
  /** The end of its output (redacted by the server, capped by the engine); empty when none. */
  outputTail: string;
}

export interface FailureContext {
  event: FailureEvent;
  /** Where it happened: the agent and node (a tester, a Checks block, a reviewer, the merge). */
  source: { agentRunId?: string; nodeId?: string; label: string };
  /** The change the failure is about, when there is one (its helper's or tester's agent run). */
  changeAgentId?: string;
  /** The likely authors: matched by files, or every helper with a change when none matched. */
  authors: readonly FailureAuthor[];
  /** False when no failing file matched any change: `authors` is then every helper with a change. */
  authorsKnown: boolean;
  failed: {
    tests?: readonly FailedTest[];
    checks?: readonly FailureCheck[];
    /** The reviewers' findings, shortened. */
    findings?: string;
    conflictFiles?: readonly string[];
  };
  /** Rework rounds used and allowed on this route; absent when the route has none. */
  rounds?: { used: number; max: number };
}

/** A candidate author: a helper with a sealed or merged change and the files it changed. */
export interface AuthorCandidate {
  agentId: string;
  nodeId: string;
  label: string;
  files: readonly string[];
}

const TEST_DIRS = new Set(['__tests__', '__test__', 'test', 'tests', 'spec', 'specs', 'e2e']);

/**
 * The file a test file is about: `src/theme.test.ts` → `src/theme`, `tests/theme.spec.ts` →
 * `theme`, `pkg/a_test.go` → `pkg/a`, `test_a.py` → `a`; any other path without its extension.
 * Used only to match a failing test file with the source file a helper changed.
 */
export function testSubject(path: string): string {
  const segments = path.split('/');
  const name = segments.pop() ?? '';
  const dirs = segments.filter((s) => !TEST_DIRS.has(s.toLowerCase()));
  const stem = name
    .replace(/\.(test|spec)(\.[^./]+)+$/i, '')
    .replace(/_test\.(go|py)$/i, '')
    .replace(/^test_(.+)\.py$/i, '$1')
    .replace(/\.[^./]+$/, '');
  return [...dirs, stem].join('/');
}

function baseSubject(path: string): string {
  return testSubject(path).split('/').pop() ?? '';
}

/** Repository paths mentioned in free text (a message or a check's output), at most 200. */
export function pathsIn(text: string): string[] {
  const found = new Set<string>();
  for (const m of text.matchAll(
    /(?:[A-Za-z0-9_.@-]+\/)*[A-Za-z0-9_@-][A-Za-z0-9_.@-]*\.[A-Za-z0-9]+/g,
  )) {
    const p = m[0].replace(/^\.\//, '');
    if (p.includes('..')) continue;
    found.add(p);
    if (found.size >= 200) break;
  }
  return [...found];
}

/**
 * True when a candidate's changed file `changed` is one of the failing files: the same path, the
 * same path at the end of a longer one (output often prints absolute paths), or the file a
 * failing test file is about (same folder and name without the test suffix, or the same name when
 * the test lives in a test folder).
 */
function touches(changed: string, failing: string): boolean {
  if (changed === failing) return true;
  if (failing.endsWith(`/${changed}`) || changed.endsWith(`/${failing}`)) return true;
  const subject = testSubject(failing);
  if (subject === testSubject(changed)) return true;
  // A test in a test folder (`tests/theme.test.ts`) about `src/theme.ts`: the same file name.
  return (
    failing.split('/').some((s) => TEST_DIRS.has(s.toLowerCase())) &&
    baseSubject(failing) === baseSubject(changed) &&
    baseSubject(changed) !== ''
  );
}

/**
 * The likely authors of a failure (ADR-0038 §2): the candidates whose changed files touch the
 * failing files (paths given, plus paths found in the free texts). None matched: every candidate,
 * with `known` false ("unknown: all helpers who changed code").
 */
export function findAuthors(
  candidates: readonly AuthorCandidate[],
  failingFiles: readonly string[],
  texts: readonly string[] = [],
): { authors: FailureAuthor[]; known: boolean } {
  const failing = [...new Set([...failingFiles, ...texts.flatMap(pathsIn)])];
  const matched: FailureAuthor[] = [];
  for (const c of candidates) {
    const files = c.files.filter((f) => failing.some((x) => touches(f, x)));
    if (files.length > 0) matched.push({ ...c, files });
  }
  if (matched.length > 0) return { authors: matched, known: true };
  return { authors: candidates.map((c) => ({ ...c })), known: false };
}
