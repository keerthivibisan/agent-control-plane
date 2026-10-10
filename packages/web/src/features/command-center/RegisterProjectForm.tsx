import { useState, type FormEvent } from 'react';
import { ErrorNotice } from '../../components/ErrorNotice';
import { href } from '../../lib/router';
import { useRegisterProject, type RegisterResult } from './useRegisterProject';

export function RegisterResultNotice({ result }: { result: RegisterResult | null }) {
  if (result === null) return null;
  if (result.ok) {
    return (
      <p role="status" className="text-emerald-700 dark:text-emerald-300">
        Registered <a href={href.project(result.project.id)}>{result.project.name}</a> at{' '}
        <code className="font-mono">{result.project.rootPath}</code>. Sessions inside it are
        ingested from now on.
      </p>
    );
  }
  if (typeof result.error === 'string') {
    return (
      <p role="alert" className="text-red-700 dark:text-red-300">
        {result.error}
      </p>
    );
  }
  return <ErrorNotice error={result.error} />;
}

/** Registers a repository root (POST /api/projects). */
export function RegisterProjectForm() {
  const { register, pending } = useRegisterProject();
  const [name, setName] = useState('');
  const [rootPath, setRootPath] = useState('');
  const [result, setResult] = useState<RegisterResult | null>(null);

  const submit = async () => {
    const r = await register({ name: name.trim(), rootPath: rootPath.trim() });
    setResult(r);
    if (r.ok) {
      setName('');
      setRootPath('');
    }
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    void submit();
  };

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-2" aria-label="Register a project">
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-0.5 text-[11px] text-dim">
          Name
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            maxLength={200}
            className="w-48 rounded border border-line bg-canvas px-1.5 py-0.5 text-xs text-ink"
            placeholder="my-repo"
          />
        </label>
        <label className="flex min-w-0 flex-1 flex-col gap-0.5 text-[11px] text-dim">
          Repository root (absolute path)
          <input
            value={rootPath}
            onChange={(e) => setRootPath(e.target.value)}
            required
            className="min-w-64 rounded border border-line bg-canvas px-1.5 py-0.5 font-mono text-xs text-ink"
            placeholder="/Users/me/code/my-repo"
          />
        </label>
        <button
          type="submit"
          disabled={pending}
          className="rounded border border-accent bg-accent px-2 py-0.5 text-xs text-panel disabled:opacity-50"
        >
          {pending ? 'Registering…' : 'Register project'}
        </button>
      </div>
      <RegisterResultNotice result={result} />
    </form>
  );
}
