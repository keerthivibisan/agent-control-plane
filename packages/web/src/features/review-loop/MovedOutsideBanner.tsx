import type { TicketBranchDto } from '@acp/core/api';
import { AlertIcon } from '../../components/icons';
import { resetTicketBranch } from '../../lib/api';
import { BRANCH_GUARD_COPY } from '../../lib/copy';
import { ActionError, ConfirmAction } from '../control/bits';
import { useTicketAction } from '../ticket/actions';

const C = BRANCH_GUARD_COPY;

/** A commit id as the page shows it. */
export const shortCommit = (commit: string): string => commit.slice(0, 7);

/**
 * F-1: the open ticket branch points at a commit the app did not record (it was changed outside
 * the app, for example by a helper that committed on it). The owner sees where it is now and the
 * last reviewed commit, and can move it back (compare-and-swap from the tip shown here). Nothing
 * when the branch is where the app left it.
 */
export function MovedOutsideBanner({
  runId,
  branch,
}: {
  runId: string;
  branch: Pick<TicketBranchDto, 'branch' | 'headCommit' | 'state' | 'movedOutside'>;
}) {
  const act = useTicketAction(resetTicketBranch);
  const moved = branch.movedOutside;
  if (moved === undefined || branch.state !== 'open') return null;
  const reviewed = shortCommit(branch.headCommit);
  return (
    <div
      role="alert"
      className="flex flex-col gap-2 rounded-control border border-warning/30 bg-warning-soft px-3 py-2"
      data-testid="branch-moved-outside"
    >
      <p className="flex items-start gap-2 text-caption font-medium">
        <AlertIcon size={15} className="mt-0.5 shrink-0 text-warning" />
        <span className="min-w-0">
          {C.movedOutside(branch.branch, shortCommit(moved.tip), reviewed)}
        </span>
      </p>
      <p className="text-caption text-dim">{C.movedHint}</p>
      <ConfirmAction
        label={C.reset}
        question={C.confirmReset(branch.branch, reviewed)}
        confirmLabel={C.confirmResetButton}
        cancelLabel={C.cancel}
        pendingLabel={C.working}
        pending={act.pending}
        onConfirm={() => act.run(runId, moved.tip)}
      />
      <ActionError error={act.error} message={C.failed} />
    </div>
  );
}
