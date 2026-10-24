import {
  BRANCH_TEMPLATE_TOKENS,
  BranchStrategySchema,
  BranchTemplateSchema,
  TicketTypeSchema,
  branchStrategyPreset,
  isSafeBranchName,
  renderTicketBranchName,
  type BranchStrategy,
  type TicketType,
} from '@acp/core';
import { BRANCHING_COPY, type BranchingChoiceKey } from '../../lib/copy';

/**
 * Pure form logic for a project's branching strategy (ADR-0025 §3): what the owner typed ↔ the
 * setup PUT's `branching`. Presets fill every field; GitHub flow and Git flow keep their name
 * template and type words (Custom frees them), and every preset keeps its branches editable.
 * The sentences say what to fix; core's `BranchStrategySchema` still runs last as the authority.
 */

export const BRANCHING_CHOICES: readonly BranchingChoiceKey[] = [
  'github-flow',
  'git-flow',
  'custom',
  'none',
];

export const TICKET_TYPES: readonly TicketType[] = TicketTypeSchema.options;

export interface BranchingDraft {
  choice: BranchingChoiceKey;
  baseBranch: string;
  defaultTargetBranch: string;
  /** ADR-0025 §10: "Start ticket branches from"; empty: the same as the target branch. */
  defaultSourceBranch: string;
  template: string;
  typeWords: Record<TicketType, string>;
}

export interface BranchingErrors {
  baseBranch?: string;
  defaultTargetBranch?: string;
  defaultSourceBranch?: string;
  template?: string;
  typeWords?: Partial<Record<TicketType, string>>;
}

const E = BRANCHING_COPY.errors;
const TYPE_WORD = /^[a-z][a-z0-9-]{0,19}$/;

function fields(strategy: BranchStrategy): Omit<BranchingDraft, 'choice'> {
  return {
    baseBranch: strategy.baseBranch,
    defaultTargetBranch: strategy.defaultTargetBranch,
    defaultSourceBranch: strategy.defaultSourceBranch ?? '',
    template: strategy.ticketBranchTemplate,
    typeWords: { ...strategy.typeWords },
  };
}

/**
 * The saved strategy as a draft. Without one the choice is "None", with GitHub flow's values
 * ready behind it, so picking a preset or Custom starts from something sensible.
 */
export function draftFromStrategy(
  strategy: BranchStrategy | undefined,
  defaultBranch = 'main',
): BranchingDraft {
  if (strategy === undefined) {
    return { choice: 'none', ...fields(branchStrategyPreset('github-flow', defaultBranch)) };
  }
  return { choice: strategy.preset, ...fields(strategy) };
}

/**
 * Switching the choice: GitHub flow and Git flow put in their own values; Custom and None keep
 * what is there (Custom starts from the strategy the owner had). The start branch is no part of a
 * preset, so the owner's choice stays.
 */
export function chooseStrategy(
  draft: BranchingDraft,
  choice: BranchingChoiceKey,
  defaultBranch = 'main',
): BranchingDraft {
  if (choice === 'github-flow' || choice === 'git-flow') {
    return {
      choice,
      ...fields(branchStrategyPreset(choice, defaultBranch)),
      defaultSourceBranch: draft.defaultSourceBranch,
    };
  }
  return { ...draft, choice };
}

/** GitHub flow and Git flow fix the name template and the type words. */
export function isLocked(choice: BranchingChoiceKey): boolean {
  return choice === 'github-flow' || choice === 'git-flow';
}

function branchError(raw: string): string | undefined {
  const name = raw.trim();
  if (name === '') return E.branchMissing;
  return isSafeBranchName(name) ? undefined : E.branch;
}

/** The template's first problem in words, or undefined when core accepts it. */
export function templateError(raw: string): string | undefined {
  const t = raw.trim();
  if (t === '') return E.templateMissing;
  if (t.length > 120) return E.templateTooLong;
  const known = BRANCH_TEMPLATE_TOKENS as readonly string[];
  const unknown = (t.match(/\{[^}]*\}/g) ?? []).filter((tok) => !known.includes(tok));
  if (unknown.length > 0) return E.templateToken([...new Set(unknown)].join(', '));
  if (!t.includes('{key}')) return E.templateNeedsKey;
  return BranchTemplateSchema.safeParse(t).success ? undefined : E.templateInvalid;
}

export function validateBranching(draft: BranchingDraft): BranchingErrors {
  if (draft.choice === 'none') return {};
  const errors: BranchingErrors = {};
  const base = branchError(draft.baseBranch);
  if (base) errors.baseBranch = base;
  const target = branchError(draft.defaultTargetBranch);
  if (target) errors.defaultTargetBranch = target;
  // Empty is "Same as the target branch".
  const source = draft.defaultSourceBranch.trim();
  if (source !== '' && !isSafeBranchName(source)) errors.defaultSourceBranch = E.branch;
  const template = templateError(draft.template);
  if (template) errors.template = template;
  const words: Partial<Record<TicketType, string>> = {};
  for (const type of TICKET_TYPES) {
    if (!TYPE_WORD.test(draft.typeWords[type].trim())) words[type] = E.typeWord;
  }
  if (Object.keys(words).length > 0) errors.typeWords = words;
  return errors;
}

export function hasBranchingErrors(errors: BranchingErrors): boolean {
  return (
    errors.baseBranch !== undefined ||
    errors.defaultTargetBranch !== undefined ||
    errors.defaultSourceBranch !== undefined ||
    errors.template !== undefined ||
    Object.keys(errors.typeWords ?? {}).length > 0
  );
}

export type BranchingResult =
  { ok: true; branching: BranchStrategy | null } | { ok: false; errors: BranchingErrors };

/** The draft → the PUT's `branching`: a strategy, or `null` for None (the old behaviour). */
export function draftToStrategy(draft: BranchingDraft): BranchingResult {
  if (draft.choice === 'none') return { ok: true, branching: null };
  const errors = validateBranching(draft);
  if (hasBranchingErrors(errors)) return { ok: false, errors };
  const target = draft.defaultTargetBranch.trim();
  const source = draft.defaultSourceBranch.trim();
  const parsed = BranchStrategySchema.safeParse({
    preset: draft.choice,
    baseBranch: draft.baseBranch.trim(),
    defaultTargetBranch: target,
    // The target's own name is the same as none: saved without it.
    ...(source !== '' && source !== target && { defaultSourceBranch: source }),
    ticketBranchTemplate: draft.template.trim(),
    typeWords: Object.fromEntries(TICKET_TYPES.map((t) => [t, draft.typeWords[t].trim()])),
  });
  // Every rule the schema checks is checked above in words; this is the backstop.
  if (!parsed.success) return { ok: false, errors: { template: E.templateInvalid } };
  return { ok: true, branching: parsed.data };
}

/** Equal for saving: None equals None whatever is typed behind it. */
export function sameBranching(a: BranchingDraft, b: BranchingDraft): boolean {
  if (a.choice !== b.choice) return false;
  if (a.choice === 'none') return true;
  return (
    a.baseBranch.trim() === b.baseBranch.trim() &&
    a.defaultTargetBranch.trim() === b.defaultTargetBranch.trim() &&
    a.defaultSourceBranch.trim() === b.defaultSourceBranch.trim() &&
    a.template.trim() === b.template.trim() &&
    TICKET_TYPES.every((t) => a.typeWords[t].trim() === b.typeWords[t].trim())
  );
}

export interface BranchPreview {
  type: TicketType;
  /** Null when the template or the type's word doesn't give a valid name. */
  name: string | null;
}

/** Example names for a feature and a bug of this project, from the draft as typed. */
export function previewNames(draft: BranchingDraft, projectKey: string): BranchPreview[] {
  const key = projectKey.trim() === '' ? 'WEB' : projectKey.trim();
  const samples = [
    { type: 'feature' as const, key: `${key}-12`, title: BRANCHING_COPY.sample.feature },
    { type: 'bug' as const, key: `${key}-13`, title: BRANCHING_COPY.sample.bug },
  ];
  return samples.map((s) => ({ type: s.type, name: renderOrNull(draft, s) }));
}

function renderOrNull(
  draft: BranchingDraft,
  ticket: { key: string; title: string; type: TicketType },
): string | null {
  if (templateError(draft.template) !== undefined) return null;
  const word = draft.typeWords[ticket.type].trim();
  if (!TYPE_WORD.test(word)) return null;
  try {
    return renderTicketBranchName(
      {
        ticketBranchTemplate: draft.template.trim(),
        typeWords: { ...draft.typeWords, [ticket.type]: word },
      },
      ticket,
    );
  } catch {
    return null;
  }
}
