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
 * Pure logic for a ticket's own branch name and target (ADR-0025 §4): the two fields as typed ↔
 * the ticket create's `branch` and the PATCH's `branch`. An empty field follows the project: on
 * create it is left out; on a change it is `null`, which puts it back to the project's.
 */

export interface TicketBranchDraft {
  name: string;
  target: string;
}

export interface TicketBranchErrors {
  name?: string;
  target?: string;
}

export const EMPTY_TICKET_BRANCH: TicketBranchDraft = { name: '', target: '' };

export function draftFromPrefs(prefs: TicketBranchPrefs | undefined): TicketBranchDraft {
  return { name: prefs?.name ?? '', target: prefs?.target ?? '' };
}

/** Live validation: empty is fine (the project's), anything else must be a safe branch name. */
export function validateTicketBranch(draft: TicketBranchDraft): TicketBranchErrors {
  const errors: TicketBranchErrors = {};
  const name = draft.name.trim();
  const target = draft.target.trim();
  if (name !== '' && !isSafeBranchName(name)) errors.name = BRANCHING_COPY.errors.branch;
  if (target !== '' && !isSafeBranchName(target)) errors.target = BRANCHING_COPY.errors.branch;
  return errors;
}

export function hasTicketBranchErrors(errors: TicketBranchErrors): boolean {
  return errors.name !== undefined || errors.target !== undefined;
}

/** The create request's `branch`: only the fields the owner filled in; undefined for none. */
export function ticketBranchCreate(draft: TicketBranchDraft): TicketBranchPrefs | undefined {
  const name = draft.name.trim();
  const target = draft.target.trim();
  if (name === '' && target === '') return undefined;
  return { ...(name !== '' && { name }), ...(target !== '' && { target }) };
}

/** The PATCH's `branch`: each field set or `null`; `null` for both when both are empty. */
export function ticketBranchPatch(draft: TicketBranchDraft): TicketBranchPrefsPatch | null {
  const name = draft.name.trim();
  const target = draft.target.trim();
  if (name === '' && target === '') return null;
  return { name: name === '' ? null : name, target: target === '' ? null : target };
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
