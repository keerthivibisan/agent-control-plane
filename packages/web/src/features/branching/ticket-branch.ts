import {
  isSafeBranchName,
  renderTicketBranchName,
  type BranchStrategy,
  type TicketBranchPrefs,
  type TicketBranchPrefsPatch,
  type TicketType,
} from '@acp/core';
import { BRANCHING_COPY } from '../../lib/copy';

/**
 * Pure logic for a ticket's own branch name, target (ADR-0025 §4) and start branch (§10, `from`):
 * the fields as typed ↔ the ticket create's `branch` and the PATCH's `branch`. An empty field
 * follows the project: on create it is left out; on a change it is `null`, which puts it back to
 * the project's.
 */

export interface TicketBranchDraft {
  name: string;
  target: string;
  /** ADR-0025 §10: the branch the ticket branch starts from. */
  from: string;
}

export interface TicketBranchErrors {
  name?: string;
  target?: string;
  from?: string;
}

export const EMPTY_TICKET_BRANCH: TicketBranchDraft = { name: '', target: '', from: '' };

export function draftFromPrefs(prefs: TicketBranchPrefs | undefined): TicketBranchDraft {
  return { name: prefs?.name ?? '', target: prefs?.target ?? '', from: prefs?.from ?? '' };
}

/** Live validation: empty is fine (the project's), anything else must be a safe branch name. */
export function validateTicketBranch(draft: TicketBranchDraft): TicketBranchErrors {
  const errors: TicketBranchErrors = {};
  const name = draft.name.trim();
  const target = draft.target.trim();
  const from = draft.from.trim();
  if (name !== '' && !isSafeBranchName(name)) errors.name = BRANCHING_COPY.errors.branch;
  if (target !== '' && !isSafeBranchName(target)) errors.target = BRANCHING_COPY.errors.branch;
  if (from !== '' && !isSafeBranchName(from)) errors.from = BRANCHING_COPY.errors.branch;
  return errors;
}

export function hasTicketBranchErrors(errors: TicketBranchErrors): boolean {
  return errors.name !== undefined || errors.target !== undefined || errors.from !== undefined;
}

/** The create request's `branch`: only the fields the owner filled in; undefined for none. */
export function ticketBranchCreate(draft: TicketBranchDraft): TicketBranchPrefs | undefined {
  const name = draft.name.trim();
  const target = draft.target.trim();
  const from = draft.from.trim();
  if (name === '' && target === '' && from === '') return undefined;
  return {
    ...(name !== '' && { name }),
    ...(target !== '' && { target }),
    ...(from !== '' && { from }),
  };
}

/** The PATCH's `branch`: each field set or `null`; `null` for all when all are empty. */
export function ticketBranchPatch(draft: TicketBranchDraft): TicketBranchPrefsPatch | null {
  const name = draft.name.trim();
  const target = draft.target.trim();
  const from = draft.from.trim();
  if (name === '' && target === '' && from === '') return null;
  return {
    name: name === '' ? null : name,
    target: target === '' ? null : target,
    from: from === '' ? null : from,
  };
}

/**
 * The name the project would give the ticket: its strategy's template, or `acp/<KEY>` without
 * one (the behaviour before ADR-0025). Null when it can't be told (e.g. a template the server
 * would refuse).
 */
export function projectBranchName(
  strategy: BranchStrategy | undefined,
  ticket: { key: string; title: string; type: TicketType },
): string | null {
  if (strategy === undefined) return `acp/${ticket.key}`;
  try {
    const title = ticket.title.trim() === '' ? BRANCHING_COPY.sample.feature : ticket.title;
    return renderTicketBranchName(strategy, { ...ticket, title });
  } catch {
    return null;
  }
}

/**
 * The key for a ticket not created yet: the project's key and "N", e.g. `WEB-N`, in the New
 * ticket placeholder (the server picks the number).
 */
export function pendingTicketKey(projectKey: string): string {
  return `${projectKey}-N`;
}

/** The project's target: its strategy's default target, or null for the folder's branch. */
export function projectTarget(strategy: BranchStrategy | undefined): string | null {
  return strategy?.defaultTargetBranch ?? null;
}

/** ADR-0025 §10: the project's start branch, or null when tickets start from their target. */
export function projectSource(strategy: BranchStrategy | undefined): string | null {
  return strategy?.defaultSourceBranch ?? null;
}

/**
 * Where a ticket's branch starts, in the server's order (ticket-branch-plan.ts): the ticket's
 * own `from`, else the project's, else null (its target).
 */
export function startSource(
  branch: TicketBranchPrefs | undefined,
  strategy: BranchStrategy | undefined,
): string | null {
  return branch?.from ?? projectSource(strategy);
}
