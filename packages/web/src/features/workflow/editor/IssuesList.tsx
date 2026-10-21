import { CheckIcon, AlertIcon } from '../../../components/icons';
import { WORKFLOW_GRAPH_COPY } from '../../../lib/copy';
import type { Selection } from './state';

const I = WORKFLOW_GRAPH_COPY.issues;

/** A problem the editor shows: core's `GraphIssue`, or a field the graph's shape refuses. */
export interface EditorIssue {
  code: string;
  severity: 'error' | 'warning';
  message: string;
  nodeId?: string | undefined;
  edgeId?: string | undefined;
}

/** What a click on the issue should show: its link when it names one, else its block. */
export function issueTarget(issue: EditorIssue): NonNullable<Selection> | null {
  if (issue.edgeId !== undefined) return { kind: 'edge', id: issue.edgeId };
  if (issue.nodeId !== undefined) return { kind: 'node', id: issue.nodeId };
  return null;
}

function IssueRow({
  issue,
  onFocus,
}: {
  issue: EditorIssue;
  onFocus: (target: NonNullable<Selection>) => void;
}) {
  const target = issueTarget(issue);
  const error = issue.severity === 'error';
  const body = (
    <>
      <AlertIcon
        size={14}
        className={`mt-0.5 shrink-0 ${error ? 'text-danger' : 'text-warning'}`}
      />
      <span className="min-w-0 flex-1">
        <span className="sr-only">{error ? I.error : I.warning}: </span>
        {issue.message}
      </span>
    </>
  );
  return (
    <li data-testid="issue" data-code={issue.code} data-severity={issue.severity}>
      {target === null ? (
        <p className="flex items-start gap-2 px-2 py-1.5 text-caption">{body}</p>
      ) : (
        <button
          type="button"
          onClick={() => onFocus(target)}
          className="flex w-full items-start gap-2 rounded-control px-2 py-1.5 text-left text-caption transition-colors hover:bg-hover"
          data-target={`${target.kind}:${target.id}`}
        >
          {body}
          <span className="shrink-0 text-accent">{I.show}</span>
        </button>
      )}
    </li>
  );
}

/**
 * The workflow's problems, checked live with core's `validateWorkflowGraph` as the owner edits:
 * errors first (they block Save), then warnings. A click on one selects its block or link and
 * shows it on the canvas. A refused save adds the server's own issues above them.
 */
export function IssuesList({
  issues,
  serverIssues,
  onFocus,
}: {
  issues: readonly EditorIssue[];
  /** The server's issues from a refused save (422), until the next change. */
  serverIssues: readonly EditorIssue[] | null;
  onFocus: (target: NonNullable<Selection>) => void;
}) {
  const errors = issues.filter((i) => i.severity === 'error');
  const warnings = issues.filter((i) => i.severity === 'warning');
  return (
    <section
      aria-labelledby="workflow-issues-title"
      className="rounded-card border border-line bg-panel shadow-card"
      data-testid="issues"
      data-errors={errors.length}
      data-warnings={warnings.length}
    >
      <header className="flex items-baseline justify-between gap-3 px-5 pt-4 pb-2">
        <h2 id="workflow-issues-title" className="text-title font-semibold">
          {I.title}
        </h2>
        {issues.length > 0 ? (
          <span className="text-caption text-dim tabular-nums" data-testid="issues-summary">
            {I.summary(errors.length, warnings.length)}
          </span>
        ) : null}
      </header>
      <div className="px-3 pb-3">
        {serverIssues !== null && serverIssues.length > 0 ? (
          <div
            role="alert"
            className="mb-2 rounded-control border border-danger/30 bg-danger-soft px-2 py-2"
            data-testid="server-issues"
          >
            <p className="px-2 pb-1 text-caption font-medium text-danger">{I.server}</p>
            <ul className="flex flex-col">
              {serverIssues.map((issue, i) => (
                <IssueRow key={`s-${i}`} issue={issue} onFocus={onFocus} />
              ))}
            </ul>
          </div>
        ) : null}
        {issues.length === 0 ? (
          <p
            className="flex items-center gap-2 px-2 py-1.5 text-caption text-success"
            data-testid="issues-none"
          >
            <CheckIcon size={14} className="shrink-0" />
            {I.none}
          </p>
        ) : (
          <ul className="flex flex-col" aria-label={I.title}>
            {[...errors, ...warnings].map((issue, i) => (
              <IssueRow key={`${issue.code}-${i}`} issue={issue} onFocus={onFocus} />
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
