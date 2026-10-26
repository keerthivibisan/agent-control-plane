import type { BranchStrategy, TicketBranchPrefs } from '@acp/core';
import type { ProjectBranchesDto } from '@acp/core/api';
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react';
import { Button, buttonClass } from '../../components/Button';
import { Card } from '../../components/Card';
import { Details } from '../../components/Details';
import { ErrorNotice } from '../../components/ErrorNotice';
import { AlertIcon, CheckIcon } from '../../components/icons';
import { Select, hintClass, inputClass, labelClass } from '../../components/Input';
import { Pill } from '../../components/Pill';
import { LoadingBlock } from '../../components/Skeleton';
import {
  ApiError,
  branchPaths,
  branchSchemas,
  codeHostPaths,
  codeHostSchemas,
  createProjectBranch,
  type CreateBranchRequest,
} from '../../lib/api';
import { PROJECT_BRANCHES_COPY } from '../../lib/copy';
import { useApiQuery, useQueryStore } from '../../lib/query';
import { alertClass } from '../control/bits';
import { BranchIcon } from '../review-loop/icons';
import {
  createBranchErrorText,
  defaultBase,
  isMissing,
  isTargetMissing,
  missingStartBranch,
  newBranchError,
  shortCommit,
} from './branch-list';

/**
 * The code host status, only to word the push choice ("GitHub" or "origin"); the same cached
 * query as the GitHub card's `useCodeHost`, kept here so the modules don't import each other.
 */
function useCodeHost(projectId: string | null) {
  return useApiQuery(
    projectId === null ? null : codeHostPaths.status(projectId),
    codeHostSchemas.status,
  );
}

const C = PROJECT_BRANCHES_COPY;

/**
 * The project's local branches (`GET /api/projects/:id/branches`), read from git when a screen
 * that needs them is shown and on Refresh; never on a timer and never a fetch (ADR-0025 §8).
 */
export function useProjectBranches(projectId: string | null) {
  const path = projectId === null ? null : branchPaths.list(projectId);
  const q = useApiQuery(path, branchSchemas.list);
  const store = useQueryStore();
  const refresh = useCallback(() => {
    if (path !== null) store.invalidate((key) => key === path);
  }, [store, path]);
  return { ...q, refresh };
}

function toApiError(e: unknown): ApiError {
  if (e instanceof ApiError) return e;
  return new ApiError({
    kind: 'parse',
    path: '',
    message: e instanceof Error ? e.message : 'unknown client error',
  });
}

/**
 * One create, on the owner's click only. The list is read again afterwards, also after a
 * failure: a failed push still leaves the branch created, and a refusal can mean it appeared.
 */
export function useCreateBranch(projectId: string) {
  const store = useQueryStore();
  const [state, setState] = useState<{ pending: boolean; error: ApiError | null }>({
    pending: false,
    error: null,
  });
  const run = useCallback(
    async (input: CreateBranchRequest): Promise<ProjectBranchesDto | null> => {
      setState({ pending: true, error: null });
      const path = branchPaths.list(projectId);
      try {
        const dto = await createProjectBranch(store.client, projectId, input);
        setState({ pending: false, error: null });
        return dto;
      } catch (e) {
        setState({ pending: false, error: toApiError(e) });
        return null;
      } finally {
        store.invalidate((key) => key === path);
      }
    },
    [store, projectId],
  );
  return { ...state, run };
}

/** A failed create in plain words, focused so it is read out. */
export function BranchError({ error }: { error: ApiError | null }) {
  const ref = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (error !== null) ref.current?.focus();
  }, [error]);
  if (error === null) return null;
  const text = createBranchErrorText(error);
  return (
    <div
      className="flex flex-col gap-1.5"
      data-testid="branch-create-error"
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

/** "Also push to GitHub", only when the project has an origin. */
function PushCheckbox({
  id,
  checked,
  onChange,
  github,
  disabled,
}: {
  id: string;
  checked: boolean;
  onChange: (next: boolean) => void;
  github: boolean;
  disabled: boolean;
}) {
  return (
    <div className="flex items-start gap-2.5">
      <input
        id={id}
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        disabled={disabled}
        aria-describedby={`${id}-hint`}
        className="mt-0.5 size-4 shrink-0 accent-accent"
        data-testid="branch-push"
      />
      <span className="flex flex-col">
        <label htmlFor={id} className={labelClass}>
          {C.push(github)}
        </label>
        <span id={`${id}-hint`} className={hintClass}>
          {C.pushHint}
        </span>
      </span>
    </div>
  );
}

/** The local branches as `<option>`s, leaving out `except` (the branch being created). */
function BranchOptions({ dto, except }: { dto: ProjectBranchesDto; except?: string }) {
  return (
    <>
      {dto.branches
        .filter((b) => b.name !== except)
        .map((b) => (
          <option key={b.name} value={b.name}>
            {b.name}
          </option>
        ))}
    </>
  );
}

/**
 * Whether to push by default: on when origin is on GitHub (the code host status says so), off for
 * another host or while that is unknown. The owner's own choice wins once made.
 */
function usePushChoice(projectId: string, dto: ProjectBranchesDto | undefined) {
  const host = useCodeHost(dto?.hasOrigin === true ? projectId : null);
  const github = host.data?.provider === 'github';
  const [choice, setChoice] = useState<boolean | null>(null);
  const shown = dto?.hasOrigin === true;
  return { shown, github, push: shown && (choice ?? github), setPush: setChoice };
}

/**
 * Create one named branch in a click (ADR-0025 §8): "From" (the default base preselected), the
 * push choice when there is an origin, and "Create <name> from <base>". No `<form>`, so it can sit
 * inside the Settings and ticket forms. `onCreated` runs once the server has the branch.
 */
export function CreateNamedBranch({
  projectId,
  name,
  preferredBase,
  onCreated,
  testId = 'branch-create-inline',
  focusOnShow = false,
}: {
  projectId: string;
  name: string;
  /** Preselected in From when it exists: the strategy's base branch. */
  preferredBase: string | undefined;
  onCreated: (result: { name: string; pushed: boolean; branches: ProjectBranchesDto }) => void;
  testId?: string;
  /** Focus the create button once it is shown (after "Create it" opened this). */
  focusOnShow?: boolean;
}) {
  const id = useId();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const focused = useRef(false);
  const branches = useProjectBranches(projectId);
  const dto = branches.data;
  const [picked, setPicked] = useState<string | null>(null);
  const base =
    dto === undefined
      ? null
      : picked !== null && picked !== name && dto.branches.some((b) => b.name === picked)
        ? picked
        : defaultBase(dto, preferredBase, name);
  const choice = usePushChoice(projectId, dto);
  const create = useCreateBranch(projectId);
  const ready = base !== null;
  useEffect(() => {
    if (focusOnShow && ready && !focused.current) {
      focused.current = true;
      buttonRef.current?.focus();
    }
  }, [focusOnShow, ready]);

  if (dto === undefined) {
    return branches.error !== null ? (
      <p className="text-caption text-danger" data-testid={testId}>
        {C.loadFailed}
      </p>
    ) : (
      <p className="text-caption text-dim" data-testid={testId}>
        {C.loading}
      </p>
    );
  }
  if (base === null) {
    return (
      <p className="text-caption text-dim" data-testid={testId}>
        {C.noBase}
      </p>
    );
  }
  const run = async () => {
    if (create.pending) return;
    const pushed = choice.push;
    const result = await create.run({ name, from: base, ...(pushed && { push: true }) });
    if (result !== null) onCreated({ name, pushed, branches: result });
  };
  return (
    <div className="flex flex-col gap-3" data-testid={testId} aria-busy={create.pending}>
      <div className="flex flex-wrap items-end gap-x-4 gap-y-3">
        <div className="flex w-full min-w-0 flex-col gap-1.5 sm:w-56">
          <label htmlFor={`${id}-from`} className={labelClass}>
            {C.from}
          </label>
          <Select
            id={`${id}-from`}
            value={base}
            onChange={(e) => setPicked(e.target.value)}
            disabled={create.pending}
            className="font-mono"
            data-testid="branch-from"
          >
            <BranchOptions dto={dto} except={name} />
          </Select>
        </div>
        {choice.shown ? (
          <PushCheckbox
            id={`${id}-push`}
            checked={choice.push}
            onChange={choice.setPush}
            github={choice.github}
            disabled={create.pending}
          />
        ) : null}
      </div>
      <div>
        {/* A native button (the shared look) so focus can move to it. */}
        <button
          ref={buttonRef}
          type="button"
          className={`${buttonClass('primary', 'sm')} max-w-full`}
          onClick={() => void run()}
          disabled={create.pending}
          data-testid="branch-create-button"
        >
          <BranchIcon size={14} />
          <span className="truncate">{create.pending ? C.busy : C.createFrom(name, base)}</span>
        </button>
      </div>
      <BranchError error={create.error} />
    </div>
  );
}

/** A short success line, focused when it appears so the change is read out. */
function Created({ children, testId }: { children: ReactNode; testId: string }) {
  const ref = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    ref.current?.focus();
  }, []);
  return (
    <p
      ref={ref}
      tabIndex={-1}
      role="status"
      className="flex items-center gap-1.5 text-caption text-success outline-none"
      data-testid={testId}
    >
      <CheckIcon size={14} className="shrink-0" />
      <span className="min-w-0 break-words">{children}</span>
    </p>
  );
}

/**
 * Under a branch field (the strategy's base or target, a ticket's target): when the typed branch
 * is a safe name that the project folder doesn't have, a warning with "Create it", which opens
 * the one-click create. Nothing while the list loads, or when it was cut at 500.
 */
export function MissingBranchNote({
  projectId,
  name,
  preferredBase,
  testId,
  direct = false,
}: {
  projectId: string;
  name: string;
  preferredBase: string | undefined;
  testId: string;
  /** Show "Create <name> from <base>" at once instead of behind "Create it". */
  direct?: boolean;
}) {
  const branches = useProjectBranches(projectId);
  const [opened, setOpen] = useState(false);
  const open = direct || opened;
  const [created, setCreated] = useState<{ name: string; pushed: boolean } | null>(null);
  const missing = isMissing(branches.data, name);
  if (created !== null && created.name === name) {
    return (
      <Created testId={`${testId}-created`}>{C.created(created.name, created.pushed)}</Created>
    );
  }
  if (!missing) return null;
  return (
    <div
      className="flex flex-col gap-3 rounded-control border border-warning/30 bg-warning-soft px-3 py-2.5"
      data-testid={testId}
      data-branch={name}
    >
      <p className="flex flex-wrap items-start gap-x-2 gap-y-1.5">
        <AlertIcon size={16} className="mt-0.5 shrink-0 text-warning" />
        <span className="min-w-0 flex-1 break-words">{C.strategyMissing(name)}</span>
        {!open ? (
          <Button size="sm" onClick={() => setOpen(true)} data-testid={`${testId}-open`}>
            {C.createIt}
          </Button>
        ) : null}
      </p>
      {open ? (
        <CreateNamedBranch
          projectId={projectId}
          name={name}
          preferredBase={preferredBase}
          focusOnShow={!direct}
          onCreated={(r) => {
            setOpen(false);
            setCreated({ name: r.name, pushed: r.pushed });
          }}
        />
      ) : null}
    </div>
  );
}

/**
 * The Start refusal's fix (ADR-0025 §8): when Start was refused with `target_branch_missing`, or
 * (G-H, §10) `source_branch_missing` for the branch the ticket branch starts from, "Create <name>
 * from <base>"; once created, `onRetry` runs exactly once (the caller starts the ticket again,
 * visibly). If the branch exists by now (made in a terminal), "Start again" instead.
 */
export function MissingTargetFix({
  projectId,
  ticketBranch,
  strategy,
  error,
  onRetry,
}: {
  projectId: string;
  ticketBranch: TicketBranchPrefs | undefined;
  strategy: BranchStrategy | undefined;
  error: ApiError | null;
  onRetry: () => void;
}) {
  const target = missingStartBranch(error, ticketBranch, strategy);
  const branches = useProjectBranches(target === null ? null : projectId);
  /** The refusal already retried: one Start again per refusal, never a second on its own. */
  const retriedFor = useRef<ApiError | null>(null);
  // The retried Start clears the error, so the fix goes away with it; the caller shows the start.
  if (target === null) return null;
  const kind = isTargetMissing(error) ? 'target' : 'source';
  const retry = () => {
    if (retriedFor.current === error) return;
    retriedFor.current = error;
    onRetry();
  };
  const exists = branches.data !== undefined && !isMissing(branches.data, target);
  return (
    <div
      className="flex flex-col gap-3 rounded-control border border-line bg-sunken px-3 py-3"
      data-testid="start-fix"
      data-target={target}
      data-kind={kind}
    >
      {exists ? (
        <div className="flex flex-wrap items-center gap-3">
          <span>{C.missing.exists(target)}</span>
          <Button variant="primary" size="sm" onClick={retry} data-testid="start-fix-again">
            {C.missing.startAgain}
          </Button>
        </div>
      ) : (
        <>
          <p className="break-words">
            {kind === 'target' ? C.missing.text(target) : C.sourceMissing(target)}
          </p>
          <CreateNamedBranch
            projectId={projectId}
            name={target}
            preferredBase={strategy?.baseBranch}
            testId="start-fix-create"
            onCreated={retry}
          />
        </>
      )}
    </div>
  );
}

/** One row of the list: the name, Current and On GitHub, and the short commit. */
function BranchRow({
  name,
  commit,
  current,
  onOrigin,
  github,
}: {
  name: string;
  commit: string;
  current: boolean;
  onOrigin: boolean | null;
  github: boolean;
}) {
  return (
    <li
      className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2"
      data-testid="branch-row"
      data-branch={name}
      data-current={current ? '' : undefined}
    >
      <BranchIcon size={14} className="shrink-0 text-dim" />
      <span className="min-w-0 font-mono font-medium break-all text-ink">{name}</span>
      {current ? (
        <Pill tone="accent" title={C.currentTip} testId="branch-current">
          {C.current}
        </Pill>
      ) : null}
      {onOrigin === true ? (
        <Pill tone="success" dot={false} title={C.onOriginTip} testId="branch-on-origin">
          {C.onOrigin(github)}
        </Pill>
      ) : null}
      <span className="ml-auto font-mono text-caption text-dim" title={commit}>
        <span className="sr-only">{C.commitLabel(shortCommit(commit))}</span>
        <span aria-hidden="true">{shortCommit(commit)}</span>
      </span>
    </li>
  );
}

/** New branch: a name (checked as typed), From (default the current branch), push, Create. */
function NewBranchForm({ projectId, dto }: { projectId: string; dto: ProjectBranchesDto }) {
  const id = useId();
  const [name, setName] = useState('');
  const [touched, setTouched] = useState(false);
  const [picked, setPicked] = useState<string | null>(null);
  const [done, setDone] = useState<{ name: string; pushed: boolean } | null>(null);
  const choice = usePushChoice(projectId, dto);
  const create = useCreateBranch(projectId);
  const nameRef = useRef<HTMLInputElement>(null);
  const trimmed = name.trim();
  const error = newBranchError(name, dto);
  const shownError = touched ? error : undefined;
  const from =
    picked !== null && dto.branches.some((b) => b.name === picked)
      ? picked
      : (dto.current ?? defaultBase(dto, undefined, trimmed));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (create.pending) return;
    setTouched(true);
    setDone(null);
    if (error !== undefined || from === null) {
      nameRef.current?.focus();
      return;
    }
    const pushed = choice.push;
    const result = await create.run({ name: trimmed, from, ...(pushed && { push: true }) });
    if (result !== null) {
      setDone({ name: trimmed, pushed });
      setName('');
      setTouched(false);
      nameRef.current?.focus();
    }
  };

  return (
    <form
      onSubmit={(e) => void submit(e)}
      noValidate
      aria-busy={create.pending}
      aria-labelledby={`${id}-title`}
      className="flex flex-col gap-4"
      data-testid="branch-new"
    >
      <h3 id={`${id}-title`} className="font-semibold">
        {C.newTitle}
      </h3>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex min-w-0 flex-col gap-1.5">
          <label htmlFor={`${id}-name`} className={labelClass}>
            {C.name}
          </label>
          <input
            ref={nameRef}
            id={`${id}-name`}
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setDone(null);
            }}
            onBlur={() => setTouched(trimmed !== '')}
            disabled={create.pending}
            autoComplete="off"
            spellCheck={false}
            maxLength={200}
            placeholder="dev"
            aria-invalid={shownError !== undefined}
            aria-describedby={`${id}-name-hint${shownError !== undefined ? ` ${id}-name-error` : ''}`}
            className={inputClass('font-mono')}
            data-testid="branch-name"
          />
          <span id={`${id}-name-hint`} className={hintClass}>
            {C.nameHint}
          </span>
          {shownError !== undefined ? (
            <span id={`${id}-name-error`} className="text-caption font-medium text-danger">
              {shownError}
            </span>
          ) : null}
        </div>
        <div className="flex min-w-0 flex-col gap-1.5">
          <label htmlFor={`${id}-from`} className={labelClass}>
            {C.from}
          </label>
          {from === null ? (
            <p className="text-caption text-dim">{C.noBase}</p>
          ) : (
            <Select
              id={`${id}-from`}
              value={from}
              onChange={(e) => setPicked(e.target.value)}
              disabled={create.pending}
              aria-describedby={`${id}-from-hint`}
              className="font-mono"
              data-testid="branch-from"
            >
              <BranchOptions dto={dto} />
            </Select>
          )}
          <span id={`${id}-from-hint`} className={hintClass}>
            {C.fromHint}
          </span>
        </div>
      </div>
      {choice.shown ? (
        <PushCheckbox
          id={`${id}-push`}
          checked={choice.push}
          onChange={choice.setPush}
          github={choice.github}
          disabled={create.pending}
        />
      ) : null}
      <BranchError error={create.error} />
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" variant="primary" disabled={create.pending || from === null}>
          {create.pending ? C.busy : C.create}
        </Button>
        <span role="status" className="text-caption text-success" data-testid="branch-created">
          {done !== null ? C.created(done.name, done.pushed) : ''}
        </span>
      </div>
    </form>
  );
}

/**
 * Settings' Local branches card (ADR-0025 §8): the project folder's branches (current, on GitHub,
 * short commit) and New branch. Read when shown and on Refresh; nothing on a timer.
 */
export function BranchesCard({ projectId }: { projectId: string }) {
  const branches = useProjectBranches(projectId);
  const dto = branches.data;
  const host = useCodeHost(dto?.hasOrigin === true ? projectId : null);
  const github = host.data?.provider === 'github';
  return (
    <Card
      title={C.card.title}
      tip={C.card.tip}
      description={C.card.description}
      testId="settings-branches"
      actions={
        <Button size="sm" onClick={branches.refresh} disabled={branches.fetching}>
          {branches.fetching && dto !== undefined ? C.refreshing : C.refresh}
        </Button>
      }
    >
      {dto === undefined ? (
        branches.error !== null ? (
          <div className="flex flex-col gap-1.5" data-testid="branches-error">
            <p role="alert" className="flex items-start gap-2 text-danger">
              <AlertIcon size={16} className="mt-0.5 shrink-0" />
              {branches.error.kind === 'http' && branches.error.code === 'not_a_git_repository'
                ? C.errors.not_a_git_repository
                : C.loadFailed}
            </p>
            <Details>
              <ErrorNotice error={branches.error} />
            </Details>
          </div>
        ) : (
          <LoadingBlock label={C.loading} />
        )
      ) : (
        <div className="flex flex-col gap-5">
          {dto.branches.length === 0 ? (
            <p className="text-dim" data-testid="branches-empty">
              {C.empty}
            </p>
          ) : (
            <div className="flex flex-col gap-1.5">
              <p className="text-caption text-dim" data-testid="branches-count">
                {C.count(dto.branches.length)}
                {dto.truncated ? ` ${C.truncated}` : ''}
              </p>
              {/* Focusable, so a long list can be scrolled with the keyboard. */}
              <ul
                tabIndex={0}
                aria-label={C.listLabel}
                className="flex max-h-80 flex-col divide-y divide-line overflow-y-auto rounded-control border border-line px-3"
                data-testid="branches-list"
              >
                {dto.branches.map((b) => (
                  <BranchRow key={b.name} {...b} github={github} />
                ))}
              </ul>
            </div>
          )}
          {dto.branches.length > 0 ? <NewBranchForm projectId={projectId} dto={dto} /> : null}
        </div>
      )}
    </Card>
  );
}
