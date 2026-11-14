import { describe, expect, it } from 'vitest';
import { FAILURE_EVENTS, findAuthors, pathsIn, testSubject } from '../src/index.js';
import type { AuthorCandidate } from '../src/index.js';

/** ADR-0038 §2 (FR-2): the likely authors of a failure, from file paths only. Synthetic data. */

const ui: AuthorCandidate = {
  agentId: 'w-ui',
  nodeId: 'frontend',
  label: 'Frontend helper',
  files: ['src/theme.ts', 'src/ui/toggle.tsx'],
};
const api: AuthorCandidate = {
  agentId: 'w-api',
  nodeId: 'helpers',
  label: 'API builder',
  files: ['server/routes.ts', 'README.md'],
};

describe('failure context authors (ADR-0038 §2)', () => {
  it('lists the five failure events', () => {
    expect(FAILURE_EVENTS).toEqual([
      'tests-failed',
      'checks-failed',
      'review-rework',
      'harness-failed',
      'merge-conflict',
    ]);
  });

  it('maps a test file to the file it tests', () => {
    expect(testSubject('src/theme.test.ts')).toBe('src/theme');
    expect(testSubject('src/__tests__/theme.spec.tsx')).toBe('src/theme');
    expect(testSubject('pkg/a_test.go')).toBe('pkg/a');
    expect(testSubject('tests/test_api.py')).toBe('api');
    expect(testSubject('src/theme.ts')).toBe('src/theme');
  });

  it('finds paths in free text', () => {
    expect(pathsIn('FAIL src/theme.test.ts > toggles\n  at ./src/ui/toggle.tsx:12:3')).toEqual(
      expect.arrayContaining(['src/theme.test.ts', 'src/ui/toggle.tsx']),
    );
    expect(pathsIn('see ../../etc/passwd')).not.toContain('../../etc/passwd');
  });

  it('one author: the helper whose change touched the failing test’s subject', () => {
    const r = findAuthors([ui, api], ['src/theme.test.ts']);
    expect(r.known).toBe(true);
    expect(r.authors).toEqual([{ ...ui, files: ['src/theme.ts'] }]);
  });

  it('several authors: paths from the failing file and from the messages', () => {
    const r = findAuthors([ui, api], ['src/theme.test.ts'], ['Error in /repo/server/routes.ts:4']);
    expect(r.known).toBe(true);
    expect(r.authors.map((a) => a.agentId)).toEqual(['w-ui', 'w-api']);
    expect(r.authors[1]?.files).toEqual(['server/routes.ts']);
  });

  it('none matched: every helper with a change, flagged unknown', () => {
    const r = findAuthors([ui, api], ['lib/other.test.ts'], ['expected 1 got 2']);
    expect(r.known).toBe(false);
    expect(r.authors).toEqual([ui, api]);
    expect(findAuthors([], ['a.ts'])).toEqual({ authors: [], known: false });
  });
});
