import { describe, expect, it } from 'vitest';
import {
  checkGitCommand,
  GIT_DENY_RULES,
  gitGuardDenialFor,
  gitGuardHooks,
  gitGuardMessage,
} from '../../src/managed/branch-guard.js';

// F-1: helpers and testers never switch, create, move, commit to, reset or push branches.

const denied = (command: string): string | null => checkGitCommand(command)?.command ?? null;

describe('checkGitCommand: allowed', () => {
  it.each([
    'git status',
    'git status --porcelain',
    'git diff',
    'git diff --stat HEAD~1',
    'git log --oneline -5',
    'git log --grep=commit',
    'git show HEAD:README.md',
    'git blame src/a.ts',
    'git grep -n "checkout" -- src',
    'git ls-files',
    'git rev-parse --abbrev-ref HEAD',
    'git rev-parse --git-dir --git-common-dir',
    'git -C packages/web status',
    'git --no-pager log -3',
    'git -P diff',
    'GIT_PAGER=cat git log',
    'git branch',
    'git branch -a',
    'git branch -vv',
    'git branch --show-current',
    'git branch --list "feature/*"',
    'git branch --contains HEAD',
    'git tag',
    'git tag -l "v*"',
    'git remote -v',
    'git remote get-url origin',
    'git config --get user.name',
    'git config --list',
    'git worktree list',
    'git stash list',
    'git reflog',
    'git symbolic-ref --short HEAD',
    'git add -A',
    'git add src/a.ts && git diff --cached',
    'git restore src/a.ts',
    'git restore --staged src/a.ts',
    'git mv a.ts b.ts',
    'git rm --cached tmp.log',
    'git clean -n',
    'git apply fix.patch',
    'git --version',
    'git',
    'npm test',
    'pnpm --filter @acp/web test',
    'echo "git checkout is not run by helpers"',
    'grep -rn "git commit" docs',
    'rg "git push" .',
    'cat .git/HEAD',
    'ls -la && git status && npm run build',
    'gh pr view 12',
    'gh --version',
    'node scripts/checkout.js',
    'digit checkout',
  ])('%s', (command) => {
    expect(checkGitCommand(command)).toBeNull();
  });
});

describe('checkGitCommand: denied', () => {
  it.each([
    ['git checkout -b feature/ACPGIT-3-branding dev', 'git checkout'],
    ['git checkout dev -- src/a.ts', 'git checkout'],
    ['git switch -c feature/x', 'git switch'],
    ['git switch dev', 'git switch'],
    ['git commit -m "wip"', 'git commit'],
    ['git commit --amend --no-edit', 'git commit'],
    ['git reset --hard dev', 'git reset'],
    ['git reset HEAD~1', 'git reset'],
    ['git branch feature/x', 'git branch'],
    ['git branch -f feature/x dev', 'git branch'],
    ['git branch -D old', 'git branch'],
    ['git branch -m old new', 'git branch'],
    ['git branch --set-upstream-to=origin/dev', 'git branch'],
    ['git merge dev', 'git merge'],
    ['git rebase dev', 'git rebase'],
    ['git cherry-pick abc123', 'git cherry-pick'],
    ['git revert HEAD', 'git revert'],
    ['git stash', 'git stash'],
    ['git stash push -m x', 'git stash'],
    ['git stash pop', 'git stash'],
    ['git push origin HEAD', 'git push'],
    ['git push --force', 'git push'],
    ['git pull', 'git pull'],
    ['git fetch origin', 'git fetch'],
    ['git tag v1.0', 'git tag'],
    ['git tag -d v1.0', 'git tag'],
    ['git tag -a v1 -m x', 'git tag'],
    ['git update-ref refs/heads/x abc', 'git update-ref'],
    ['git symbolic-ref HEAD refs/heads/x', 'git symbolic-ref'],
    ['git worktree add ../x dev', 'git worktree'],
    ['git worktree remove ../x', 'git worktree'],
    ['git am < fix.patch', 'git am'],
    ['git bisect start', 'git bisect'],
    ['git config user.name x', 'git config'],
    ['git config alias.co checkout', 'git config'],
    ['git co dev', 'git co'],
    ['git ci -m x', 'git ci'],
    ['git init sub', 'git init'],
    ['git clone https://example.invalid/r.git', 'git clone'],
    ['git gc', 'git gc'],
    ['git reflog expire --all', 'git reflog'],
    ['git notes add -m x', 'git notes'],
    ['git submodule update --init', 'git submodule'],
    ['git commit-tree abc -m x', 'git commit-tree'],
    ['git update-index --assume-unchanged a', 'git update-index'],
    ['git log --output=/tmp/x', 'git log'],
    ['git diff --ext-diff', 'git diff'],
    ['gh pr checkout 12', 'gh pr checkout'],
    ['gh pr merge 12', 'gh pr merge'],
    ['gh repo sync', 'gh repo sync'],
    ['gh api repos/x/y/git/refs', 'gh api'],
  ])('%s → %s', (command, expected) => {
    expect(denied(command)).toBe(expected);
  });

  it('reads global options before the subcommand', () => {
    expect(denied('git -C ../other checkout dev')).toBe('git checkout');
    expect(denied('git --git-dir=/repo/.git --work-tree=. commit -m x')).toBe('git commit');
    expect(denied('git --git-dir /repo/.git reset --hard')).toBe('git reset');
    expect(denied('git --no-pager -C x push')).toBe('git push');
    expect(denied('/usr/bin/git commit -m x')).toBe('git commit');
  });

  it('denies config that could run a program', () => {
    expect(denied('git -c core.pager=less log')).toBe('git -c');
    expect(denied('git -c alias.st="!sh -c x" st')).toBe('git -c');
    expect(denied('git --config-env=core.pager=X log')).toBe('git --config-env');
    expect(denied('GIT_DIR=/repo/.git git log')).toBe('git (with GIT_DIR set)');
    expect(denied('GIT_PAGER="sh -c x" git log')).toBe('git (with GIT_PAGER set)');
  });

  it('finds git anywhere in a chain, pipeline or list', () => {
    expect(denied('git fetch origin && git checkout -b feature/x dev')).toBe('git fetch');
    expect(denied('npm test; git commit -am x')).toBe('git commit');
    expect(denied('npm test || git stash')).toBe('git stash');
    expect(denied('echo y | git reset --hard')).toBe('git reset');
    expect(denied('npm test & git push')).toBe('git push');
    expect(denied('npm test\ngit commit -m x')).toBe('git commit');
    expect(denied('(cd sub && git checkout dev)')).toBe('git checkout');
    expect(denied('{ git commit -m x; }')).toBe('git commit');
    expect(denied('if true; then git checkout dev; fi')).toBe('git checkout');
    expect(denied('for b in a b; do git branch $b; done')).toBe('git branch');
    expect(denied('git status 2>/dev/null && git commit -m x >out.txt')).toBe('git commit');
  });

  it('reads past env prefixes and wrappers', () => {
    expect(denied('FOO=1 git commit -m x')).toBe('git commit');
    expect(denied('env -i PATH=/bin git checkout dev')).toBe('git checkout');
    expect(denied('command git switch dev')).toBe('git switch');
    expect(denied('exec git push')).toBe('git push');
    expect(denied('nohup git fetch &')).toBe('git fetch');
    expect(denied('time git commit -m x')).toBe('git commit');
    expect(denied('nice -n 5 git rebase dev')).toBe('git rebase');
    expect(denied('timeout 30 git pull')).toBe('git pull');
    expect(denied('sudo -u me git reset --hard')).toBe('git reset');
    expect(denied('echo dev | xargs git checkout')).toBe('git checkout');
    expect(denied('xargs -n 1 git branch -D < names')).toBe('git branch');
    expect(denied('find . -name x -exec git add {} \\; -exec git commit -m x \\;')).toBe(
      'git commit',
    );
  });

  it('reads shells, eval and command substitutions', () => {
    expect(denied('sh -c "git checkout dev"')).toBe('git checkout');
    expect(denied("bash -lc 'cd x && git commit -m y'")).toBe('git commit');
    expect(denied('zsh -c "npm test; git push"')).toBe('git push');
    expect(denied('eval "git reset --hard"')).toBe('git reset');
    expect(denied('echo $(git checkout dev)')).toBe('git checkout');
    expect(denied('echo `git commit -m x`')).toBe('git commit');
    expect(denied('echo "$(git stash)"')).toBe('git stash');
    expect(denied('watch "git fetch"')).toBe('git fetch');
    expect(denied('sh -c "sh -c \\"git push\\""')).toBe('git push');
    expect(denied('g\\it checkout dev')).toBe('git checkout');
    expect(denied('"git" commit -m x')).toBe('git commit');
    expect(denied("'git' 'push'")).toBe('git push');
  });

  it('denies text it cannot read when it mentions git', () => {
    expect(denied('git commit -m "unclosed')).toBe('git (unbalanced quoting)');
    expect(checkGitCommand('echo "unclosed')).toBeNull();
  });
});

describe('the guard wiring', () => {
  it('only reads Bash calls with a command', () => {
    expect(gitGuardDenialFor('Bash', { command: 'git commit -m x' })).toEqual({
      command: 'git commit',
    });
    expect(gitGuardDenialFor('Edit', { command: 'git commit' })).toBeNull();
    expect(gitGuardDenialFor('Bash', { description: 'x' })).toBeNull();
    expect(gitGuardDenialFor('Bash', null)).toBeNull();
  });

  it('says plainly that the app owns branches', () => {
    const text = gitGuardMessage({ command: 'git checkout' });
    expect(text).toContain('The app owns branches and commits');
    expect(text).toContain('git checkout');
    expect(text).toContain('your work is saved when you finish');
  });

  it('the hook denies a guarded command and leaves others undecided', async () => {
    const matcher = gitGuardHooks().PreToolUse[0];
    expect(matcher?.matcher).toBe('Bash');
    const hook = matcher?.hooks[0];
    if (hook === undefined) throw new Error('no hook');
    const signal = new AbortController().signal;
    const base = { session_id: 's', transcript_path: '/t', cwd: '/w' };
    const deny = await hook(
      {
        ...base,
        hook_event_name: 'PreToolUse',
        tool_name: 'Bash',
        tool_input: { command: 'git checkout -b x dev' },
        tool_use_id: 'u1',
      } as never,
      'u1',
      { signal },
    );
    expect(deny).toMatchObject({
      hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny' },
    });
    const pass = await hook(
      {
        ...base,
        hook_event_name: 'PreToolUse',
        tool_name: 'Bash',
        tool_input: { command: 'git status' },
        tool_use_id: 'u2',
      } as never,
      'u2',
      { signal },
    );
    // Never `allow`: the gate still decides everything else.
    expect(pass).toEqual({});
  });

  it('has prefix deny rules for the plain forms', () => {
    expect(GIT_DENY_RULES).toContain('Bash(git checkout:*)');
    expect(GIT_DENY_RULES).toContain('Bash(git commit:*)');
    expect(GIT_DENY_RULES).toContain('Bash(git push:*)');
    expect(GIT_DENY_RULES).toContain('Bash(git branch -D:*)');
    // Reading forms are never covered by a rule.
    expect(GIT_DENY_RULES.some((r) => /git (status|diff|log|show)/.test(r))).toBe(false);
  });
});
