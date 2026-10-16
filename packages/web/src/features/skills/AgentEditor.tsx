import { useId, useState, type FormEvent, type KeyboardEvent } from 'react';
import type { AgentDefinitionDetailDto } from '@acp/core/api';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { commitAgent, createAgent, deleteAgent, isAgentsPath, updateAgent } from '../../lib/api';
import { AGENTS_COPY, SKILLS_COPY } from '../../lib/copy';
import {
  agentFileBytes,
  agentRequest,
  isToolName,
  MAX_AGENT_TOOLS,
  useSkillAction,
  validateAgentForm,
  type AgentForm,
  type AgentFormErrors,
} from './actions';
import { AGENT_TEMPLATES, COMMON_TOOLS, type AgentTemplate } from './agent-templates';
import { describedBy, Field, fieldClass, RefusalNotice } from './bits';
import { FileSide, InstructionsField, TemplatePicker } from './editor-parts';

const A = AGENTS_COPY;
const S = SKILLS_COPY;
const MODEL_SUGGESTIONS = ['sonnet', 'opus', 'haiku', 'inherit'];

function sameForm(a: AgentForm, b: AgentForm): boolean {
  return (
    a.name === b.name &&
    a.description === b.description &&
    a.instructions === b.instructions &&
    a.model === b.model &&
    JSON.stringify(a.tools) === JSON.stringify(b.tools)
  );
}

/**
 * The tools an agent may use: "All tools" (null, Claude Code's default) or a chosen list, edited as
 * chips. Enter or a comma adds what was typed; × removes a chip; common tools are one click away.
 */
function ToolsField({
  tools,
  onChange,
  error,
}: {
  tools: readonly string[] | null;
  onChange: (tools: readonly string[] | null) => void;
  error: string | undefined;
}) {
  const id = useId();
  const [draft, setDraft] = useState('');
  const [draftError, setDraftError] = useState<string | undefined>(undefined);
  // Remembered so turning "All tools" off again restores the earlier choice.
  const [lastList, setLastList] = useState<readonly string[]>(tools ?? []);
  const all = tools === null;
  const list = tools ?? [];

  const add = (raw: string) => {
    const tool = raw.trim();
    if (tool === '') return;
    if (!isToolName(tool)) {
      setDraftError(A.editor.toolInvalid);
      return;
    }
    setDraftError(undefined);
    setDraft('');
    if (!list.includes(tool) && list.length < MAX_AGENT_TOOLS) onChange([...list, tool]);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      add(draft);
    } else if (e.key === 'Backspace' && draft === '' && list.length > 0) {
      onChange(list.slice(0, -1));
    }
  };
  const shownError = draftError ?? error;

  return (
    <fieldset className="flex min-w-0 flex-col gap-2" data-testid="tools-field">
      <legend className="mb-1 font-medium">{A.editor.tools}</legend>
      <label className="flex items-start gap-2">
        <input
          type="checkbox"
          checked={all}
          onChange={(e) => {
            if (e.target.checked) {
              setLastList(list);
              onChange(null);
            } else {
              onChange(lastList);
            }
          }}
          className="mt-1"
        />
        <span>
          <span className="font-medium">{A.editor.allTools}</span>
          <span className="block text-caption text-dim">{A.editor.allToolsHint}</span>
        </span>
      </label>
      {all ? null : (
        <>
          <div
            className={`flex flex-wrap items-center gap-1.5 rounded-control border bg-panel px-2 py-1.5 ${shownError ? 'border-danger' : 'border-line-strong'}`}
          >
            {list.map((t) => (
              <span
                key={t}
                className="inline-flex items-center gap-1 rounded-full border border-line bg-sunken py-px pr-1 pl-2 font-mono text-caption"
              >
                {t}
                <button
                  type="button"
                  aria-label={A.editor.removeTool(t)}
                  onClick={() => onChange(list.filter((x) => x !== t))}
                  className="rounded-full px-1 text-dim hover:bg-panel hover:text-ink"
                >
                  ×
                </button>
              </span>
            ))}
            <input
              id={id}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={onKeyDown}
              onBlur={() => add(draft)}
              aria-label={A.editor.addTool}
              aria-invalid={shownError ? true : undefined}
              aria-describedby={describedBy(id, true, shownError)}
              autoComplete="off"
              spellCheck={false}
              placeholder={list.length === 0 ? 'Read' : ''}
              className="min-w-[8rem] flex-1 bg-transparent px-1 py-0.5 font-mono text-caption outline-none"
            />
          </div>
          <span id={`${id}-hint`} className="text-caption text-dim">
            {list.length === 0 ? A.editor.toolsNone : A.editor.toolsHint}
          </span>
          {shownError ? (
            <span id={`${id}-error`} role="alert" className="text-caption text-danger">
              {shownError}
            </span>
          ) : null}
          <div
            className="flex flex-wrap items-center gap-1.5"
            role="group"
            aria-label={A.editor.common}
          >
            <span className="text-caption text-dim">{A.editor.common}:</span>
            {COMMON_TOOLS.filter((t) => !list.includes(t)).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => add(t)}
                className="rounded-full border border-dashed border-line-strong px-2 py-px font-mono text-caption text-dim hover:border-accent hover:text-accent"
              >
                + {t}
              </button>
            ))}
          </div>
        </>
      )}
    </fieldset>
  );
}

/** New agent and Edit agent: like a skill, plus tools and a model. Save, then Commit (ADR-0018). */
export function AgentEditor({
  projectId,
  detail,
  template,
  existing,
  onCreated,
  onCancel,
  onDeleted,
}: {
  projectId: string;
  detail?: AgentDefinitionDetailDto;
  template?: AgentTemplate | null;
  existing: readonly string[];
  onCreated: (name: string) => void;
  onCancel: () => void;
  onDeleted: (name: string) => void;
}) {
  const isNew = detail === undefined;
  const initial: AgentForm = detail
    ? {
        name: detail.name,
        description: detail.description,
        tools: detail.tools,
        model: detail.model ?? '',
        instructions: detail.instructions,
      }
    : {
        name: template?.name ?? '',
        description: template?.description ?? '',
        tools: template ? [...template.tools] : null,
        model: '',
        instructions: template?.instructions ?? '',
      };
  const [form, setForm] = useState<AgentForm>(initial);
  const [baseline, setBaseline] = useState<AgentForm>(initial);
  const [errors, setErrors] = useState<AgentFormErrors>({});
  const [saved, setSaved] = useState(false);
  const create = useSkillAction(projectId, createAgent, isAgentsPath);
  const update = useSkillAction(projectId, updateAgent, isAgentsPath);
  const save = isNew ? create : update;
  const ids = { name: useId(), description: useId(), model: useId(), models: useId() };
  const dirty = !sameForm(form, baseline);
  const sizeError = validateAgentForm(form, { isNew, existing }).size;

  const set = (patch: Partial<AgentForm>) => {
    setForm((f) => ({ ...f, ...patch }));
    setSaved(false);
  };
  const pickTemplate = (t: AgentTemplate) =>
    set({
      ...(isNew && (form.name === '' || AGENT_TEMPLATES.some((x) => x.name === form.name))
        ? { name: t.name }
        : {}),
      description: t.description,
      tools: [...t.tools],
      instructions: t.instructions,
    });

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const found = validateAgentForm(form, { isNew, existing });
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    const body = agentRequest(form);
    const result = isNew ? await create.run(body) : await update.run(form.name, body);
    if (result === null) return;
    const next = { ...form, description: body.description, model: body.model ?? '' };
    setForm(next);
    setBaseline(next);
    setSaved(true);
    if (isNew) onCreated(result.name);
  };

  return (
    <div
      className={isNew ? 'max-w-4xl' : 'grid gap-4 lg:grid-cols-[minmax(0,1fr)_19rem]'}
      data-testid="agent-editor"
    >
      <Card
        title={isNew ? A.editor.newTitle : S.editor.editTitle(form.name)}
        description={isNew ? A.editor.newDescription : undefined}
        actions={
          dirty && !isNew ? (
            <span className="text-caption text-dim">{S.editor.unsaved}</span>
          ) : undefined
        }
      >
        <form className="flex flex-col gap-5" onSubmit={(e) => void submit(e)} noValidate>
          <TemplatePicker templates={AGENT_TEMPLATES} onPick={pickTemplate} collapsed={!isNew} />
          <Field id={ids.name} label={S.editor.name} hint={A.editor.nameHint} error={errors.name}>
            <input
              id={ids.name}
              value={form.name}
              disabled={!isNew}
              autoComplete="off"
              spellCheck={false}
              placeholder="reviewer"
              onChange={(e) => set({ name: e.target.value })}
              aria-invalid={errors.name ? true : undefined}
              aria-describedby={describedBy(ids.name, true, errors.name)}
              className={`${fieldClass} font-mono ${errors.name ? 'border-danger' : ''}`}
            />
          </Field>
          <Field
            id={ids.description}
            label={S.editor.description}
            hint={A.editor.descriptionHint}
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
          <ToolsField
            tools={form.tools}
            onChange={(tools) => set({ tools })}
            error={errors.tools}
          />
          <Field
            id={ids.model}
            label={A.editor.model}
            hint={A.editor.modelHint}
            error={errors.model}
          >
            <input
              id={ids.model}
              value={form.model}
              list={ids.models}
              autoComplete="off"
              spellCheck={false}
              placeholder={A.editor.modelPlaceholder}
              onChange={(e) => set({ model: e.target.value })}
              aria-invalid={errors.model ? true : undefined}
              aria-describedby={describedBy(ids.model, true, errors.model)}
              className={`${fieldClass} max-w-xs font-mono ${errors.model ? 'border-danger' : ''}`}
            />
            <datalist id={ids.models}>
              {MODEL_SUGGESTIONS.map((m) => (
                <option key={m} value={m} />
              ))}
            </datalist>
          </Field>
          <InstructionsField
            value={form.instructions}
            onChange={(instructions) => set({ instructions })}
            bytes={agentFileBytes(form)}
            sizeError={sizeError}
          />
          <RefusalNotice error={save.error} refusals={A.refusals} />
          {saved && !isNew ? (
            <p role="status" className="text-success">
              {S.editor.saved}
            </p>
          ) : null}
          <div className="flex flex-wrap justify-end gap-2">
            <Button onClick={onCancel} disabled={save.pending}>
              {S.editor.cancel}
            </Button>
            <Button
              type="submit"
              variant="primary"
              disabled={save.pending || (!isNew && !dirty) || sizeError !== undefined}
            >
              {save.pending ? S.editor.saving : S.editor.save}
            </Button>
          </div>
        </form>
      </Card>
      {detail !== undefined ? (
        <FileSide
          projectId={projectId}
          file={detail}
          dirty={dirty}
          commitFn={commitAgent}
          deleteFn={deleteAgent}
          scope={isAgentsPath}
          copy={{
            commitExplain: A.commit.explain,
            commitClean: A.commit.clean,
            deleteButton: A.remove.button,
            deleteText: A.remove.text,
            refusals: A.refusals,
          }}
          details={
            <div className="flex flex-col gap-1">
              <dt className="text-caption text-dim">{A.card.model}</dt>
              <dd className={detail.model === null ? 'text-dim' : 'font-mono text-caption'}>
                {detail.model ?? A.card.defaultModel}
              </dd>
            </div>
          }
          onDeleted={onDeleted}
        />
      ) : null}
    </div>
  );
}
