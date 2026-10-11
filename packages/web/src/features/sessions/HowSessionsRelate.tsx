import type { SessionSummaryDto } from '@acp/core/api';
import { Card } from '../../components/Card';
import { EmptyState } from '../../components/EmptyState';
import { SESSIONS_COPY } from '../../lib/copy';
import { idPrefix } from '../../lib/format';
import { navigate } from '../../lib/router';
import { ConcurrencyTimeline } from './ConcurrencyTimeline';
import { explorerHref, type ExplorerParams, type RelateView } from './explorer-params';
import { fieldClass } from './Filters';
import { isHelperAgent, sessionName } from './session-bits';
import { SessionFamily } from './FamilyTree';
import { FamilyLegend, SessionGraph } from './SessionGraph';

const COPY = SESSIONS_COPY.relate;

function Tabs({ params, view }: { params: ExplorerParams; view: RelateView }) {
  const relationships = view !== 'timeline';
  const tab = (v: RelateView, selected: boolean, label: string) => (
    <a
      href={explorerHref({ ...params, view: v })}
      role="tab"
      aria-selected={selected}
      className={`rounded-control px-3 py-1.5 font-medium no-underline transition-colors ${
        selected ? 'bg-panel text-ink shadow-card' : 'text-dim hover:text-ink'
      }`}
    >
      {label}
    </a>
  );
  return (
    <div
      role="tablist"
      aria-label={COPY.title}
      className="flex gap-1 rounded-control bg-sunken p-1"
    >
      {tab('relationships', relationships, COPY.tabs.relationships)}
      {tab('timeline', !relationships, COPY.tabs.timeline)}
    </div>
  );
}

/** Tree (default, easiest to read) or the same family as a zoomable diagram. */
function ShowAs({ params, view }: { params: ExplorerParams; view: RelateView }) {
  const option = (v: RelateView, label: string) => (
    <a
      href={explorerHref({ ...params, view: v })}
      aria-current={view === v ? 'true' : undefined}
      className={`rounded-control px-2.5 py-1 no-underline ${
        view === v ? 'bg-accent-soft font-medium text-accent' : 'text-dim hover:text-ink'
      }`}
    >
      {label}
    </a>
  );
  return (
    <div className="flex items-center gap-1" role="group" aria-label={SESSIONS_COPY.family.showAs}>
      <span className="mr-1 text-dim">{SESSIONS_COPY.family.showAs}</span>
      {option('relationships', SESSIONS_COPY.family.tree)}
      {option('graph', SESSIONS_COPY.family.diagram)}
    </div>
  );
}

/**
 * The session whose family is drawn: the one in the URL, else the first session on the page that
 * started helper agents, else the first session. A choice for display only; no relation is implied.
 */
function pickRoot(params: ExplorerParams, sessions: readonly SessionSummaryDto[]): string | null {
  if (params.root) return params.root;
  const withHelpers = sessions.find((s) => s.childCount > 0 && !isHelperAgent(s));
  return (withHelpers ?? sessions[0])?.id ?? null;
}

function RootPicker({
  params,
  sessions,
  root,
}: {
  params: ExplorerParams;
  sessions: readonly SessionSummaryDto[];
  root: string;
}) {
  const options = sessions.filter((s) => !isHelperAgent(s) || s.id === root);
  const listed = options.some((s) => s.id === root);
  return (
    <label className="flex flex-wrap items-center gap-2">
      <span className="text-dim">{COPY.pick}</span>
      <select
        className={`${fieldClass} max-w-full min-w-0 sm:w-80`}
        value={root}
        onChange={(e) =>
          navigate(explorerHref({ ...params, root: e.target.value, view: 'relationships' }))
        }
      >
        {/* A root from a link that isn't on this page still shows as selected. */}
        {listed ? null : <option value={root}>{idPrefix(root)}</option>}
        {options.map((s) => (
          <option key={s.id} value={s.id}>
            {sessionName(s)} ({idPrefix(s.id)})
          </option>
        ))}
      </select>
    </label>
  );
}

/** "How sessions relate": the relationships graph and the timeline, as two tabs. */
export function HowSessionsRelate({
  params,
  sessions,
}: {
  params: ExplorerParams;
  sessions: readonly SessionSummaryDto[];
}) {
  const view = params.view ?? 'relationships';
  const root = pickRoot(params, sessions);
  return (
    <Card
      title={COPY.title}
      description={COPY.description}
      actions={<Tabs params={params} view={view} />}
      testId="how-sessions-relate"
    >
      <div
        role="tabpanel"
        aria-label={view === 'timeline' ? COPY.tabs.timeline : COPY.tabs.relationships}
      >
        {view === 'timeline' ? (
          <ConcurrencyTimeline sessions={sessions} />
        ) : root === null ? (
          <EmptyState compact title={COPY.tabs.relationships} text={COPY.pickHint} />
        ) : (
          <div className="flex flex-col gap-5">
            <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
              <RootPicker params={params} sessions={sessions} root={root} />
              <ShowAs params={params} view={view} />
            </div>
            {view === 'graph' ? (
              // Remount per root so collapsed nodes never carry over to another family.
              <SessionGraph key={root} sessionId={root} />
            ) : (
              <>
                <FamilyLegend />
                <SessionFamily
                  sessionId={root}
                  currentLabel={SESSIONS_COPY.family.selected}
                  outlineRoot={false}
                />
                <p className="text-caption text-dim">{COPY.evidenceNote}</p>
              </>
            )}
          </div>
        )}
      </div>
    </Card>
  );
}
