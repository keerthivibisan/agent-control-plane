import type { BranchStrategy } from '@acp/core';
import type { TicketDetailDto } from '@acp/core/api';
import { useId, useState } from 'react';
import { Button } from '../../components/Button';
import { Dialog } from '../../components/Dialog';
import { InfoTip } from '../../components/InfoTip';
import { hintClass, inputClass, labelClass } from '../../components/Input';
import { projectSetupPaths, projectSetupSchemas, updateTicket } from '../../lib/api';
import { PROJECT_BRANCHES_COPY, TICKET_BRANCH_COPY } from '../../lib/copy';
import { useApiQuery } from '../../lib/query';
import { ActionError } from '../control/bits';
import { TextField } from '../project-setup/fields';
import { useTicketAction } from '../ticket/actions';
import { MissingBranchNote, useProjectBranches } from './Branches';
import {
  draftFromPrefs,
  hasTicketBranchErrors,
  projectBranchName,
  projectSource,
  projectTarget,
  ticketBranchPatch,
  validateTicketBranch,
  type TicketBranchDraft,
} from './ticket-branch';

const C = TICKET_BRANCH_COPY;
const B = PROJECT_BRANCHES_COPY;

export interface BranchDefaults {
  strategy: BranchStrategy | undefined;
  projectKey: string;
}

/**
 * What an empty branch field follows: the project's strategy and key, from its cached setup.
 * Null while loading or when it can't be read; the fields then say "Project default" alone.
 */
export function useBranchDefaults(projectId: string): BranchDefaults | null {
  const q = useApiQuery(projectSetupPaths.setup(projectId), projectSetupSchemas.setup);
  return q.data === undefined
    ? null
    : { strategy: q.data.branching, projectKey: q.data.projectKey };
}

/** The target an empty field follows, in words: the strategy's, or the project folder's branch. */
export function targetWord(defaults: BranchDefaults | null): string | null {
  if (defaults === null) return null;
  return projectTarget(defaults.strategy) ?? C.currentBranch;
}

/** The target field's placeholder: the strategy's target branch, else "Project default". */
export function targetPlaceholder(defaults: BranchDefaults | null): string {
  return (defaults === null ? null : projectTarget(defaults.strategy)) ?? C.projectDefault(null);
}

/**
 * G-H (ADR-0025 §10): where an empty "Start from" follows, in words: the project's start branch,
 * else the target branch.
 */
export function sourceWord(defaults: BranchDefaults | null): string | null {
  if (defaults === null) return null;
  return projectSource(defaults.strategy) ?? C.fromTarget;
}

/** The "Start from" placeholder: "Project default (release/1.0)" or "(the target branch)". */
export function sourcePlaceholder(defaults: BranchDefaults | null): string {
  return C.projectDefault(sourceWord(defaults));
}

/**
 * G-F (ADR-0025 §8): a branch field as a combobox of the project's local branches (a native
 * `<datalist>`, so any name can still be typed), and when the typed branch doesn't exist yet,
 * "Create it" right under it. G-H uses it for "Start from" too.
 */
function BranchCombobox({
  projectId,
  value,
  onChange,
  error,
  placeholder,
  preferredBase,
  label,
  hint,
  testId,
}: {
  projectId: string;
  value: string;
  onChange: (v: string) => void;
  error: string | undefined;
  placeholder: string | null;
  preferredBase: string | undefined;
  label: string;
  hint: string;
  /** `ticket-branch-target` gives `…-input` and `…-missing`. */
  testId: string;
}) {
  const id = useId();
  const branches = useProjectBranches(projectId);
  const typed = value.trim();
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <label htmlFor={id} className={labelClass}>
        {label}
      </label>
      <input
        id={id}
        list={`${id}-list`}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder ?? undefined}
        spellCheck={false}
        autoComplete="off"
        aria-invalid={error !== undefined ? true : undefined}
        aria-describedby={error !== undefined ? `${id}-hint ${id}-error` : `${id}-hint`}
        className={inputClass('font-mono')}
        data-testid={`${testId}-input`}
      />
      <datalist id={`${id}-list`} aria-label={B.targetListLabel}>
        {(branches.data?.branches ?? []).map((b) => (
          <option key={b.name} value={b.name} />
        ))}
      </datalist>
      <span id={`${id}-hint`} className={hintClass}>
        {hint}
      </span>
      {error !== undefined ? (
        <span id={`${id}-error`} role="alert" className="text-caption font-medium text-danger">
          {error}
        </span>
      ) : typed !== '' ? (
        <MissingBranchNote
          key={typed}
          projectId={projectId}
          name={typed}
          preferredBase={preferredBase}
          testId={`${testId}-missing`}
          direct
        />
      ) : null}
    </div>
  );
}

/**
 * The fields (ADR-0025 §4, §10), validated as typed. Placeholders show what an empty field
 * follows: the name the project would give, its target branch and where it starts. With
 * `projectId` (a ticket's branch settings, New ticket), the target and "Start from" offer the
 * project's local branches and can create a missing one.
 */
export function TicketBranchInputs({
  draft,
  onChange,
  namePlaceholder,
  targetPlaceholder,
  fromPlaceholder,
  projectId,
  preferredBase,
}: {
  draft: TicketBranchDraft;
  onChange: (next: TicketBranchDraft) => void;
  namePlaceholder: string | null;
  targetPlaceholder: string | null;
  /** G-H: what an empty "Start from" follows ("Project default (…)"). */
  fromPlaceholder?: string | null | undefined;
  projectId?: string | undefined;
  /** Where a created target starts by default when it exists: the strategy's base branch. */
  preferredBase?: string | undefined;
}) {
  const errors = validateTicketBranch(draft);
  return (
    <div className="grid gap-4 sm:grid-cols-2" data-testid="ticket-branch-fields">
      <TextField
        label={C.name}
        hint={C.nameHint}
        error={errors.name}
        value={draft.name}
        onChange={(v) => onChange({ ...draft, name: v })}
        placeholder={namePlaceholder ?? undefined}
        mono
      />
      {projectId === undefined ? (
        <TextField
          label={C.target}
          hint={C.targetHint}
          error={errors.target}
          value={draft.target}
          onChange={(v) => onChange({ ...draft, target: v })}
          placeholder={targetPlaceholder ?? undefined}
          mono
        />
      ) : (
        <BranchCombobox
          projectId={projectId}
          value={draft.target}
          onChange={(v) => onChange({ ...draft, target: v })}
          error={errors.target}
          placeholder={targetPlaceholder}
          preferredBase={preferredBase}
          label={C.target}
          hint={C.targetHint}
          testId="ticket-branch-target"
        />
      )}
      {projectId === undefined ? (
        <TextField
          label={C.from}
          hint={C.fromHint}
          error={errors.from}
          value={draft.from}
          onChange={(v) => onChange({ ...draft, from: v })}
          placeholder={fromPlaceholder ?? undefined}
          mono
        />
      ) : (
        <BranchCombobox
          projectId={projectId}
          value={draft.from}
          onChange={(v) => onChange({ ...draft, from: v })}
          error={errors.from}
          placeholder={fromPlaceholder ?? null}
          // A missing start branch starts, by default, from the target the ticket goes back to.
          preferredBase={draft.target.trim() || preferredBase}
          label={C.from}
          hint={C.fromHint}
          testId="ticket-branch-from"
        />
      )}
    </div>
  );
}

/** "feature/WEB-12-… · This ticket" or "Project default (feature/WEB-12-…)". */
function Value({ own, fallback }: { own: string | undefined; fallback: string | null }) {
  if (own !== undefined) {
    return (
      <span className="min-w-0 break-all">
        <span className="font-mono font-medium text-ink">{own}</span>
        <span className="text-dim"> · {C.own}</span>
      </span>
    );
  }
  return <span className="min-w-0 break-all text-dim">{C.projectDefault(fallback)}</span>;
}

/** A label over its value, as GitHub's pull request sidebar lists them. */
const ROW = 'flex min-w-0 flex-col gap-0.5';
const LABEL = 'text-caption text-dim';

/**
 * The ticket page's Branch section (in the sidebar since v0.3.0 D-B): the ticket's own branch
 * name and target, or what the project gives, with Change, which edits them in a dialog. Once the
 * current run has created its branch (and not discarded it), the actual branch and target are
 * shown instead, read-only.
 */
export function TicketBranchSection({
  detail,
  heading,
}: {
  detail: Pick<TicketDetailDto, 'ticket' | 'currentRun'>;
  heading: string;
}) {
  const { ticket } = detail;
  const defaults = useBranchDefaults(ticket.projectId);
  const save = useTicketAction(updateTicket);
  const [draft, setDraft] = useState<TicketBranchDraft | null>(null);
  const created = detail.currentRun?.ticketBranch ?? null;
  const fixed = created !== null && created.state !== 'discarded';
  const name = defaults === null ? null : projectBranchName(defaults.strategy, ticket);
  const target = targetWord(defaults);
  const source = sourceWord(defaults);
  const errors = draft === null ? {} : validateTicketBranch(draft);

  return (
    <div className="flex flex-col gap-2" data-testid="ticket-branch-settings">
      <div className="flex min-h-7 items-center gap-1">
        <h3 className={heading}>{C.title}</h3>
        <InfoTip tip={fixed ? C.created : C.note} label={C.title} />
        {!fixed ? (
          <Button
            variant="quiet"
            size="sm"
            className="ml-auto"
            aria-label={C.editLabel}
            onClick={() => {
              save.reset();
              setDraft(draftFromPrefs(ticket.branch));
            }}
          >
            {C.edit}
          </Button>
        ) : null}
      </div>
      {fixed ? (
        <dl className="flex flex-col gap-2">
          <div className={ROW}>
            <dt className={LABEL}>{C.actualBranch}</dt>
            <dd
              className="min-w-0 font-mono font-medium break-all"
              data-testid="ticket-branch-actual"
            >
              {created.branch}
            </dd>
          </div>
          <div className={ROW}>
            <dt className={LABEL}>{C.actualTarget}</dt>
            <dd className="min-w-0 font-mono break-all" data-testid="ticket-branch-actual-target">
              {created.baseBranch}
            </dd>
          </div>
          {created.sourceBranch !== undefined ? (
            <div className={ROW}>
              <dt className={LABEL}>{C.actualFrom}</dt>
              <dd className="min-w-0 font-mono break-all" data-testid="ticket-branch-actual-from">
                {created.sourceBranch}
              </dd>
            </div>
          ) : null}
        </dl>
      ) : (
        <dl className="flex flex-col gap-2">
          <div className={ROW}>
            <dt className={LABEL}>{C.name}</dt>
            <dd className="flex min-w-0" data-testid="ticket-branch-name">
              <Value own={ticket.branch?.name} fallback={name} />
            </dd>
          </div>
          <div className={ROW}>
            <dt className={LABEL}>{C.target}</dt>
            <dd className="flex min-w-0" data-testid="ticket-branch-target">
              <Value own={ticket.branch?.target} fallback={target} />
            </dd>
          </div>
          <div className={ROW}>
            <dt className={LABEL}>{C.from}</dt>
            <dd className="flex min-w-0" data-testid="ticket-branch-from">
              <Value own={ticket.branch?.from} fallback={source} />
            </dd>
          </div>
        </dl>
      )}
      {draft !== null ? (
        <Dialog
          title={C.title}
          description={C.note}
          onClose={() => {
            if (!save.pending) setDraft(null);
          }}
          testId="ticket-branch-dialog"
          wide
        >
          <form
            className="flex flex-col gap-4"
            noValidate
            onSubmit={(e) => {
              e.preventDefault();
              if (hasTicketBranchErrors(errors)) return;
              void save.run(ticket.id, { branch: ticketBranchPatch(draft) }).then((done) => {
                if (done !== null) setDraft(null);
              });
            }}
          >
            <TicketBranchInputs
              draft={draft}
              onChange={setDraft}
              namePlaceholder={name}
              targetPlaceholder={targetPlaceholder(defaults)}
              fromPlaceholder={sourcePlaceholder(defaults)}
              projectId={ticket.projectId}
              preferredBase={defaults?.strategy?.baseBranch}
            />
            <ActionError error={save.error} message={C.failed} />
            <div className="flex flex-wrap justify-end gap-2">
              <Button onClick={() => setDraft(null)} disabled={save.pending}>
                {C.cancel}
              </Button>
              <Button
                type="submit"
                variant="primary"
                disabled={save.pending || hasTicketBranchErrors(errors)}
              >
                {save.pending ? C.saving : C.save}
              </Button>
            </div>
          </form>
        </Dialog>
      ) : null}
    </div>
  );
}
