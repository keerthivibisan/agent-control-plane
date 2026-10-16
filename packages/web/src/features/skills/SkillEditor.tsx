import { useId, useState, type FormEvent } from 'react';
import type { SkillDetailDto } from '@acp/core/api';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { commitSkill, createSkill, deleteSkill, updateSkill } from '../../lib/api';
import { SKILLS_COPY } from '../../lib/copy';
import {
  skillFileBytes,
  useSkillAction,
  validateSkillForm,
  type SkillForm,
  type SkillFormErrors,
} from './actions';
import { describedBy, Field, fieldClass, RefusalNotice } from './bits';
import { FileSide, InstructionsField, TemplatePicker } from './editor-parts';
import { SKILL_TEMPLATES, type SkillTemplate } from './templates';

const C = SKILLS_COPY;

function sameForm(a: SkillForm, b: SkillForm): boolean {
  return a.name === b.name && a.description === b.description && a.instructions === b.instructions;
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
      className={isNew ? 'max-w-4xl' : 'grid gap-4 lg:grid-cols-[minmax(0,1fr)_19rem]'}
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
          <TemplatePicker templates={SKILL_TEMPLATES} onPick={pickTemplate} collapsed={!isNew} />
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
        <FileSide
          projectId={projectId}
          file={detail}
          dirty={dirty}
          usedBy={detail.usedBy}
          commitFn={commitSkill}
          deleteFn={deleteSkill}
          copy={{
            commitExplain: C.commit.explain,
            commitClean: C.commit.clean,
            deleteButton: C.remove.button,
            deleteText: C.remove.text,
          }}
          onDeleted={onDeleted}
        />
      ) : null}
    </div>
  );
}
