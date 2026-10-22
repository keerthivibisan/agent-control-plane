import { BranchStrategySchema, branchStrategyPreset } from '@acp/core';
import {
  CodeHostStatusDtoSchema,
  PullRequestDtoSchema,
  UpdateTicketRequestSchema,
} from '@acp/core/api';
import { describe, expect, it } from 'vitest';
import { codeHost, pullRequest } from '../../e2e/github-fixtures';
import {
  canRefresh,
  codeHostReadiness,
  defaultPullRequestTitle,
  hasNewCommits,
  pullRequestErrorText,
  pullRequestTitleError,
  pushBlockedReason,
} from '../../src/features/branching/code-host';
import { checkOnView } from '../../src/features/branching/pull-request-check';
import {
  chooseStrategy,
  draftFromStrategy,
  draftToStrategy,
  isLocked,
  previewNames,
  sameBranching,
  templateError,
  validateBranching,
} from '../../src/features/branching/strategy-form';
import {
  draftFromPrefs,
  projectBranchName,
  projectTarget,
  ticketBranchCreate,
  ticketBranchPatch,
  validateTicketBranch,
} from '../../src/features/branching/ticket-branch';
import { ApiError } from '../../src/lib/api';
import { BRANCHING_COPY, PULL_REQUEST_COPY } from '../../src/lib/copy';

/*
 * G-B (ADR-0025): the pure rules behind the branching strategy form, a ticket's own branch and
 * the GitHub card states. Every sentence comes from copy.ts; the core schemas stay the authority.
 */

const E = BRANCHING_COPY.errors;

describe('branching strategy: presets and switching', () => {
  it('a project without a strategy reads None, with GitHub flow ready behind it', () => {
    const d = draftFromStrategy(undefined);
    expect(d.choice).toBe('none');
    expect(d.template).toBe('{type}/{key}-{slug}');
    expect(d.baseBranch).toBe('main');
    expect(draftToStrategy(d)).toEqual({ ok: true, branching: null });
  });

  it('a saved strategy is read back as it is', () => {
    const saved = { ...branchStrategyPreset('custom'), ticketBranchTemplate: '{key}-{slug}' };
    const d = draftFromStrategy(saved);
    expect(d.choice).toBe('custom');
    expect(draftToStrategy(d)).toEqual({ ok: true, branching: saved });
  });

  it('Git flow and GitHub flow put in their own values; GitHub flow uses the known default', () => {
    const none = draftFromStrategy(undefined);
    const git = chooseStrategy(none, 'git-flow');
    expect(git).toMatchObject({ choice: 'git-flow', baseBranch: 'develop' });
    expect(git.typeWords.bug).toBe('bugfix');
    const gh = chooseStrategy(git, 'github-flow', 'trunk');
    expect(gh).toMatchObject({ baseBranch: 'trunk', defaultTargetBranch: 'trunk' });
    expect(gh.typeWords.bug).toBe('fix');
  });

  it('Custom keeps what was there; presets lock the template and the words', () => {
    const git = chooseStrategy(draftFromStrategy(undefined), 'git-flow');
    const custom = chooseStrategy(git, 'custom');
    expect(custom).toEqual({ ...git, choice: 'custom' });
    expect(isLocked('git-flow')).toBe(true);
    expect(isLocked('github-flow')).toBe(true);
    expect(isLocked('custom')).toBe(false);
    expect(isLocked('none')).toBe(false);
  });

  it('every preset passes core’s schema as sent', () => {
    for (const choice of ['github-flow', 'git-flow', 'custom'] as const) {
      const r = draftToStrategy(chooseStrategy(draftFromStrategy(undefined), choice));
      expect(r.ok).toBe(true);
      if (r.ok) expect(BranchStrategySchema.safeParse(r.branching).success).toBe(true);
    }
  });

  it('None equals None whatever is typed behind it; other changes are changes', () => {
    const a = draftFromStrategy(undefined);
    expect(sameBranching(a, { ...a, template: 'x' })).toBe(true);
    const gh = chooseStrategy(a, 'github-flow');
    expect(sameBranching(gh, { ...gh, baseBranch: ' main ' })).toBe(true);
    expect(sameBranching(gh, { ...gh, baseBranch: 'trunk' })).toBe(false);
    expect(sameBranching(gh, { ...gh, choice: 'custom' })).toBe(false);
  });
});

describe('branching strategy: the template and the preview', () => {
  it('previews a feature and a bug of the project', () => {
    const d = chooseStrategy(draftFromStrategy(undefined), 'github-flow');
    expect(previewNames(d, 'APP')).toEqual([
      { type: 'feature', name: 'feature/APP-12-add-saved-searches' },
      { type: 'bug', name: 'fix/APP-13-login-fails-on-safari' },
    ]);
  });

  it('follows the template and the words as typed', () => {
    const d = {
      ...chooseStrategy(draftFromStrategy(undefined), 'custom'),
      template: 'work/{key}',
    };
    expect(previewNames(d, 'WEB').map((p) => p.name)).toEqual(['work/WEB-12', 'work/WEB-13']);
    const words = { ...d, template: '{type}-{key}', typeWords: { ...d.typeWords, bug: 'hotfix' } };
    expect(previewNames(words, 'WEB')[1]?.name).toBe('hotfix-WEB-13');
  });

  it('says what is wrong with a template, in order', () => {
    expect(templateError('  ')).toBe(E.templateMissing);
    expect(templateError(`{key}${'a'.repeat(120)}`)).toBe(E.templateTooLong);
    expect(templateError('{type}/{ticket}-{id}')).toBe(E.templateToken('{ticket}, {id}'));
    expect(templateError('{type}/{slug}')).toBe(E.templateNeedsKey);
    expect(templateError('{key} {slug}')).toBe(E.templateInvalid);
    expect(templateError('../{key}')).toBe(E.templateInvalid);
    expect(templateError('{type}/{key}-{slug}')).toBeUndefined();
  });

  it('no preview for a template or word that gives no valid name', () => {
    const d = chooseStrategy(draftFromStrategy(undefined), 'custom');
    expect(previewNames({ ...d, template: '{slug}' }, 'WEB').every((p) => p.name === null)).toBe(
      true,
    );
    const badWord = { ...d, typeWords: { ...d.typeWords, bug: 'Fix!' } };
    expect(previewNames(badWord, 'WEB')).toEqual([
      { type: 'feature', name: 'feature/WEB-12-add-saved-searches' },
      { type: 'bug', name: null },
    ]);
  });

  it('validates branches, the template and each type word', () => {
    const d = chooseStrategy(draftFromStrategy(undefined), 'custom');
    const errors = validateBranching({
      ...d,
      baseBranch: '',
      defaultTargetBranch: 'main..x',
      template: '{slug}',
      typeWords: { ...d.typeWords, chore: '9chore' },
    });
    expect(errors).toEqual({
      baseBranch: E.branchMissing,
      defaultTargetBranch: E.branch,
      template: E.templateNeedsKey,
      typeWords: { chore: E.typeWord },
    });
    expect(draftToStrategy({ ...d, baseBranch: 'HEAD' })).toEqual({
      ok: false,
      errors: { baseBranch: E.branch },
    });
    expect(validateBranching({ ...d, choice: 'none', baseBranch: '' })).toEqual({});
  });
});

describe('a ticket’s own branch', () => {
  it('empty fields follow the project: left out on create, null on a change', () => {
    expect(ticketBranchCreate({ name: ' ', target: '' })).toBeUndefined();
    expect(ticketBranchCreate({ name: 'spike/search', target: '' })).toEqual({
      name: 'spike/search',
    });
    expect(ticketBranchCreate({ name: '', target: 'release/2.0' })).toEqual({
      target: 'release/2.0',
    });
    expect(ticketBranchPatch({ name: '', target: '' })).toBeNull();
    expect(ticketBranchPatch({ name: 'spike/search', target: ' ' })).toEqual({
      name: 'spike/search',
      target: null,
    });
    // Both forms are what the PATCH accepts.
    for (const branch of [null, { name: 'spike/search', target: null }]) {
      expect(UpdateTicketRequestSchema.safeParse({ branch }).success).toBe(true);
    }
  });

  it('validates as typed; empty is fine', () => {
    expect(validateTicketBranch({ name: '', target: '' })).toEqual({});
    expect(validateTicketBranch({ name: 'my branch', target: 'refs/heads/main' })).toEqual({
      name: E.branch,
      target: E.branch,
    });
    expect(draftFromPrefs({ target: 'develop' })).toEqual({ name: '', target: 'develop' });
    expect(draftFromPrefs(undefined)).toEqual({ name: '', target: '' });
  });

  it('the project’s name and target: the strategy’s, or acp/<KEY> and the folder’s branch', () => {
    const t = { key: 'WEB-12', title: 'Fix the login crash', type: 'bug' as const };
    expect(projectBranchName(undefined, t)).toBe('acp/WEB-12');
    expect(projectBranchName(branchStrategyPreset('git-flow'), t)).toBe(
      'bugfix/WEB-12-fix-the-login-crash',
    );
    expect(projectBranchName(branchStrategyPreset('github-flow'), { ...t, title: ' ' })).toBe(
      'fix/WEB-12-add-saved-searches',
    );
    expect(projectTarget(undefined)).toBeNull();
    expect(projectTarget(branchStrategyPreset('git-flow'))).toBe('develop');
  });
});

describe('GitHub: readiness, the push button and errors', () => {
  const status = (k: Parameters<typeof codeHost>[0]) => CodeHostStatusDtoSchema.parse(codeHost(k));

  it('is ready only with a GitHub remote, the CLI installed and signed in', () => {
    expect(codeHostReadiness(status('ready'))).toEqual({ kind: 'ready', repo: 'acme/web-app' });
    expect(codeHostReadiness(status('no-remote'))).toEqual({
      kind: 'problem',
      problem: 'no-remote',
    });
    expect(codeHostReadiness(status('no-cli'))).toEqual({ kind: 'problem', problem: 'no-cli' });
    expect(codeHostReadiness(status('not-logged-in'))).toEqual({
      kind: 'problem',
      problem: 'not-logged-in',
    });
  });

  it('says why Push & open PR is off', () => {
    const B = PULL_REQUEST_COPY.blocked;
    expect(pushBlockedReason(status('ready'), null)).toBeNull();
    expect(pushBlockedReason(status('no-cli'), null)).toBe(B['no-cli']);
    expect(pushBlockedReason(undefined, null)).toBe(B.checking);
    const failed = new ApiError({ kind: 'http', path: '/x', message: 'no route', status: 404 });
    expect(pushBlockedReason(undefined, failed)).toBe(B.unknown);
  });

  it('titles the pull request <KEY>: <title>, at most 200 characters', () => {
    expect(defaultPullRequestTitle({ key: 'WEB-21', title: ' Saved searches ' })).toBe(
      'WEB-21: Saved searches',
    );
    expect(defaultPullRequestTitle({ key: 'WEB-1', title: 'x'.repeat(200) })).toHaveLength(200);
    expect(pullRequestTitleError(' ')).toBe(PULL_REQUEST_COPY.titleMissing);
    expect(pullRequestTitleError('x'.repeat(201))).toBe(PULL_REQUEST_COPY.titleTooLong);
    expect(pullRequestTitleError('WEB-21: Saved searches')).toBeUndefined();
  });

  it('words every server error code; other errors get the fallback', () => {
    for (const code of [
      'gh-not-installed',
      'gh-not-logged-in',
      'no-github-remote',
      'push-rejected',
      'pr-exists-elsewhere',
      'timeout',
      'gh-failed',
    ] as const) {
      const e = new ApiError({ kind: 'http', path: '/x', message: 'raw', status: 409, code });
      expect(pullRequestErrorText(e)).toBe(PULL_REQUEST_COPY.errors[code]);
    }
    const other = new ApiError({
      kind: 'http',
      path: '/x',
      message: 'raw',
      status: 500,
      code: 'x',
    });
    expect(pullRequestErrorText(other)).toBeNull();
    expect(
      pullRequestErrorText(new ApiError({ kind: 'unreachable', path: '/x', message: 'm' })),
    ).toBeNull();
  });

  it('Refresh is offered until the pull request is merged', () => {
    expect(canRefresh({ state: 'open' })).toBe(true);
    expect(canRefresh({ state: 'closed' })).toBe(true);
    expect(canRefresh({ state: 'merged' })).toBe(false);
  });
});

describe('G-D: the open pull request', () => {
  const head = 'a'.repeat(40);
  const earlier = 'b'.repeat(40);
  const pr = PullRequestDtoSchema.parse(pullRequest('open'));

  it('has new commits only when it is open and was pushed at another commit than the tip', () => {
    const open = (pushedCommit?: string | null) => ({
      headCommit: head,
      pullRequest: { state: 'open' as const, ...(pushedCommit !== undefined && { pushedCommit }) },
    });
    expect(hasNewCommits(open(earlier))).toBe(true);
    expect(hasNewCommits(open(head))).toBe(false);
    // Unknown is not "new": a server before pushedCommit, or a null.
    expect(hasNewCommits(open())).toBe(false);
    expect(hasNewCommits(open(null))).toBe(false);
    for (const state of ['merged', 'closed'] as const) {
      expect(
        hasNewCommits({ headCommit: head, pullRequest: { state, pushedCommit: earlier } }),
      ).toBe(false);
    }
    expect(hasNewCommits({ headCommit: head, pullRequest: null })).toBe(false);
    expect(hasNewCommits({ headCommit: head })).toBe(false);
  });

  it('a refused push to the open pull request has its own words; other codes stay', () => {
    const e = (code: string) =>
      new ApiError({ kind: 'http', path: '/x', message: 'raw', status: 409, code });
    expect(pullRequestErrorText(e('push-rejected'), { pushAgain: true })).toBe(
      PULL_REQUEST_COPY.pushNewRejected,
    );
    expect(pullRequestErrorText(e('push-rejected'))).toBe(
      PULL_REQUEST_COPY.errors['push-rejected'],
    );
    expect(pullRequestErrorText(e('timeout'), { pushAgain: true })).toBe(
      PULL_REQUEST_COPY.errors.timeout,
    );
  });

  it('is read on opening the page only while it is open', () => {
    expect(checkOnView({ pullRequest: { ...pr, state: 'open' } })).toBe(true);
    expect(checkOnView({ pullRequest: { ...pr, state: 'merged' } })).toBe(false);
    expect(checkOnView({ pullRequest: { ...pr, state: 'closed' } })).toBe(false);
    expect(checkOnView({ pullRequest: null })).toBe(false);
    expect(checkOnView({})).toBe(false);
    expect(checkOnView(null)).toBe(false);
    expect(checkOnView(undefined)).toBe(false);
  });
});
