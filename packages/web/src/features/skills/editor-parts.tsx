import { useId, useState, type ReactNode } from 'react';
import type { WorkflowStageId } from '@acp/core';
import type { SkillCommitResultDto } from '@acp/core/api';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { RelativeTime } from '../../components/RelativeTime';
import { SparkIcon } from '../../components/icons';
import type { ApiClient } from '../../lib/api';
import { formatKiB, SKILLS_COPY, stageList } from '../../lib/copy';
import { Dialog } from '../board/Dialog';
import { useSkillAction } from './actions';
import { fieldClass, ProblemList, RefusalNotice, StageChips, UncommittedBadge } from './bits';
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
}: {
  templates: readonly T[];
  onPick: (t: T) => void;
  collapsed?: boolean;
}) {
  const buttons = (
    <>
      <div className="flex flex-wrap gap-2" role="group" aria-label={C.editor.templates}>
        {templates.map((t) => (
          <Button key={t.id} onClick={() => onPick(t)} className="text-caption">
            <SparkIcon size={13} aria-hidden />
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
        <summary className="cursor-pointer text-caption text-dim hover:text-ink">
          {C.editor.templates}
        </summary>
        <div className="mt-2 flex flex-col gap-1.5">{buttons}</div>
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
    <div className="flex min-w-0 flex-col gap-1">
      <div className="flex items-center gap-2">
        <label htmlFor={id} className="flex-1 font-medium">
          {C.editor.instructions}
        </label>
        <div className="inline-flex rounded-control border border-line bg-sunken p-0.5">
          {[false, true].map((on) => (
            <button
              key={String(on)}
              type="button"
              aria-pressed={preview === on}
              onClick={() => setPreview(on)}
              className={`rounded-[0.375rem] px-2.5 py-0.5 text-caption font-medium ${preview === on ? 'bg-panel text-ink shadow-card' : 'text-dim hover:text-ink'}`}
            >
              {on ? C.editor.preview : C.editor.write}
            </button>
          ))}
        </div>
      </div>
      {preview ? (
        <div
          data-testid="skill-preview"
          className="min-h-[22rem] rounded-control border border-line bg-panel px-4 py-3"
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
          className={`${fieldClass} min-h-[22rem] resize-y font-mono text-caption leading-5`}
        />
      )}
      <span
        id={`${id}-size`}
        className={`text-right text-caption ${sizeError ? 'text-danger' : 'text-dim'}`}
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
  /** Extra rows in the status card (an agent's note about workflow stages). */
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
  const inUse = (usedBy?.length ?? 0) > 0;
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
    <div className="flex flex-col gap-4">
      <Card title={C.editor.path} testId="skill-status">
        <dl className="flex flex-col gap-3">
          <div>
            <dd className="font-mono text-caption break-all">{file.path}</dd>
          </div>
          {usedBy !== undefined ? (
            <div className="flex flex-col gap-1">
              <dt className="text-caption text-dim">{C.card.usedBy}</dt>
              <dd>
                <StageChips stages={usedBy} />
              </dd>
            </div>
          ) : null}
          {details}
          <div className="flex flex-col gap-1">
            <dt className="text-caption text-dim">{C.card.lastCommitted}</dt>
            <dd className="flex flex-wrap items-center gap-2">
              <RelativeTime iso={file.lastCommittedAt} fallback={C.card.neverCommitted} />
              {file.uncommitted ? <UncommittedBadge /> : null}
            </dd>
          </div>
        </dl>
      </Card>

      <Card title={C.commit.title} description={copy.commitExplain} testId="skill-commit">
        <div className="flex flex-col gap-2">
          {committed !== null && !file.uncommitted ? (
            <p role="status" className="text-success">
              {C.commit.done(committed.commit, committed.branch)}
            </p>
          ) : null}
          {!file.uncommitted && committed === null ? (
            <p className="text-dim">{copy.commitClean}</p>
          ) : null}
          {dirty ? <p className="text-caption text-dim">{C.commit.saveFirst}</p> : null}
          <RefusalNotice error={commit.error} refusals={copy.refusals} />
          <div>
            <Button
              variant="primary"
              onClick={() => void doCommit()}
              disabled={!file.uncommitted || dirty || commit.pending}
            >
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
              onClick={() => setConfirming(true)}
              disabled={inUse}
              aria-describedby={inUse ? inUseId : undefined}
              className="border-danger/40! text-danger! hover:bg-danger-soft!"
            >
              {copy.deleteButton}
            </Button>
          </div>
          {inUse && usedBy !== undefined ? (
            <p id={inUseId} className="text-caption text-dim">
              {C.remove.inUse(stageList(usedBy))}
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
              <Button
                onClick={() => void doDelete()}
                disabled={remove.pending}
                className="border-danger! bg-danger! text-white! hover:opacity-90"
              >
                {remove.pending ? C.remove.deleting : C.remove.confirm}
              </Button>
            </div>
          </div>
        </Dialog>
      ) : null}
    </div>
  );
}
