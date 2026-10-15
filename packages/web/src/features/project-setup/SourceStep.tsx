import type { ProjectDto } from '@acp/core/api';
import { useId, useState } from 'react';
import { Details } from '../../components/Details';
import { ErrorNotice } from '../../components/ErrorNotice';
import { CheckIcon } from '../../components/icons';
import { ApiError, createRepoProject } from '../../lib/api';
import { PROJECT_SETUP_COPY, SETUP_COPY } from '../../lib/copy';
import { useQueryStore } from '../../lib/query';
import { useRegisterProject, type FieldErrors } from '../setup/register';
import { ChoiceCards, TextAreaField, TextField } from './fields';
import {
  createRepoErrorMessage,
  joinFolder,
  newRepoRequest,
  validateNewRepo,
  type NewRepoErrors,
  type NewRepoInput,
} from './setup-form';

export type SourceMode = 'existing' | 'new';

export interface SourceDraft {
  mode: SourceMode;
  existing: { name: string; rootPath: string };
  repo: NewRepoInput;
}

export const EMPTY_SOURCE: SourceDraft = {
  mode: 'existing',
  existing: { name: '', rootPath: '' },
  repo: { parentDir: '', name: '', readme: '' },
};

const S = PROJECT_SETUP_COPY.source;
const ADD = SETUP_COPY.addProject;

type Failure = { message: string; error: ApiError } | null;

/**
 * Step 1: add an existing folder (POST /api/projects, the Setup page's logic) or create a new git
 * repository (POST /api/projects/new). Returns a `submit` the wizard's Next button calls.
 */
export function useSourceStep(onCreated: (project: ProjectDto) => void) {
  const store = useQueryStore();
  const { register, pending: registering } = useRegisterProject();
  const [draft, setDraft] = useState<SourceDraft>(EMPTY_SOURCE);
  const [existingErrors, setExistingErrors] = useState<FieldErrors>({});
  const [repoErrors, setRepoErrors] = useState<NewRepoErrors>({});
  const [failure, setFailure] = useState<Failure>(null);
  const [creating, setCreating] = useState(false);

  const submit = async (): Promise<void> => {
    setFailure(null);
    if (draft.mode === 'existing') {
      const r = await register(draft.existing);
      if (r.ok) {
        setExistingErrors({});
        onCreated(r.project);
      } else if (r.kind === 'invalid') setExistingErrors(r.fields);
      else setFailure({ message: r.message, error: r.error });
      return;
    }
    const errors = validateNewRepo(draft.repo);
    setRepoErrors(errors);
    const request = newRepoRequest(draft.repo);
    if (Object.keys(errors).length > 0 || request === null) return;
    setCreating(true);
    try {
      const project = await createRepoProject(store.client, request);
      store.invalidate((key) => !key.endsWith('/health'));
      onCreated(project);
    } catch (e) {
      if (!(e instanceof ApiError)) throw e;
      setFailure({ message: createRepoErrorMessage(e), error: e });
    } finally {
      setCreating(false);
    }
  };

  return {
    draft,
    setDraft,
    existingErrors,
    repoErrors,
    failure,
    pending: registering || creating,
    submit,
  };
}

export type SourceStepState = ReturnType<typeof useSourceStep>;

export function SourceStep({ state }: { state: SourceStepState }) {
  const name = useId();
  const { draft, setDraft, existingErrors, repoErrors, failure } = state;
  const setExisting = (patch: Partial<SourceDraft['existing']>) =>
    setDraft((d) => ({ ...d, existing: { ...d.existing, ...patch } }));
  const setRepo = (patch: Partial<NewRepoInput>) =>
    setDraft((d) => ({ ...d, repo: { ...d.repo, ...patch } }));
  const target =
    draft.repo.parentDir.trim() !== '' && draft.repo.name.trim() !== ''
      ? joinFolder(draft.repo.parentDir, draft.repo.name)
      : null;

  return (
    <div className="flex flex-col gap-6">
      <ChoiceCards<SourceMode>
        legend={S.choiceLabel}
        name={`${name}-mode`}
        value={draft.mode}
        options={[
          { value: 'existing', label: S.existing, hint: S.existingHint },
          { value: 'new', label: S.newRepo, hint: S.newRepoHint },
        ]}
        onChange={(mode) => setDraft((d) => ({ ...d, mode }))}
      />
      {draft.mode === 'existing' ? (
        <div className="flex flex-wrap items-start gap-4" data-testid="source-existing">
          <TextField
            label={ADD.nameLabel}
            hint={ADD.nameHint}
            error={existingErrors.name}
            value={draft.existing.name}
            onChange={(v) => setExisting({ name: v })}
            placeholder={ADD.namePlaceholder}
            className="w-full sm:w-56"
          />
          <TextField
            label={ADD.pathLabel}
            hint={ADD.pathHint}
            error={existingErrors.rootPath}
            value={draft.existing.rootPath}
            onChange={(v) => setExisting({ rootPath: v })}
            placeholder={ADD.pathPlaceholder}
            mono
            className="flex-1 basis-80"
          />
        </div>
      ) : (
        <div className="flex flex-col gap-4" data-testid="source-new">
          <div className="flex flex-wrap items-start gap-4">
            <TextField
              label={S.parentLabel}
              hint={S.parentHint}
              error={repoErrors.parentDir}
              value={draft.repo.parentDir}
              onChange={(v) => setRepo({ parentDir: v })}
              placeholder={S.parentPlaceholder}
              mono
              className="flex-1 basis-80"
            />
            <TextField
              label={S.nameLabel}
              hint={S.nameHint}
              error={repoErrors.name}
              value={draft.repo.name}
              onChange={(v) => setRepo({ name: v })}
              placeholder={S.namePlaceholder}
              mono
              className="w-full sm:w-64"
            />
          </div>
          {target ? (
            <p className="text-caption text-dim">
              {S.willCreate}: <code className="font-mono text-ink">{target}</code>
            </p>
          ) : null}
          <TextAreaField
            label={S.readmeLabel}
            hint={S.readmeHint}
            error={repoErrors.readme}
            value={draft.repo.readme}
            onChange={(v) => setRepo({ readme: v })}
            placeholder={S.readmePlaceholder}
          />
        </div>
      )}
      {failure ? (
        <div className="flex flex-col gap-2">
          <p
            role="alert"
            className="rounded-control border border-danger/30 bg-danger-soft px-3 py-2 text-danger"
          >
            {failure.message}
          </p>
          <Details>
            <ErrorNotice error={failure.error} />
          </Details>
        </div>
      ) : null}
    </div>
  );
}

/** Step 1 after the project exists: what was added; going back can't add it twice. */
export function SourceDone({ project, created }: { project: ProjectDto; created: boolean }) {
  return (
    <div className="flex flex-col gap-3">
      <div
        role="status"
        className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-control border border-success/30 bg-success/10 px-3 py-2"
      >
        <CheckIcon size={16} className="shrink-0 text-success" />
        <span>
          <strong className="font-semibold">{S.added(project.name)}</strong>{' '}
          <span className="text-dim">{created ? S.createdText : S.addedText}</span>
        </span>
      </div>
      <p className="text-caption text-dim">
        <code className="font-mono text-ink">{project.rootPath}</code>
      </p>
      <p className="text-dim">{S.alreadyAdded}</p>
    </div>
  );
}
