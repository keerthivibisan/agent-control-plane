import type { BranchStrategy } from '@acp/core';
import type { TicketDetailDto } from '@acp/core/api';
import { useState } from 'react';
import { Button } from '../../components/Button';
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

/**
 * The ticket page's Branch section: the ticket's own branch name and target, or what the
 * project gives, with Change. Once the current run has created its branch (and not discarded
 * it), the actual branch and target are shown instead, read-only.
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

  return (
    <div className="flex flex-col gap-2" data-testid="ticket-branch-settings">
      <div className="flex min-h-7 items-center gap-2">
        <h3 className={heading}>{C.title}</h3>
        {!fixed && draft === null ? (
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
      <p className="text-caption text-dim">{fixed ? C.created : C.note}</p>
      {fixed ? (
        <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1.5">
          <dt className="text-dim">{C.actualBranch}</dt>
          <dd
            className="min-w-0 font-mono font-medium break-all"
            data-testid="ticket-branch-actual"
          >
            {created.branch}
          </dd>
          <dt className="text-dim">{C.actualTarget}</dt>
          <dd className="min-w-0 font-mono break-all" data-testid="ticket-branch-actual-target">
            {created.baseBranch}
          </dd>
        </dl>
      ) : draft === null ? (
        <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1.5">
          <dt className="text-dim">{C.name}</dt>
          <dd className="flex min-w-0" data-testid="ticket-branch-name">
            <Value own={ticket.branch?.name} fallback={name} />
          </dd>
          <dt className="text-dim">{C.target}</dt>
          <dd className="flex min-w-0" data-testid="ticket-branch-target">
            <Value own={ticket.branch?.target} fallback={target} />
          </dd>
        </dl>
      ) : (
        <form
          className="flex flex-col gap-3"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            if (hasTicketBranchErrors(validateTicketBranch(draft))) return;
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
          <div className="flex gap-2">
            <Button
              type="submit"
              variant="primary"
              disabled={save.pending || hasTicketBranchErrors(validateTicketBranch(draft))}
            >
              {save.pending ? C.saving : C.save}
            </Button>
            <Button onClick={() => setDraft(null)} disabled={save.pending}>
              {C.cancel}
            </Button>
          </div>
          <ActionError error={save.error} message={C.failed} />
        </form>
      )}
    </div>
  );
}
