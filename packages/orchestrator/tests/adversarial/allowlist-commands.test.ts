import { GIT_READ_ONLY_SUBCOMMANDS } from '@acp/core';
import type { ApprovalMode } from '@acp/core';
import { describe, expect, it } from 'vitest';
import { allowlistTarget, evaluateAllowlist } from '../../src/index.js';

/*
 * T-1: the server gate's own rules (ADR-0021 §2) against the commands a hostile helper might
 * run. Even the loosest project allowlist (`git …` and `npm …` prefixes, mode `auto`) never
 * auto-approves a git command that changes branches, refs or remotes, however it is spelled; the
 * owner (or, in Full auto, the gate's deny) decides those. The adapter's guard in front of this
 * is tested in packages/adapters/claude-code/tests/managed/adversarial-commands.test.ts.
 * Synthetic data only.
 */

const WT = '/data/worktrees/run-1/agent-1';
/**
 * The loosest allowlist the schema accepts: every read-only git subcommand and `npm` as prefixes
 * (a bare `git` or `sh` pattern is refused by the schema, and never matches if stored anyway).
 */
const LOOSE = [
  ...GIT_READ_ONLY_SUBCOMMANDS.map((sub) => ({ argv: ['git', sub], match: 'prefix' as const })),
  { argv: ['npm'], match: 'prefix' as const },
  { argv: ['git'], match: 'prefix' as const },
  { argv: ['sh'], match: 'prefix' as const },
];

const HOSTILE: readonly string[] = [
  'git checkout acp/WEBAPP-1',
  'git checkout -b feature/ACPGIT-3-branding dev',
  'git switch main',
  'git branch -f acp/WEBAPP-1 main',
  'git reset --hard dev',
  'git update-ref refs/heads/main HEAD',
  'git push origin HEAD',
  'git commit -am wip',
  'git stash',
  'git -C ../other checkout main',
  'git -c alias.co=checkout co main',
  'git --git-dir=/repo/.git branch -f main HEAD',
  'cd .. && git checkout main',
  'env A=1 git push origin HEAD',
  'sh -c "git reset --hard main"',
  'npm test; git push origin HEAD',
  'npm test && git checkout main',
  'npm test\ngit checkout main',
  'echo $(git checkout main)',
  'npm run x -- `git switch main`',
];

function verdict(
  mode: ApprovalMode,
  command: string,
  checks: { id: string; argv: string[] }[] = [],
) {
  return evaluateAllowlist({
    policy: { mode, commands: LOOSE },
    agentKind: 'worker',
    target: allowlistTarget('Bash', { command }),
    resolvedPath: null,
    worktreeRoot: WT,
    checks,
  });
}

describe('T-1: the gate never auto-approves a hostile git command', () => {
  for (const command of HOSTILE) {
    it(JSON.stringify(command), () => {
      for (const mode of ['manual', 'auto-edits', 'auto', 'full-auto'] as const) {
        expect(verdict(mode, command).allowed, mode).toBe(false);
      }
    });
  }

  it('the loose allowlist still allows what it should (it is not a blanket deny)', () => {
    expect(verdict('auto', 'git status').allowed).toBe(true);
    expect(verdict('auto', 'npm test').allowed).toBe(true);
  });

  // Closed by F-2: a harness check is matched by its exact command line and auto-approved in
  // auto-edits and Full auto (`run-harness-check`). The harness file comes from the project, so
  // F-1's command guard now runs before that rule: a check that is itself a branch-changing git
  // command (`git push`, `git checkout`) is never pre-approved.
  it('a harness check never auto-approves a branch-changing git command', () => {
    const checks = [
      { id: 'push', argv: ['git', 'push', 'origin', 'HEAD'] },
      { id: 'switch', argv: ['git', 'checkout', 'main'] },
    ];
    for (const mode of ['auto-edits', 'full-auto'] as const) {
      for (const command of ['git push origin HEAD', 'git checkout main']) {
        expect(
          verdict(mode, command, checks).allowed,
          `[gate] ${mode} auto-approved the harness check ${command}`,
        ).toBe(false);
      }
    }
  });

  it('F-2: the guard runs before every rule, and reading harness checks still pass', () => {
    const checks = [
      { id: 'push', argv: ['git', 'push', 'origin', 'HEAD'] },
      { id: 'diff', argv: ['git', 'diff', '--stat'] },
    ];
    for (const mode of ['auto-edits', 'auto', 'full-auto'] as const) {
      expect(verdict(mode, 'git push origin HEAD', checks)).toEqual({
        allowed: false,
        reason: 'The app owns branches and commits, so git push is never pre-approved.',
      });
      expect(verdict(mode, 'git diff --stat', checks)).toEqual({
        allowed: true,
        rule: 'run-harness-check',
        checkId: 'diff',
      });
    }
  });
});
