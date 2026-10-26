import { GitBranchNameSchema, GitCommitSchema } from '@acp/core';
import type { CreateBranchRequest, ProjectBranchDto, ProjectBranchesDto } from '@acp/core/api';
import { silentLogger, type Logger } from '../logger.js';
import { GitCommandError, SAFE_GIT_CONFIG, type GitRunner } from '../workspace/index.js';
import { CodeHostError, MESSAGES } from './errors.js';

/**
 * A project's local branches (ADR-0025 §8): listed with `git for-each-ref` when asked, and
 * created only on the owner's click with `git branch --no-track <name> refs/heads/<from>`. The
 * checkout is never switched, no file or index entry changes, and an existing branch is never
 * moved. Every git call is an argument array with hooks disabled (`SAFE_GIT_CONFIG`); git's own
 * output is only parsed (ref names and commit ids), never shown or logged.
 */

/** The most branches one answer lists (the contract's limit); `truncated` says there were more. */
export const MAX_BRANCHES = 500;

export interface ProjectBranches {
  list(projectRoot: string): Promise<ProjectBranchesDto>;
  /** Creates (and, with `push`, pushes) the branch; answers the fresh list. */
  create(projectRoot: string, input: CreateBranchRequest): Promise<ProjectBranchesDto>;
}

export interface ProjectBranchesDeps {
  git: GitRunner;
  /** The code host's hook-free push (`--no-verify`, `refs/heads/<b>:refs/heads/<b>`). */
  push: (projectRoot: string, branch: string) => Promise<void>;
  logger?: Logger;
}

interface RefRow {
  name: string;
  commit: string;
}

export function createProjectBranches(deps: ProjectBranchesDeps): ProjectBranches {
  const logger = deps.logger ?? silentLogger;
  const run = (projectRoot: string, args: readonly string[]) =>
    deps.git([...SAFE_GIT_CONFIG, ...args], { cwd: projectRoot });

  /** stdout of a git call that may fail; null on a non-zero exit. */
  async function probe(projectRoot: string, args: readonly string[]): Promise<string | null> {
    try {
      return (await run(projectRoot, args)).stdout;
    } catch (error) {
      if (error instanceof GitCommandError) return null;
      throw error;
    }
  }

  /** `git remote` lists `origin`; refuses a folder that is not a git repository. */
  async function hasOrigin(projectRoot: string): Promise<boolean> {
    const out = await probe(projectRoot, ['remote']);
    if (out === null) throw new CodeHostError('not_a_git_repository', MESSAGES.notGitRepository);
    return out.split('\n').some((l) => l.trim() === 'origin');
  }

  /** The commit of `refs/heads/<name>`, or null when there is no such local branch. */
  async function localTip(projectRoot: string, name: string): Promise<string | null> {
    const out = await probe(projectRoot, [
      'rev-parse',
      '--verify',
      '--quiet',
      `refs/heads/${name}^{commit}`,
    ]);
    const tip = out?.trim() ?? '';
    return GitCommitSchema.safeParse(tip).success ? tip : null;
  }

  /** The refs under `prefix` (name without its first `strip` parts → commit), sorted by name. */
  async function refs(
    projectRoot: string,
    prefix: string,
    strip: number,
    limit?: number,
  ): Promise<RefRow[]> {
    const { stdout } = await run(projectRoot, [
      'for-each-ref',
      '--sort=refname',
      ...(limit === undefined ? [] : [`--count=${limit}`]),
      `--format=%(refname:strip=${strip})%00%(objectname)`,
      prefix,
    ]);
    const rows: RefRow[] = [];
    for (const line of stdout.split('\n')) {
      const [name, commit] = line.split('\0');
      if (name === undefined || commit === undefined) continue;
      rows.push({ name, commit: commit.trim() });
    }
    return rows;
  }

  async function list(projectRoot: string): Promise<ProjectBranchesDto> {
    const origin = await hasOrigin(projectRoot);
    const heads = await refs(projectRoot, 'refs/heads', 2, MAX_BRANCHES + 1);
    const truncated = heads.length > MAX_BRANCHES;
    // `refs/remotes/origin/*` as of the owner's last fetch: the app never fetches for this list.
    const remote = origin
      ? new Set((await refs(projectRoot, 'refs/remotes/origin', 3)).map((r) => r.name))
      : null;
    const symbolic = await probe(projectRoot, ['symbolic-ref', '--quiet', '--short', 'HEAD']);
    const name = symbolic?.trim() ?? '';
    // Null on a detached HEAD, and on an unborn branch (HEAD names a branch with no commit yet).
    const current =
      GitBranchNameSchema.safeParse(name).success && (await localTip(projectRoot, name)) !== null
        ? name
        : null;
    const branches: ProjectBranchDto[] = [];
    for (const head of heads.slice(0, MAX_BRANCHES)) {
      // A name outside the app's safe subset (or an odd object) is left out, not guessed at.
      if (!GitBranchNameSchema.safeParse(head.name).success) continue;
      if (!GitCommitSchema.safeParse(head.commit).success) continue;
      branches.push({
        name: head.name,
        commit: head.commit,
        current: head.name === current,
        onOrigin: remote === null ? null : remote.has(head.name),
      });
    }
    return { current, hasOrigin: origin, branches, truncated };
  }

  return {
    list,

    async create(projectRoot, input) {
      const name = GitBranchNameSchema.parse(input.name);
      const from = GitBranchNameSchema.parse(input.from);
      const push = input.push === true;
      const origin = await hasOrigin(projectRoot);
      // git's own rule as well as the app's (`--branch` also expands `@{-1}`, so the answer must
      // be the name itself).
      const checked = await probe(projectRoot, ['check-ref-format', '--branch', name]);
      if (checked?.trim() !== name) {
        throw new CodeHostError('invalid_branch_name', MESSAGES.invalidBranchName(name));
      }
      // Everything that can refuse is asked before the branch exists.
      if (push && !origin) throw new CodeHostError('no_origin', MESSAGES.noOrigin);
      if ((await localTip(projectRoot, name)) !== null) {
        throw new CodeHostError('branch_exists', MESSAGES.branchExists(name));
      }
      if ((await localTip(projectRoot, from)) === null) {
        throw new CodeHostError('base_branch_missing', MESSAGES.baseBranchMissing(from));
      }
      try {
        // No `--force`, so git refuses to move a branch that appeared meanwhile; no checkout.
        await run(projectRoot, ['branch', '--no-track', name, `refs/heads/${from}`]);
      } catch (error) {
        if (!(error instanceof GitCommandError)) throw error;
        // The exit code only: git's stderr can quote paths.
        logger.log('info', 'branches.create_failed', { exitCode: error.exitCode });
        if ((await localTip(projectRoot, name)) !== null) {
          throw new CodeHostError('branch_exists', MESSAGES.branchExists(name));
        }
        throw new CodeHostError('branch_create_failed', MESSAGES.branchCreateFailed(name));
      }
      logger.log('info', 'branches.created', { push });
      if (push) {
        try {
          await deps.push(projectRoot, name);
        } catch (error) {
          if (!(error instanceof CodeHostError)) throw error;
          throw new CodeHostError(
            error.code,
            `${MESSAGES.createdNotPushed(name)} ${error.message}`,
          );
        }
      }
      return list(projectRoot);
    },
  };
}
