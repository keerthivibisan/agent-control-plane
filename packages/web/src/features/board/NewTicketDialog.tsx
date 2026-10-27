import {
  TicketPrioritySchema,
  TicketTypeSchema,
  type TicketPriority,
  type TicketRunOptions,
  type TicketType,
} from '@acp/core';
import type { TicketDto } from '@acp/core/api';
import { useId, useState, type FormEvent, type ReactNode } from 'react';
import { Button } from '../../components/Button';
import { Dialog } from '../../components/Dialog';
import { hintClass, inputClass, labelClass } from '../../components/Input';
import { createTicket, uploadAttachment } from '../../lib/api';
import { useQueryStore } from '../../lib/query';
import { BOARD_COPY, TICKET_PRIORITY_COPY, TICKET_TYPE_COPY } from '../../lib/copy';
import { AttachButton, DropZone, UploadList } from '../attachments/Attachments';
import { useStagedFiles } from '../attachments/use-staged-files';
import type { Upload } from '../attachments/use-uploads';
import { ActionError } from '../control/bits';
import { RunOptionsFields, useProjectRunDefaults } from '../review-loop/RunOptions';
import {
  TicketBranchInputs,
  sourcePlaceholder,
  targetPlaceholder,
  useBranchDefaults,
} from '../branching/TicketBranchFields';
import {
  EMPTY_TICKET_BRANCH,
  hasTicketBranchErrors,
  pendingTicketKey,
  projectBranchName,
  ticketBranchCreate,
  validateTicketBranch,
  type TicketBranchDraft,
} from '../branching/ticket-branch';
import { useBoardAction } from './actions';
import { parseLabels } from './moves';

const C = BOARD_COPY.dialog;
const MAX_TITLE = 200;
const MAX_LABELS = 10;
const MAX_LABEL = 30;
const MAX_DESCRIPTION = 20_000;

interface Errors {
  title?: string;
  labels?: string;
}

/** Plain-sentence validation, mirroring CreateTicketRequestSchema so the server rarely refuses. */
function validate(title: string, labels: string[]): Errors {
  const errors: Errors = {};
  const t = title.trim();
  if (t.length === 0) errors.title = C.titleMissing;
  else if (t.length > MAX_TITLE) errors.title = C.titleTooLong;
  if (labels.length > MAX_LABELS) errors.labels = C.labelsTooMany;
  else if (labels.some((l) => l.length > MAX_LABEL)) errors.labels = C.labelTooLong;
  return errors;
}

function Field({
  id,
  label,
  hint,
  error,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  error?: string | undefined;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className={labelClass}>
        {label}
      </label>
      {children}
      {hint ? (
        <span id={`${id}-hint`} className={hintClass}>
          {hint}
        </span>
      ) : null}
      {error ? (
        <span id={`${id}-error`} role="alert" className="text-caption text-danger">
          {error}
        </span>
      ) : null}
    </div>
  );
}

/**
 * "New ticket": title, type, priority, labels, description, and the ticket's own run options
 * (RL-H; "Project default" unless chosen, reviewer and rounds under "More options") and branch
 * name and target (ADR-0025, also under "More options"). The ticket lands in Backlog.
 */
export function NewTicketDialog({
  projectId,
  onClose,
  onCreated,
}: {
  projectId: string;
  onClose: () => void;
  onCreated: (ticket: TicketDto) => void;
}) {
  const create = useBoardAction(createTicket);
  const store = useQueryStore();
  const staged = useStagedFiles();
  const [uploading, setUploading] = useState<string | null>(null);
  // Set when the ticket exists but some files didn't attach: the owner continues from here.
  const [partial, setPartial] = useState<{ ticket: TicketDto; names: string[] } | null>(null);
  const [title, setTitle] = useState('');
  const [type, setType] = useState<TicketType>('feature');
  const [priority, setPriority] = useState<TicketPriority>('medium');
  const [labels, setLabels] = useState('');
  const [description, setDescription] = useState('');
  const [runOptions, setRunOptions] = useState<TicketRunOptions>({});
  const defaults = useProjectRunDefaults(projectId);
  const [branch, setBranch] = useState<TicketBranchDraft>(EMPTY_TICKET_BRANCH);
  const branchDefaults = useBranchDefaults(projectId);
  const [errors, setErrors] = useState<Errors>({});
  const ids = {
    title: useId(),
    type: useId(),
    priority: useId(),
    labels: useId(),
    description: useId(),
    attachments: useId(),
  };
  const busy = create.pending || uploading !== null;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const parsedLabels = parseLabels(labels);
    const next = validate(title, parsedLabels);
    setErrors(next);
    if (next.title || next.labels || hasTicketBranchErrors(validateTicketBranch(branch))) return;
    const branchPrefs = ticketBranchCreate(branch);
    const ticket = await create.run(projectId, {
      title: title.trim(),
      description,
      type,
      priority,
      labels: parsedLabels,
      // Only what the owner chose: an empty choice follows the project.
      ...(Object.keys(runOptions).length > 0 && { runOptions }),
      ...(branchPrefs !== undefined && { branch: branchPrefs }),
    });
    if (ticket === null) return;
    // The ticket exists now, so a failed file is reported, never a reason to create it again.
    const failed: string[] = [];
    for (const s of staged.valid) {
      setUploading(s.key);
      try {
        await uploadAttachment(store.client, ticket.id, {
          data: s.file,
          name: s.file.name,
          mimeType: s.mimeType,
        });
      } catch {
        failed.push(s.file.name);
      }
    }
    setUploading(null);
    if (failed.length === 0) onCreated(ticket);
    else setPartial({ ticket, names: failed });
  };

  const close = () => {
    if (!busy) onClose();
  };

  const rows: Upload[] = [
    ...staged.valid.map((s) => ({
      key: s.key,
      name: s.file.name,
      sizeBytes: s.file.size,
      status: s.key === uploading ? ('uploading' as const) : ('staged' as const),
      attachment: null,
      error: null,
    })),
    ...staged.failures.map((f) => ({
      key: f.key,
      name: f.name,
      sizeBytes: f.sizeBytes,
      status: 'failed' as const,
      attachment: null,
      error: f.error,
    })),
  ];
  const locked = busy || partial !== null;

  return (
    <Dialog title={C.title} description={C.description} onClose={close} testId="new-ticket" wide>
      <form className="flex flex-col gap-4" onSubmit={(e) => void submit(e)} noValidate>
        <Field id={ids.title} label={C.titleField} error={errors.title}>
          <input
            id={ids.title}
            data-autofocus
            value={title}
            maxLength={MAX_TITLE + 50}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={C.titlePlaceholder}
            aria-invalid={errors.title ? true : undefined}
            aria-describedby={errors.title ? `${ids.title}-error` : undefined}
            className={inputClass()}
          />
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field id={ids.type} label={C.type}>
            <select
              id={ids.type}
              value={type}
              onChange={(e) => setType(TicketTypeSchema.parse(e.target.value))}
              className={inputClass('pr-8')}
            >
              {TicketTypeSchema.options.map((t) => (
                <option key={t} value={t}>
                  {TICKET_TYPE_COPY[t].word}
                </option>
              ))}
            </select>
          </Field>
          <Field id={ids.priority} label={C.priority}>
            <select
              id={ids.priority}
              value={priority}
              onChange={(e) => setPriority(TicketPrioritySchema.parse(e.target.value))}
              className={inputClass('pr-8')}
            >
              {TicketPrioritySchema.options.map((p) => (
                <option key={p} value={p}>
                  {TICKET_PRIORITY_COPY[p]}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <Field id={ids.labels} label={C.labels} hint={C.labelsHint} error={errors.labels}>
          <input
            id={ids.labels}
            value={labels}
            onChange={(e) => setLabels(e.target.value)}
            aria-invalid={errors.labels ? true : undefined}
            aria-describedby={`${ids.labels}-hint${errors.labels ? ` ${ids.labels}-error` : ''}`}
            className={inputClass()}
          />
        </Field>
        <Field id={ids.description} label={C.descriptionField} hint={C.descriptionHint}>
          <textarea
            id={ids.description}
            rows={5}
            value={description}
            maxLength={MAX_DESCRIPTION}
            onChange={(e) => setDescription(e.target.value)}
            aria-describedby={`${ids.description}-hint`}
            className={inputClass('resize-y')}
          />
        </Field>
        <Field id={ids.attachments} label={C.attachmentsField} hint={C.attachmentsHint}>
          <DropZone onFiles={locked ? () => undefined : staged.add} testId="new-ticket-drop">
            <div
              id={ids.attachments}
              className="flex flex-col items-start gap-2"
              aria-describedby={`${ids.attachments}-hint`}
            >
              <AttachButton onFiles={staged.add} disabled={locked} />
              <UploadList uploads={rows} onRemove={staged.remove} />
            </div>
          </DropZone>
        </Field>
        <RunOptionsFields
          value={runOptions}
          onChange={setRunOptions}
          defaults={defaults}
          collapse
          more={
            <TicketBranchInputs
              draft={branch}
              onChange={setBranch}
              namePlaceholder={
                branchDefaults === null
                  ? null
                  : projectBranchName(branchDefaults.strategy, {
                      key: pendingTicketKey(branchDefaults.projectKey),
                      title,
                      type,
                    })
              }
              targetPlaceholder={targetPlaceholder(branchDefaults)}
              // G-H (G-F's follow-up): the target and "Start from" offer the local branches.
              fromPlaceholder={sourcePlaceholder(branchDefaults)}
              projectId={projectId}
              preferredBase={branchDefaults?.strategy?.baseBranch}
            />
          }
        />
        <ActionError error={create.error} message={C.failed} />
        {partial !== null ? (
          <div role="alert" data-testid="attachments-partial" className="text-caption text-danger">
            <p>{C.attachmentsPartial(partial.names.length)}</p>
            <p>{C.attachmentsNotAttached(partial.names.join(', '))}</p>
          </div>
        ) : null}
        <div className="-mx-5 -mb-5 flex justify-end gap-2 rounded-b-card border-t border-line bg-sunken/60 px-5 py-3">
          <Button onClick={close} disabled={busy}>
            {C.cancel}
          </Button>
          {partial !== null ? (
            <Button variant="primary" onClick={() => onCreated(partial.ticket)}>
              {C.openTicket}
            </Button>
          ) : (
            <Button type="submit" variant="primary" disabled={busy}>
              {create.pending ? C.creating : uploading !== null ? C.attachmentsUploading : C.create}
            </Button>
          )}
        </div>
      </form>
    </Dialog>
  );
}
