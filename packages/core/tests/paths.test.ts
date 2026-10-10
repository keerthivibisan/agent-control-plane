import { describe, expect, it } from 'vitest';
import { findOwningRoot, isPathInside, normalizePosixPath } from '../src/index.js';

describe('normalizePosixPath (A6)', () => {
  it.each([
    ['/', '/'],
    ['/repo', '/repo'],
    ['/repo/', '/repo'],
    ['/repo//sub///', '/repo/sub'],
    ['//repo', '/repo'],
    ['/repo/./sub/.', '/repo/sub'],
    ['/repo/sub/..', '/repo'],
    ['/repo/../other', '/other'],
    ['/../..', '/'],
    ['/repo/...', '/repo/...'],
  ])('%s normalizes to %s', (input, expected) => {
    expect(normalizePosixPath(input)).toBe(expected);
  });

  it.each(['repo', './repo', '', 'C:\\repo', 'C:/repo', '\\\\server\\share', '/repo\0/x'])(
    'rejects non-POSIX-absolute path %j',
    (input) => {
      expect(normalizePosixPath(input)).toBeNull();
    },
  );
});

describe('isPathInside (security §2.2, A6)', () => {
  it('does not treat /repo-evil as inside /repo', () => {
    expect(isPathInside('/repo', '/repo-evil')).toBe(false);
    expect(isPathInside('/repo', '/repo-evil/src')).toBe(false);
    expect(isPathInside('/repo', '/repository')).toBe(false);
  });

  it('includes the root itself and its descendants', () => {
    expect(isPathInside('/repo', '/repo')).toBe(true);
    expect(isPathInside('/repo', '/repo/packages/core')).toBe(true);
    expect(isPathInside('/', '/anything/at/all')).toBe(true);
  });

  it('ignores trailing and repeated slashes on either side', () => {
    expect(isPathInside('/repo/', '/repo')).toBe(true);
    expect(isPathInside('/repo', '/repo/')).toBe(true);
    expect(isPathInside('/repo//', '/repo//src/')).toBe(true);
  });

  it('resolves dot segments before comparing', () => {
    expect(isPathInside('/repo', '/repo/src/../../repo-evil')).toBe(false);
    expect(isPathInside('/repo', '/repo/./src/..')).toBe(true);
    expect(isPathInside('/repo/sub/..', '/repo/x')).toBe(true);
  });

  it('does not treat a parent as inside its child', () => {
    expect(isPathInside('/repo/sub', '/repo')).toBe(false);
  });

  it('is case-sensitive (callers pass realpath output)', () => {
    expect(isPathInside('/Repo', '/repo/src')).toBe(false);
  });

  it('rejects Windows-style paths on POSIX', () => {
    expect(isPathInside('C:\\repo', 'C:\\repo\\src')).toBe(false);
    expect(isPathInside('/repo', 'C:/repo/src')).toBe(false);
    expect(isPathInside('C:/repo', '/repo')).toBe(false);
  });
});

describe('findOwningRoot (domain-model Project, A6)', () => {
  const roots = [
    { projectId: 'mono', rootPath: '/work/mono' },
    { projectId: 'pkg', rootPath: '/work/mono/packages/web/' },
    { projectId: 'other', rootPath: '/work/other' },
  ];

  it('picks the longest (deepest) matching root for nested roots', () => {
    expect(findOwningRoot(roots, '/work/mono/packages/web/src')?.projectId).toBe('pkg');
    expect(findOwningRoot(roots, '/work/mono/packages/web')?.projectId).toBe('pkg');
    expect(findOwningRoot(roots, '/work/mono/packages/db')?.projectId).toBe('mono');
    expect(findOwningRoot([...roots].reverse(), '/work/mono/packages/web/src')?.projectId).toBe(
      'pkg',
    );
  });

  it('returns null when no root contains the cwd', () => {
    expect(findOwningRoot(roots, '/work/mono-evil')).toBeNull();
    expect(findOwningRoot(roots, '/work')).toBeNull();
    expect(findOwningRoot([], '/work/mono')).toBeNull();
    expect(findOwningRoot(roots, 'C:\\work\\mono')).toBeNull();
  });

  it('breaks a tie between equivalent roots by raw path, not list order', () => {
    const dupes = [
      { projectId: 'b', rootPath: '/work/x/' },
      { projectId: 'a', rootPath: '/work/x' },
    ];
    expect(findOwningRoot(dupes, '/work/x/y')?.projectId).toBe('a');
    expect(findOwningRoot([...dupes].reverse(), '/work/x/y')?.projectId).toBe('a');
  });
});
