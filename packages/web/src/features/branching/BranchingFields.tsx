import { useId } from 'react';
import { BranchIcon } from '../review-loop/icons';
import { InfoTip } from '../../components/InfoTip';
import { labelClass } from '../../components/Input';
import { BRANCHING_COPY, TICKET_TYPE_COPY, type BranchingChoiceKey } from '../../lib/copy';
import { ChoiceCards, TextField } from '../project-setup/fields';
import {
  BRANCHING_CHOICES,
  TICKET_TYPES,
  chooseStrategy,
  isLocked,
  previewNames,
  type BranchingDraft,
  type BranchingErrors,
} from './strategy-form';

const C = BRANCHING_COPY;

/** The example names, updated as the owner types (read out politely to screen readers). */
function Preview({ draft, projectKey }: { draft: BranchingDraft; projectKey: string }) {
  const names = previewNames(draft, projectKey);
  const valid = names.every((n) => n.name !== null);
  return (
    <div
      className="flex min-w-0 flex-col gap-1.5 rounded-control border border-line bg-sunken px-3 py-2.5"
      data-testid="branching-preview"
    >
      <span className="flex items-center gap-1">
        <span className={labelClass}>{C.preview}</span>
        <InfoTip tip={C.previewTip} label={C.preview} />
      </span>
      <div aria-live="polite" className="flex min-w-0 flex-col gap-1">
        {valid ? (
          names.map((n) => (
            <p key={n.type} className="flex min-w-0 items-center gap-2 text-caption">
              <BranchIcon size={13} className="shrink-0 text-dim" />
              <span className="text-dim">{TICKET_TYPE_COPY[n.type].word}</span>
              <span
                className="min-w-0 font-mono font-medium break-all text-ink"
                data-testid="branching-preview-name"
              >
                {n.name}
              </span>
            </p>
          ))
        ) : (
          <p className="text-caption text-dim">{C.previewUnavailable}</p>
        )}
      </div>
    </div>
  );
}

/**
 * A project's branching strategy (ADR-0025 §3): the choice, the base and default target branches,
 * the ticket branch name with its tokens and a live preview, and a word per ticket type. For the
 * settings page and the new-project wizard; saving is the caller's (the setup PUT's `branching`).
 */
export function BranchingFields({
  draft,
  errors,
  onChange,
  projectKey,
  defaultBranch,
}: {
  draft: BranchingDraft;
  errors: BranchingErrors;
  onChange: (next: BranchingDraft) => void;
  projectKey: string;
  /** The repository's default branch when known (GitHub's), for the presets; else `main`. */
  defaultBranch?: string | undefined;
}) {
  const name = useId();
  const locked = isLocked(draft.choice);
  const set = (patch: Partial<BranchingDraft>) => onChange({ ...draft, ...patch });
  return (
    <div className="flex flex-col gap-6" data-testid="branching-fields" data-choice={draft.choice}>
      <ChoiceCards<BranchingChoiceKey>
        legend={C.choiceLabel}
        name={`${name}-choice`}
        value={draft.choice}
        options={BRANCHING_CHOICES.map((c) => ({
          value: c,
          label: C.choices[c].word,
          hint: C.choices[c].text,
        }))}
        onChange={(c) => onChange(chooseStrategy(draft, c, defaultBranch))}
      />
      {draft.choice === 'none' ? (
        <p className="text-caption text-dim" data-testid="branching-none">
          {C.noneNote(projectKey.trim() === '' ? 'WEB' : projectKey.trim())}
        </p>
      ) : (
        <>
          <div className="grid gap-6 sm:grid-cols-2">
            <TextField
              label={C.baseBranch}
              hint={C.baseBranchHint}
              error={errors.baseBranch}
              value={draft.baseBranch}
              onChange={(v) => set({ baseBranch: v })}
              placeholder="main"
              mono
            />
            <TextField
              label={C.targetBranch}
              hint={C.targetBranchHint}
              error={errors.defaultTargetBranch}
              value={draft.defaultTargetBranch}
              onChange={(v) => set({ defaultTargetBranch: v })}
              placeholder="main"
              mono
            />
          </div>
          <TextField
            label={C.template}
            hint={locked ? `${C.templateHint} ${C.locked}` : C.templateHint}
            error={errors.template}
            value={draft.template}
            onChange={(v) => set({ template: v })}
            placeholder="{type}/{key}-{slug}"
            mono
            readOnly={locked}
          />
          <fieldset className="flex min-w-0 flex-col gap-2" data-testid="branching-type-words">
            <legend className={`mb-1.5 ${labelClass}`}>{C.typeWords}</legend>
            <div className="grid gap-4 sm:grid-cols-4">
              {TICKET_TYPES.map((t) => (
                <TextField
                  key={t}
                  label={TICKET_TYPE_COPY[t].word}
                  hint=""
                  error={errors.typeWords?.[t]}
                  value={draft.typeWords[t]}
                  onChange={(v) => set({ typeWords: { ...draft.typeWords, [t]: v } })}
                  mono
                  readOnly={locked}
                />
              ))}
            </div>
            <span className="text-caption text-dim">
              {locked ? `${C.typeWordsHint} ${C.locked}` : C.typeWordsHint}
            </span>
          </fieldset>
          <Preview draft={draft} projectKey={projectKey} />
        </>
      )}
    </div>
  );
}
