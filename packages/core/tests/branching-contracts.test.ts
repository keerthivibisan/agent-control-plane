// Contract tests for branching strategies and code hosting (ADR-0025, v0.3.0 G-0). Additive:
// every earlier shape still parses. Synthetic data only.
import { describe, expect, it } from 'vitest';
import {
  BranchStrategySchema,
  BranchTemplateSchema,
  GitBranchNameSchema,
  TicketBranchNameSchema,
  TicketSchema,
  branchSlug,
  branchStrategyPreset,
  isSafeBranchName,
  renderTicketBranchName,
  ticketBranchName,
} from '../src/index.js';
import {
  CodeHostStatusDtoSchema,
  OpenPullRequestRequestSchema,
  PullRequestDtoSchema,
  UpdateTicketRequestSchema,
} from '../src/api/index.js';

describe('safe branch names', () => {
  it('accepts ordinary branch names, including the old acp/<KEY> ones', () => {
    for (const ok of [
      'main',
      'develop',
      'feature/WEB-12-dark-mode',
      'acp/WEB-12',
      'acp/WEB-12-r2',
      'release/1.2.0',
      'a_b',
    ]) {
      expect(isSafeBranchName(ok), ok).toBe(true);
      expect(GitBranchNameSchema.safeParse(ok).success).toBe(true);
    }
    expect(TicketBranchNameSchema.parse(ticketBranchName('WEB-12'))).toBe('acp/WEB-12');
  });

  it('refuses names git would refuse or a shell or terminal could misread', () => {
    for (const bad of [
      '',
      '-x',
      'a..b',
      'a//b',
      '/a',
      'a/',
      'a.',
      'x.lock',
      'a/.b',
      'a@{1}',
      'a b',
      'a;b',
      'a$b',
      "a'b",
      'a\nb',
      'ä',
      'HEAD',
      'refs/heads/main',
      'a\u0007b',
      'x'.repeat(201),
    ]) {
      expect(isSafeBranchName(bad), JSON.stringify(bad)).toBe(false);
    }
  });
});

describe('ticket branch templates', () => {
  const ticket = { key: 'WEB-13', title: 'Login crash on Safari 17!', type: 'bug' as const };

  it('renders the GitHub flow and Git flow presets', () => {
    expect(renderTicketBranchName(branchStrategyPreset('github-flow'), ticket)).toBe(
      'fix/WEB-13-login-crash-on-safari-17',
    );
    expect(renderTicketBranchName(branchStrategyPreset('git-flow'), ticket)).toBe(
      'bugfix/WEB-13-login-crash-on-safari-17',
    );
    expect(renderTicketBranchName(branchStrategyPreset('github-flow'), ticket, 2)).toBe(
      'fix/WEB-13-login-crash-on-safari-17-r2',
    );
    expect(branchStrategyPreset('git-flow').baseBranch).toBe('develop');
    expect(branchStrategyPreset('github-flow', 'trunk').defaultTargetBranch).toBe('trunk');
  });

  it('makes a short ASCII slug, never empty', () => {
    expect(branchSlug('Café ☕ menu — v2')).toBe('cafe-menu-v2');
    expect(branchSlug('!!!')).toBe('ticket');
    expect(branchSlug('x'.repeat(80)).length).toBeLessThanOrEqual(40);
  });

  it('accepts only known tokens, needs {key}, and must give a valid name', () => {
    expect(BranchTemplateSchema.safeParse('{type}/{key}-{slug}').success).toBe(true);
    expect(BranchTemplateSchema.safeParse('{type}/{slug}').success).toBe(false);
    expect(BranchTemplateSchema.safeParse('{key}-{user}').success).toBe(false);
    expect(BranchTemplateSchema.safeParse('../{key}').success).toBe(false);
    expect(BranchStrategySchema.safeParse(branchStrategyPreset('custom')).success).toBe(true);
  });
});

describe('ticket branch settings and code hosting', () => {
  it('keeps tickets without branch settings valid, and validates them when set', () => {
    const t = {
      id: 't1',
      projectId: 'p1',
      key: 'WEB-1',
      title: 'x',
      description: '',
      type: 'feature',
      priority: 'medium',
      labels: [],
      status: 'BACKLOG',
      currentRunId: null,
      createdAt: '2026-10-22T09:00:00.000Z',
      updatedAt: '2026-10-22T09:00:00.000Z',
    };
    expect(TicketSchema.parse(t).branch).toBeUndefined();
    expect(TicketSchema.parse({ ...t, branch: { target: 'develop' } }).branch).toEqual({
      target: 'develop',
    });
    expect(TicketSchema.safeParse({ ...t, branch: { name: 'bad name' } }).success).toBe(false);
    expect(
      UpdateTicketRequestSchema.parse({ branch: { name: null, target: 'develop' } }).branch,
    ).toEqual({ name: null, target: 'develop' });
    expect(UpdateTicketRequestSchema.parse({ branch: null }).branch).toBeNull();
  });

  it('parses the code host status, pull requests and the open request', () => {
    expect(
      CodeHostStatusDtoSchema.parse({
        provider: 'github',
        repo: 'owner/app',
        defaultBranch: 'main',
        cli: { name: 'gh', installed: true, loggedIn: true },
        problem: null,
      }).repo,
    ).toBe('owner/app');
    const pr = {
      provider: 'github',
      number: 7,
      url: 'https://github.com/owner/app/pull/7',
      state: 'open',
      baseBranch: 'main',
      headBranch: 'feature/WEB-1-x',
      checkedAt: '2026-10-22T09:00:00.000Z',
    };
    expect(PullRequestDtoSchema.parse(pr).number).toBe(7);
    expect(PullRequestDtoSchema.safeParse({ ...pr, url: 'not a url' }).success).toBe(false);
    expect(OpenPullRequestRequestSchema.parse({})).toEqual({});
  });
});
