import type { ProjectBranchesDto } from '@acp/core/api';
import { describe, expect, it } from 'vitest';
import {
  createBranchErrorText,
  defaultBase,
  hasBranch,
  isMissing,
  isTargetMissing,
  newBranchError,
  shortCommit,
  startTarget,
} from '../../src/features/branching/branch-list';
import { ApiError } from '../../src/lib/api';
import { BRANCHING_COPY, PROJECT_BRANCHES_COPY } from '../../src/lib/copy';

// G-F (ADR-0025 §8): the pure rules behind the Branches card and the "create it" actions.

const C = PROJECT_BRANCHES_COPY;
const A = 'a'.repeat(40);

function list(names: string[], over: Partial<ProjectBranchesDto> = {}): ProjectBranchesDto {
  return {
    current: names[0] ?? null,
    hasOrigin: false,
    truncated: false,
    branches: names.map((name, i) => ({ name, commit: A, current: i === 0, onOrigin: null })),
    ...over,
  };
}

const http = (code: string, message = 'server words') =>
  new ApiError({ kind: 'http', path: '/api/x', status: 409, code, message });

describe('which branches exist', () => {
  it('hasBranch and isMissing; a truncated or unread list never says missing', () => {
    const dto = list(['main', 'develop']);
    expect(hasBranch(dto, 'develop')).toBe(true);
    expect(isMissing(dto, 'dev')).toBe(true);
    expect(isMissing(dto, 'main')).toBe(false);
    expect(isMissing(undefined, 'dev')).toBe(false);
    expect(isMissing(list(['main'], { truncated: true }), 'dev')).toBe(false);
  });
});

describe('defaultBase', () => {
  it('the preferred base, else the current branch, else main, else the first other', () => {
    expect(defaultBase(list(['feature/a', 'develop', 'main']), 'develop')).toBe('develop');
    expect(defaultBase(list(['feature/a', 'main']), 'develop')).toBe('feature/a');
    expect(defaultBase(list(['main', 'x'], { current: null }), undefined)).toBe('main');
    expect(defaultBase(list(['b', 'c'], { current: null }), 'nope')).toBe('b');
  });

  it('never the branch being created, and null with nothing to start from', () => {
    expect(defaultBase(list(['develop', 'main']), 'develop', 'develop')).toBe('main');
    expect(defaultBase(list(['dev']), undefined, 'dev')).toBeNull();
    expect(defaultBase(list([]), 'main')).toBeNull();
  });
});

describe('startTarget', () => {
  it('the ticket’s own target, else the strategy’s, else null (the folder’s branch)', () => {
    const strategy = {
      preset: 'github-flow' as const,
      baseBranch: 'main',
      defaultTargetBranch: 'dev',
      ticketBranchTemplate: '{type}/{key}-{slug}',
      typeWords: { feature: 'feature', bug: 'fix', chore: 'chore', harness: 'chore' },
    };
    expect(startTarget({ target: 'qa' }, strategy)).toBe('qa');
    expect(startTarget({ name: 'x' }, strategy)).toBe('dev');
    expect(startTarget(undefined, undefined)).toBeNull();
  });
});

describe('newBranchError', () => {
  it('empty, unsafe and taken names; fine otherwise', () => {
    const dto = list(['main', 'dev']);
    expect(newBranchError('  ', dto)).toBe(C.nameMissing);
    expect(newBranchError('a b', dto)).toBe(BRANCHING_COPY.errors.branch);
    expect(newBranchError('-x', dto)).toBe(BRANCHING_COPY.errors.branch);
    expect(newBranchError('dev', dto)).toBe(C.nameExists);
    expect(newBranchError(' release/2.0 ', dto)).toBeUndefined();
  });
});

describe('errors in plain words', () => {
  it('each refusal code has its sentence; a failed push keeps the server’s own', () => {
    for (const code of Object.keys(C.errors) as (keyof typeof C.errors)[]) {
      expect(createBranchErrorText(http(code))).toBe(C.errors[code]);
    }
    const pushed = 'The app created dev in the project, but pushing it to origin did not work.';
    expect(createBranchErrorText(http('push-rejected', pushed))).toBe(pushed);
    expect(createBranchErrorText(http('branch_create_failed', 'Git could not'))).toBe(
      'Git could not',
    );
    expect(createBranchErrorText(http('something_else'))).toBeNull();
    expect(
      createBranchErrorText(new ApiError({ kind: 'unreachable', path: '/x', message: 'down' })),
    ).toBeNull();
  });

  it('isTargetMissing reads the Start refusal; shortCommit is 7 characters', () => {
    expect(isTargetMissing(http('target_branch_missing'))).toBe(true);
    expect(isTargetMissing(http('managed_disabled'))).toBe(false);
    expect(isTargetMissing(null)).toBe(false);
    expect(shortCommit('0123456789abcdef')).toBe('0123456');
  });
});
