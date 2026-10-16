import { useId, useState, type FormEvent } from 'react';
import type { SkillCommitResultDto, SkillDetailDto } from '@acp/core/api';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { RelativeTime } from '../../components/RelativeTime';
import { SparkIcon } from '../../components/icons';
import { commitSkill, createSkill, deleteSkill, updateSkill } from '../../lib/api';
import { formatKiB, SKILLS_COPY, stageList } from '../../lib/copy';
import { Dialog } from '../board/Dialog';
import {
  skillFileBytes,
  useSkillAction,
  validateSkillForm,
  type SkillForm,
  type SkillFormErrors,
} from './actions';
import {
  describedBy,
  Field,
  fieldClass,
  ProblemList,
  RefusalNotice,
  StageChips,
  UncommittedBadge,
} from './bits';
import { MarkdownPreview } from './markdown';
import { SKILL_TEMPLATES, type SkillTemplate } from './templates';

const C = SKILLS_COPY;

function sameForm(a: SkillForm, b: SkillForm): boolean {
  return a.name === b.name && a.description === b.description && a.instructions === b.instructions;
}

function TemplatePicker({ onPick }: { onPick: (t: SkillTemplate) => void }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="font-medium">{C.editor.templates}</span>
      <div className="flex flex-wrap gap-2" role="group" aria-label={C.editor.templates}>
        {SKILL_TEMPLATES.map((t) => (
          <Button key={t.id} onClick={() => onPick(t)} className="text-caption">
            <SparkIcon size={13} aria-hidden />
            {t.label}
          </Button>
        ))}
      </div>
      <span className="text-caption text-dim">{C.editor.templatesHint}</span>
    </div>
  );
}

function InstructionsField({
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

/** The right-hand column on an existing skill: file, git state, Commit, problems and Delete. */
function SkillSide({
  projectId,
  detail,
  dirty,
  onDeleted,
}: {
  projectId: string;
  detail: SkillDetailDto;
  dirty: boolean;
  onDeleted: (name: string) => void;
}) {
  const commit = useSkillAction(projectId, commitSkill);
  const remove = useSkillAction(projectId, deleteSkill);
  const [confirming, setConfirming] = useState(false);
  const [committed, setCommitted] = useState<SkillCommitResultDto | null>(null);
  const inUse = detail.usedBy.length > 0;

  const doCommit = async () => {
    const result = await commit.run(detail.name);
    if (result !== null) setCommitted(result);
  };
  const doDelete = async () => {
    const ok = await remove.run(detail.name);
    // `deleteSkill` resolves to undefined; null is a failure.
    if (ok !== null) {
      setConfirming(false);
      onDeleted(detail.name);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <Card title={C.editor.path} testId="skill-status">
        <dl className="flex flex-col gap-3">
          <div>
            <dd className="font-mono text-caption break-all">{detail.path}</dd>
          </div>
          <div className="flex flex-col gap-1">
            <dt className="text-caption text-dim">{C.card.usedBy}</dt>
            <dd>
              <StageChips stages={detail.usedBy} />
            </dd>
          </div>
          <div className="flex flex-col gap-1">
            <dt className="text-caption text-dim">{C.card.lastCommitted}</dt>
            <dd className="flex flex-wrap items-center gap-2">
              <RelativeTime iso={detail.lastCommittedAt} fallback={C.card.neverCommitted} />
              {detail.uncommitted ? <UncommittedBadge /> : null}
            </dd>
          </div>
        </dl>
      </Card>

      <Card title={C.commit.title} description={C.commit.explain} testId="skill-commit">
        <div className="flex flex-col gap-2">
          {committed !== null && !detail.uncommitted ? (
            <p role="status" className="text-success">
              {C.commit.done(committed.commit, committed.branch)}
            </p>
          ) : null}
          {!detail.uncommitted && committed === null ? (
            <p className="text-dim">{C.commit.clean}</p>
          ) : null}
          {dirty ? <p className="text-caption text-dim">{C.commit.saveFirst}</p> : null}
          <RefusalNotice error={commit.error} />
          <div>
            <Button
              variant="primary"
              onClick={() => void doCommit()}
              disabled={!detail.uncommitted || dirty || commit.pending}
            >
              {commit.pending ? C.commit.committing : C.commit.button}
            </Button>
          </div>
        </div>
      </Card>

      {detail.problems.length > 0 ? (
        <Card title={C.problems.title} testId="skill-problems-card">
          <ProblemList problems={detail.problems} />
        </Card>
      ) : null}

      <Card testId="skill-delete">
        <div className="flex flex-col gap-2">
          <div>
            <Button
              onClick={() => setConfirming(true)}
              disabled={inUse}
              aria-describedby={inUse ? 'skill-in-use' : undefined}
              className="border-danger/40 text-danger hover:bg-danger-soft"
            >
              {C.remove.button}
            </Button>
          </div>
          {inUse ? (
            <p id="skill-in-use" className="text-caption text-dim">
              {C.remove.inUse(stageList(detail.usedBy))}
            </p>
          ) : null}
          {!confirming ? <RefusalNotice error={remove.error} /> : null}
        </div>
      </Card>

      {confirming ? (
        <Dialog
          title={C.remove.title(detail.name)}
          description={C.remove.text(detail.path)}
          onClose={() => setConfirming(false)}
          testId="delete-dialog"
        >
          <div className="flex flex-col gap-3">
            <RefusalNotice error={remove.error} />
            <div className="flex justify-end gap-2">
              <Button onClick={() => setConfirming(false)} disabled={remove.pending}>
                {C.remove.cancel}
              </Button>
              <Button
                onClick={() => void doDelete()}
                disabled={remove.pending}
                className="border-danger bg-danger text-white hover:opacity-90"
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

/**
 * New skill and Edit skill. Save writes the file into the project's working tree; Commit is a
 * separate owner action on the saved file (ADR-0018 §4).
 */
export function SkillEditor({
  projectId,
  detail,
  template,
  existing,
  onCreated,
  onCancel,
  onDeleted,
}: {
  projectId: string;
  /** The saved skill; undefined for a new one. */
  detail?: SkillDetailDto;
  /** A new skill's starting template. */
  template?: SkillTemplate | null;
  /** Names already taken (a new skill's name must differ). */
  existing: readonly string[];
  onCreated: (name: string) => void;
  onCancel: () => void;
  onDeleted: (name: string) => void;
}) {
  const isNew = detail === undefined;
  const initial: SkillForm = detail
    ? { name: detail.name, description: detail.description, instructions: detail.instructions }
    : {
        name: template?.name ?? '',
        description: template?.description ?? '',
        instructions: template?.instructions ?? '',
      };
  const [form, setForm] = useState<SkillForm>(initial);
  const [baseline, setBaseline] = useState<SkillForm>(initial);
  const [errors, setErrors] = useState<SkillFormErrors>({});
  const [saved, setSaved] = useState(false);
  const create = useSkillAction(projectId, createSkill);
  const update = useSkillAction(projectId, updateSkill);
  const save = isNew ? create : update;
  const ids = { name: useId(), description: useId() };
  const dirty = !sameForm(form, baseline);
  const bytes = skillFileBytes(form);
  const sizeError = validateSkillForm(form, { isNew, existing }).size;

  const set = (patch: Partial<SkillForm>) => {
    setForm((f) => ({ ...f, ...patch }));
    setSaved(false);
  };
  const pickTemplate = (t: SkillTemplate) =>
    set({
      ...(isNew && (form.name === '' || SKILL_TEMPLATES.some((x) => x.name === form.name))
        ? { name: t.name }
        : {}),
      description: t.description,
      instructions: t.instructions,
    });

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const found = validateSkillForm(form, { isNew, existing });
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    const body = {
      name: form.name,
      description: form.description.trim(),
      instructions: form.instructions,
    };
    const result = isNew ? await create.run(body) : await update.run(form.name, body);
    if (result === null) return;
    const next = { ...form, description: body.description };
    setForm(next);
    setBaseline(next);
    setSaved(true);
    if (isNew) onCreated(result.name);
  };

  return (
    <div
      className={isNew ? '' : 'grid gap-4 lg:grid-cols-[minmax(0,1fr)_19rem]'}
      data-testid="skill-editor"
    >
      <Card
        title={isNew ? C.editor.newTitle : C.editor.editTitle(form.name)}
        description={isNew ? C.editor.newDescription : undefined}
        actions={
          dirty && !isNew ? (
            <span className="text-caption text-dim">{C.editor.unsaved}</span>
          ) : undefined
        }
      >
        <form className="flex flex-col gap-5" onSubmit={(e) => void submit(e)} noValidate>
          <TemplatePicker onPick={pickTemplate} />
          <Field id={ids.name} label={C.editor.name} hint={C.editor.nameHint} error={errors.name}>
            <input
              id={ids.name}
              value={form.name}
              disabled={!isNew}
              autoComplete="off"
              spellCheck={false}
              placeholder="code-review"
              onChange={(e) => set({ name: e.target.value })}
              aria-invalid={errors.name ? true : undefined}
              aria-describedby={describedBy(ids.name, true, errors.name)}
              className={`${fieldClass} font-mono ${errors.name ? 'border-danger' : ''}`}
            />
          </Field>
          <Field
            id={ids.description}
            label={C.editor.description}
            hint={C.editor.descriptionHint}
            error={errors.description}
          >
            <textarea
              id={ids.description}
              rows={2}
              value={form.description}
              maxLength={1024}
              onChange={(e) => set({ description: e.target.value })}
              aria-invalid={errors.description ? true : undefined}
              aria-describedby={describedBy(ids.description, true, errors.description)}
              className={`${fieldClass} resize-y ${errors.description ? 'border-danger' : ''}`}
            />
          </Field>
          <InstructionsField
            value={form.instructions}
            onChange={(instructions) => set({ instructions })}
            bytes={bytes}
            sizeError={sizeError}
          />
          <RefusalNotice error={save.error} />
          {saved && !isNew ? (
            <p role="status" className="text-success">
              {C.editor.saved}
            </p>
          ) : null}
          <div className="flex flex-wrap justify-end gap-2">
            <Button onClick={onCancel} disabled={save.pending}>
              {C.editor.cancel}
            </Button>
            <Button
              type="submit"
              variant="primary"
              disabled={save.pending || (!isNew && !dirty) || sizeError !== undefined}
            >
              {save.pending ? C.editor.saving : C.editor.save}
            </Button>
          </div>
        </form>
      </Card>
      {detail !== undefined ? (
        <SkillSide projectId={projectId} detail={detail} dirty={dirty} onDeleted={onDeleted} />
      ) : null}
    </div>
  );
}
