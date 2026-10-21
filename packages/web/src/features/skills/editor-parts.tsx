import { useId, useState, type ReactNode } from 'react';
import type { WorkflowStageId } from '@acp/core';
import type { NodeUseDto, SkillCommitResultDto } from '@acp/core/api';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { Dialog } from '../../components/Dialog';
import { CheckIcon, ChevronRightIcon, SparkIcon } from '../../components/icons';
import { inputClass } from '../../components/Input';
import { RelativeTime } from '../../components/RelativeTime';
import type { ApiClient } from '../../lib/api';
import { blockList, formatKiB, SKILLS_COPY, stageList, WORKFLOW_LIVE_COPY } from '../../lib/copy';
import { AgentFileIcon, CommitIcon, DeleteIcon, FileIcon } from '../workflow/icons';
import { useSkillAction } from './actions';
import { CardRow, ProblemList, RefusalNotice, StageChips, UncommittedBadge } from './bits';
import { MarkdownPreview } from './markdown';

/** Shared by the skill and agent editors: templates, the instructions field, and the side column. */

const C = SKILLS_COPY;

/**
 * The template buttons. `collapsed` (an existing file) folds them away behind a summary, because
 * replacing a saved file's text is rare there.
 */
export function TemplatePicker<T extends { id: string; label: string }>({
  templates,
  onPick,
  collapsed = false,
  agent = false,
}: {
  templates: readonly T[];
  onPick: (t: T) => void;
  collapsed?: boolean;
  /** Agent templates: the agent-file icon instead of the skill sparkle. */
  agent?: boolean;
}) {
  const Icon = agent ? AgentFileIcon : SparkIcon;
  const buttons = (
    <>
      <div className="flex flex-wrap gap-1.5" role="group" aria-label={C.editor.templates}>
        {templates.map((t) => (
          <Button key={t.id} size="sm" onClick={() => onPick(t)}>
            <Icon size={13} className="text-accent" />
            {t.label}
          </Button>
        ))}
      </div>
      <span className="text-caption text-dim">{C.editor.templatesHint}</span>
    </>
  );
  if (collapsed) {
    return (
      <details className="group flex flex-col gap-1.5">
        <summary className="inline-flex w-fit cursor-pointer list-none items-center gap-1 rounded-control text-caption text-dim transition-colors select-none hover:text-ink [&::-webkit-details-marker]:hidden">
          <ChevronRightIcon
            size={14}
            className="transition-transform duration-150 group-open:rotate-90"
          />
          {C.editor.templates}
        </summary>
        <div className="mt-2 flex flex-col gap-1.5 rounded-control border border-line bg-sunken p-3">
          {buttons}
        </div>
      </details>
    );
  }
  return (
    <div className="flex flex-col gap-1.5">
      <span className="font-medium">{C.editor.templates}</span>
      {buttons}
    </div>
  );
}

export function InstructionsField({
  value,
  onChange,
  bytes,
  sizeError,
}: {
  value: string;
  onChange: (v: string) => void;
  bytes: number;
  sizeError: string | undefined;
}) {
  const id = useId();
  const [preview, setPreview] = useState(false);
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <div className="flex items-center gap-2">
        <label htmlFor={id} className="flex-1 font-medium">
          {C.editor.instructions}
        </label>
        {/* The look of the shared Segmented control; its own two buttons keep their names. */}
        <div className="inline-flex gap-0.5 rounded-control border border-line bg-sunken p-0.5">
          {[false, true].map((on) => (
            <button
              key={String(on)}
              type="button"
              aria-pressed={preview === on}
              onClick={() => setPreview(on)}
              className={`h-6 rounded-[calc(var(--radius-control)-2px)] px-2.5 text-caption font-medium transition-colors ${
                preview === on
                  ? 'bg-panel text-ink shadow-[0_0_0_1px_var(--color-line),0_1px_2px_rgb(0_0_0/0.06)]'
                  : 'text-dim hover:text-ink'
              }`}
            >
              {on ? C.editor.preview : C.editor.write}
            </button>
          ))}
        </div>
      </div>
      {preview ? (
        <div
          data-testid="skill-preview"
          className="min-h-[22rem] animate-fade-in rounded-control border border-line bg-panel px-5 py-4"
        >
          <MarkdownPreview source={value} empty={C.editor.previewEmpty} />
        </div>
      ) : (
        <textarea
          id={id}
          rows={18}
          value={value}
          spellCheck={false}
          onChange={(e) => onChange(e.target.value)}
          aria-describedby={`${id}-size`}
          className={inputClass('min-h-[22rem] resize-y font-mono text-caption leading-5')}
        />
      )}
      <span
        id={`${id}-size`}
        className={`text-right text-caption tabular-nums ${sizeError ? 'text-danger' : 'text-dim'}`}
      >
        {sizeError ?? C.editor.size(formatKiB(bytes))}
      </span>
    </div>
  );
}

export interface SideFile {
  name: string;
  path: string;
  lastCommittedAt: string | null;
  uncommitted: boolean;
  problems: readonly string[];
}

export interface SideCopy {
  commitExplain: string;
  commitClean: string;
  deleteButton: string;
  deleteText: (path: string) => string;
  refusals?: Readonly<Record<string, string>>;
}

/**
 * The column next to a saved file: its path and git state, Commit, problems and Delete. `usedBy`
 * (skills, and agent files once the workflow is known) shows the stages and blocks Delete while
 * any stage uses the file; the server refuses that delete too (`skill_in_use`, `agent_in_use`).
 */
export function FileSide({
  projectId,
  file,
  dirty,
  usedBy,
  usedByNodes,
  details,
  commitFn,
  deleteFn,
  scope,
  copy,
  onDeleted,
}: {
  projectId: string;
  file: SideFile;
  dirty: boolean;
  usedBy?: readonly WorkflowStageId[];
  /** ADR-0023: the workflow blocks that use the file, when the server says (else `usedBy`). */
  usedByNodes?: readonly NodeUseDto[] | undefined;
  /** Extra `CardRow`s in the status card (an agent's model). */
  details?: ReactNode;
  commitFn: (client: ApiClient, projectId: string, name: string) => Promise<SkillCommitResultDto>;
  deleteFn: (client: ApiClient, projectId: string, name: string) => Promise<void>;
  scope?: (projectId: string) => (key: string) => boolean;
  copy: SideCopy;
  onDeleted: (name: string) => void;
}) {
  const commit = useSkillAction(projectId, commitFn, scope);
  const remove = useSkillAction(projectId, deleteFn, scope);
  const [confirming, setConfirming] = useState(false);
  const [committed, setCommitted] = useState<SkillCommitResultDto | null>(null);
  const inUse = usedByNodes !== undefined ? usedByNodes.length > 0 : (usedBy?.length ?? 0) > 0;
  const inUseId = useId();

  const doCommit = async () => {
    const result = await commit.run(file.name);
    if (result !== null) setCommitted(result);
  };
  const doDelete = async () => {
    const ok = await remove.run(file.name);
    // The delete resolves to undefined; null is a failure.
    if (ok !== null) {
      setConfirming(false);
      onDeleted(file.name);
    }
  };

  return (
    // Sticky on wide screens, so Commit and Delete stay next to a long instructions field.
    <div className="flex flex-col gap-4 lg:sticky lg:top-24">
      <Card title={C.editor.path} testId="skill-status">
        <div className="flex flex-col gap-4">
          <p className="flex items-start gap-2 rounded-control border border-line bg-sunken px-2.5 py-2 font-mono text-[0.6875rem] leading-4 break-all">
            <FileIcon size={13} className="mt-px shrink-0 text-dim" />
            <span className="min-w-0">{file.path}</span>
          </p>
          <dl className="grid grid-cols-[6.25rem_minmax(0,1fr)] items-start gap-x-3 gap-y-3">
            {usedBy !== undefined || usedByNodes !== undefined ? (
              <CardRow label={C.card.usedBy}>
                <StageChips stages={usedBy ?? []} nodes={usedByNodes} />
              </CardRow>
            ) : null}
            {details}
            <CardRow label={C.card.lastCommitted}>
              <span className="flex flex-wrap items-center gap-2">
                <RelativeTime iso={file.lastCommittedAt} fallback={C.card.neverCommitted} />
                {file.uncommitted ? <UncommittedBadge /> : null}
              </span>
            </CardRow>
          </dl>
        </div>
      </Card>

      <Card title={C.commit.title} description={copy.commitExplain} testId="skill-commit">
        <div className="flex flex-col gap-3">
          {committed !== null && !file.uncommitted ? (
            <p role="status" className="flex items-start gap-1.5 text-success">
              <CheckIcon size={15} className="mt-0.5 shrink-0" />
              <span className="min-w-0">{C.commit.done(committed.commit, committed.branch)}</span>
            </p>
          ) : null}
          {!file.uncommitted && committed === null ? (
            <p className="text-caption text-dim">{copy.commitClean}</p>
          ) : null}
          {dirty ? <p className="text-caption text-dim">{C.commit.saveFirst}</p> : null}
          <RefusalNotice error={commit.error} refusals={copy.refusals} />
          <div>
            <Button
              variant="primary"
              onClick={() => void doCommit()}
              disabled={!file.uncommitted || dirty || commit.pending}
            >
              <CommitIcon size={15} />
              {commit.pending ? C.commit.committing : C.commit.button}
            </Button>
          </div>
        </div>
      </Card>

      {file.problems.length > 0 ? (
        <Card title={C.problems.title} testId="skill-problems-card">
          <ProblemList problems={file.problems} />
        </Card>
      ) : null}

      <Card testId="skill-delete">
        <div className="flex flex-col gap-2">
          <div>
            <Button
              variant="danger"
              onClick={() => setConfirming(true)}
              disabled={inUse}
              aria-describedby={inUse ? inUseId : undefined}
            >
              <DeleteIcon size={14} />
              {copy.deleteButton}
            </Button>
          </div>
          {inUse && (usedByNodes !== undefined || usedBy !== undefined) ? (
            <p id={inUseId} className="text-caption text-dim">
              {usedByNodes !== undefined
                ? WORKFLOW_LIVE_COPY.usedBy.inUse(blockList(usedByNodes.map((n) => n.label)))
                : C.remove.inUse(stageList(usedBy ?? []))}
            </p>
          ) : null}
          {!confirming ? <RefusalNotice error={remove.error} refusals={copy.refusals} /> : null}
        </div>
      </Card>

      {confirming ? (
        <Dialog
          title={C.remove.title(file.name)}
          description={copy.deleteText(file.path)}
          onClose={() => setConfirming(false)}
          testId="delete-dialog"
        >
          <div className="flex flex-col gap-3">
            <RefusalNotice error={remove.error} refusals={copy.refusals} />
            <div className="flex justify-end gap-2">
              <Button onClick={() => setConfirming(false)} disabled={remove.pending}>
                {C.remove.cancel}
              </Button>
              <Button variant="danger" onClick={() => void doDelete()} disabled={remove.pending}>
                <DeleteIcon size={14} />
                {remove.pending ? C.remove.deleting : C.remove.confirm}
              </Button>
            </div>
          </div>
        </Dialog>
      ) : null}
    </div>
  );
}
