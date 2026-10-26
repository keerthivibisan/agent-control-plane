import { parseGitHubRepository, type CodeHostStatusDto } from '@acp/core/api';
import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { Button } from '../../components/Button';
import { Details } from '../../components/Details';
import { ErrorNotice } from '../../components/ErrorNotice';
import { AlertIcon } from '../../components/icons';
import { hintClass, inputClass, labelClass } from '../../components/Input';
import { Segmented } from '../../components/Segmented';
import {
  ApiError,
  branchPaths,
  codeHostPaths,
  connectCodeHostRepository,
  createCodeHostRepository,
  paths,
  schemas,
  type ApiClient,
} from '../../lib/api';
import { CODE_HOST_CONNECT_COPY } from '../../lib/copy';
import { useApiQuery, useQueryStore } from '../../lib/query';
import { alertClass } from '../control/bits';
import { useProjectBranches } from './Branches';
import { checkCreateRepo, connectErrorText, defaultRepoName } from './code-host';

const C = CODE_HOST_CONNECT_COPY;

type Mode = 'create' | 'existing';

function toApiError(e: unknown): ApiError {
  if (e instanceof ApiError) return e;
  return new ApiError({
    kind: 'parse',
    path: '',
    message: e instanceof Error ? e.message : 'unknown client error',
  });
}

/**
 * One connect action (create or connect): the owner's click only. Afterwards the code host status
 * is asked again, also after a failure, as a refusal can mean origin was set meanwhile, or the
 * repository was created before a later step failed.
 */
function useConnectAction<A extends unknown[]>(
  projectId: string,
  fn: (client: ApiClient, projectId: string, ...args: A) => Promise<CodeHostStatusDto>,
  onDone: (status: CodeHostStatusDto) => void,
) {
  const store = useQueryStore();
  const [state, setState] = useState<{ pending: boolean; error: ApiError | null }>({
    pending: false,
    error: null,
  });
  const run = useCallback(
    async (...args: A) => {
      setState({ pending: true, error: null });
      const statusPath = codeHostPaths.status(projectId);
      try {
        const status = await fn(store.client, projectId, ...args);
        setState({ pending: false, error: null });
        onDone(status);
      } catch (e) {
        setState({ pending: false, error: toApiError(e) });
      } finally {
        // G-F: a push now also changes which branches are on origin.
        const branchesPath = branchPaths.list(projectId);
        store.invalidate((key) => key === statusPath || key === branchesPath);
      }
    },
    [store, fn, projectId, onDone],
  );
  return { ...state, run };
}

/** A failed create or connect, in plain words, focused so it is read out. */
function ConnectError({ error }: { error: ApiError | null }) {
  const ref = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (error !== null) ref.current?.focus();
  }, [error]);
  if (error === null) return null;
  const text = connectErrorText(error);
  return (
    <div
      className="flex flex-col gap-1.5"
      data-testid="code-host-connect-error"
      data-code={error.code ?? ''}
    >
      <p ref={ref} tabIndex={-1} role="alert" className={`${alertClass} outline-none`}>
        <AlertIcon size={16} className="mt-0.5 shrink-0" />
        <span className="min-w-0">{text ?? C.failed}</span>
      </p>
      {text === null ? (
        <Details>
          <ErrorNotice error={error} />
        </Details>
      ) : null}
    </div>
  );
}

function FieldError({ id, text }: { id: string; text: string | undefined }) {
  if (text === undefined) return null;
  return (
    <span id={id} className="text-caption text-danger">
      {text}
    </span>
  );
}

/** Create a new repository: name, owner, visibility, push now; one line says what happens. */
function CreateForm({
  projectId,
  onDone,
}: {
  projectId: string;
  onDone: (status: CodeHostStatusDto) => void;
}) {
  const id = useId();
  const project = useApiQuery(paths.project(projectId), schemas.project);
  // The folder's name until the owner types one.
  const [typedName, setTypedName] = useState<string | null>(null);
  const name = typedName ?? (project.data === undefined ? '' : defaultRepoName(project.data));
  const [owner, setOwner] = useState('');
  const [visibility, setVisibility] = useState<'private' | 'public'>('private');
  const [push, setPush] = useState(true);
  // G-F: the branch the project folder is on, so the checkbox can name it ("Push main now").
  const current = useProjectBranches(projectId).data?.current ?? null;
  const [touched, setTouched] = useState({ name: false, owner: false, submit: false });
  const action = useConnectAction(projectId, createCodeHostRepository, onDone);
  const check = checkCreateRepo({ name, owner, visibility, push });
  const show = {
    name: touched.name || touched.submit || typedName !== null ? check.errors.name : undefined,
    owner: touched.owner || touched.submit ? check.errors.owner : undefined,
  };
  const nameRef = useRef<HTMLInputElement>(null);
  const ownerRef = useRef<HTMLInputElement>(null);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (action.pending) return;
    setTouched((t) => ({ ...t, submit: true }));
    if (check.request === null) {
      // Focus the first field to fix.
      (check.errors.name !== undefined ? nameRef : ownerRef).current?.focus();
      return;
    }
    void action.run(check.request);
  };

  const ids = {
    name: `${id}-name`,
    owner: `${id}-owner`,
    push: `${id}-push`,
    summary: `${id}-summary`,
  };
  const trimmedOwner = owner.trim();
  return (
    <form
      onSubmit={submit}
      noValidate
      aria-busy={action.pending}
      className="flex flex-col gap-4"
      data-testid="code-host-create"
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex min-w-0 flex-col gap-1.5">
          <label htmlFor={ids.name} className={labelClass}>
            {C.create.name}
          </label>
          <input
            ref={nameRef}
            id={ids.name}
            value={name}
            onChange={(e) => setTypedName(e.target.value)}
            onBlur={() => setTouched((t) => ({ ...t, name: true }))}
            disabled={action.pending}
            autoComplete="off"
            spellCheck={false}
            maxLength={100}
            aria-invalid={show.name !== undefined}
            aria-describedby={`${ids.name}-hint${show.name !== undefined ? ` ${ids.name}-error` : ''}`}
            className={inputClass('font-mono')}
          />
          <span id={`${ids.name}-hint`} className={hintClass}>
            {C.create.nameHint}
          </span>
          <FieldError id={`${ids.name}-error`} text={show.name} />
        </div>
        <div className="flex min-w-0 flex-col gap-1.5">
          <label htmlFor={ids.owner} className={labelClass}>
            {C.create.owner}
          </label>
          <input
            ref={ownerRef}
            id={ids.owner}
            value={owner}
            onChange={(e) => setOwner(e.target.value)}
            onBlur={() => setTouched((t) => ({ ...t, owner: true }))}
            placeholder={C.create.ownerPlaceholder}
            disabled={action.pending}
            autoComplete="off"
            spellCheck={false}
            maxLength={39}
            aria-invalid={show.owner !== undefined}
            aria-describedby={`${ids.owner}-hint${show.owner !== undefined ? ` ${ids.owner}-error` : ''}`}
            className={inputClass('font-mono')}
          />
          <span id={`${ids.owner}-hint`} className={hintClass}>
            {C.create.ownerHint}
          </span>
          <FieldError id={`${ids.owner}-error`} text={show.owner} />
        </div>
      </div>

      <fieldset className="flex flex-col gap-2" disabled={action.pending}>
        <legend className={`${labelClass} mb-1.5`}>{C.create.visibility}</legend>
        {(['private', 'public'] as const).map((v) => (
          <div key={v} className="flex items-start gap-2.5">
            <input
              id={`${id}-${v}`}
              type="radio"
              name={`${id}-visibility`}
              value={v}
              checked={visibility === v}
              onChange={() => setVisibility(v)}
              aria-describedby={`${id}-${v}-hint`}
              className="mt-0.5 size-4 shrink-0 accent-accent"
            />
            <span className="flex flex-col">
              <label htmlFor={`${id}-${v}`} className={labelClass}>
                {C.create[v]}
              </label>
              <span id={`${id}-${v}-hint`} className={hintClass}>
                {v === 'private' ? C.create.privateHint : C.create.publicHint}
              </span>
            </span>
          </div>
        ))}
      </fieldset>

      <div className="flex items-start gap-2.5">
        <input
          id={ids.push}
          type="checkbox"
          checked={push}
          onChange={(e) => setPush(e.target.checked)}
          disabled={action.pending}
          aria-describedby={`${ids.push}-hint`}
          className="mt-0.5 size-4 shrink-0 accent-accent"
        />
        <span className="flex flex-col">
          <label htmlFor={ids.push} className={labelClass}>
            {current === null ? C.create.push : C.create.pushNamed(current)}
          </label>
          <span id={`${ids.push}-hint`} className={hintClass}>
            {C.create.pushHint}
          </span>
        </span>
      </div>

      {check.request !== null ? (
        <p
          id={ids.summary}
          className="rounded-control border border-line bg-sunken px-3 py-2 text-caption break-words"
          data-testid="code-host-create-summary"
        >
          {C.create.summary(
            trimmedOwner === '' ? null : trimmedOwner,
            check.request.name,
            visibility,
            push,
            current,
          )}
        </p>
      ) : null}

      <ConnectError error={action.error} />

      <div>
        <Button
          type="submit"
          variant="primary"
          disabled={action.pending}
          aria-describedby={check.request !== null ? ids.summary : undefined}
        >
          {action.pending ? C.create.busy : C.create.button}
        </Button>
      </div>
    </form>
  );
}

/** Connect an existing repository: one field, read live with `parseGitHubRepository`. */
function ExistingForm({
  projectId,
  onDone,
}: {
  projectId: string;
  onDone: (status: CodeHostStatusDto) => void;
}) {
  const id = useId();
  const [text, setText] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const action = useConnectAction(projectId, connectCodeHostRepository, onDone);
  const inputRef = useRef<HTMLInputElement>(null);
  const trimmed = text.trim();
  const parsed = trimmed === '' ? null : parseGitHubRepository(trimmed);
  const error = (trimmed !== '' || submitted) && parsed === null ? C.existing.invalid : undefined;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (action.pending) return;
    setSubmitted(true);
    if (parsed === null) {
      inputRef.current?.focus();
      return;
    }
    void action.run({ repository: trimmed });
  };

  const field = `${id}-repo`;
  return (
    <form
      onSubmit={submit}
      noValidate
      aria-busy={action.pending}
      className="flex flex-col gap-4"
      data-testid="code-host-existing"
    >
      <div className="flex min-w-0 flex-col gap-1.5">
        <label htmlFor={field} className={labelClass}>
          {C.existing.label}
        </label>
        <input
          ref={inputRef}
          id={field}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={C.existing.placeholder}
          disabled={action.pending}
          autoComplete="off"
          spellCheck={false}
          maxLength={300}
          aria-invalid={error !== undefined}
          aria-describedby={`${field}-hint ${field}-read`}
          className={inputClass('font-mono')}
        />
        <span id={`${field}-hint`} className={hintClass}>
          {C.existing.hint}
        </span>
        {/* Polite: what the text reads as, while typing. */}
        <span id={`${field}-read`} aria-live="polite" data-testid="code-host-existing-read">
          {parsed !== null ? (
            <span className="text-caption text-ink">
              {C.existing.summary(parsed.owner, parsed.name, parsed.protocol)}
            </span>
          ) : error !== undefined ? (
            <span className="text-caption text-danger">{error}</span>
          ) : null}
        </span>
      </div>

      <ConnectError error={action.error} />

      <div>
        <Button type="submit" variant="primary" disabled={action.pending}>
          {action.pending ? C.existing.busy : C.existing.button}
        </Button>
      </div>
    </form>
  );
}

/**
 * Logged in to GitHub and no origin yet (ADR-0025 §7): create a new repository or connect an
 * existing one. Each writes only `origin`, and only on the owner's click.
 */
export function ConnectRepository({
  projectId,
  onDone,
}: {
  projectId: string;
  onDone: (status: CodeHostStatusDto) => void;
}) {
  const [mode, setMode] = useState<Mode>('create');
  return (
    <div className="flex flex-col gap-4" data-testid="code-host-connect">
      <Segmented<Mode>
        label={C.connect.choose}
        hideLabel
        value={mode}
        onChange={setMode}
        options={[
          { value: 'create', label: C.connect.create },
          { value: 'existing', label: C.connect.existing },
        ]}
      />
      {/* Both forms stay mounted, so switching keeps what was typed. */}
      <div hidden={mode !== 'create'}>
        <CreateForm projectId={projectId} onDone={onDone} />
      </div>
      <div hidden={mode !== 'existing'}>
        <ExistingForm projectId={projectId} onDone={onDone} />
      </div>
    </div>
  );
}
