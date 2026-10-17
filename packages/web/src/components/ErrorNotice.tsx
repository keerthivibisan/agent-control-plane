import type { ApiError } from '../lib/api';
import { API_BASE, UNREACHABLE_HINT } from '../lib/constants';
import { AlertIcon } from './icons';

const FRAME = 'flex items-start gap-2.5 rounded-card border px-3.5 py-3 text-ink';
const WARNING = `${FRAME} border-warning/30 bg-warning-soft`;
const DANGER = `${FRAME} border-danger/30 bg-danger-soft`;

/** Explains an API failure. Contract (parse) failures list every issue: nothing is swallowed. */
export function ErrorNotice({ error }: { error: ApiError }) {
  if (error.kind === 'unreachable') {
    return (
      <div role="alert" data-error-kind="unreachable" className={WARNING}>
        <AlertIcon size={16} className="mt-0.5 text-warning" />
        <div className="min-w-0">
          <strong>Server not reachable at {API_BASE}</strong> — {UNREACHABLE_HINT}. Nothing is shown
          until it answers; this page refetches automatically once the event stream reconnects.
        </div>
      </div>
    );
  }
  if (error.kind === 'parse') {
    return (
      <div role="alert" data-error-kind="parse" className={DANGER}>
        <AlertIcon size={16} className="mt-0.5 text-danger" />
        <div className="min-w-0">
          <strong>API contract violation</strong> on <code className="font-mono">{error.path}</code>
          : {error.message}. The response was rejected and is not displayed.
          {error.issues.length > 0 ? (
            <ul className="mt-1 list-disc pl-5 font-mono text-micro text-dim">
              {error.issues.slice(0, 12).map((i, n) => (
                <li key={n}>
                  {i.path}: {i.message}
                </li>
              ))}
              {error.issues.length > 12 ? <li>… {error.issues.length - 12} more</li> : null}
            </ul>
          ) : null}
        </div>
      </div>
    );
  }
  return (
    <div role="alert" data-error-kind="http" className={DANGER}>
      <AlertIcon size={16} className="mt-0.5 text-danger" />
      <div className="min-w-0">
        <strong>
          Request failed{error.status !== null ? ` (HTTP ${error.status})` : ''}
          {error.code ? `: ${error.code}` : ''}
        </strong>{' '}
        — {error.message}{' '}
        <span className="font-mono text-micro text-dim">
          {error.path}
          {error.requestId ? ` · request ${error.requestId}` : ''}
        </span>
      </div>
    </div>
  );
}
