import type { ApiError } from '../lib/api';
import { API_BASE, UNREACHABLE_HINT } from '../lib/constants';

/** Explains an API failure. Contract (parse) failures list every issue: nothing is swallowed. */
export function ErrorNotice({ error }: { error: ApiError }) {
  if (error.kind === 'unreachable') {
    return (
      <div
        role="alert"
        data-error-kind="unreachable"
        className="rounded border border-amber-600/40 bg-amber-500/10 p-3 text-amber-900 dark:text-amber-200"
      >
        <strong>Server not reachable at {API_BASE}</strong> — {UNREACHABLE_HINT}. Nothing is shown
        until it answers; this page refetches automatically once the event stream reconnects.
      </div>
    );
  }
  if (error.kind === 'parse') {
    return (
      <div
        role="alert"
        data-error-kind="parse"
        className="rounded border border-red-600/50 bg-red-500/10 p-3 text-red-800 dark:text-red-200"
      >
        <strong>API contract violation</strong> on <code className="font-mono">{error.path}</code>:{' '}
        {error.message}. The response was rejected and is not displayed.
        {error.issues.length > 0 ? (
          <ul className="mt-1 list-disc pl-5 font-mono text-[11px]">
            {error.issues.slice(0, 12).map((i, n) => (
              <li key={n}>
                {i.path}: {i.message}
              </li>
            ))}
            {error.issues.length > 12 ? <li>… {error.issues.length - 12} more</li> : null}
          </ul>
        ) : null}
      </div>
    );
  }
  return (
    <div
      role="alert"
      data-error-kind="http"
      className="rounded border border-red-600/50 bg-red-500/10 p-3 text-red-800 dark:text-red-200"
    >
      <strong>
        Request failed{error.status !== null ? ` (HTTP ${error.status})` : ''}
        {error.code ? `: ${error.code}` : ''}
      </strong>{' '}
      — {error.message}{' '}
      <span className="font-mono text-[11px]">
        {error.path}
        {error.requestId ? ` · request ${error.requestId}` : ''}
      </span>
    </div>
  );
}
