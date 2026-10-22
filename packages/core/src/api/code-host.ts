import { z } from 'zod';
import { IsoTimestampSchema } from '../domain/time.js';
import { GitCommitSchema } from '../orchestration/orchestration.js';
import { GitBranchNameSchema } from '../workspace/branching.js';

/**
 * Code hosting (ADR-0025): GitHub through the owner's own `gh` login, GitLab later through `glab`.
 * The app never reads, stores or sends a token; it pushes and opens pull requests only when the
 * owner clicks, with `git` and the host's CLI as argument arrays (ADR-0013 amendment).
 */

export const CodeHostProviderSchema = z.enum(['github']);
export type CodeHostProvider = z.infer<typeof CodeHostProviderSchema>;

/** GET `/api/projects/:id/code-host`: what the app can do with the project's remote. */
export const CodeHostStatusDtoSchema = z.object({
  /** Null when `origin` is missing or not on a supported host. */
  provider: CodeHostProviderSchema.nullable(),
  /** `owner/name` on the host, from the `origin` URL; never the URL itself (it may hold a user). */
  repo: z.string().min(1).max(200).nullable(),
  /** The host's default branch, when the CLI could tell. */
  defaultBranch: GitBranchNameSchema.nullable(),
  cli: z.object({
    /** E.g. `gh`. */
    name: z.string().min(1),
    installed: z.boolean(),
    /** From the CLI's own status command's exit code only; null when not installed. */
    loggedIn: z.boolean().nullable(),
  }),
  /** Plain words for the owner when something is missing, e.g. "Install the GitHub CLI (gh)". */
  problem: z.string().min(1).max(300).nullable(),
});
export type CodeHostStatusDto = z.infer<typeof CodeHostStatusDtoSchema>;

export const PullRequestStateSchema = z.enum(['open', 'merged', 'closed']);
export type PullRequestState = z.infer<typeof PullRequestStateSchema>;

/** A pull (merge) request raised for a ticket branch. */
export const PullRequestDtoSchema = z.object({
  provider: CodeHostProviderSchema,
  number: z.number().int().positive(),
  url: z.string().url().max(500),
  state: PullRequestStateSchema,
  baseBranch: GitBranchNameSchema,
  headBranch: GitBranchNameSchema,
  /** When the app last read the state from the host (on the owner's view or Refresh). */
  checkedAt: IsoTimestampSchema,
  /**
   * The ticket branch commit the app last pushed (G-A, coordinator-approved additive field): when
   * the branch's `headCommit` differs, there is something new to push. Absent from servers
   * before it; null when unknown.
   */
  pushedCommit: GitCommitSchema.nullable().optional(),
});
export type PullRequestDto = z.infer<typeof PullRequestDtoSchema>;

/**
 * POST `/api/tickets/:id/branch/pull-request` (CSRF; the owner's click only). Pushes the ticket
 * branch to `origin` and opens a pull request against the ticket's target branch. The body is the
 * run summary by default.
 */
export const OpenPullRequestRequestSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  draft: z.boolean().optional(),
});
export type OpenPullRequestRequest = z.infer<typeof OpenPullRequestRequestSchema>;
