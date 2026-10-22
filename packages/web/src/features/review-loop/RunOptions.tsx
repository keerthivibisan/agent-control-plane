import {
  APPROVAL_MODES,
  ApprovalModeSchema,
  ChangeReviewerModeSchema,
  MAX_REWORK_ROUNDS,
  compactRunOptions,
  type ApprovalMode,
  type RunOptions,
  type TicketRunOptions,
} from '@acp/core';
import type { TicketDto } from '@acp/core/api';
import { useId, useMemo, useState, type ReactNode } from 'react';
import { Button } from '../../components/Button';
import { Details } from '../../components/Details';
import { Dialog } from '../../components/Dialog';
import { InfoTip } from '../../components/InfoTip';
import { hintClass, inputClass, labelClass } from '../../components/Input';
import { updateTicket, workflowGraphPaths, workflowGraphSchemas } from '../../lib/api';
import { REVIEW_LOOP_COPY, TICKET_OPTIONS_COPY, WORKFLOW_LIVE_COPY } from '../../lib/copy';
import { useApiQuery } from '../../lib/query';
import { ActionError } from '../control/bits';
import { useTicketAction } from '../ticket/actions';
import { FullAutoWarning } from './ApprovalsEditor';
import {
  blockModesOf,
  optionsBadge,
  projectRunDefaults,
  runLimitNoEffect,
  runOptionsPatch,
  type BlockModes,
  type NoEffectReason,
} from './logic';

/*
 * A ticket's own run options (RL-H): its approval mode, reviewer and rework rounds, each
 * "Project default" unless the owner sets it. The server resolves run override > ticket > project
 * when a run starts; these screens only show and change the ticket's choice.
 */

const C = TICKET_OPTIONS_COPY;
const M = REVIEW_LOOP_COPY.modes;
const R = REVIEW_LOOP_COPY.review;
const L = WORKFLOW_LIVE_COPY.ceiling;
const ROUNDS: readonly number[] = Array.from({ length: MAX_REWORK_ROUNDS + 1 }, (_, i) => i);
/** The select value meaning "Project default" (nothing stored). */
const DEFAULT = '';

/**
 * The project's workflow graph (`GET /workflow-graph`, the editor's cached query), which answers
 * for every project: a stored graph, or the version 1 or default workflow migrated. The run
 * options read the project's defaults and the blocks' own modes from it (WG-F). `null` skips it.
 */
export function useProjectGraph(projectId: string | null) {
  return useApiQuery(
    projectId === null ? null : workflowGraphPaths.graph(projectId),
    workflowGraphSchemas.graph,
  );
}

/**
 * The project's editing blocks' own modes (ADR-0023), from its workflow graph. Undefined while it
 * loads, and when it can't be read: the screens then say nothing about the blocks.
 */
export function useBlockModes(projectId: string): BlockModes | undefined {
  const q = useProjectGraph(projectId);
  return useMemo(() => (q.data === undefined ? undefined : blockModesOf(q.data)), [q.data]);
}

/** The project's run settings, and what its blocks' own modes are once known (ADR-0023). */
export type RunDefaults = RunOptions & { blocks?: BlockModes | undefined };

/**
 * The project's settings that "Project default" follows, from its cached graph query. Null while
 * loading or when it can't be read: the screens then say "Project default" without a value.
 */
export function useProjectRunDefaults(projectId: string): RunDefaults | null {
  const q = useProjectGraph(projectId);
  return useMemo(
    () =>
      q.data === undefined ? null : { ...projectRunDefaults(q.data), blocks: blockModesOf(q.data) },
    [q.data],
  );
}

/**
 * "No block is set looser than Auto edits, so at most Full auto changes nothing", or the same for
 * a run limit looser than the ticket's own.
 */
export function NoEffectNote({ mode, reason }: { mode: ApprovalMode; reason: NoEffectReason }) {
  return (
    <p
      role="note"
      className="rounded-control border border-line bg-sunken px-3 py-2 text-caption text-dim"
      data-testid="mode-no-effect"
      data-by={reason.by}
    >
      {reason.by === 'ticket'
        ? L.noEffectTicket(M.word[mode], M.word[reason.limit])
        : L.noEffect(M.word[mode], M.word[reason.loosest])}
    </p>
  );
}

function SelectField({
  label,
  hint,
  value,
  onChange,
  children,
}: {
  label: string;
  hint?: string;
  value: string;
  onChange: (value: string) => void;
  children: ReactNode;
}) {
  const id = useId();
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <label htmlFor={id} className={labelClass}>
        {label}
      </label>
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-describedby={hint ? `${id}-hint` : undefined}
        className={inputClass('pr-8')}
      >
        {children}
      </select>
      {hint ? (
        <span id={`${id}-hint`} className={hintClass}>
          {hint}
        </span>
      ) : null}
    </div>
  );
}

/**
 * The three options as selects, each starting with "Project default (<value>)". With `collapse`
 * (the New ticket dialog) the reviewer and rounds sit under "More options".
 */
export function RunOptionsFields({
  value,
  onChange,
  defaults,
  collapse = false,
  more,
}: {
  value: TicketRunOptions;
  onChange: (next: TicketRunOptions) => void;
  defaults: RunDefaults | null;
  collapse?: boolean;
  /** More fields under "More options" with `collapse` (New ticket's branch, ADR-0025). */
  more?: ReactNode;
}) {
  const set = (patch: TicketRunOptions) => onChange(compactRunOptions({ ...value, ...patch }));
  const blocks = defaults?.blocks;
  // A ticket's own limit: only the blocks can make it change nothing.
  const noEffect =
    value.approvalMode === undefined
      ? null
      : runLimitNoEffect(value.approvalMode, blocks, undefined);
  const review = (
    <div className="grid gap-4 sm:grid-cols-2">
      <SelectField
        label={C.reviewer}
        hint={L.ticketReviewerHint}
        value={value.reviewer ?? DEFAULT}
        onChange={(v) =>
          set({ reviewer: v === DEFAULT ? undefined : ChangeReviewerModeSchema.parse(v) })
        }
      >
        <option value={DEFAULT}>
          {C.projectDefault(defaults === null ? null : R.reviewerWord[defaults.reviewer])}
        </option>
        {(['agent', 'lead'] as const).map((r) => (
          <option key={r} value={r}>
            {R.reviewerWord[r]}
          </option>
        ))}
      </SelectField>
      <SelectField
        label={C.rounds}
        hint={L.ticketRoundsHint}
        value={value.maxReworkRounds === undefined ? DEFAULT : String(value.maxReworkRounds)}
        onChange={(v) => set({ maxReworkRounds: v === DEFAULT ? undefined : Number(v) })}
      >
        <option value={DEFAULT}>
          {C.projectDefault(defaults === null ? null : C.roundsValue(defaults.maxReworkRounds))}
        </option>
        {ROUNDS.map((n) => (
          <option key={n} value={String(n)}>
            {C.roundsValue(n)}
          </option>
        ))}
      </SelectField>
    </div>
  );
  return (
    <div className="flex flex-col gap-3" data-testid="run-options-fields">
      <SelectField
        label={L.legend}
        hint={L.ticketHint}
        value={value.approvalMode ?? DEFAULT}
        onChange={(v) =>
          set({ approvalMode: v === DEFAULT ? undefined : ApprovalModeSchema.parse(v) })
        }
      >
        <option value={DEFAULT}>{L.noLimitOption}</option>
        {APPROVAL_MODES.map((m) => (
          <option key={m} value={m}>
            {M.word[m]}
          </option>
        ))}
      </SelectField>
      {noEffect !== null && value.approvalMode !== undefined ? (
        <NoEffectNote mode={value.approvalMode} reason={noEffect} />
      ) : blocks === undefined && value.approvalMode === 'full-auto' ? (
        // The graph could not be read, so the blocks are unknown: keep Full auto's warning.
        <FullAutoWarning />
      ) : null}
      {collapse ? (
        <Details summary={C.more} testId="run-options-more" defaultOpen={hasReviewOptions(value)}>
          <div className="flex flex-col gap-4">
            {review}
            {more}
          </div>
        </Details>
      ) : (
        review
      )}
    </div>
  );
}

function hasReviewOptions(value: TicketRunOptions): boolean {
  return value.reviewer !== undefined || value.maxReworkRounds !== undefined;
}

/** "Manual · This ticket" or "Project default (Full auto)". */
function OptionValue({ own, word }: { own: string | undefined; word: string | null }) {
  if (own !== undefined) {
    return (
      <span>
        <span className="font-medium text-ink">{own}</span>
        <span className="text-dim"> · {C.section.own}</span>
      </span>
    );
  }
  return <span className="text-dim">{C.projectDefault(word)}</span>;
}

/** The ticket page's Run options: what new runs start with, and a form to change it. */
export function TicketRunOptionsSection({
  ticket,
  heading,
}: {
  ticket: Pick<TicketDto, 'id' | 'projectId' | 'runOptions'>;
  /** The ticket card's heading style. */
  heading: string;
}) {
  const defaults = useProjectRunDefaults(ticket.projectId);
  const save = useTicketAction(updateTicket);
  const [draft, setDraft] = useState<TicketRunOptions | null>(null);
  const own = compactRunOptions(ticket.runOptions);
  const S = C.section;

  // v0.3.0 D-B: in the ticket page's sidebar, a label over each value, and Change edits them in
  // a dialog (the three selects need more room than the sidebar has).
  const row = 'flex min-w-0 flex-col gap-0.5';
  const label = 'text-caption text-dim';
  return (
    <div className="flex flex-col gap-2" data-testid="ticket-run-options">
      <div className="flex min-h-7 items-center gap-1">
        <h3 className={heading}>{S.title}</h3>
        <InfoTip tip={S.note} label={S.title} />
        <Button
          variant="quiet"
          size="sm"
          className="ml-auto"
          aria-label={S.editLabel}
          onClick={() => {
            save.reset();
            setDraft(own);
          }}
        >
          {S.edit}
        </Button>
      </div>
      <dl className="flex flex-col gap-2">
        <div className={row}>
          <dt className={label}>{L.rowLabel}</dt>
          <dd data-testid="run-option-mode">
            {own.approvalMode === undefined ? (
              <span className="text-dim">{L.noLimitOption}</span>
            ) : (
              <OptionValue own={M.word[own.approvalMode]} word={null} />
            )}
          </dd>
        </div>
        <div className={row}>
          <dt className={label}>{C.reviewer}</dt>
          <dd data-testid="run-option-reviewer">
            <OptionValue
              own={own.reviewer === undefined ? undefined : R.reviewerWord[own.reviewer]}
              word={defaults === null ? null : R.reviewerWord[defaults.reviewer]}
            />
          </dd>
        </div>
        <div className={row}>
          <dt className={label}>{C.rounds}</dt>
          <dd data-testid="run-option-rounds">
            <OptionValue
              own={
                own.maxReworkRounds === undefined ? undefined : C.roundsValue(own.maxReworkRounds)
              }
              word={defaults === null ? null : C.roundsValue(defaults.maxReworkRounds)}
            />
          </dd>
        </div>
      </dl>
      {draft !== null ? (
        <Dialog
          title={S.title}
          description={S.note}
          onClose={() => {
            if (!save.pending) setDraft(null);
          }}
          testId="ticket-run-options-dialog"
          wide
        >
          <form
            className="flex flex-col gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              void save.run(ticket.id, { runOptions: runOptionsPatch(draft) }).then((done) => {
                if (done !== null) setDraft(null);
              });
            }}
          >
            <RunOptionsFields value={draft} onChange={setDraft} defaults={defaults} />
            <ActionError error={save.error} message={S.failed} />
            <div className="flex flex-wrap justify-end gap-2">
              <Button onClick={() => setDraft(null)} disabled={save.pending}>
                {S.cancel}
              </Button>
              <Button type="submit" variant="primary" disabled={save.pending}>
                {save.pending ? S.saving : S.save}
              </Button>
            </div>
          </form>
        </Dialog>
      ) : null}
    </div>
  );
}

/**
 * The board card's chip when the ticket's options differ from the project's ("Manual"). It asks
 * for the project's settings only for a ticket with options of its own (one cached request).
 */
export function RunOptionsBadge({
  ticket,
}: {
  ticket: Pick<TicketDto, 'projectId' | 'runOptions'>;
}) {
  const own = compactRunOptions(ticket.runOptions);
  const q = useProjectGraph(Object.keys(own).length > 0 ? ticket.projectId : null);
  // Nothing while the project's settings load, so a chip never flashes; if they can't be read,
  // every option the ticket sets shows.
  if (q.data === undefined && q.error === null) return null;
  const text = optionsBadge(own, q.data === undefined ? null : projectRunDefaults(q.data));
  if (text === null) return null;
  return (
    <span
      data-testid="card-run-options"
      title={C.badge.label(text)}
      className="inline-flex h-5 items-center self-start rounded-[0.3125rem] border border-accent/30 bg-accent-soft px-1.5 text-caption font-medium whitespace-nowrap text-accent"
    >
      <span className="sr-only">{C.badge.label(text)}</span>
      <span aria-hidden="true">{text}</span>
    </span>
  );
}
