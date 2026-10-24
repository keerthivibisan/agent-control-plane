import { GitBranchNameSchema } from '@acp/core';
import type { TicketBranchDto } from '@acp/core/api';
import { silentLogger, type Logger } from '../logger.js';
import { GitCommandError, SAFE_GIT_CONFIG, type GitRunner } from '../workspace/index.js';
import { CodeHostError, MESSAGES } from './errors.js';
import { originPushUrl, PUSH_CONFIG } from './push-target.js';

/**
 * Where a finished ticket branch still exists, and deleting it (ADR-0025 §9, G-G). Only on the
 * owner's click, and only the ticket's own branch: never the checkout's current branch (so HEAD,
 * the index and the files never change) and never a branch the caller protects (the target and
 * the project's base). Every git call is an argument array with hooks disabled
 * (`SAFE_GIT_CONFIG`); git's output is only parsed (ref names), never shown or logged.
 *
 * Writes, all on the owner's click: `git push --no-verify <origin's address> --delete
 * refs/heads/<b>` when origin has it (F-2: the address, never the remote name: `push-target.ts`), `git branch -D <b>` in the project, and, when origin no longer has the branch,
 * removing the stale remote-tracking ref `refs/remotes/origin/<b>` (what `git fetch --prune` would
 * do for that one branch), so "on GitHub" reads stay true without a fetch.
 */

export interface TicketBranchPresence {
  /** `refs/heads/<b>` exists in the project. */
  localExists: boolean;
  /** On `origin`: null without an `origin` remote, or when origin could not be asked. */
  onOrigin: boolean | null;
  /** It is the branch the project's checkout is on. */
  current: boolean;
}

/**
 * How to tell whether origin has the branch: `tracking` reads `refs/remotes/origin/<b>` (local,
 * as of the last fetch or the app's own push and delete); `remote` asks origin with
 * `git ls-remote` (a network read, only on the owner's click).
 */
export type OriginRead = 'tracking' | 'remote';

/** The ticket branch DTO with what git says now; unchanged when that could not be read. */
export function withPresence(
  dto: TicketBranchDto,
  presence: TicketBranchPresence | null,
): TicketBranchDto {
  if (presence === null) return dto;
  const pr = dto.pullRequest ?? null;
  return {
    ...dto,
    localExists: presence.localExists,
    ...(pr !== null && { pullRequest: { ...pr, headOnOrigin: presence.onOrigin } }),
  };
}

export type LocalDeleteOutcome = 'deleted' | 'absent' | 'checked-out' | 'failed';

export interface TicketBranchGit {
  presence(projectRoot: string, branch: string, read: OriginRead): Promise<TicketBranchPresence>;
  /** Deletes the branch on origin (when there) and in the project; answers what is left. */
  remove(
    projectRoot: string,
    branch: string,
    protect: readonly string[],
  ): Promise<TicketBranchPresence>;
  /** After a merge with "Delete branch": `git branch -D` unless it is checked out; never throws. */
  removeLocal(projectRoot: string, branch: string): Promise<LocalDeleteOutcome>;
}

export function createTicketBranchGit(deps: { git: GitRunner; logger?: Logger }): TicketBranchGit {
  const logger = deps.logger ?? silentLogger;
  const run = (projectRoot: string, args: readonly string[]) =>
    deps.git([...SAFE_GIT_CONFIG, ...args], { cwd: projectRoot });

  async function probe(projectRoot: string, args: readonly string[]): Promise<string | null> {
    try {
      return (await run(projectRoot, args)).stdout;
    } catch (error) {
      if (error instanceof GitCommandError) return null;
      throw error;
    }
  }

  function checked(branch: string): string {
    if (!GitBranchNameSchema.safeParse(branch).success) {
      throw new CodeHostError('branch_delete_failed', 'The ticket branch is not a valid name');
    }
    return branch;
  }

  async function hasOrigin(projectRoot: string): Promise<boolean> {
    const out = await probe(projectRoot, ['remote']);
    return out !== null && out.split('\n').some((l) => l.trim() === 'origin');
  }

  /** Which of the two refs exist, in one call (patterns match by prefix: compare exactly). */
  async function refsOf(projectRoot: string, b: string) {
    const local = `refs/heads/${b}`;
    const tracking = `refs/remotes/origin/${b}`;
    const out = (await probe(projectRoot, ['for-each-ref', '--format=%(refname)', local, tracking]))
      ?.split('\n')
      .map((l) => l.trim());
    return { local: out?.includes(local) ?? false, tracking: out?.includes(tracking) ?? false };
  }

  async function isCurrent(projectRoot: string, b: string): Promise<boolean> {
    const out = await probe(projectRoot, ['symbolic-ref', '--quiet', '--short', 'HEAD']);
    return out?.trim() === b;
  }

  /** `git ls-remote --heads origin refs/heads/<b>`: null when origin could not be asked. */
  async function askOrigin(projectRoot: string, b: string): Promise<boolean | 'timeout' | null> {
    try {
      const { stdout } = await run(projectRoot, [
        'ls-remote',
        '--heads',
        'origin',
        `refs/heads/${b}`,
      ]);
      return stdout.split('\n').some((l) => l.split('\t')[1]?.trim() === `refs/heads/${b}`);
    } catch (error) {
      if (!(error instanceof GitCommandError)) throw error;
      logger.log('info', 'code_host.ls_remote_failed', { exitCode: error.exitCode });
      return error.exitCode === null ? 'timeout' : null;
    }
  }

  /** Origin has no such branch: drop the stale tracking ref, if any (never another ref). */
  async function pruneTracking(projectRoot: string, b: string): Promise<void> {
    if ((await refsOf(projectRoot, b)).tracking) {
      await probe(projectRoot, ['update-ref', '-d', `refs/remotes/origin/${b}`]);
    }
  }

  async function presence(
    projectRoot: string,
    branch: string,
    read: OriginRead,
  ): Promise<TicketBranchPresence> {
    const b = checked(branch);
    const origin = await hasOrigin(projectRoot);
    let onOrigin: boolean | null = null;
    if (origin && read === 'remote') {
      const asked = await askOrigin(projectRoot, b);
      onOrigin = typeof asked === 'boolean' ? asked : null;
      if (onOrigin === false) await pruneTracking(projectRoot, b);
    }
    const refs = await refsOf(projectRoot, b);
    if (origin && read === 'tracking') onOrigin = refs.tracking;
    return { localExists: refs.local, onOrigin, current: await isCurrent(projectRoot, b) };
  }

  /** `git branch -D <b>`; on a failure, whether another worktree has it checked out. */
  async function deleteLocal(
    projectRoot: string,
    b: string,
  ): Promise<'deleted' | 'elsewhere' | 'failed'> {
    try {
      await run(projectRoot, ['branch', '-D', b]);
      return 'deleted';
    } catch (error) {
      if (!(error instanceof GitCommandError)) throw error;
      logger.log('info', 'code_host.branch_delete_failed', { exitCode: error.exitCode });
      const list = await probe(projectRoot, ['worktree', 'list', '--porcelain']);
      const elsewhere = (list ?? '').split('\n').some((l) => l.trim() === `branch refs/heads/${b}`);
      return elsewhere ? 'elsewhere' : 'failed';
    }
  }

  return {
    presence,

    async remove(projectRoot, branch, protect) {
      const b = checked(branch);
      if (protect.includes(b)) {
        throw new CodeHostError('branch_protected', MESSAGES.branchProtected(b));
      }
      if (await isCurrent(projectRoot, b)) {
        throw new CodeHostError('branch_checked_out', MESSAGES.branchCheckedOut(b));
      }
      // Origin first: when it refuses, the project keeps its copy and the owner can try again.
      const origin = await hasOrigin(projectRoot);
      let remoteDone = false;
      if (origin) {
        const asked = await askOrigin(projectRoot, b);
        if (asked === 'timeout') {
          throw new CodeHostError('timeout', MESSAGES.remoteUnreadable(b));
        }
        if (asked === null) {
          throw new CodeHostError('branch_delete_failed', MESSAGES.remoteUnreadable(b));
        }
        if (asked) {
          // F-2: origin's own address, never the remote name (a planted pushurl is never used).
          const url = await originPushUrl(deps.git, projectRoot).catch((error: unknown) => {
            if (!(error instanceof CodeHostError)) throw error;
            throw new CodeHostError('branch_delete_failed', error.message);
          });
          try {
            await run(projectRoot, [
              ...PUSH_CONFIG,
              'push',
              '--no-verify',
              url,
              '--delete',
              `refs/heads/${b}`,
            ]);
            remoteDone = true;
          } catch (error) {
            if (!(error instanceof GitCommandError)) throw error;
            // Codes only: git's stderr can quote the remote URL and a user.
            logger.log('info', 'code_host.remote_delete_failed', { exitCode: error.exitCode });
            if (error.exitCode === null) {
              throw new CodeHostError('timeout', MESSAGES.remoteDeleteTimeout(b));
            }
            throw new CodeHostError('branch_delete_failed', MESSAGES.remoteDeleteFailed(b));
          }
        }
        await pruneTracking(projectRoot, b);
      }
      if ((await refsOf(projectRoot, b)).local) {
        const outcome = await deleteLocal(projectRoot, b);
        if (outcome === 'elsewhere') {
          throw new CodeHostError('branch_checked_out', MESSAGES.branchCheckedOutElsewhere(b));
        }
        if (outcome === 'failed') {
          throw new CodeHostError(
            'branch_delete_failed',
            MESSAGES.localDeleteFailed(b, remoteDone),
          );
        }
      }
      logger.log('info', 'code_host.ticket_branch_deleted', { onOrigin: remoteDone });
      return presence(projectRoot, b, 'tracking');
    },

    async removeLocal(projectRoot, branch) {
      const b = checked(branch);
      if (!(await refsOf(projectRoot, b)).local) return 'absent';
      if (await isCurrent(projectRoot, b)) return 'checked-out';
      const outcome = await deleteLocal(projectRoot, b);
      return outcome === 'deleted' ? 'deleted' : outcome === 'elsewhere' ? 'checked-out' : 'failed';
    },
  };
}
