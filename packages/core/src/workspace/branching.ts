import { z } from 'zod';

/**
 * Branching strategies and ticket branch names (ADR-0025). Pure: no git and no I/O. The server
 * names a ticket's branch from its project's strategy (or the ticket's own name) when the plan is
 * approved, and creates it from the ticket's target branch.
 */

/**
 * A branch name the app may create, push or open a pull request from: a safe subset of `git
 * check-ref-format --branch`. ASCII letters, digits, `.`, `_`, `-` and `/` only (so nothing a
 * shell, a URL or a terminal could misread); no empty or dot-led path parts, no `..`, `@{` or
 * `.lock` ending; never starts with `-`, is `HEAD` or starts with `refs/`. Argument arrays are still used everywhere (ADR-0013).
 */
export const GitBranchNameSchema = z
  .string()
  .min(1)
  .max(200)
  .refine(isSafeBranchName, 'letters, digits, ".", "_", "-" and "/" in a valid git branch name');
export type GitBranchName = z.infer<typeof GitBranchNameSchema>;

export function isSafeBranchName(name: string): boolean {
  if (name.length === 0 || name.length > 200) return false;
  if (!/^[A-Za-z0-9._/-]+$/.test(name)) return false;
  if (name.startsWith('-') || name.endsWith('.') || name.endsWith('.lock')) return false;
  if (name.includes('..') || name.includes('@{')) return false;
  // Allowed by git, but they would name something else in a command line or a ref path.
  if (name === 'HEAD' || name.startsWith('refs/')) return false;
  return name.split('/').every((part) => part.length > 0 && !part.startsWith('.'));
}

export const BranchStrategyPresetSchema = z.enum(['github-flow', 'git-flow', 'custom']);
export type BranchStrategyPreset = z.infer<typeof BranchStrategyPresetSchema>;

/** The tokens a ticket branch template may use. */
export const BRANCH_TEMPLATE_TOKENS = ['{key}', '{slug}', '{type}'] as const;

/**
 * A ticket type's word in a branch name (`{type}`), e.g. `feature` or `fix`. Lowercase, so a
 * template like `{type}/{key}-{slug}` gives `fix/WEB-13-login-crash`.
 */
const TypeWordSchema = z.string().regex(/^[a-z][a-z0-9-]{0,19}$/, 'lowercase word (up to 20)');

/** A template with only known tokens, which renders to a safe branch name for a sample ticket. */
export const BranchTemplateSchema = z
  .string()
  .trim()
  .min(1)
  .max(120)
  .refine(
    (t) =>
      (t.match(/\{[^}]*\}/g) ?? []).every((tok) =>
        (BRANCH_TEMPLATE_TOKENS as readonly string[]).includes(tok),
      ),
    'only {key}, {slug} and {type}',
  )
  .refine((t) => t.includes('{key}'), 'must include {key}, so every ticket gets its own branch')
  .refine(
    (t) => isSafeBranchName(fillTemplate(t, { key: 'WEB-1', slug: 'sample', type: 'feature' })),
    'must give a valid branch name',
  );

/**
 * A project's branching strategy (ADR-0025 §2). Absent on a project: the behaviour before it,
 * `acp/<KEY>` from the project's current branch, merged locally.
 */
export const BranchStrategySchema = z.object({
  preset: BranchStrategyPresetSchema,
  /** The long-lived branch tickets start from by default (`main`, or `develop` in Git flow). */
  baseBranch: GitBranchNameSchema,
  /** Where a ticket's work is merged or its pull request is raised, unless the ticket says. */
  defaultTargetBranch: GitBranchNameSchema,
  /**
   * ADR-0025 §10: the branch a new ticket branch starts from, unless the ticket says. Absent: the
   * ticket's target branch (the behaviour before it).
   */
  defaultSourceBranch: GitBranchNameSchema.optional(),
  /** E.g. `{type}/{key}-{slug}`. */
  ticketBranchTemplate: BranchTemplateSchema,
  /** `{type}` per ticket type. */
  typeWords: z.object({
    feature: TypeWordSchema,
    bug: TypeWordSchema,
    chore: TypeWordSchema,
    harness: TypeWordSchema,
  }),
});
export type BranchStrategy = z.infer<typeof BranchStrategySchema>;

const TYPE_WORDS: BranchStrategy['typeWords'] = {
  feature: 'feature',
  bug: 'fix',
  chore: 'chore',
  harness: 'chore',
};

/** The presets the project settings offer; `custom` starts from GitHub flow. */
export function branchStrategyPreset(
  preset: BranchStrategyPreset,
  defaultBranch = 'main',
): BranchStrategy {
  if (preset === 'git-flow') {
    return {
      preset,
      baseBranch: 'develop',
      defaultTargetBranch: 'develop',
      ticketBranchTemplate: '{type}/{key}-{slug}',
      typeWords: { ...TYPE_WORDS, bug: 'bugfix' },
    };
  }
  return {
    preset,
    baseBranch: defaultBranch,
    defaultTargetBranch: defaultBranch,
    ticketBranchTemplate: '{type}/{key}-{slug}',
    typeWords: { ...TYPE_WORDS },
  };
}

/**
 * A ticket's own branch settings (ADR-0025 §3). An absent field follows the project's strategy:
 * `name` replaces the template's name, `target` the strategy's default target branch.
 */
export const TicketBranchPrefsSchema = z.object({
  name: GitBranchNameSchema.optional(),
  target: GitBranchNameSchema.optional(),
  /** ADR-0025 §10: the branch this ticket's branch starts from; absent: the project's. */
  from: GitBranchNameSchema.optional(),
});
export type TicketBranchPrefs = z.infer<typeof TicketBranchPrefsSchema>;

/** A change to a ticket's branch settings: a value sets it, `null` back to the project's. */
export const TicketBranchPrefsPatchSchema = z.object({
  name: GitBranchNameSchema.nullable().optional(),
  target: GitBranchNameSchema.nullable().optional(),
  from: GitBranchNameSchema.nullable().optional(),
});
export type TicketBranchPrefsPatch = z.infer<typeof TicketBranchPrefsPatchSchema>;

/** Lowercase ASCII words joined by `-`, at most 40 characters, from a ticket title. */
export function branchSlug(title: string): string {
  const slug = title
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  const cut = slug.slice(0, 40).replace(/-+$/, '');
  return cut.length > 0 ? cut : 'ticket';
}

function fillTemplate(template: string, v: { key: string; slug: string; type: string }): string {
  return template
    .replaceAll('{key}', v.key)
    .replaceAll('{slug}', v.slug)
    .replaceAll('{type}', v.type);
}

/**
 * The branch name for a ticket from a strategy's template. Attempt 0 is the plain name; the server
 * tries 1, 2, … (`…-r1`) when a branch of that name already exists. Throws when the result is not
 * a safe branch name.
 */
export function renderTicketBranchName(
  strategy: Pick<BranchStrategy, 'ticketBranchTemplate' | 'typeWords'>,
  ticket: { key: string; title: string; type: keyof BranchStrategy['typeWords'] },
  attempt = 0,
): string {
  if (!Number.isInteger(attempt) || attempt < 0) throw new RangeError('attempt must be 0 or more');
  const base = fillTemplate(strategy.ticketBranchTemplate, {
    key: ticket.key,
    slug: branchSlug(ticket.title),
    type: strategy.typeWords[ticket.type],
  });
  return GitBranchNameSchema.parse(attempt === 0 ? base : `${base}-r${attempt}`);
}
