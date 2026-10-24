import type { HookCallbackMatcher, HookJSONOutput } from '@anthropic-ai/claude-agent-sdk';

/**
 * F-1 (2026-10-24, ticket ACPGIT-3): helpers and testers never switch, create, move, commit to,
 * reset or push branches. Only the app does that: it creates the ticket branch, seals (commits)
 * each helper's worktree and moves the ticket branch by compare-and-swap (ADR-0021 §3–§4). A
 * helper that ran `git checkout -b feature/X dev` and `git commit` in a Full auto run left its
 * worktree on the ticket branch and moved that branch outside the app.
 *
 * This module reads a Bash command the way a shell would split it and says whether it runs a git
 * (or gh) command that could change a ref, `HEAD` or history. It is an allowlist: only git
 * subcommands that read, or that change files and the index of the agent's own folder (`add`,
 * `rm`, `mv`, `restore`, `clean`, `apply`), are allowed; every other subcommand, including an
 * alias the owner's git config may define (`git co`), is denied. It is used three ways for every
 * worker and tester, in every approval mode:
 * - a PreToolUse hook (`gitGuardHooks`), which Claude Code runs before its permission pipeline, so
 *   it holds in auto mode too (docs/research/f-1-branch-guard-2026-10-24.md);
 * - the gate (`createCanUseTool`), so the owner is never asked to approve such a command;
 * - coarse `disallowedTools` deny rules (`GIT_DENY_RULES`) as a second layer.
 * In Full auto the OS sandbox also denies writes to the repository's git directory (F-1 §1b).
 *
 * What it cannot see: a program that runs git itself (a script, `python -c`, `node -e`, a test
 * runner). Those are bounded by the sandbox in Full auto and by the owner's approval otherwise.
 */

/** Why a command was denied: the command as the agent wrote it, e.g. `git checkout`. */
export interface GitGuardDenial {
  command: string;
}

/** Nested `sh -c`, `eval` and `$(…)` levels read before the guard gives up and denies. */
const MAX_DEPTH = 4;

const SHELLS: ReadonlySet<string> = new Set(['sh', 'bash', 'zsh', 'dash', 'ksh', 'fish', 'ash']);

/** Wrappers that run the rest of their words as a command, with the options they take a value for. */
const WRAPPERS: Readonly<Record<string, ReadonlySet<string>>> = {
  command: new Set(),
  builtin: new Set(),
  exec: new Set(['-a']),
  nohup: new Set(),
  time: new Set(['-f', '-o']),
  nice: new Set(['-n']),
  ionice: new Set(['-c', '-n', '-p']),
  sudo: new Set(['-u', '-g', '-h', '-p', '-C', '-D', '-r', '-t']),
  doas: new Set(['-u', '-C']),
  env: new Set(['-u', '-C', '-S', '--unset', '--chdir', '--split-string']),
  stdbuf: new Set(['-i', '-o', '-e']),
  caffeinate: new Set(['-t', '-w']),
  xargs: new Set(['-I', '-L', '-n', '-P', '-s', '-E', '-d', '-a']),
  timeout: new Set(['-s', '-k', '--signal', '--kill-after']),
  gtimeout: new Set(['-s', '-k', '--signal', '--kill-after']),
  watch: new Set(['-n', '-d', '--interval']),
  // Shell keywords before a command: `if git …; then git …; fi`, `{ git …; }`.
  if: new Set(),
  elif: new Set(),
  then: new Set(),
  else: new Set(),
  while: new Set(),
  until: new Set(),
  do: new Set(),
  '{': new Set(),
  '!': new Set(),
};

/** Wrappers whose first positional word is not the command (a duration). */
const WRAPPER_FIRST_ARG: ReadonlySet<string> = new Set(['timeout', 'gtimeout']);

/** Git subcommands that only read. */
const GIT_READ_ONLY: ReadonlySet<string> = new Set([
  'status',
  'diff',
  'log',
  'show',
  'blame',
  'annotate',
  'grep',
  'ls-files',
  'ls-tree',
  'rev-parse',
  'rev-list',
  'cat-file',
  'describe',
  'shortlog',
  'whatchanged',
  'show-ref',
  'for-each-ref',
  'name-rev',
  'merge-base',
  'diff-tree',
  'diff-files',
  'diff-index',
  'help',
  'version',
  'var',
  'check-ignore',
  'check-attr',
  'check-ref-format',
  'count-objects',
  'fsck',
  'cherry',
  'range-diff',
  'ls-remote',
  'archive',
  'format-patch',
  'show-branch',
  'verify-commit',
  'verify-tag',
  'column',
  'stripspace',
]);

/** Git subcommands that change only files (and the index) of the agent's own folder. */
const GIT_FILES_ONLY: ReadonlySet<string> = new Set([
  'add',
  'rm',
  'mv',
  'restore',
  'clean',
  'apply',
]);

/** Options that make a reading command run a program or write a file elsewhere. */
const GIT_UNSAFE_READ_OPTIONS = [/^--ext-diff$/, /^--output(=|$)/, /^-O/, /^--open-files-in-pager/];

/** Subcommands allowed only in these read forms (first positional word, or none). */
const GIT_READ_FORMS: Readonly<Record<string, ReadonlySet<string>>> = {
  remote: new Set(['', 'show', 'get-url']),
  worktree: new Set(['list']),
  reflog: new Set(['', 'show', 'exists']),
  stash: new Set(['list', 'show']),
  notes: new Set(['list', 'show']),
  submodule: new Set(['', 'status', 'summary']),
  'sparse-checkout': new Set(['list']),
  lfs: new Set(['ls-files', 'status', 'env', 'version', 'logs']),
};

/** `git branch` options that create, move, copy or delete a branch (`-a` lists: allowed). */
const BRANCH_WRITE_OPTIONS =
  /^(-[dDmMcCfu].*|--delete|--move|--copy|--force|--set-upstream-to.*|--unset-upstream|--track.*|--no-track|--edit-description|--create-reflog|--recurse-submodules)$/;
/** `git tag` options that create or delete a tag. */
const TAG_WRITE_OPTIONS =
  /^(-[adfsuFm].*|--annotate|--sign|--delete|--force|--local-user.*|--message.*|--file.*|--create-reflog)$/;
/** `git branch` and `git tag` options whose value is the next word (so it is not a name). */
const LIST_VALUE_OPTIONS: ReadonlySet<string> = new Set([
  '--contains',
  '--no-contains',
  '--merged',
  '--no-merged',
  '--points-at',
  '--format',
  '--sort',
  '--column',
]);
const LIST_FLAGS = /^(-l|--list|--show-current|-n\d*)$/;

/** `git config` forms that only read. */
const CONFIG_READ =
  /^(--get|--get-all|--get-regexp|--get-urlmatch|--get-color|--get-colorbool|--list|-l|get|list)$/;

/** Global git options whose value is the next word (or after `=`). */
const GIT_GLOBAL_WITH_VALUE: ReadonlySet<string> = new Set([
  '-C',
  '--git-dir',
  '--work-tree',
  '--namespace',
  '--super-prefix',
]);

/** `gh` commands that only read: `<group> <action>`. Anything else in gh is denied. */
const GH_READ: Readonly<Record<string, ReadonlySet<string>>> = {
  pr: new Set(['view', 'list', 'status', 'diff', 'checks']),
  issue: new Set(['view', 'list', 'status']),
  repo: new Set(['view', 'list']),
  run: new Set(['view', 'list', 'watch']),
  auth: new Set(['status']),
};
const GH_INFO: ReadonlySet<string> = new Set(['', 'help', 'version', '--version', '--help']);

const ENV_ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/;

/** True for `git`, `/usr/bin/git`, `./git`. */
function isNamed(word: string, name: string): boolean {
  return word === name || word.endsWith(`/${name}`);
}

// ---------------------------------------------------------------- tokenizing

interface Segment {
  words: string[];
}

interface Scan {
  segments: Segment[];
  /** Command substitutions (`$(…)`, backticks) found anywhere, read as commands of their own. */
  nested: string[];
}

/** Index just past the `)` that closes the `$(` whose content starts at `start`, or -1. */
function closeParen(text: string, start: number): number {
  let depth = 1;
  let i = start;
  while (i < text.length) {
    const c = text[i];
    if (c === '\\') {
      i += 2;
      continue;
    }
    if (c === "'") {
      const end = text.indexOf("'", i + 1);
      if (end < 0) return -1;
      i = end + 1;
      continue;
    }
    if (c === '"') {
      i += 1;
      while (i < text.length && text[i] !== '"') i += text[i] === '\\' ? 2 : 1;
      i += 1;
      continue;
    }
    if (c === '(') depth += 1;
    if (c === ')') {
      depth -= 1;
      if (depth === 0) return i + 1;
    }
    i += 1;
  }
  return -1;
}

/**
 * Splits shell text into simple commands (words between `;`, `&`, `|`, `&&`, `||`, newlines and
 * parentheses), removing quotes as the shell would. Redirections and their targets are dropped.
 * Unbalanced quoting yields null: the guard then denies any text that mentions git.
 */
function tokenize(text: string): Scan | null {
  const segments: Segment[] = [];
  const nested: string[] = [];
  let words: string[] = [];
  let word = '';
  let inWord = false;
  let skipNext = false;
  const endWord = (): void => {
    if (inWord) {
      if (skipNext) skipNext = false;
      else words.push(word);
    }
    word = '';
    inWord = false;
  };
  const endSegment = (): void => {
    endWord();
    if (words.length > 0) segments.push({ words });
    words = [];
  };
  let i = 0;
  while (i < text.length) {
    const c = text[i] ?? '';
    if (c === '\\') {
      if (text[i + 1] === '\n') {
        i += 2;
        continue;
      }
      word += text[i + 1] ?? '';
      inWord = true;
      i += 2;
      continue;
    }
    if (c === "'") {
      const end = text.indexOf("'", i + 1);
      if (end < 0) return null;
      word += text.slice(i + 1, end);
      inWord = true;
      i = end + 1;
      continue;
    }
    if (c === '$' && text[i + 1] === "'") {
      let j = i + 2;
      let content = '';
      while (j < text.length && text[j] !== "'") {
        if (text[j] === '\\') {
          content += text[j + 1] ?? '';
          j += 2;
        } else {
          content += text[j];
          j += 1;
        }
      }
      if (j >= text.length) return null;
      word += content;
      inWord = true;
      i = j + 1;
      continue;
    }
    if (c === '"') {
      let j = i + 1;
      let content = '';
      while (j < text.length && text[j] !== '"') {
        const d = text[j];
        if (d === '\\' && j + 1 < text.length) {
          const e = text[j + 1] ?? '';
          content += '$`"\\\n'.includes(e) ? e : `\\${e}`;
          j += 2;
        } else if (d === '$' && text[j + 1] === '(') {
          const end = closeParen(text, j + 2);
          if (end < 0) return null;
          nested.push(text.slice(j + 2, end - 1));
          content += '$()';
          j = end;
        } else if (d === '`') {
          const end = text.indexOf('`', j + 1);
          if (end < 0) return null;
          nested.push(text.slice(j + 1, end));
          j = end + 1;
        } else {
          content += d;
          j += 1;
        }
      }
      if (j >= text.length) return null;
      word += content;
      inWord = true;
      i = j + 1;
      continue;
    }
    if (c === '$' && text[i + 1] === '(') {
      const end = closeParen(text, i + 2);
      if (end < 0) return null;
      nested.push(text.slice(i + 2, end - 1));
      word += '$()';
      inWord = true;
      i = end;
      continue;
    }
    if (c === '`') {
      const end = text.indexOf('`', i + 1);
      if (end < 0) return null;
      nested.push(text.slice(i + 1, end));
      word += '$()';
      inWord = true;
      i = end + 1;
      continue;
    }
    if (c === '#' && !inWord) {
      const end = text.indexOf('\n', i);
      i = end < 0 ? text.length : end;
      continue;
    }
    if (c === ';' || c === '&' || c === '|' || c === '\n' || c === '(' || c === ')') {
      // `&>` and `>&` are redirections, not separators.
      if (c === '&' && text[i + 1] === '>') {
        endWord();
        skipNext = true;
        i += text[i + 2] === '>' ? 3 : 2;
        continue;
      }
      endSegment();
      i += 1;
      continue;
    }
    if (c === '<' || c === '>') {
      // `2>file`: the digits are the descriptor, not a word.
      if (inWord && /^\d+$/.test(word)) {
        word = '';
        inWord = false;
      } else endWord();
      let j = i + 1;
      while (text[j] === '>' || text[j] === '<' || text[j] === '&' || text[j] === '|') j += 1;
      // `>&2`: the target is a descriptor glued to the operator.
      const glued = /^\d+/.exec(text.slice(j));
      if (glued !== null && text[j - 1] === '&') j += glued[0].length;
      else skipNext = true;
      i = j;
      continue;
    }
    if (c === ' ' || c === '\t' || c === '\r') {
      endWord();
      i += 1;
      continue;
    }
    word += c;
    inWord = true;
    i += 1;
  }
  endSegment();
  return { segments, nested };
}

// ---------------------------------------------------------------- analysis

/**
 * The denial for one shell text, or null when nothing in it changes a ref. Exported for tests via
 * `checkGitCommand`.
 */
function scanText(text: string, depth: number): GitGuardDenial | null {
  if (depth > MAX_DEPTH) {
    return /\bgit\b|\bgh\b/.test(text) ? { command: 'git (nested too deeply to read)' } : null;
  }
  const scan = tokenize(text);
  if (scan === null) {
    return /\bgit\b|\bgh\b/.test(text) ? { command: 'git (unbalanced quoting)' } : null;
  }
  for (const inner of scan.nested) {
    const denied = scanText(inner, depth + 1);
    if (denied !== null) return denied;
  }
  for (const segment of scan.segments) {
    const denied = analyzeCommand(segment.words, depth);
    if (denied !== null) return denied;
  }
  return null;
}

/** Skips a wrapper's options; returns the index of its command word. */
function skipWrapperOptions(words: readonly string[], start: number, name: string): number {
  const withValue = WRAPPERS[name] ?? new Set<string>();
  let i = start;
  while (i < words.length) {
    const w = words[i] ?? '';
    if (w === '--') return i + 1;
    if (name === 'env' && ENV_ASSIGNMENT.test(w)) {
      i += 1;
      continue;
    }
    if (!w.startsWith('-') || w === '-') break;
    i += withValue.has(w) ? 2 : 1;
  }
  if (WRAPPER_FIRST_ARG.has(name) && i < words.length) i += 1;
  return i;
}

/** One simple command (already split into words). */
function analyzeCommand(words: readonly string[], depth: number): GitGuardDenial | null {
  let i = 0;
  // Leading assignments: `GIT_DIR=… git …` points git elsewhere; `GIT_PAGER=cat` is harmless.
  while (i < words.length && ENV_ASSIGNMENT.test(words[i] ?? '')) i += 1;
  const assignments = words.slice(0, i);
  let guard = 0;
  while (i < words.length && guard < 16) {
    guard += 1;
    const w = words[i] ?? '';
    const name = w.replace(/^.*\//, '');
    if (ENV_ASSIGNMENT.test(w)) {
      assignments.push(w);
      i += 1;
      continue;
    }
    if (Object.hasOwn(WRAPPERS, name)) {
      // `watch "git …"` takes its command as one string.
      if (name === 'watch') {
        const at = skipWrapperOptions(words, i + 1, name);
        return scanText(words.slice(at).join(' '), depth + 1);
      }
      i = skipWrapperOptions(words, i + 1, name);
      continue;
    }
    break;
  }
  const command = words[i];
  if (command === undefined) return null;
  const rest = words.slice(i + 1);
  const name = command.replace(/^.*\//, '');
  if (isNamed(command, 'git')) {
    const env = assignments.find((a) => /^GIT_/.test(a) && !/^GIT_PAGER=(cat)?$/.test(a));
    if (env !== undefined) return { command: `git (with ${env.split('=')[0] ?? 'GIT_'} set)` };
    return analyzeGit(rest);
  }
  if (isNamed(command, 'gh')) return analyzeGh(rest);
  if (SHELLS.has(name)) {
    // `sh -c "<script>"`, `bash -lc '<script>'`: the script is a command of its own.
    for (let j = 0; j < rest.length; j += 1) {
      const w = rest[j] ?? '';
      if (/^-[a-zA-Z]*c[a-zA-Z]*$/.test(w)) {
        return scanText(rest[j + 1] ?? '', depth + 1);
      }
      if (!w.startsWith('-')) break;
    }
    return null;
  }
  if (name === 'eval') return scanText(rest.join(' '), depth + 1);
  if (name === 'find' || name === 'fd') {
    // `find … -exec git checkout {} ;`
    for (let j = 0; j < rest.length; j += 1) {
      const w = rest[j] ?? '';
      if (w === '-exec' || w === '-execdir' || w === '-ok' || w === '-okdir' || w === '-x') {
        const end = rest.findIndex((x, k) => k > j && (x === ';' || x === '+'));
        const denied = analyzeCommand(rest.slice(j + 1, end < 0 ? undefined : end), depth + 1);
        if (denied !== null) return denied;
      }
    }
    return null;
  }
  return null;
}

/** The first positional word at or after `from` (options skipped), and its index. */
function firstPositional(args: readonly string[], from = 0): { word: string; index: number } {
  for (let j = from; j < args.length; j += 1) {
    const w = args[j] ?? '';
    if (w === '--') return { word: args[j + 1] ?? '', index: j + 1 };
    if (!w.startsWith('-')) return { word: w, index: j };
  }
  return { word: '', index: -1 };
}

/** `git branch` / `git tag` that only lists. */
function listsOnly(args: readonly string[], writes: RegExp): boolean {
  let listing = false;
  const positional: string[] = [];
  for (let j = 0; j < args.length; j += 1) {
    const w = args[j] ?? '';
    if (writes.test(w)) return false;
    if (LIST_FLAGS.test(w) || /^--(contains|no-contains|merged|no-merged|points-at)/.test(w)) {
      listing = true;
    }
    if (LIST_VALUE_OPTIONS.has(w)) {
      j += 1;
      continue;
    }
    if (!w.startsWith('-')) positional.push(w);
  }
  return positional.length === 0 || listing;
}

function analyzeGit(args: readonly string[]): GitGuardDenial | null {
  let i = 0;
  while (i < args.length) {
    const w = args[i] ?? '';
    if (!w.startsWith('-')) break;
    // A config value can name a program (pager, diff driver, alias with `!`).
    if (w === '-c' || w.startsWith('--config-env') || /^--exec-path=/.test(w)) {
      return { command: `git ${w.split('=')[0] ?? w}` };
    }
    if (w === '--version' || w === '--help' || w === '-h' || w === '--exec-path') return null;
    i += GIT_GLOBAL_WITH_VALUE.has(w) ? 2 : 1;
  }
  const sub = args[i];
  if (sub === undefined) return null;
  const subArgs = args.slice(i + 1);
  const denied: GitGuardDenial = { command: `git ${sub}` };
  if (GIT_READ_ONLY.has(sub)) {
    return subArgs.some((a) => GIT_UNSAFE_READ_OPTIONS.some((re) => re.test(a))) ? denied : null;
  }
  if (GIT_FILES_ONLY.has(sub)) return null;
  if (sub === 'branch') return listsOnly(subArgs, BRANCH_WRITE_OPTIONS) ? null : denied;
  if (sub === 'tag') return listsOnly(subArgs, TAG_WRITE_OPTIONS) ? null : denied;
  if (sub === 'config') return subArgs.some((a) => CONFIG_READ.test(a)) ? null : denied;
  if (sub === 'symbolic-ref') {
    const positional = subArgs.filter((a) => !a.startsWith('-'));
    const deletes = subArgs.some((a) => a === '-d' || a === '--delete' || a === '-m');
    return deletes || positional.length > 1 ? denied : null;
  }
  if (sub === 'hash-object') return subArgs.includes('-w') ? denied : null;
  if (sub === 'interpret-trailers') return subArgs.includes('--in-place') ? denied : null;
  const forms = GIT_READ_FORMS[sub];
  if (forms !== undefined) {
    const first = firstPositional(subArgs).word;
    if (sub === 'remote' && first === '' && subArgs.every((a) => a === '-v' || a === '--verbose')) {
      return null;
    }
    return forms.has(first) ? null : denied;
  }
  return denied;
}

function analyzeGh(args: readonly string[]): GitGuardDenial | null {
  let i = 0;
  while (i < args.length && (args[i] ?? '').startsWith('-') && args[i] !== '--version') {
    i += args[i] === '-R' || args[i] === '--repo' ? 2 : 1;
  }
  const group = args[i] ?? '';
  const action = firstPositional(args, i + 1).word;
  if (GH_INFO.has(group) || GH_READ[group]?.has(action) === true) return null;
  // Only a subcommand word is quoted back, never an argument.
  const named = /^[a-z][a-z-]*$/.test(action) ? ` ${action}` : '';
  return { command: `gh ${group}${named}` };
}

/**
 * Whether a Bash command would make git (or gh) change a ref, `HEAD` or history: null when it is
 * allowed, otherwise the command that is denied.
 */
export function checkGitCommand(command: string): GitGuardDenial | null {
  return scanText(command, 0);
}

/** What the agent is told, in plain words. */
export function gitGuardMessage(denial: GitGuardDenial): string {
  return `The app owns branches and commits, so this command is not run (${denial.command}). Never run git commands that switch, create, commit, reset, merge, rebase, stash, fetch or push. Keep working by editing files in this folder; your work is saved when you finish.`;
}

/**
 * The second layer (SDK `disallowedTools`): permission deny rules for the plain forms of the
 * commands that always change a ref or HEAD. Claude Code checks each part of a compound command
 * against them, and deny rules apply in every permission mode. Forms such as `git -C x checkout`
 * are left to the hook and the gate.
 */
export const GIT_DENY_RULES: readonly string[] = [
  'checkout',
  'switch',
  'commit',
  'reset',
  'merge',
  'rebase',
  'cherry-pick',
  'revert',
  'stash push',
  'stash pop',
  'stash apply',
  'stash drop',
  'push',
  'pull',
  'fetch',
  'update-ref',
  'am',
  'bisect',
  'filter-branch',
  'replace',
  'worktree add',
  'worktree remove',
  'worktree move',
  'branch -f',
  'branch -d',
  'branch -D',
  'branch -m',
  'branch -M',
  'branch -c',
  'branch -C',
  'commit-tree',
  'read-tree',
  'update-index',
  'init',
  'clone',
].map((sub) => `Bash(git ${sub}:*)`);

/** The tool input of a Bash call, as far as the guard reads it. */
function bashCommandOf(input: unknown): string | null {
  if (typeof input !== 'object' || input === null) return null;
  const command = (input as { command?: unknown }).command;
  return typeof command === 'string' ? command : null;
}

/**
 * Denies a Bash call (`toolName` `Bash`) whose command the guard refuses; null otherwise. A Bash
 * call without a readable command is left to the rest of the pipeline.
 */
export function gitGuardDenialFor(toolName: string, input: unknown): GitGuardDenial | null {
  if (toolName !== 'Bash') return null;
  const command = bashCommandOf(input);
  return command === null ? null : checkGitCommand(command);
}

/**
 * The PreToolUse hook for a worker or tester (SDK `hooks`): a guarded command is denied with the
 * plain message; anything else gets no decision from the hook (never `allow`, which would skip
 * the gate). The command text is never logged or kept.
 */
export function gitGuardHooks(): { PreToolUse: HookCallbackMatcher[] } {
  return {
    PreToolUse: [
      {
        matcher: 'Bash',
        hooks: [
          (input): Promise<HookJSONOutput> => {
            if (input.hook_event_name !== 'PreToolUse') return Promise.resolve({});
            const denial = gitGuardDenialFor(input.tool_name, input.tool_input);
            if (denial === null) return Promise.resolve({});
            return Promise.resolve({
              hookSpecificOutput: {
                hookEventName: 'PreToolUse',
                permissionDecision: 'deny',
                permissionDecisionReason: gitGuardMessage(denial),
              },
            });
          },
        ],
      },
    ],
  };
}
