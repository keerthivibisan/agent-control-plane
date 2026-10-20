import {
  APPROVAL_MODES,
  MAX_REWORK_ROUNDS,
  compactRunOptions,
  resolveRunOptions,
  type ApprovalMode,
  type ChangeReviewerMode,
  type TicketRunOptions,
} from '@acp/core';
import type { StartTicketRequest } from '@acp/core/api';
import { useId, useState } from 'react';
import { Button } from '../../components/Button';
import { Dialog } from '../../components/Dialog';
import { LoadingBlock } from '../../components/Skeleton';
import { workflowPaths, workflowSchemas, type ApiError } from '../../lib/api';
import { REVIEW_LOOP_COPY, TICKET_OPTIONS_COPY, WORKFLOW_LIVE_COPY } from '../../lib/copy';
import { useApiQuery } from '../../lib/query';
import { ActionError } from '../control/bits';
import { ChoiceCards, NumberChoice } from '../project-setup/fields';
import { AutoRunWarning, FullAutoWarning } from './ApprovalsEditor';
import { projectRunDefaults, runLimitNoEffect, startRequest, type StartChoice } from './logic';
import { NoEffectNote, useBlockModes } from './RunOptions';

const S = REVIEW_LOOP_COPY.start;
const M = REVIEW_LOOP_COPY.modes;
const R = REVIEW_LOOP_COPY.review;
const T = TICKET_OPTIONS_COPY.start;
const L = WORKFLOW_LIVE_COPY.ceiling;
/** The mode choice "No limit": nothing is sent, and each block keeps its own mode (ADR-0023). */
const NO_LIMIT = 'no-limit' as const;
type ModeChoice = ApprovalMode | typeof NO_LIMIT;
const ROUNDS: readonly number[] = Array.from({ length: MAX_REWORK_ROUNDS + 1 }, (_, i) => i);
const MODE_RANK: Readonly<Record<ApprovalMode, number>> = {
  manual: 0,
  'auto-edits': 1,
  auto: 2,
  'full-auto': 3,
};

/**
 * "Auto edits (recommended) · Project setting": the project's own choice is marked, and the
 * ticket's own choice (RL-H) as "This ticket".
 */
function marked(label: string, isDefault: boolean, isTicket = false): string {
  const marks = [...(isTicket ? [T.ticketSetting] : []), ...(isDefault ? [S.projectDefault] : [])];
  return marks.length === 0 ? label : `${label} · ${marks.join(' · ')}`;
}

/**
 * Start (or Re-run) with options (ADR-0021 §1, §3): this run's approval mode, reviewer and rework
 * rounds, each starting at the ticket's own option (RL-H), else the project's setting. Only what
 * the owner changes is sent (`StartTicketRequest`), so starting without a change is the plain
 * Start. If the project's settings can't be read, Start still works and the run takes the
 * ticket's and the project's as they are.
 *
 * ADR-0023: the mode is a limit ("at most"). Each editing block runs with its own mode, and a run
 * or ticket mode can only make it more careful; "No limit" (nothing sent) leaves every block as
 * set. With the project's graph known, a limit looser than every block says it changes nothing.
 */
export function StartDialog({
  projectId,
  ticketKey,
  kind,
  pending,
  error,
  onStart,
  onClose,
  ticketOptions,
}: {
  projectId: string;
  ticketKey: string;
  /** RL-H: the ticket's own run options; absent ones follow the project. */
  ticketOptions?: TicketRunOptions | undefined;
  kind: 'start' | 'rerun';
  pending: boolean;
  error: ApiError | null;
  onStart: (request: StartTicketRequest) => void;
  onClose: () => void;
}) {
  const q = useApiQuery(workflowPaths.workflow(projectId), workflowSchemas.workflow);
  const blocks = useBlockModes(projectId);
  const [picked, setPicked] = useState<Partial<StartChoice>>({});
  const [pickedMode, setPickedMode] = useState<ModeChoice | null>(null);
  const name = useId();
  const dto = q.data;
  const own = compactRunOptions(ticketOptions);
  const hasOwn = Object.keys(own).length > 0;
  const project: StartChoice | null = dto === undefined ? null : projectRunDefaults(dto);
  // What the run gets without a change: the ticket's own options over the project's (RL-H).
  const defaults: StartChoice | null =
    project === null ? null : resolveRunOptions(project, own).options;
  const choice: StartChoice | null = defaults === null ? null : { ...defaults, ...picked };
  // The ticket's own limit, else none; any mode the owner picks is sent as this run's limit.
  const defaultMode: ModeChoice = own.approvalMode ?? NO_LIMIT;
  const mode: ModeChoice = pickedMode ?? defaultMode;
  const request: StartTicketRequest =
    choice === null || defaults === null
      ? {}
      : {
          ...(mode === defaultMode || mode === NO_LIMIT ? {} : { approvalMode: mode }),
          ...startRequest({ ...choice, approvalMode: defaults.approvalMode }, defaults),
        };
  const changed = Object.keys(request).length;
  const limit: ApprovalMode | null = mode === NO_LIMIT ? null : mode;
  // Each block runs with the strictest of its own mode, the ticket's limit and this run's.
  const noEffect = limit === null ? null : runLimitNoEffect(limit, blocks, own.approvalMode);
  // A server without graphs (no blocks known) still replaces the mode: keep its warnings.
  const wider =
    blocks === undefined &&
    limit !== null &&
    defaults !== null &&
    MODE_RANK[limit] > MODE_RANK[defaults.approvalMode];

  return (
    <Dialog
      title={kind === 'rerun' ? S.rerunTitle(ticketKey) : S.title(ticketKey)}
      description={hasOwn ? T.description : S.description}
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
        {choice === null || defaults === null || project === null ? (
          q.error !== null ? (
            <p className="rounded-control border border-line bg-sunken px-3 py-2.5 text-dim">
              {S.loadFailed}
            </p>
          ) : (
            <LoadingBlock label={S.loading} />
          )
        ) : (
          <>
            <ChoiceCards<ModeChoice>
              legend={L.legend}
              hint={
                <span data-testid="mode-limit-summary">
                  {limit === null ? L.summaryNone : L.summary(M.word[limit])}
                </span>
              }
              name={`${name}-mode`}
              value={mode}
              columns={1}
              options={[
                ...(own.approvalMode === undefined
                  ? [
                      {
                        value: NO_LIMIT,
                        label: L.noLimit,
                        hint: L.noLimitHint(M.word[blocks?.projectMode ?? project.approvalMode]),
                      },
                    ]
                  : []),
                ...APPROVAL_MODES.map((m) => ({
                  value: m,
                  label: marked(M.label[m], false, m === own.approvalMode),
                  hint: M.hint[m],
                })),
              ]}
              onChange={setPickedMode}
            />
            {limit !== null && noEffect !== null ? (
              <NoEffectNote mode={limit} reason={noEffect} />
            ) : blocks === undefined && limit === 'full-auto' ? (
              <FullAutoWarning />
            ) : wider ? (
              <AutoRunWarning />
            ) : null}
            <ChoiceCards<ChangeReviewerMode>
              legend={S.reviewer}
              name={`${name}-reviewer`}
              value={choice.reviewer}
              options={(['agent', 'lead'] as const).map((r) => ({
                value: r,
                label: marked(R.reviewer[r], r === project.reviewer, r === own.reviewer),
                hint: L.reviewerHint[r],
              }))}
              onChange={(reviewer) => setPicked((p) => ({ ...p, reviewer }))}
            />
            <NumberChoice
              legend={S.rounds}
              hint={`${
                own.maxReworkRounds === undefined ? '' : `${T.ticketRounds(own.maxReworkRounds)} `
              }${S.projectRounds(project.maxReworkRounds)} ${L.roundsHint}`}
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
            {defaults === null
              ? null
              : changed === 0
                ? hasOwn
                  ? T.unchanged
                  : S.unchanged
                : hasOwn
                  ? T.changed(changed)
                  : S.changed(changed)}
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
