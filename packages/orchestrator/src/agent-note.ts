import { MAX_AGENT_NOTE_CHARS, redact } from '@acp/core';

/**
 * The helper's and tester's note (ADR-0026 §3): the brief line that asks for it and the cleaning
 * of its text. A leaf module, so the briefs can import it without a cycle.
 */

/**
 * What a helper or tester is told at the end of its brief (ticket runs only). Kept short: it is
 * sent with every helper's task, and asks for about 50 to 150 tokens of output.
 */
export const AGENT_NOTE_LINE =
  'Before you finish, call report_work with 2 to 4 plain sentences on what you did and how you checked it. The owner reads it on the ticket.';

/**
 * F-1 (2026-10-24, ticket ACPGIT-3): what every helper and the tester are told about branches.
 * The adapter denies such commands in any case; this line tells the agent before it tries.
 */
export const BRANCH_RULE_LINE =
  'The app owns branches and commits. Work only by editing files in this folder; never run git commands that switch, create, commit, reset, merge, rebase, stash, fetch or push. Your work is saved when you finish.';

/** Redacts, then caps to `MAX_AGENT_NOTE_CHARS` (redaction can lengthen the text). */
export function cleanAgentNote(text: string): string {
  const body = redact(text).trim();
  return body.length <= MAX_AGENT_NOTE_CHARS
    ? body
    : `${body.slice(0, MAX_AGENT_NOTE_CHARS - 1).trimEnd()}…`;
}

/** `prompt` with the note line, for a helper or tester of a ticket run; unchanged otherwise. */
export function withAgentNoteLine(prompt: string, ticketRun: boolean): string {
  return ticketRun ? `${prompt}\n\n${AGENT_NOTE_LINE}` : prompt;
}

/**
 * A helper's brief: the task, the branch rule (F-1, every run: helpers always work in a worktree
 * the app made), then the note line in a ticket run.
 */
export function helperBrief(task: string, ticketRun: boolean): string {
  return withAgentNoteLine(`${task}\n\n${BRANCH_RULE_LINE}`, ticketRun);
}
