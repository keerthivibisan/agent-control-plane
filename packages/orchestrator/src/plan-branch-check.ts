import type { PlanStep } from '@acp/core';

/**
 * F-1 (2026-10-24, ticket ACPGIT-3): a deterministic check that no plan step tells a helper to
 * manage branches. The lead's auto-approved plan said "Run `git fetch origin` then
 * `git checkout -b feature/ACPGIT-3-branding dev` … commit"; the helper did, its worktree left its
 * own branch and the ticket branch moved outside the app. The app creates the ticket branch from
 * its target and saves (commits) each helper's work, so such a step is refused at `submit_plan`,
 * before the plan is approved by anyone (the owner or Full auto).
 *
 * It reads prose, so it only looks at the word `git` (lower case, as a command is written, also in
 * backticks or quotes) followed by a subcommand that changes a ref or `HEAD`. Words such as
 * "commit to the design" or "merge the two lists" without `git` are never refused, nor are
 * reading commands (`git status`, `git diff`, `git log`). The adapter denies the commands
 * themselves in any case (`branch-guard.ts` in the Claude Code adapter); this keeps them out of
 * the plan the owner reads and the lead hands out.
 */

/** Subcommands a plan step may never ask for, whatever follows them. */
const ALWAYS: ReadonlySet<string> = new Set([
  'checkout',
  'switch',
  'commit',
  'push',
  'pull',
  'fetch',
  'reset',
  'rebase',
  'merge',
  'stash',
  'cherry-pick',
  'revert',
  'update-ref',
  'am',
]);

/** Global options whose value is the next word. */
const WITH_VALUE: ReadonlySet<string> = new Set(['-C', '-c', '--git-dir', '--work-tree']);

/** `git branch` options that only list. */
const BRANCH_LISTS =
  /^(-a|-r|-v|-vv|-l|--list|--all|--remotes|--show-current|--contains|--merged|--no-merged)$/;

/** Text around a word that is not part of it (backticks, quotes, brackets, punctuation). */
function bare(word: string): string {
  return word.replace(/^[`'"([{]+/, '').replace(/[`'")\]},.;:!?]+$/, '');
}

/** Words after "git branch" / "git tag" that make it prose, not a branch or tag name. */
const PROSE_AFTER: ReadonlySet<string> = new Set([
  'is',
  'was',
  'are',
  'will',
  'should',
  'must',
  'and',
  'or',
  'to',
  'of',
  'for',
  'in',
  'on',
  'that',
  'the',
  'a',
  'an',
  'with',
  'from',
  'name',
  'names',
  'naming',
  'list',
  'model',
  'strategy',
]);

/** True when `word` is `git` written as a command: not "git," or "git." closing a sentence. */
function isGitCommandWord(word: string): boolean {
  return bare(word) === 'git' && /^[`'"(]*git(`|$)/.test(word) && !/^[`'"(]*git`$/.test(word);
}

/** The first branch-managing git command in `text` (e.g. `git checkout -b`), or null. */
export function branchCommandIn(text: string): string | null {
  const words = text.split(/\s+/).filter((w) => w !== '');
  for (let i = 0; i < words.length; i += 1) {
    if (!isGitCommandWord(words[i] ?? '')) continue;
    let j = i + 1;
    while (j < words.length) {
      const w = bare(words[j] ?? '');
      if (!w.startsWith('-')) break;
      j += WITH_VALUE.has(w) ? 2 : 1;
    }
    const sub = bare(words[j] ?? '');
    const next = bare(words[j + 1] ?? '');
    if (ALWAYS.has(sub)) {
      return /^-[a-zA-Z]{1,2}$/.test(next) ? `git ${sub} ${next}` : `git ${sub}`;
    }
    if (sub === 'branch' || sub === 'tag') {
      // Alone, or with a listing option, it only lists.
      if (next === '' || BRANCH_LISTS.test(next) || (sub === 'tag' && /^-n\d*$/.test(next))) {
        continue;
      }
      if (next.startsWith('-') || !PROSE_AFTER.has(next.toLowerCase())) return `git ${sub}`;
      continue;
    }
    if (sub === 'worktree' && (next === 'add' || next === 'remove' || next === 'move')) {
      return `git worktree ${next}`;
    }
  }
  return null;
}

/** The plain refusal for a plan whose step asks for one (owner's wording, 2026-10-24). */
export const PLAN_BRANCH_REFUSAL =
  "Plans can't include branch or commit commands: the app creates the ticket branch from its target and saves each helper's work; describe the file changes instead.";

/** The first step (title or detail) that asks for a branch-managing git command, or null. */
export function planBranchCommand(
  steps: readonly Pick<PlanStep, 'title' | 'detail'>[],
): { step: string; command: string } | null {
  for (const step of steps) {
    const command = branchCommandIn(step.title) ?? branchCommandIn(step.detail);
    if (command !== null) return { step: step.title, command };
  }
  return null;
}
