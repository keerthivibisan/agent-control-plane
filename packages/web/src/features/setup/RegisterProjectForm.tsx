import { useId, useState, type FormEvent } from 'react';
import { Button } from '../../components/Button';
import { Details } from '../../components/Details';
import { ErrorNotice } from '../../components/ErrorNotice';
import { AlertIcon, CheckIcon } from '../../components/icons';
import { hintClass, inputClass, labelClass } from '../../components/Input';
import { SETUP_COPY } from '../../lib/copy';
import { href } from '../../lib/router';
import { alertClass } from '../control/bits';
import { useRegisterProject, type FieldErrors, type RegisterResult } from './register';

const C = SETUP_COPY.addProject;

/** Success or a server-side failure, in plain words; the raw error is under Technical details. */
export function RegisterNotice({
  result,
  showInvalid = false,
}: {
  result: RegisterResult | null;
  /** True where there are no form fields to show validation messages next to. */
  showInvalid?: boolean;
}) {
  if (result === null) return null;
  if (result.ok) {
    return (
      <div
        role="status"
        className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-control border border-success/25 bg-success/10 px-3 py-2"
      >
        <CheckIcon size={16} className="shrink-0 text-success" />
        <span>
          <strong className="font-semibold">{C.added(result.project.name)}</strong>{' '}
          <span className="text-dim">{C.addedText}</span>
        </span>
        <a href={href.project(result.project.id)} className="ml-auto">
          {C.open}
        </a>
      </div>
    );
  }
  if (result.kind === 'invalid') {
    if (!showInvalid) return null;
    return (
      <p role="alert" className={alertClass}>
        <AlertIcon size={16} className="mt-0.5 shrink-0" />
        <span className="min-w-0">
          {[result.fields.name, result.fields.rootPath].filter(Boolean).join(' ')}
        </span>
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-2">
      <p role="alert" className={alertClass}>
        <AlertIcon size={16} className="mt-0.5 shrink-0" />
        <span className="min-w-0">{result.message}</span>
      </p>
      <Details>
        <ErrorNotice error={result.error} />
      </Details>
    </div>
  );
}

function Field({
  label,
  hint,
  error,
  value,
  onChange,
  placeholder,
  mono = false,
  className = '',
}: {
  label: string;
  hint: string;
  error: string | undefined;
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  mono?: boolean;
  className?: string;
}) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  return (
    <div className={`flex min-w-0 flex-col gap-1.5 ${className}`}>
      <label htmlFor={id} className={labelClass}>
        {label}
      </label>
      <input
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${hintId} ${errorId}` : hintId}
        className={inputClass(mono ? 'font-mono' : '')}
      />
      <span id={hintId} className={hintClass}>
        {hint}
      </span>
      {error ? (
        <span
          id={errorId}
          role="alert"
          className="text-caption font-medium text-danger"
          data-field-error
        >
          {error}
        </span>
      ) : null}
    </div>
  );
}

/** Step 1 on Setup: add a project folder by name and full path (POST /api/projects). */
export function RegisterProjectForm() {
  const { register, pending } = useRegisterProject();
  const [name, setName] = useState('');
  const [rootPath, setRootPath] = useState('');
  const [result, setResult] = useState<RegisterResult | null>(null);
  const fields: FieldErrors =
    result && !result.ok && result.kind === 'invalid' ? result.fields : {};

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    void register({ name, rootPath }).then((r) => {
      setResult(r);
      if (r.ok) {
        setName('');
        setRootPath('');
      }
    });
  };

  return (
    <form onSubmit={onSubmit} noValidate aria-label={C.formLabel} className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start gap-4">
        <Field
          label={C.nameLabel}
          hint={C.nameHint}
          error={fields.name}
          value={name}
          onChange={setName}
          placeholder={C.namePlaceholder}
          className="w-full sm:w-56"
        />
        <Field
          label={C.pathLabel}
          hint={C.pathHint}
          error={fields.rootPath}
          value={rootPath}
          onChange={setRootPath}
          placeholder={C.pathPlaceholder}
          mono
          className="flex-1 basis-80"
        />
      </div>
      <div>
        <Button type="submit" variant="primary" disabled={pending}>
          {pending ? C.submitting : C.submit}
        </Button>
      </div>
      <RegisterNotice result={result} />
    </form>
  );
}
