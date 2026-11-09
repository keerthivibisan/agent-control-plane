import type { CodeMapLanguage } from '@acp/core';
import type { CodeMapGraphDto, CodeMapStatus, CodeMapSummaryDto } from '@acp/core/api';
import { useCallback, useId, useMemo, useState, type ReactNode } from 'react';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { EmptyState } from '../../components/EmptyState';
import { ErrorNotice } from '../../components/ErrorNotice';
import { AlertIcon, CodeMapIcon } from '../../components/icons';
import { Select } from '../../components/Input';
import { PageHeader } from '../../components/PageHeader';
import { Pill, type PillTone } from '../../components/Pill';
import { QueryView } from '../../components/QueryView';
import { RelativeTime } from '../../components/RelativeTime';
import { InfoTip } from '../../components/InfoTip';
import type { ApiError } from '../../lib/api';
import { codeMapPaths, codeMapSchemas } from '../../lib/api';
import { CODE_MAP_COPY } from '../../lib/copy';
import { formatCount } from '../../lib/format';
import { useApiQuery } from '../../lib/query';
import { CodeMapGraph, type FocusRequest } from './CodeMapGraph';
import { FilePanel } from './FilePanel';
import { NO_FILTERS, filterGraph, folderTrail, lastSegment, type CodeMapFilters } from './layout';
import { SearchBox } from './SearchBox';
import { useCodeMap } from './use-code-map';

const C = CODE_MAP_COPY;
const ST = C.status;

const TONE: Record<CodeMapStatus, PillTone> = {
  none: 'neutral',
  building: 'accent',
  ready: 'success',
  failed: 'danger',
};

function Stat({ label, value, tip }: { label: string; value: ReactNode; tip?: string }) {
  return (
    <div className="flex min-w-0 flex-col">
      <dt className="flex items-center gap-1 text-caption text-dim">
        {label}
        {tip !== undefined ? <InfoTip tip={tip} label={label} /> : null}
      </dt>
      <dd className="font-medium tabular-nums">{value}</dd>
    </div>
  );
}

/** The map's status, commit, age and counts. */
function StatusStrip({ summary, now }: { summary: CodeMapSummaryDto; now?: () => Date }) {
  const m = summary.manifest;
  const skipped = m === null ? 0 : Object.values(m.counts.skipped).reduce((sum, n) => sum + n, 0);
  return (
    <div
      className="mb-4 rounded-card border border-line bg-panel px-4 py-3 shadow-card"
      data-testid="code-map-status"
      data-status={summary.status}
    >
      <dl className="flex flex-wrap items-end gap-x-8 gap-y-3">
        <Stat
          label={ST.label}
          value={<Pill tone={TONE[summary.status]}>{ST.words[summary.status]}</Pill>}
        />
        {m !== null ? (
          <>
            <Stat
              label={ST.commit}
              value={
                <code
                  className="font-mono text-caption"
                  title={ST.commitTip(m.commit)}
                  data-testid="code-map-commit"
                >
                  {m.commit.slice(0, 7)}
                </code>
              }
            />
            <Stat
              label={ST.built}
              value={<RelativeTime iso={m.builtAt} {...(now === undefined ? {} : { now })} />}
            />
            <Stat label={ST.files} value={formatCount(m.counts.files)} />
            <Stat label={ST.indexed} value={formatCount(m.counts.indexed)} />
            <Stat label={ST.skipped} value={formatCount(skipped)} tip={ST.skippedTip} />
            <Stat label={ST.symbols} value={formatCount(m.counts.symbols)} />
            <Stat
              label={ST.unresolved}
              value={formatCount(m.counts.unresolved)}
              tip={ST.unresolvedTip}
            />
          </>
        ) : null}
      </dl>
    </div>
  );
}

function Breadcrumbs({
  folder,
  onOpen,
}: {
  folder: string | null;
  onOpen: (folder: string | null) => void;
}) {
  const trail = folderTrail(folder);
  const crumb =
    'rounded-control px-1 font-mono text-caption text-accent hover:underline focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none';
  return (
    <nav aria-label={C.graph.breadcrumbs} data-testid="code-map-breadcrumbs">
      <ol className="flex flex-wrap items-center gap-1 text-caption">
        <li>
          {folder === null ? (
            <span aria-current="page" className="px-1 font-medium text-ink">
              {C.graph.root}
            </span>
          ) : (
            <button type="button" className={crumb} onClick={() => onOpen(null)}>
              {C.graph.root}
            </button>
          )}
        </li>
        {trail.map((path, i) => (
          <li key={path} className="flex items-center gap-1">
            <span aria-hidden="true" className="text-dim">
              /
            </span>
            {i === trail.length - 1 ? (
              <span aria-current="page" className="px-1 font-mono font-medium text-ink">
                {lastSegment(path)}
              </span>
            ) : (
              <button type="button" className={crumb} title={path} onClick={() => onOpen(path)}>
                {lastSegment(path)}
              </button>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}

function Filters({
  languages,
  filters,
  onChange,
}: {
  languages: readonly CodeMapLanguage[];
  filters: CodeMapFilters;
  onChange: (next: CodeMapFilters) => void;
}) {
  const id = useId();
  const F = C.filters;
  return (
    <fieldset className="flex flex-wrap items-center gap-x-4 gap-y-2 text-caption">
      <legend className="sr-only">{F.label}</legend>
      <label htmlFor={`${id}-language`} className="sr-only">
        {F.language}
      </label>
      <Select
        id={`${id}-language`}
        className="h-7 w-auto py-0 text-caption"
        value={filters.language ?? ''}
        onChange={(e) =>
          onChange({
            ...filters,
            language: e.target.value === '' ? null : (e.target.value as CodeMapLanguage),
          })
        }
      >
        <option value="">{F.allLanguages}</option>
        {languages.map((l) => (
          <option key={l} value={l}>
            {l}
          </option>
        ))}
      </Select>
      <label className="flex items-center gap-1.5">
        <input
          type="checkbox"
          checked={filters.hideTests}
          onChange={(e) => onChange({ ...filters, hideTests: e.target.checked })}
        />
        {F.hideTests}
      </label>
      <label className="flex items-center gap-1.5" title={F.linkedOnlyTip}>
        <input
          type="checkbox"
          checked={filters.linkedOnly}
          onChange={(e) => onChange({ ...filters, linkedOnly: e.target.checked })}
        />
        {F.linkedOnly}
      </label>
    </fieldset>
  );
}

/** One line under the toolbar when the view is not every file one by one. */
function ViewNote({ view }: { view: CodeMapGraphDto }) {
  if (!view.truncated && view.level === 'file') return null;
  return (
    <p className="text-caption text-dim" data-testid="code-map-view-note" data-level={view.level}>
      {view.truncated
        ? C.graph.truncated(view.nodes.length, view.edges.length, view.totalEdges)
        : C.graph.folderLevel}
    </p>
  );
}

/** The graph, search, filters and file panel over the newest ready map. */
function Explorer({ projectId }: { projectId: string }) {
  const [folder, setFolder] = useState<string | null>(null);
  const [filters, setFilters] = useState<CodeMapFilters>(NO_FILTERS);
  const [activePath, setActivePath] = useState<string | null>(null);
  const [focus, setFocus] = useState<FocusRequest | null>(null);
  const graph = useApiQuery(codeMapPaths.graph(projectId, folder), codeMapSchemas.graph);

  const openFile = useCallback((path: string) => setActivePath(path), []);
  const openFolder = useCallback((path: string | null) => {
    setFolder(path);
    setFocus(null);
  }, []);
  // From search or the panel: also bring the node into view when it is drawn.
  const pickFile = useCallback((path: string) => {
    setActivePath(path);
    setFocus((f) => ({ path, n: (f?.n ?? 0) + 1 }));
  }, []);

  return (
    <div
      className={`grid grid-cols-1 items-start gap-4 ${activePath !== null ? 'xl:grid-cols-[minmax(0,1fr)_24rem]' : ''}`}
    >
      <Card title={C.graph.title} padded={false} testId="code-map-explorer">
        <div className="flex flex-col gap-3 border-b border-line px-4 py-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Breadcrumbs folder={folder} onOpen={openFolder} />
            <SearchBox projectId={projectId} onPick={pickFile} />
          </div>
          <QueryView query={graph} loading={C.loading}>
            {(view) => <GraphToolbar view={view} filters={filters} onFilters={setFilters} />}
          </QueryView>
        </div>
        {graph.data !== undefined ? (
          <GraphBody
            view={graph.data}
            filters={filters}
            folder={folder}
            activePath={activePath}
            focus={focus}
            onOpenFile={openFile}
            onOpenFolder={openFolder}
          />
        ) : null}
      </Card>
      {activePath !== null ? (
        <FilePanel
          key={activePath}
          projectId={projectId}
          path={activePath}
          onOpen={pickFile}
          onClose={() => setActivePath(null)}
        />
      ) : null}
    </div>
  );
}

function languagesOf(view: CodeMapGraphDto, selected: CodeMapLanguage | null): CodeMapLanguage[] {
  const set = new Set(view.nodes.map((n) => n.language));
  if (selected !== null) set.add(selected);
  return [...set].sort();
}

function GraphToolbar({
  view,
  filters,
  onFilters,
}: {
  view: CodeMapGraphDto;
  filters: CodeMapFilters;
  onFilters: (f: CodeMapFilters) => void;
}) {
  const languages = useMemo(() => languagesOf(view, filters.language), [view, filters.language]);
  return (
    <>
      <Filters languages={languages} filters={filters} onChange={onFilters} />
      <ViewNote view={view} />
    </>
  );
}

function GraphBody({
  view,
  filters,
  folder,
  activePath,
  focus,
  onOpenFile,
  onOpenFolder,
}: {
  view: CodeMapGraphDto;
  filters: CodeMapFilters;
  folder: string | null;
  activePath: string | null;
  focus: FocusRequest | null;
  onOpenFile: (path: string) => void;
  onOpenFolder: (path: string) => void;
}) {
  const shown = useMemo(() => filterGraph(view.nodes, view.edges, filters), [view, filters]);
  if (view.nodes.length === 0) {
    return <EmptyState compact title={C.graph.noFiles} testId="code-map-no-files" />;
  }
  if (shown.nodes.length === 0) {
    return <EmptyState compact title={C.graph.noNodes} testId="code-map-no-match" />;
  }
  return (
    <>
      <p className="px-4 pt-2 text-micro text-dim tabular-nums" data-testid="code-map-count">
        {C.graph.shown(shown.nodes.length, view.nodes.length)}
      </p>
      <CodeMapGraph
        viewKey={`${view.commit}:${view.folder ?? ''}:${view.level}`}
        nodes={shown.nodes}
        edges={shown.edges}
        folder={folder}
        activePath={activePath}
        focus={focus}
        onOpenFile={onOpenFile}
        onOpenFolder={onOpenFolder}
      />
    </>
  );
}

function RefreshError({ error }: { error: ApiError }) {
  const text =
    error.kind === 'http' && error.code !== null ? C.refreshErrors[error.code] : undefined;
  if (text === undefined) return <ErrorNotice error={error} />;
  return (
    <p
      role="alert"
      className="flex items-start gap-2 rounded-card border border-warning/30 bg-warning-soft px-3.5 py-3 text-ink"
    >
      <AlertIcon size={16} className="mt-0.5 text-warning" />
      {text}
    </p>
  );
}

/**
 * `#/p/:projectId/code-map` (ADR-0034 §5, CM-4): the files, symbols and imports ACP indexed for
 * the project's agents. The map's status, commit and age with Refresh (polled while building, as
 * there is no push event); the import graph by folder with drill-in, filters and search; and a
 * file's details. Every path and name is repository data, shown as text.
 */
export function CodeMapPage({
  projectId,
  now,
  pollMs,
  pollLimitMs,
}: {
  projectId: string;
  now?: () => Date;
  pollMs?: number;
  pollLimitMs?: number;
}) {
  const map = useCodeMap(projectId, {
    ...(pollMs === undefined ? {} : { pollMs }),
    ...(pollLimitMs === undefined ? {} : { limitMs: pollLimitMs }),
  });
  const data = map.summary.data;
  const building = data?.status === 'building' || map.pending;
  const showRefresh = data !== undefined && data.status !== 'none';

  return (
    <div>
      <PageHeader
        title={C.title}
        tip={C.tip}
        description={C.description}
        actions={
          showRefresh ? (
            <Button
              disabled={building}
              title={C.refreshTip}
              onClick={() => void map.refresh()}
              data-testid="code-map-refresh"
            >
              {building ? C.refreshing : C.refresh}
            </Button>
          ) : undefined
        }
      />
      {map.error !== null ? (
        <div className="mb-4">
          <RefreshError error={map.error} />
        </div>
      ) : null}
      <QueryView query={map.summary} loading={C.loading}>
        {(summary) => {
          if (summary.status === 'none') {
            return (
              <Card>
                <EmptyState
                  title={C.empty.title}
                  text={C.empty.text}
                  icon={<CodeMapIcon size={20} />}
                  testId="code-map-empty"
                  action={
                    <Button
                      variant="primary"
                      disabled={map.pending}
                      onClick={() => void map.refresh()}
                    >
                      {map.pending ? C.refreshing : C.empty.build}
                    </Button>
                  }
                />
              </Card>
            );
          }
          return (
            <>
              <StatusStrip summary={summary} {...(now === undefined ? {} : { now })} />
              {summary.status === 'building' ? (
                <p className="mb-4 text-caption text-dim" data-testid="code-map-building">
                  {map.slow ? ST.buildingSlow : ST.building}
                  {summary.manifest !== null ? ` ${ST.lastGood}` : ''}
                </p>
              ) : null}
              {summary.status === 'failed' ? (
                <div
                  role="alert"
                  data-testid="code-map-failed"
                  className="mb-4 flex flex-wrap items-center gap-3 rounded-card border border-danger/30 bg-danger-soft px-3.5 py-3 text-ink"
                >
                  <AlertIcon size={16} className="text-danger" />
                  <div className="min-w-0 flex-1">
                    <strong className="font-semibold">{C.failed.title}. </strong>
                    {summary.errorCode !== null ? C.failed.codes[summary.errorCode] : null}
                    {summary.manifest !== null ? ` ${ST.lastGood}` : ''}
                  </div>
                  <Button size="sm" disabled={map.pending} onClick={() => void map.refresh()}>
                    {C.failed.retry}
                  </Button>
                </div>
              ) : null}
              {summary.manifest !== null ? <Explorer projectId={projectId} /> : null}
            </>
          );
        }}
      </QueryView>
    </div>
  );
}
