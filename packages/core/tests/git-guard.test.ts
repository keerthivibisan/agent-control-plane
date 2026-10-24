import { describe, expect, it } from 'vitest';
import { checkGitArgv, checkGitCommand } from '../src/index.js';

/*
 * F-2: the command guard's reading of a shell's input (here-strings, here-documents, pipes and
 * `xargs`), and of argument arrays (harness checks). F-1's full table of commands is in the Claude
 * Code adapter's tests (`tests/managed/branch-guard.test.ts`, `adversarial-commands.test.ts`).
 * Synthetic commands only.
 */

const denied = (command: string) => checkGitCommand(command)?.command ?? null;

describe('here-strings fed to a shell (F-2)', () => {
  it.each([
    ["bash <<< 'git checkout main'", 'git checkout'],
    ['bash <<< "git push origin HEAD"', 'git push'],
    ["sh <<<'git reset --hard main'", 'git reset'],
    ["zsh -s <<< 'git switch main'", 'git switch'],
    ["bash -s extra <<< 'git checkout main'", 'git checkout'],
    ["source /dev/stdin <<< 'git checkout main'", 'git checkout'],
    ["bash <<< $'git checkout main'", 'git checkout'],
    ["<<< 'git checkout main' bash", 'git checkout'],
  ])('%s → %s', (command, what) => {
    expect(denied(command)).toBe(what);
  });

  it('a here-string with a command substitution is denied when the command mentions git', () => {
    expect(denied('bash <<< "$(echo git checkout main)"')).toBe(
      'git (read by a shell from its input)',
    );
  });

  it('a here-string given to a program that is not a shell is data', () => {
    expect(denied("grep -c checkout <<< 'git checkout main'")).toBeNull();
    expect(denied("wc -w <<< 'git push'")).toBeNull();
    expect(denied("bash <<< 'npm test'")).toBeNull();
  });

  it('a shell running a script file still has its here-string read', () => {
    expect(denied("bash build.sh <<< 'git checkout main'")).toBe('git checkout');
    expect(denied("bash build.sh <<< 'yes'")).toBeNull();
  });
});

describe('here-documents fed to a shell (F-2)', () => {
  it.each([
    ['bash <<EOF\ngit checkout main\nEOF', 'git checkout'],
    ["bash <<'EOF'\ngit reset --hard main\nEOF", 'git reset'],
    ['bash << "END"\ngit push origin HEAD\nEND\n', 'git push'],
    ['bash <<-EOF\n\tgit switch main\n\tEOF', 'git switch'],
    ['sh <<EOF && echo done\ngit checkout main\nEOF', 'git checkout'],
  ])('%j → %s', (command, what) => {
    expect(denied(command)).toBe(what);
  });

  it('a here-document given to cat is data (unless a line of it reads as git)', () => {
    expect(denied("cat > notes.md <<'EOF'\nThe tests pass.\nEOF")).toBeNull();
    expect(denied('cat <<EOF\nhello\nEOF\nnpm test')).toBeNull();
  });
});

describe('piped input and xargs (F-2)', () => {
  it.each([
    ["echo 'git checkout main' | bash", 'git (read by a shell from its input)'],
    ["printf 'git push' | sh -s", 'git (read by a shell from its input)'],
    ['cat script.txt | bash # git', 'git (read by a shell from its input)'],
    ['echo checkout main | xargs git', 'git (subcommand from xargs)'],
    ["xargs git <<< 'checkout main'", 'git (subcommand from xargs)'],
    ['echo pr merge 1 | xargs gh', 'gh (from xargs)'],
  ])('%j → %s', (command, what) => {
    expect(denied(command)).toBe(what);
  });

  it('a pipe into a shell that never mentions git, and `||`, are left alone', () => {
    expect(denied('echo hello | bash')).toBeNull();
    expect(denied('npm test || echo failed')).toBeNull();
    expect(denied('npm test 2>&1 | tee test.log')).toBeNull();
    expect(denied('git status || npm test')).toBeNull();
  });

  it('xargs with a reading git subcommand is read as before', () => {
    expect(denied('echo src | xargs git log --oneline')).toBeNull();
    expect(denied('echo main | xargs git checkout')).toBe('git checkout');
  });

  it('a redirection with no target never hides the next command', () => {
    expect(denied('echo >; git checkout main')).toBe('git checkout');
  });
});

describe('argument arrays (harness checks and setup steps, F-2)', () => {
  it.each([
    [['git', 'push', 'origin', 'HEAD'], 'git push'],
    [['git', 'checkout', 'main'], 'git checkout'],
    [['/usr/bin/git', 'reset', '--hard'], 'git reset'],
    [['env', 'git', 'switch', 'main'], 'git switch'],
    [['sh', '-c', 'git push origin HEAD'], 'git push'],
    [['gh', 'pr', 'merge', '1'], 'gh pr merge'],
  ])('%j → %s', (argv, what) => {
    expect(checkGitArgv(argv)?.command ?? null).toBe(what);
  });

  it('reading git and ordinary commands pass; quoting keeps each word whole', () => {
    expect(checkGitArgv(['git', 'diff', '--stat'])).toBeNull();
    expect(checkGitArgv(['npm', 'test'])).toBeNull();
    expect(checkGitArgv(['node', '-e', "console.log('git push')"])).toBeNull();
    expect(checkGitArgv(['echo', 'a; git push'])).toBeNull();
    expect(checkGitArgv([])).toBeNull();
  });
});
