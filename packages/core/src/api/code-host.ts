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
  /**
   * ADR-0025 §9: whether the head branch still exists on `origin`, as last read (on the owner's
   * view, Refresh, or after a merge or delete). Null when unknown; absent from servers before it.
   */
  headOnOrigin: z.boolean().nullable().optional(),
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

// ---------------------------------------------------------------- connecting a project (G-E)

/**
 * A GitHub account or organization name: letters, digits and single hyphens, at most 39, not
 * starting or ending with a hyphen (ADR-0025 §7).
 */
export const GitHubOwnerSchema = z
  .string()
  .regex(/^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}$/, 'a GitHub account or organization');
/** A GitHub repository name: letters, digits, `.`, `-`, `_`, at most 100; not `.`, `..` or `*.git`. */
export const GitHubRepoNameSchema = z
  .string()
  .regex(/^[A-Za-z0-9._-]{1,100}$/, 'letters, digits, dots, dashes and underscores')
  .refine((n) => n !== '.' && n !== '..' && !n.toLowerCase().endsWith('.git'), {
    message: 'not ".", ".." or a name ending in .git',
  });

/**
 * POST `/api/projects/:id/code-host/repository` (CSRF; the owner's click only; ADR-0025 §7).
 * Creates the repository on GitHub with the owner's `gh` login and sets it as the project's
 * `origin`; with `push`, pushes the project's current branch. Refused (409 `origin_exists`) when
 * the project already has an `origin`. Answers the new `CodeHostStatusDto`.
 */
export const CreateRepositoryRequestSchema = z.object({
  name: GitHubRepoNameSchema,
  /** Absent: the logged-in account. */
  owner: GitHubOwnerSchema.optional(),
  visibility: z.enum(['private', 'public']),
  push: z.boolean(),
});
export type CreateRepositoryRequest = z.infer<typeof CreateRepositoryRequestSchema>;

/**
 * POST `/api/projects/:id/code-host/remote` (CSRF; the owner's click only; ADR-0025 §7). Sets an
 * existing GitHub repository as the project's `origin` (`owner/name`, an `https://github.com/…`
 * address or `git@github.com:…`; see `parseGitHubRepository`). Nothing is pushed. Refused (409
 * `origin_exists`) when the project already has an `origin`. Answers the new `CodeHostStatusDto`.
 */
export const ConnectRepositoryRequestSchema = z.object({
  repository: z.string().trim().min(3).max(300),
});
export type ConnectRepositoryRequest = z.infer<typeof ConnectRepositoryRequestSchema>;

export interface GitHubRepository {
  owner: string;
  name: string;
  /** How `origin` is written: `https://github.com/<owner>/<name>.git` or `git@github.com:…`. */
  protocol: 'https' | 'ssh';
}

/**
 * Reads what the owner typed as a GitHub repository; null when it is not one. Only `github.com`,
 * never a user, password, port, query or extra path, so the `origin` the app writes is exactly
 * `https://github.com/<owner>/<name>.git` (or the `git@github.com:` form the owner chose).
 */
export function parseGitHubRepository(input: string): GitHubRepository | null {
  const text = input.trim();
  const forms: { re: RegExp; protocol: GitHubRepository['protocol'] }[] = [
    { re: /^([^/\s:@]+)\/([^/\s:@]+?)(?:\.git)?$/, protocol: 'https' },
    {
      re: /^https:\/\/github\.com\/([^/\s:@?#]+)\/([^/\s:@?#]+?)(?:\.git)?\/?$/,
      protocol: 'https',
    },
    { re: /^git@github\.com:([^/\s:@]+)\/([^/\s:@]+?)(?:\.git)?$/, protocol: 'ssh' },
  ];
  for (const { re, protocol } of forms) {
    const m = re.exec(text);
    if (m === null) continue;
    const owner = GitHubOwnerSchema.safeParse(m[1]);
    const name = GitHubRepoNameSchema.safeParse(m[2]);
    if (owner.success && name.success) return { owner: owner.data, name: name.data, protocol };
    return null;
  }
  return null;
}

/** The `origin` address the app writes for a repository. */
export function gitHubRemoteUrl(repo: GitHubRepository): string {
  return repo.protocol === 'ssh'
    ? `git@github.com:${repo.owner}/${repo.name}.git`
    : `https://github.com/${repo.owner}/${repo.name}.git`;
}

// ---------------------------------------------------------------- the project's branches (G-F)

/** One local branch of the project (ADR-0025 §8). */
export const ProjectBranchDtoSchema = z.object({
  name: GitBranchNameSchema,
  commit: GitCommitSchema,
  /** The project's checkout is on this branch. */
  current: z.boolean(),
  /** `origin` has a branch of the same name (from the last fetch); null without an `origin`. */
  onOrigin: z.boolean().nullable(),
});
export type ProjectBranchDto = z.infer<typeof ProjectBranchDtoSchema>;

/** GET `/api/projects/:id/branches`: the project's local branches, read from git when asked. */
export const ProjectBranchesDtoSchema = z.object({
  /** The checkout's branch; null on a detached HEAD or an unborn branch. */
  current: GitBranchNameSchema.nullable(),
  /** Whether the project has an `origin` remote (of any host). */
  hasOrigin: z.boolean(),
  /** Sorted by name; at most 500 (`truncated` when there were more). */
  branches: z.array(ProjectBranchDtoSchema).max(500),
  truncated: z.boolean(),
});
export type ProjectBranchesDto = z.infer<typeof ProjectBranchesDtoSchema>;

/**
 * POST `/api/projects/:id/branches` (CSRF; the owner's click only; ADR-0025 §8). Creates the local
 * branch `name` at the tip of the local branch `from`, without switching the checkout; with `push`,
 * pushes it to `origin`. Refused: 409 `branch_exists`, 404 `base_branch_missing`, 409 `no_origin`
 * (push without an `origin`). Answers the new `ProjectBranchesDto`.
 */
export const CreateBranchRequestSchema = z.object({
  name: GitBranchNameSchema,
  from: GitBranchNameSchema,
  push: z.boolean().optional(),
});
export type CreateBranchRequest = z.infer<typeof CreateBranchRequestSchema>;

// ---------------------------------------------------------------- merging and deleting (G-G)

export const PullRequestMergeMethodSchema = z.enum(['merge', 'squash', 'rebase']);
export type PullRequestMergeMethod = z.infer<typeof PullRequestMergeMethodSchema>;

/**
 * POST `/api/tickets/:id/branch/pull-request/merge` (CSRF; the owner's click only; ADR-0025 §9).
 * Merges the ticket's open pull request on GitHub with `method`; with `deleteBranch`, GitHub
 * deletes the head branch and the app deletes its local ticket branch. Answers the ticket branch.
 */
export const MergePullRequestRequestSchema = z.object({
  method: PullRequestMergeMethodSchema,
  deleteBranch: z.boolean(),
});
export type MergePullRequestRequest = z.infer<typeof MergePullRequestRequestSchema>;
