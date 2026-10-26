import type { TicketDetailDto } from '@acp/core/api';
import { useEffect, useMemo, useRef, useState, type ComponentType, type ReactNode } from 'react';
import { ButtonLink } from '../../components/Button';
import { EmptyState } from '../../components/EmptyState';
import { AlertIcon, type IconProps } from '../../components/icons';
import { QueryView } from '../../components/QueryView';
import { Skeleton } from '../../components/Skeleton';
import { Tab, TabList, TabPanel, Tabs } from '../../components/Tabs';
import { controlPaths, controlSchemas, ticketPaths, ticketSchemas } from '../../lib/api';
import { CONTROL_COPY, TICKET_COPY } from '../../lib/copy';
import { formatCount } from '../../lib/format';
import { useApiQuery } from '../../lib/query';
import { href } from '../../lib/router';
import {
  PullRequestCheckProvider,
  useCheckPullRequestOnView,
} from '../branching/pull-request-check';
import { ActivityTimeline, useActivityCount } from '../activity/ActivityTimeline';
import { commentsTabCount } from '../activity/comment-kind';
import { TICKET_TAB_COPY } from '../activity/copy';
import { AgentsTab } from './AgentsTab';
import { ChecksPanel, checksCount } from './ChecksPanel';
import { CommentsTab } from './CommentsTab';
import { FilesTab, filesCount } from './FilesTab';
import { AgentsIcon, ChecksIcon, CommentsIcon, ConversationIcon, FilesChangedIcon } from './icons';
import { useRunChecks, useRunReview, useTicketBranchReview } from './run-data';
import type { PanelTab } from './SidePanel';
import { TicketSidebar } from './Sidebar';
import { TicketHeader } from './TicketHeader';
import { TicketNavProvider, type TicketNav } from './ticket-nav';
import { lastRunNote } from './ticket-state';
import { TICKET_TABS, useTicketParams, useTicketTab, type TicketTab } from './ticket-tabs';

const C = TICKET_COPY;
const T = TICKET_TAB_COPY;

/** The side panel's place, so "Open" on another tab brings it into view on Agents. */
const SIDE_PANEL_ID = 'ticket-side-panel';

const TAB_ICON: Record<TicketTab, ComponentType<IconProps>> = {
  comments: CommentsIcon,
  conversation: ConversationIcon,
  agents: AgentsIcon,
  files: FilesChangedIcon,
  checks: ChecksIcon,
};

/** A tab's name with its icon and, like GitHub's, a count when one is known. */
function TabLabel({ tab, count }: { tab: TicketTab; count: number | null }) {
  const Icon = TAB_ICON[tab];
  return (
    <>
      <Icon size={16} className="text-dim" />
      {T[tab]}
      {count !== null ? (
        <span
          className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-hover px-1.5 text-caption font-medium text-ink tabular-nums"
          data-testid={`tab-count-${tab}`}
        >
          {formatCount(count)}
        </span>
      ) : null}
    </>
  );
}

/**
 * The page's shape while the ticket loads: the header, the tabs, and the conversation with its
 * sidebar. The loading words stay in the page for screen readers, as in `LoadingBlock`.
 */
function TicketSkeleton() {
  return (
    <div data-loading="" className="flex flex-col gap-5">
      <span className="sr-only">{C.loading}</span>
      <div aria-hidden="true" className="flex flex-col gap-3">
        <Skeleton className="h-3 w-16" />
        <Skeleton className="h-7 w-80 max-w-full" />
        <div className="flex gap-2">
          <Skeleton className="h-8 w-28 rounded-full" />
          <Skeleton className="h-5 w-72 max-w-full" />
        </div>
      </div>
      <div aria-hidden="true" className="flex gap-4 border-b border-line pb-2">
        <Skeleton className="h-5 w-28" />
        <Skeleton className="h-5 w-20" />
        <Skeleton className="h-5 w-28" />
        <Skeleton className="h-5 w-20" />
        <Skeleton className="h-5 w-28" />
      </div>
      <div aria-hidden="true" className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <div className="flex flex-col gap-4">
          <Skeleton className="h-32 w-full rounded-card" />
          <Skeleton className="h-20 w-full rounded-card" />
        </div>
        <div className="flex flex-col gap-4">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
        </div>
      </div>
    </div>
  );
}

function Banner({ tone, children }: { tone: 'danger' | 'neutral'; children: ReactNode }) {
  return (
    <p
      role="status"
      className={`flex flex-wrap items-center gap-x-3 gap-y-2 rounded-card border px-4 py-2.5 text-ink ${
        tone === 'danger' ? 'border-danger/25 bg-danger-soft' : 'border-line bg-sunken'
      }`}
    >
      {children}
    </p>
  );
}

function Ticket({ detail }: { detail: TicketDetailDto }) {
  const { ticket } = detail;
  const [tab, setTab] = useTicketTab();
  // The run on screen (`?run=`, when not the latest) and Files changed's `?change=` live in the
  // address, so links from other pages (and the old review pages) open the same view.
  const [params, setParams] = useTicketParams();
  const pickedRunId = params.run;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [panelTab, setPanelTab] = useState<PanelTab>('chat');
  // The chat's unsent text lives here, so a visit to another tab doesn't lose it.
  const [draft, setDraft] = useState('');
  const chatInput = useRef<HTMLTextAreaElement | null>(null);
  // A part of a tab to bring into view once that tab has rendered; `jumps` counts the requests.
  const target = useRef<string | null>(null);
  const [jumps, setJumps] = useState(0);
  const currentId = ticket.currentRunId ?? detail.runs[0]?.id ?? null;
  const runId = pickedRunId ?? currentId;
  const isCurrent = runId === currentId;
  // The run itself is fetched too: run notices refresh it, so the tree stays live.
  const runQuery = useApiQuery(runId ? controlPaths.run(runId) : null, controlSchemas.run);
  const run =
    runQuery.data ??
    (detail.currentRun !== null && detail.currentRun.id === runId ? detail.currentRun : undefined);
  const reviews = useRunReview(run);
  const checks = useRunChecks(detail, run?.id ?? null, isCurrent);
  const branchReview = useTicketBranchReview(run);
  const note = lastRunNote(detail);
  // ADR-0025 §2: an open pull request is read again once when the page opens, never on a timer.
  const prCheck = useCheckPullRequestOnView(ticket.id, detail.currentRun?.ticketBranch);
  const activityCount = useActivityCount(detail);

  const nav = useMemo<TicketNav>(
    () => ({
      goTo: (next, id) => {
        setTab(next);
        if (id !== undefined) {
          target.current = id;
          setJumps((n) => n + 1);
        }
      },
    }),
    [setTab],
  );

  // After a jump, once its tab has rendered (the address changes the tab a render later, and a
  // tab's panel can mount a frame after that): bring the part into view.
  useEffect(() => {
    let frame = 0;
    let tries = 0;
    const land = () => {
      const id = target.current;
      if (id === null) return;
      const el = document.getElementById(id);
      if (el === null) {
        // Not on screen yet; a few frames at most, then give up quietly.
        if (++tries < 10) frame = window.requestAnimationFrame(land);
        return;
      }
      target.current = null;
      el.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
      // The final-step box takes focus, so the keyboard lands where the action is.
      if (el.hasAttribute('tabindex')) el.focus({ preventScroll: true });
    };
    land();
    return () => window.cancelAnimationFrame(frame);
  }, [jumps, tab]);

  const select = (agentId: string, nextTab?: PanelTab) => {
    setSelectedId(agentId);
    if (nextTab) setPanelTab(nextTab);
    if (tab !== 'agents') nav.goTo('agents', SIDE_PANEL_ID);
  };
  const showRun = (id: string) => {
    // Another run has other changes: Files changed goes back to all of them.
    setParams({ run: id === currentId ? null : id, change: null });
    setSelectedId(null);
    window.scrollTo?.({ top: 0 });
  };

  const runLoading =
    runId !== null && run === undefined ? (
      <QueryView query={runQuery} loading={CONTROL_COPY.loading}>
        {() => null}
      </QueryView>
    ) : null;

  const counts: Record<TicketTab, number | null> = {
    comments: commentsTabCount(detail.comments),
    conversation: activityCount,
    agents: run === undefined ? null : run.agents.length,
    files: filesCount(reviews, branchReview),
    checks: run === undefined ? null : checksCount(run, checks, branchReview),
  };

  return (
    <PullRequestCheckProvider value={prCheck}>
      <TicketNavProvider value={nav}>
        <div>
          <TicketHeader
            detail={detail}
            run={run}
            runId={runId}
            isCurrent={isCurrent}
            onPickRun={showRun}
            branchReview={branchReview}
          />
          {note !== null || !isCurrent ? (
            <div className="mb-4 flex flex-col gap-3">
              {note !== null ? (
                <Banner tone="danger">
                  <AlertIcon size={16} className="text-danger" />
                  {C.lastRun[note]}
                </Banner>
              ) : null}
              {!isCurrent ? (
                <Banner tone="neutral">
                  {C.runPicker.earlier}
                  <button
                    type="button"
                    className="font-medium text-accent hover:underline"
                    onClick={() => showRun(currentId ?? '')}
                  >
                    {C.runPicker.backToLatest}
                  </button>
                </Banner>
              ) : null}
            </div>
          ) : null}
          <Tabs value={tab} onValueChange={setTab}>
            <TabList label={T.label} className="mb-6">
              {TICKET_TABS.map((t) => (
                <Tab key={t} value={t} testId={`ticket-tab-${t}`}>
                  <TabLabel tab={t} count={counts[t]} />
                </Tab>
              ))}
            </TabList>
            <TabPanel value="comments">
              <div className="grid grid-cols-1 items-start gap-8 lg:grid-cols-[minmax(0,1fr)_18rem] lg:gap-6 xl:gap-8">
                <CommentsTab
                  detail={detail}
                  run={run}
                  reviews={reviews}
                  checks={checks}
                  branchReview={branchReview}
                  onOpenAgent={select}
                />
                <TicketSidebar detail={detail} run={run} isCurrent={isCurrent} />
              </div>
            </TabPanel>
            <TabPanel value="agents">
              {runLoading ?? (
                <div id={SIDE_PANEL_ID} className="scroll-mt-24">
                  <AgentsTab
                    key={run?.id ?? 'none'}
                    detail={detail}
                    run={run}
                    isCurrent={isCurrent}
                    reviews={reviews}
                    checks={checks}
                    selectedId={selectedId}
                    onSelect={select}
                    panelTab={panelTab}
                    onPanelTab={setPanelTab}
                    draft={draft}
                    onDraft={setDraft}
                    chatInput={chatInput}
                  />
                </div>
              )}
            </TabPanel>
            <TabPanel value="files">
              {runLoading ?? (
                <FilesTab
                  ticket={ticket}
                  run={run}
                  reviews={reviews}
                  change={params.change}
                  onChange={(change) => setParams({ change })}
                  onOpenAgent={select}
                />
              )}
            </TabPanel>
            <TabPanel value="checks">
              {runLoading ?? (
                <ChecksPanel
                  run={run}
                  checks={checks}
                  reviews={reviews}
                  branchReview={branchReview}
                />
              )}
            </TabPanel>
            <TabPanel value="conversation">
              <ActivityTimeline detail={detail} shownRunId={run?.id ?? null} onShowRun={showRun} />
            </TabPanel>
          </Tabs>
        </div>
      </TicketNavProvider>
    </PullRequestCheckProvider>
  );
}

/**
 * `#/p/:projectId/tickets/:id` (Phase 4, README §5.3; a pull request page since v0.3.0 D-B): the
 * header with the ticket's state and branch, and five tabs (C-B, ADR-0026). Comments (what waits
 * for you, the plan, the description and attachments, the lead's ticket summary, people's
 * comments, the final step and a sidebar), Agents (the live graph, the agent tree and the side
 * panel), Files changed (GitHub's review UI with "Changes from", C-D), Checks and Conversation
 * (the timeline of what happened). `?tab=` in the address picks the tab, `?run=` an earlier run
 * and `?change=` the change Files changed shows.
 */
export function TicketPage({ id }: { id: string }) {
  const detail = useApiQuery(ticketPaths.ticket(id), ticketSchemas.detail);
  if (detail.data === undefined && detail.error?.kind === 'http' && detail.error.status === 404) {
    return (
      <EmptyState
        title={C.notFound.title}
        text={C.notFound.text}
        action={
          <ButtonLink href={href.board()} variant="primary">
            {C.openBoard}
          </ButtonLink>
        }
      />
    );
  }
  if (detail.data === undefined && detail.error === null) return <TicketSkeleton />;
  return (
    <QueryView query={detail} loading={C.loading}>
      {(d) => <Ticket detail={d} />}
    </QueryView>
  );
}
