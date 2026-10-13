import {
  HARD_MAX_DEPTH,
  HARD_MAX_HELPERS,
  MAX_CONTEXT_BYTES,
  MAX_CONTEXT_FILES,
  ProjectKeySchema,
} from '@acp/core';
import {
  CreateRepoProjectRequestSchema,
  UpdateProjectSetupRequestSchema,
  type ContextCandidateDto,
  type ProjectAgentSetupDto,
} from '@acp/core/api';
import type { ApiError, CreateRepoProjectRequest, UpdateProjectSetupRequest } from '../../lib/api';
import { PROJECT_SETUP_COPY } from '../../lib/copy';

/**
 * Pure form logic for the wizard and the settings page: what the owner typed (strings, as typed)
 * ↔ the PUT /api/projects/:id/setup body. Validation speaks in sentences; the core request schema
 * still runs afterwards as the single authority.
 */

export const MAX_CONTEXT_KIB = MAX_CONTEXT_BYTES / 1024;
export const HELPER_CHOICES: readonly number[] = Array.from(
  { length: HARD_MAX_HELPERS },
  (_, i) => i + 1,
);
export const DEPTH_CHOICES = [1, 2] as const satisfies readonly number[];
export type Depth = (typeof DEPTH_CHOICES)[number];

export interface SetupDraft {
  projectKey: string;
  maxConcurrentHelpers: number;
  maxDepth: Depth;
  /** As typed, e.g. "500,000". */
  budget: string;
  /** As typed; empty means the provider's default model. */
  model: string;
  editInOwnWorktree: boolean;
  runHarnessChecks: boolean;
  contextFiles: readonly string[];
}

export type SetupField = 'projectKey' | 'budget' | 'model' | 'contextFiles';
export type SetupErrors = Partial<Record<SetupField, string>>;

const E = PROJECT_SETUP_COPY;

function clampDepth(n: number): Depth {
  return n >= HARD_MAX_DEPTH ? 2 : 1;
}

export function draftFromSetup(setup: ProjectAgentSetupDto): SetupDraft {
  return {
    projectKey: setup.projectKey,
    maxConcurrentHelpers: setup.maxConcurrentHelpers,
    maxDepth: clampDepth(setup.maxDepth),
    budget: setup.defaultBudgetTokensPerAgent.toLocaleString('en-US'),
    model: setup.model ?? '',
    editInOwnWorktree: setup.allowlist.editInOwnWorktree,
    runHarnessChecks: setup.allowlist.runHarnessChecks,
    contextFiles: setup.contextFiles,
  };
}

/** "500,000", "500 000" and "500_000" all read as 500000; anything else is null. */
export function parseTokens(raw: string): number | null {
  const n = Number(raw.replace(/[,\s_]/g, ''));
  return raw.trim() !== '' && Number.isSafeInteger(n) && n > 0 ? n : null;
}

/** Total size of the chosen files; files the server didn't list count as unknown. */
export function contextUsage(
  chosen: readonly string[],
  candidates: readonly ContextCandidateDto[] | undefined,
): { bytes: number; unknown: number } {
  const sizes = new Map((candidates ?? []).map((c) => [c.path, c.sizeBytes]));
  let bytes = 0;
  let unknown = 0;
  for (const path of chosen) {
    const size = sizes.get(path);
    if (size === undefined) unknown += 1;
    else bytes += size;
  }
  return { bytes, unknown };
}

/** Step 2's fields (also the top of the settings card). */
export function validateAgentFields(draft: SetupDraft): SetupErrors {
  const errors: SetupErrors = {};
  if (!ProjectKeySchema.safeParse(draft.projectKey.trim()).success) {
    errors.projectKey = E.agents.errors.projectKey;
  }
  if (parseTokens(draft.budget) === null) errors.budget = E.agents.errors.budget;
  if (draft.model.trim().length > 100) errors.model = E.agents.errors.modelTooLong;
  return errors;
}

/** Step 4: at most 10 files and 32 KiB together (sizes from the candidate list). */
export function validateContext(
  chosen: readonly string[],
  candidates: readonly ContextCandidateDto[] | undefined,
): SetupErrors {
  if (chosen.length > MAX_CONTEXT_FILES) {
    return { contextFiles: E.context.errors.tooMany(MAX_CONTEXT_FILES) };
  }
  if (contextUsage(chosen, candidates).bytes > MAX_CONTEXT_BYTES) {
    return { contextFiles: E.context.errors.tooLarge(MAX_CONTEXT_KIB) };
  }
  return {};
}

export type DraftResult =
  | { ok: true; request: UpdateProjectSetupRequest }
  | { ok: false; errors: SetupErrors };

/** The whole draft → the PUT body, or the sentences that say what to fix. */
export function draftToRequest(
  draft: SetupDraft,
  candidates: readonly ContextCandidateDto[] | undefined,
): DraftResult {
  const errors = { ...validateAgentFields(draft), ...validateContext(draft.contextFiles, candidates) };
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  const model = draft.model.trim();
  const parsed = UpdateProjectSetupRequestSchema.safeParse({
    projectKey: draft.projectKey.trim(),
    maxConcurrentHelpers: draft.maxConcurrentHelpers,
    maxDepth: draft.maxDepth,
    defaultBudgetTokensPerAgent: parseTokens(draft.budget),
    model: model === '' ? null : model,
    allowlist: {
      editInOwnWorktree: draft.editInOwnWorktree,
      runHarnessChecks: draft.runHarnessChecks,
    },
    contextFiles: [...draft.contextFiles],
  });
  // Every rule the schema checks is checked above in words; this is the backstop.
  if (!parsed.success) return { ok: false, errors: { contextFiles: E.wizard.saveFailed } };
  return { ok: true, request: parsed.data };
}

export function sameDraft(a: SetupDraft, b: SetupDraft): boolean {
  return (
    a.projectKey === b.projectKey &&
    a.maxConcurrentHelpers === b.maxConcurrentHelpers &&
    a.maxDepth === b.maxDepth &&
    a.budget.trim() === b.budget.trim() &&
    a.model.trim() === b.model.trim() &&
    a.editInOwnWorktree === b.editInOwnWorktree &&
    a.runHarnessChecks === b.runHarnessChecks &&
    a.contextFiles.length === b.contextFiles.length &&
    a.contextFiles.every((f, i) => b.contextFiles[i] === f)
  );
}

/**
 * The wizard's first pick of context files: what the server already has, otherwise the files it
 * marks as suggested (e.g. CLAUDE.md), smallest first while they fit the limits.
 */
export function initialContextFiles(
  current: readonly string[],
  candidates: readonly ContextCandidateDto[],
): string[] {
  if (current.length > 0) return [...current];
  const picked: string[] = [];
  let bytes = 0;
  for (const c of candidates.filter((c) => c.suggested)) {
    if (picked.length >= MAX_CONTEXT_FILES || bytes + c.sizeBytes > MAX_CONTEXT_BYTES) continue;
    picked.push(c.path);
    bytes += c.sizeBytes;
  }
  return picked;
}

// --- Step 1: a new repository ---------------------------------------------------------------------

export interface NewRepoInput {
  parentDir: string;
  name: string;
  readme: string;
}
export type NewRepoErrors = Partial<Record<keyof NewRepoInput, string>>;

const R = PROJECT_SETUP_COPY.source.errors;

export function validateNewRepo(input: NewRepoInput): NewRepoErrors {
  const shape = CreateRepoProjectRequestSchema.shape;
  const errors: NewRepoErrors = {};
  const parent = input.parentDir.trim();
  const name = input.name.trim();
  if (parent === '') errors.parentDir = R.parentMissing;
  else if (!shape.parentDir.safeParse(parent).success) errors.parentDir = R.parentNotAbsolute;
  if (name === '') errors.name = R.nameMissing;
  else if (!shape.name.safeParse(name).success) errors.name = R.nameInvalid;
  if (input.readme.length > 20_000) errors.readme = R.readmeTooLong;
  return errors;
}

export function newRepoRequest(input: NewRepoInput): CreateRepoProjectRequest | null {
  const readme = input.readme.trim();
  const parsed = CreateRepoProjectRequestSchema.safeParse({
    parentDir: input.parentDir.trim(),
    name: input.name.trim(),
    ...(readme === '' ? {} : { readme: input.readme }),
  });
  return parsed.success ? parsed.data : null;
}

/** "/Users/me/code" + "app" → "/Users/me/code/app" (display only; the server decides). */
export function joinFolder(parent: string, name: string): string {
  const p = parent.trim().replace(/[/\\]+$/, '');
  return `${p}/${name.trim()}`;
}

/**
 * Plain words for a failed POST /api/projects/new. The codes follow the existing POST
 * /api/projects (`conflict`, `invalid_root`); anything else reads generically, and the raw error
 * stays under Details.
 */
export function createRepoErrorMessage(error: ApiError): string {
  if (error.kind === 'http') {
    if (error.code === 'conflict') return R.exists;
    if (error.code === 'invalid_root' || error.code === 'not_found') return R.parentNotFound;
  }
  return R.generic;
}

// --- Links into pages other work packages own -------------------------------------------------------

/** The project's board (P4-E route `#/board/:projectId`). */
export function boardHash(projectId: string): string {
  return `#/board/${encodeURIComponent(projectId)}`;
}

/** A ticket's page (P4-G route `#/tickets/:ticketId`). */
export function ticketHash(ticketId: string): string {
  return `#/tickets/${encodeURIComponent(ticketId)}`;
}
