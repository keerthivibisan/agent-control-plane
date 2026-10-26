/**
 * F-1's command guard (2026-10-24, ACPGIT-3): reads a shell command the way a shell would split
 * it and says whether it runs a git (or gh) command that could change a ref, `HEAD` or history.
 * Pure, so every layer reads a command the same way: the Claude Code adapter's PreToolUse hook,
 * gate and deny rules (`managed/branch-guard.ts`, which re-exports it), the server gate's
 * allowlist (`evaluateAllowlist` in `@acp/orchestrator`, F-2) and the harness manifest status
 * (F-2). It is an allowlist: only git subcommands that read, or that change files and the index of
 * the agent's own folder, are allowed; every other subcommand (an alias too) is denied.
 *
 * F-2: a shell's standard input is read as well. A here-string (`bash <<< 'git checkout main'`) or
 * a here-document fed to a shell is read as a script of its own; a shell that reads a pipe, or
 * input with a command substitution in it, is denied when the command mentions git or gh (what
 * it will read cannot be known); and `xargs git` with no subcommand is denied (xargs supplies it).
 *
 * What it cannot see: a program that runs git itself (a script, `python -c`, `node -e`, a test
 * runner), or a shell that reads a script file.
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

/** What a simple command reads on its standard input, as far as the text shows it (F-2). */
interface Input {
  /** Here-strings (expanded as the shell would) and here-document bodies (raw) fed to it. */
  stdin: readonly string[];
  /** It reads the previous command's output (`a | b`). */
  piped: boolean;
}

const NO_INPUT: Input = { stdin: [], piped: false };

interface Segment extends Input {
  words: string[];
}

/** What a redirection operator does to the word after it. */
type NextWord = 'skip' | 'here-string' | 'heredoc' | null;

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
  let stdin: string[] = [];
  let piped = false;
  let word = '';
  let inWord = false;
  let nextWord: NextWord = null;
  let strip = false;
  /** Here-documents of the current line: their bodies follow its newline (F-2). */
  const pending: { delimiter: string; strip: boolean; stdin: string[] }[] = [];
  const endWord = (): void => {
    if (inWord) {
      if (nextWord === 'here-string') stdin.push(word);
      else if (nextWord === 'heredoc') pending.push({ delimiter: word, strip, stdin });
      else if (nextWord !== 'skip') words.push(word);
      nextWord = null;
    }
    word = '';
    inWord = false;
  };
  const endSegment = (pipe = false): void => {
    endWord();
    // A redirection with no word before the separator is a syntax error; it never skips the
    // next command's first word.
    nextWord = null;
    if (words.length > 0) segments.push({ words, stdin, piped });
    words = [];
    stdin = [];
    piped = pipe;
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
        nextWord = 'skip';
        i += text[i + 2] === '>' ? 3 : 2;
        continue;
      }
      if (c === '|') {
        // `a || b` runs b after a; `a | b` and `a |& b` feed a's output to b (F-2).
        if (text[i + 1] === '|') {
          endSegment();
          i += 2;
        } else {
          endSegment(true);
          i += text[i + 1] === '&' ? 2 : 1;
        }
        continue;
      }
      endSegment();
      if (c === '\n' && pending.length > 0) {
        // F-2: the here-document bodies of the line just ended. They are given to their command
        // as its input, and still read as commands below too (as before F-2: the safe side).
        let pos = i + 1;
        for (const doc of pending) {
          let body = '';
          while (pos < text.length) {
            const nl = text.indexOf('\n', pos);
            const end = nl < 0 ? text.length : nl;
            const line = text.slice(pos, end);
            pos = end + 1;
            if ((doc.strip ? line.replace(/^\t+/, '') : line) === doc.delimiter) break;
            body += `${line}\n`;
          }
          doc.stdin.push(body);
        }
        pending.length = 0;
      }
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
      const op = text.slice(i, j);
      if (op === '<<<') {
        // F-2: a here-string: the next word is the command's input.
        nextWord = 'here-string';
      } else if (op === '<<') {
        // F-2: a here-document: the next word is its delimiter; `<<-` strips leading tabs.
        strip = text[j] === '-';
        if (strip) j += 1;
        nextWord = 'heredoc';
      } else {
        // `>&2`: the target is a descriptor glued to the operator.
        const glued = /^\d+/.exec(text.slice(j));
        if (glued !== null && text[j - 1] === '&') j += glued[0].length;
        else nextWord = 'skip';
      }
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
    const denied = analyzeCommand(segment.words, depth, segment, text);
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

/** True when the text mentions git or gh as a word. */
const mentionsGit = (text: string): boolean => /\bgit\b|\bgh\b/.test(text);

/**
 * F-2: what a shell (or `eval`, `source`) reads on its input. A here-string or here-document is
 * read as a script; input that cannot be known (a pipe, or a command substitution in the input)
 * is denied when the command mentions git or gh.
 */
function analyzeInput(input: Input, depth: number, whole: string): GitGuardDenial | null {
  for (const text of input.stdin) {
    const denied = scanText(text, depth + 1);
    if (denied !== null) return denied;
  }
  const opaque = input.piped || input.stdin.some((t) => t.includes('$(') || t.includes('`'));
  return opaque && mentionsGit(whole) ? { command: 'git (read by a shell from its input)' } : null;
}

/** One simple command (already split into words), with what it reads on its input. */
function analyzeCommand(
  words: readonly string[],
  depth: number,
  input: Input = NO_INPUT,
  whole = '',
): GitGuardDenial | null {
  let i = 0;
  // Leading assignments: `GIT_DIR=… git …` points git elsewhere; `GIT_PAGER=cat` is harmless.
  while (i < words.length && ENV_ASSIGNMENT.test(words[i] ?? '')) i += 1;
  const assignments = words.slice(0, i);
  /** F-2: `xargs` adds words from its input to the command. */
  let viaXargs = false;
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
      if (name === 'xargs') viaXargs = true;
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
    // F-2: `… | xargs git` takes its subcommand from the input, which cannot be read.
    if (viaXargs && gitSubcommand(rest) === undefined) {
      return { command: 'git (subcommand from xargs)' };
    }
    return analyzeGit(rest);
  }
  if (isNamed(command, 'gh')) {
    if (viaXargs && firstPositional(rest).word === '') return { command: 'gh (from xargs)' };
    return analyzeGh(rest);
  }
  if (SHELLS.has(name)) {
    // `sh -c "<script>"`, `bash -lc '<script>'`: the script is a command of its own. Without `-c`
    // or a script file, the shell reads its script from its input (F-2).
    let file = false;
    for (let j = 0; j < rest.length; j += 1) {
      const w = rest[j] ?? '';
      if (/^-[a-zA-Z]*c[a-zA-Z]*$/.test(w)) {
        const denied = scanText(rest[j + 1] ?? '', depth + 1);
        if (denied !== null) return denied;
        break;
      }
      if (!w.startsWith('-')) {
        // `bash -s arg`: the words are arguments; the script still comes from the input.
        file = !rest.slice(0, j).some((o) => /^-[a-zA-Z]*s[a-zA-Z]*$/.test(o));
        break;
      }
    }
    if (!file) return analyzeInput(input, depth, whole);
    // It runs a script file, which the guard cannot read; its input is still read.
    for (const text of input.stdin) {
      const denied = scanText(text, depth + 1);
      if (denied !== null) return denied;
    }
    return null;
  }
  if (name === 'eval' || name === 'source' || name === '.') {
    const denied = name === 'eval' ? scanText(rest.join(' '), depth + 1) : null;
    // `source /dev/stdin <<< '…'`: the input is a script (F-2).
    return denied ?? analyzeInput(input, depth, whole);
  }
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

/** The subcommand after git's global options, or undefined when there is none. */
function gitSubcommand(args: readonly string[]): string | undefined {
  let i = 0;
  while (i < args.length && (args[i] ?? '').startsWith('-')) {
    i += GIT_GLOBAL_WITH_VALUE.has(args[i] ?? '') ? 2 : 1;
  }
  return args[i];
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

/** One argument as a shell would need it written to stay one word with this exact text. */
function shellWord(arg: string): string {
  return /^[A-Za-z0-9._/:=@+%,-]+$/.test(arg) ? arg : `'${arg.replaceAll("'", `'\\''`)}'`;
}

/**
 * `checkGitCommand` for a command given as an argument array (a harness check or setup step, run
 * without a shell): the words are quoted so the guard reads exactly them (F-2).
 */
export function checkGitArgv(argv: readonly string[]): GitGuardDenial | null {
  return argv.length === 0 ? null : checkGitCommand(argv.map(shellWord).join(' '));
}
