import type { HookCallbackMatcher, HookJSONOutput } from '@anthropic-ai/claude-agent-sdk';
import { checkGitCommand } from '@acp/core';
import type { GitGuardDenial } from '@acp/core';

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
 *
 * F-2: the reader itself (`checkGitCommand`) moved to `@acp/core` (`workspace/git-guard.ts`), so
 * the server gate's allowlist and the harness status read commands exactly as this guard does. It
 * now also reads a shell's here-strings, here-documents and piped input. It is re-exported here.
 */

export { checkGitCommand };
export type { GitGuardDenial };

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
