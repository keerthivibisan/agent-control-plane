import {
  APPROVAL_MODES,
  MAX_REWORK_ROUNDS,
  approvalsOf,
  reviewStageOf,
  type ApprovalMode,
  type ChangeReviewerMode,
} from '@acp/core';
import type { StartTicketRequest } from '@acp/core/api';
import { useId, useState } from 'react';
import { Button } from '../../components/Button';
import { Dialog } from '../../components/Dialog';
import { LoadingBlock } from '../../components/Skeleton';
import { workflowPaths, workflowSchemas, type ApiError } from '../../lib/api';
import { REVIEW_LOOP_COPY } from '../../lib/copy';
import { useApiQuery } from '../../lib/query';
import { ActionError } from '../control/bits';
import { ChoiceCards, NumberChoice } from '../project-setup/fields';
import { AutoRunWarning } from './ApprovalsEditor';
import { startRequest, type StartChoice } from './logic';

const S = REVIEW_LOOP_COPY.start;
const M = REVIEW_LOOP_COPY.modes;
const R = REVIEW_LOOP_COPY.review;
const ROUNDS: readonly number[] = Array.from({ length: MAX_REWORK_ROUNDS + 1 }, (_, i) => i);
const MODE_RANK: Readonly<Record<ApprovalMode, number>> = { manual: 0, 'auto-edits': 1, auto: 2 };

/** "Auto edits (recommended) · Project setting": the project's own choice is marked. */
function marked(label: string, isDefault: boolean): string {
  return isDefault ? `${label} · ${S.projectDefault}` : label;
}

/**
 * Start (or Re-run) with options (ADR-0021 §1, §3): this run's approval mode, reviewer and rework
 * rounds, each starting at the project's setting. Only what the owner changes is sent
 * (`StartTicketRequest`), so starting without a change is the plain Start. If the project's
 * settings can't be read, Start still works and the run takes them as they are.
 */
export function StartDialog({
  projectId,
  ticketKey,
  kind,
  pending,
  error,
  onStart,
  onClose,
}: {
  projectId: string;
  ticketKey: string;
  kind: 'start' | 'rerun';
  pending: boolean;
  error: ApiError | null;
  onStart: (request: StartTicketRequest) => void;
  onClose: () => void;
}) {
  const q = useApiQuery(workflowPaths.workflow(projectId), workflowSchemas.workflow);
  const [picked, setPicked] = useState<Partial<StartChoice>>({});
  const name = useId();
  const dto = q.data;
  const defaults: StartChoice | null =
    dto === undefined
      ? null
      : {
          approvalMode: approvalsOf(dto.setup).mode,
          reviewer: reviewStageOf(dto.workflow).reviewer,
          maxReworkRounds: reviewStageOf(dto.workflow).maxReworkRounds,
        };
  const choice: StartChoice | null = defaults === null ? null : { ...defaults, ...picked };
  const request: StartTicketRequest =
    choice === null || defaults === null ? {} : startRequest(choice, defaults);
  const changed = Object.keys(request).length;
  const wider =
    choice !== null &&
    defaults !== null &&
    MODE_RANK[choice.approvalMode] > MODE_RANK[defaults.approvalMode];

  return (
    <Dialog
      title={kind === 'rerun' ? S.rerunTitle(ticketKey) : S.title(ticketKey)}
      description={S.description}
      onClose={onClose}
      closeLabel={S.cancel}
      testId="start-dialog"
      wide
    >
      <form
        noValidate
        className="flex flex-col gap-5"
        onSubmit={(e) => {
          e.preventDefault();
          onStart(request);
        }}
      >
        {choice === null || defaults === null ? (
          q.error !== null ? (
            <p className="rounded-control border border-line bg-sunken px-3 py-2.5 text-dim">
              {S.loadFailed}
            </p>
          ) : (
            <LoadingBlock label={S.loading} />
          )
        ) : (
          <>
            <ChoiceCards<ApprovalMode>
              legend={S.mode}
              name={`${name}-mode`}
              value={choice.approvalMode}
              columns={1}
              options={APPROVAL_MODES.map((m) => ({
                value: m,
                label: marked(M.label[m], m === defaults.approvalMode),
                hint: M.hint[m],
              }))}
              onChange={(approvalMode) => setPicked((p) => ({ ...p, approvalMode }))}
            />
            {wider ? <AutoRunWarning /> : null}
            <ChoiceCards<ChangeReviewerMode>
              legend={S.reviewer}
              name={`${name}-reviewer`}
              value={choice.reviewer}
              options={(['agent', 'lead'] as const).map((r) => ({
                value: r,
                label: marked(R.reviewer[r], r === defaults.reviewer),
                hint: R.reviewerHint[r],
              }))}
              onChange={(reviewer) => setPicked((p) => ({ ...p, reviewer }))}
            />
            <NumberChoice
              legend={S.rounds}
              hint={`${S.projectRounds(defaults.maxReworkRounds)} ${R.roundsHint}`}
              name={`${name}-rounds`}
              value={choice.maxReworkRounds}
              choices={ROUNDS}
              onChange={(maxReworkRounds) => setPicked((p) => ({ ...p, maxReworkRounds }))}
              valueText={R.roundsValue}
            />
          </>
        )}
        <ActionError error={error} message={REVIEW_LOOP_COPY.start.failed} />
        <div className="-mx-5 -mb-5 flex flex-wrap items-center gap-2 rounded-b-card border-t border-line bg-sunken/40 px-5 py-3">
          <span className="mr-auto text-caption text-dim" data-testid="start-dialog-summary">
            {defaults === null ? null : changed === 0 ? S.unchanged : S.changed(changed)}
          </span>
          <Button onClick={onClose} disabled={pending}>
            {S.cancel}
          </Button>
          <Button type="submit" variant="primary" disabled={pending} data-autofocus>
            {pending ? S.starting : kind === 'rerun' ? S.rerunSubmit : S.submit}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
