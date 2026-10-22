import { AlertIcon, CheckIcon } from '../../../components/icons';
import { InfoTip } from '../../../components/InfoTip';
import { WORKFLOW_GRAPH_COPY } from '../../../lib/copy';
import { ErrorIcon, PickStageIcon } from '../icons';
import { EDITOR_COPY } from './copy';
import type { Selection } from './state';

const I = WORKFLOW_GRAPH_COPY.issues;
const E = EDITOR_COPY.issues;

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

/** GitHub's Counter: a small rounded count, in the tone of the worst issue. */
export function IssueCounter({
  errors,
  warnings,
  testId,
}: {
  errors: number;
  warnings: number;
  testId?: string;
}) {
  const n = errors + warnings;
  const tone =
    errors > 0
      ? 'border-danger/40 bg-danger-soft text-danger'
      : warnings > 0
        ? 'border-warning/40 bg-warning-soft text-warning'
        : 'border-line bg-hover text-dim';
  return (
    <span
      aria-hidden="true"
      data-testid={testId}
      className={`inline-flex h-5 min-w-5 items-center justify-center rounded-full border px-1.5 text-micro font-semibold tabular-nums ${tone}`}
    >
      {n}
    </span>
  );
}

export function IssueRow({
  issue,
  onFocus,
}: {
  issue: EditorIssue;
  onFocus?: ((target: NonNullable<Selection>) => void) | undefined;
}) {
  const target = issueTarget(issue);
  const error = issue.severity === 'error';
  const body = (
    <>
      {error ? (
        <ErrorIcon size={15} className="mt-0.5 shrink-0 text-danger" />
      ) : (
        <AlertIcon size={15} className="mt-0.5 shrink-0 text-warning" />
      )}
      <span className="min-w-0 flex-1">
        <span className="sr-only">{error ? I.error : I.warning}: </span>
        {issue.message}
      </span>
    </>
  );
  return (
    <li data-testid="issue" data-code={issue.code} data-severity={issue.severity}>
      {target === null || onFocus === undefined ? (
        <p className="flex items-start gap-2 px-2 py-1.5 text-caption">{body}</p>
      ) : (
        <button
          type="button"
          onClick={() => onFocus(target)}
          className="group flex w-full items-start gap-2 rounded-control px-2 py-1.5 text-left text-caption transition-colors hover:bg-hover"
          data-target={`${target.kind}:${target.id}`}
        >
          {body}
          <span className="shrink-0 text-accent group-hover:underline">{I.show}</span>
        </button>
      )}
    </li>
  );
}

function Group({
  title,
  issues,
  onFocus,
  testId,
}: {
  title: string;
  issues: readonly EditorIssue[];
  onFocus: (target: NonNullable<Selection>) => void;
  testId: string;
}) {
  if (issues.length === 0) return null;
  return (
    <div className="flex flex-col gap-0.5" data-testid={testId}>
      <h3 className="px-2 pt-1 pb-0.5 text-caption font-semibold text-dim">{title}</h3>
      <ul className="flex flex-col" aria-label={title}>
        {issues.map((issue, i) => (
          <IssueRow key={`${issue.code}-${i}`} issue={issue} onFocus={onFocus} />
        ))}
      </ul>
    </div>
  );
}

/**
 * The workflow's problems, checked live with core's `validateWorkflowGraph` as the owner edits, in
 * a Box with a count on its header: the problems to fix before saving, then the warnings. A click
 * on one selects its block or link and shows it on the canvas. A refused save adds the server's own
 * issues above them. Shown beside the canvas while nothing is selected.
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
      className="min-w-0 rounded-card border border-line bg-panel shadow-card"
      data-testid="issues"
      data-errors={errors.length}
      data-warnings={warnings.length}
    >
      <header className="flex items-center gap-2 rounded-t-[calc(var(--radius-card)-1px)] border-b border-line bg-subtle px-4 py-3">
        <h2 id="workflow-issues-title" className="flex items-center gap-1 text-title font-semibold">
          {I.title}
          <InfoTip tip={I.tip} label={I.title} />
        </h2>
        <IssueCounter errors={errors.length} warnings={warnings.length} />
        {issues.length > 0 ? (
          <span className="ml-auto text-caption text-dim tabular-nums" data-testid="issues-summary">
            {I.summary(errors.length, warnings.length)}
          </span>
        ) : null}
      </header>
      <div className="flex flex-col gap-2 p-2">
        {serverIssues !== null && serverIssues.length > 0 ? (
          <div
            role="alert"
            className="rounded-control border border-danger/30 bg-danger-soft px-1 py-1.5"
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
            <CheckIcon size={15} className="shrink-0" />
            {I.none}
          </p>
        ) : (
          <>
            <Group title={E.errors} issues={errors} onFocus={onFocus} testId="issues-errors" />
            <Group
              title={E.warnings}
              issues={warnings}
              onFocus={onFocus}
              testId="issues-warnings"
            />
          </>
        )}
      </div>
      <p className="flex items-center gap-2 border-t border-line px-4 py-3 text-caption text-dim">
        <PickStageIcon size={15} className="shrink-0" />
        {E.selectHint}
      </p>
    </section>
  );
}
