import type { SessionSummaryDto } from '@acp/core/api';
import { Card } from '../../components/Card';
import { EmptyState } from '../../components/EmptyState';
import { fieldClass } from '../../components/Input';
import { Tab, TabList, TabPanel, Tabs } from '../../components/Tabs';
import { SESSIONS_COPY } from '../../lib/copy';
import { idPrefix } from '../../lib/format';
import { navigate } from '../../lib/router';
import { ConcurrencyTimeline } from './ConcurrencyTimeline';
import { explorerHref, type ExplorerParams, type RelateView } from './explorer-params';
import { isHelperAgent, sessionName } from './session-bits';
import { SessionFamily } from './FamilyTree';
import { FamilyLegend, SessionGraph } from './SessionGraph';

const COPY = SESSIONS_COPY.relate;

/** The two tabs: the tree/diagram view counts as "Relationships". */
type RelateTab = 'relationships' | 'timeline';

/**
 * Tree (default, easiest to read) or the same family as a zoomable diagram. Links, not buttons:
 * each view has its own address. Drawn as a small segmented control.
 */
function ShowAs({ params, view }: { params: ExplorerParams; view: RelateView }) {
  const option = (v: RelateView, label: string) => (
    <a
      href={explorerHref({ ...params, view: v })}
      aria-current={view === v ? 'true' : undefined}
      className={`inline-flex h-6 items-center rounded-[calc(var(--radius-control)-2px)] px-2.5 text-caption font-medium no-underline transition-colors ${
        view === v
          ? 'bg-panel text-ink shadow-[0_0_0_1px_var(--color-line),0_1px_2px_rgb(0_0_0/0.06)]'
          : 'text-dim hover:text-ink'
      }`}
    >
      {label}
    </a>
  );
  return (
    <div className="flex items-center gap-2" role="group" aria-label={SESSIONS_COPY.family.showAs}>
      <span className="text-caption font-medium text-dim">{SESSIONS_COPY.family.showAs}</span>
      <span className="inline-flex gap-0.5 rounded-control border border-line bg-sunken p-0.5">
        {option('relationships', SESSIONS_COPY.family.tree)}
        {option('graph', SESSIONS_COPY.family.diagram)}
      </span>
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
      <span className="text-caption font-medium text-dim">{COPY.pick}</span>
      <select
        className={`${fieldClass} max-w-full min-w-0 pr-8 sm:w-80`}
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
  const tab: RelateTab = view === 'timeline' ? 'timeline' : 'relationships';
  const root = pickRoot(params, sessions);
  return (
    <Card title={COPY.title} description={COPY.description} testId="how-sessions-relate">
      {/* The tab is part of the address (`view`), so a choice is a navigation. */}
      <Tabs<RelateTab>
        value={tab}
        onValueChange={(next) => navigate(explorerHref({ ...params, view: next }))}
      >
        <TabList label={COPY.title} className="-mx-5 mb-5 px-5">
          <Tab value="relationships">{COPY.tabs.relationships}</Tab>
          <Tab value="timeline">{COPY.tabs.timeline}</Tab>
        </TabList>
        <TabPanel value="timeline">
          <ConcurrencyTimeline sessions={sessions} />
        </TabPanel>
        <TabPanel value="relationships">
          {root === null ? (
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
        </TabPanel>
      </Tabs>
    </Card>
  );
}
