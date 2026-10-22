import type { BranchStrategy } from '@acp/core';
import type { TicketDetailDto } from '@acp/core/api';
import { useState } from 'react';
import { Button } from '../../components/Button';
import { Dialog } from '../../components/Dialog';
import { InfoTip } from '../../components/InfoTip';
import { projectSetupPaths, projectSetupSchemas, updateTicket } from '../../lib/api';
import { TICKET_BRANCH_COPY } from '../../lib/copy';
import { useApiQuery } from '../../lib/query';
import { ActionError } from '../control/bits';
import { TextField } from '../project-setup/fields';
import { useTicketAction } from '../ticket/actions';
import {
  draftFromPrefs,
  hasTicketBranchErrors,
  projectBranchName,
  projectTarget,
  ticketBranchPatch,
  validateTicketBranch,
  type TicketBranchDraft,
} from './ticket-branch';

const C = TICKET_BRANCH_COPY;

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
 * The two fields (ADR-0025 §4), validated as typed. Placeholders show what an empty field
 * follows: the name the project would give and its target branch.
 */
export function TicketBranchInputs({
  draft,
  onChange,
  namePlaceholder,
  targetPlaceholder,
}: {
  draft: TicketBranchDraft;
  onChange: (next: TicketBranchDraft) => void;
  namePlaceholder: string | null;
  targetPlaceholder: string | null;
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
      <TextField
        label={C.target}
        hint={C.targetHint}
        error={errors.target}
        value={draft.target}
        onChange={(v) => onChange({ ...draft, target: v })}
        placeholder={targetPlaceholder ?? undefined}
        mono
      />
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
