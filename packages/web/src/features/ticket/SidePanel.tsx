import type { AgentRunDto, CheckRunDto, ReviewDto, RunDetailDto } from '@acp/core/api';
import { useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { ButtonLink } from '../../components/Button';
import { EstimatedCost } from '../../components/EstimatedCost';
import { RelativeTime } from '../../components/RelativeTime';
import { paths, schemas } from '../../lib/api';
import {
  AGENT_STATUS_COPY,
  CONTROL_COPY,
  describeEvent,
  NOT_REPORTED,
  TICKET_COPY,
} from '../../lib/copy';
import { useApiQuery } from '../../lib/query';
import { href } from '../../lib/router';
import { Approvals } from '../control/Approvals';
import { StatusWord } from '../control/bits';
import { Chat } from '../control/Chat';
import { canChat } from '../control/run-state';
import { ChangesTab } from './ChangesTab';
import { ChecksTab } from './ChecksTab';
import { agentBranch } from './ticket-state';

const C = TICKET_COPY;
const D = TICKET_COPY.details;

export type PanelTab = 'chat' | 'activity' | 'changes' | 'checks' | 'approvals' | 'details';

/** Chat is with the lead only (README §5.3); a helper's tabs start at Activity. */
export function tabsFor(agent: Pick<AgentRunDto, 'kind'>): PanelTab[] {
  const all: PanelTab[] = ['chat', 'activity', 'changes', 'checks', 'approvals', 'details'];
  return agent.kind === 'lead' ? all : all.filter((t) => t !== 'chat');
}

const ACTIVITY_LIMIT = 20;

/** Content-free sentences from the agent's observed session, newest first (DESIGN.md feed). */
function ActivityTab({ agent }: { agent: AgentRunDto }) {
  const events = useApiQuery(
    agent.sessionId ? paths.sessionEvents(agent.sessionId) : null,
    schemas.eventPage,
  );
  const items = events.data?.items.slice(0, ACTIVITY_LIMIT) ?? [];
  return (
    <div className="flex flex-col gap-3" data-testid="activity">
      <p className="text-caption">
        <span className="text-dim">{C.activity.latest}: </span>
        {agent.latestActivity ?? (
          <span className="text-unavailable">{CONTROL_COPY.agents.noActivity}</span>
        )}
      </p>
      {agent.sessionId === null ? (
        <p className="text-dim">{C.activity.noSession}</p>
      ) : events.data === undefined ? (
        <p className="text-dim">{events.error ? events.error.message : C.activity.loading}</p>
      ) : items.length === 0 ? (
        <p className="text-dim">{C.activity.empty}</p>
      ) : (
        <ol className="flex flex-col" aria-label={C.activity.title}>
          {items.map((e) => (
            <li
              key={e.id}
              data-event-type={e.eventType}
              className="flex items-baseline gap-3 border-b border-line/70 py-2 last:border-b-0"
            >
              <span
                aria-hidden="true"
                className="inline-block size-1.5 shrink-0 translate-y-[-2px] rounded-full bg-line-strong"
              />
              <span className="min-w-0 flex-1 break-words">{describeEvent(e)}</span>
              <span className="shrink-0 text-caption text-dim">
                <RelativeTime iso={e.occurredAt ?? e.observedAt} />
              </span>
            </li>
          ))}
        </ol>
      )}
      {agent.sessionId !== null ? (
        <ButtonLink href={href.session(agent.sessionId)} variant="quiet" className="self-start">
          {C.activity.openSession}
        </ButtonLink>
      ) : null}
    </div>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt className="text-dim">{label}</dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </>
  );
}

/** Ids, branch, model and session link (README §5.3 "Details"). Model and cost come from the session. */
function DetailsTab({
  agent,
  review,
}: {
  agent: AgentRunDto;
  review: ReviewDto['agents'][number] | undefined;
}) {
  const session = useApiQuery(
    agent.sessionId ? paths.session(agent.sessionId) : null,
    schemas.session,
  );
  const branch = agentBranch(agent, review);
  const models = session.data?.models ?? [];
  const cost = session.data?.latestSnapshot?.reportedCostUsd ?? {
    provenance: 'unavailable' as const,
    value: null,
  };
  return (
    <dl
      className="grid grid-cols-[max-content_minmax(0,1fr)] gap-x-4 gap-y-2"
      data-testid="details"
    >
      <Row label={D.kind}>
        {agent.kind === 'lead' ? CONTROL_COPY.terms.lead.term : CONTROL_COPY.terms.worker.term}
      </Row>
      <Row label={D.task}>
        {agent.task ? (
          <span className="whitespace-pre-wrap">{agent.task}</span>
        ) : (
          <span className="text-dim">{D.noTask}</span>
        )}
      </Row>
      {agent.kind === 'worker' ? (
        <>
          <Row label={D.branch}>
            {branch ? (
              <span className="font-mono text-caption">{branch}</span>
            ) : (
              <span className="text-dim">{D.branchUnknown}</span>
            )}
          </Row>
          {review ? (
            <Row label={D.baseBranch}>
              <span className="font-mono text-caption">{review.baseBranch}</span>
            </Row>
          ) : null}
        </>
      ) : null}
      <Row label={D.model}>
        {models.length > 0 ? (
          models.join(', ')
        ) : (
          <span className="text-unavailable">{NOT_REPORTED}</span>
        )}
      </Row>
      <Row label={D.cost}>
        <EstimatedCost cost={cost} />
      </Row>
      <Row label={D.started}>
        <RelativeTime iso={agent.createdAt} />
      </Row>
      <Row label={D.ended}>
        <RelativeTime iso={agent.endedAt} fallback={D.notEnded} />
      </Row>
      <Row label={D.session}>
        {agent.sessionId ? (
          <a href={href.session(agent.sessionId)} className="font-mono text-caption break-all">
            {agent.sessionId}
          </a>
        ) : (
          <span className="text-dim">{D.noSession}</span>
        )}
      </Row>
      <Row label={D.agentId}>
        <span className="font-mono text-caption break-all">{agent.id}</span>
      </Row>
      <Row label={D.runId}>
        <span className="font-mono text-caption break-all">{agent.runId}</span>
      </Row>
    </dl>
  );
}

/**
 * The selected agent in tabs (README §5.3 "Side panel"): Chat (lead only), Activity, Changes,
 * Checks, Approvals and Details.
 */
export function SidePanel({
  run,
  agent,
  tab,
  onTab,
  review,
  checks,
}: {
  run: RunDetailDto;
  agent: AgentRunDto;
  tab: PanelTab;
  onTab: (tab: PanelTab) => void;
  review: ReviewDto['agents'][number] | undefined;
  checks: readonly CheckRunDto[];
}) {
  const tabs = tabsFor(agent);
  const active = tabs.includes(tab) ? tab : (tabs[0] ?? 'activity');
  const baseId = useId();
  const refs = useRef(new Map<PanelTab, HTMLButtonElement>());
  const [draft, setDraft] = useState('');
  const chatInput = useRef<HTMLTextAreaElement | null>(null);
  const approvals = run.approvals.filter((a) => a.agentRunId === agent.id);
  const waiting = approvals.filter((a) => a.status === 'pending').length;
  const pendingReview = review?.state === 'pending';

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const i = tabs.indexOf(active);
    const next =
      e.key === 'ArrowRight'
        ? tabs[(i + 1) % tabs.length]
        : e.key === 'ArrowLeft'
          ? tabs[(i - 1 + tabs.length) % tabs.length]
          : e.key === 'Home'
            ? tabs[0]
            : e.key === 'End'
              ? tabs[tabs.length - 1]
              : undefined;
    if (next === undefined) return;
    e.preventDefault();
    onTab(next);
    refs.current.get(next)?.focus();
  };

  const label = (t: PanelTab) =>
    t === 'approvals' && waiting > 0 ? (
      <>
        {C.panel.tabs[t]}{' '}
        <span className="rounded-full bg-warning px-1.5 text-caption font-semibold text-panel tabular-nums">
          {waiting}
        </span>
      </>
    ) : (
      C.panel.tabs[t]
    );

  return (
    <section
      aria-label={C.panel.label}
      data-testid="side-panel"
      className="flex min-w-0 flex-col rounded-card border border-line bg-panel shadow-card"
    >
      <header className="flex flex-col gap-1 px-5 pt-4">
        <span className="text-caption tracking-wide text-dim uppercase">
          {agent.kind === 'lead' ? CONTROL_COPY.terms.lead.term : CONTROL_COPY.terms.worker.term}
        </span>
        <h2 className="text-title font-semibold break-words">{agent.role}</h2>
        <StatusWord status={AGENT_STATUS_COPY[agent.status]} value={agent.status} />
      </header>
      <div
        role="tablist"
        aria-label={agent.role}
        onKeyDown={onKeyDown}
        className="mt-3 flex gap-x-1 overflow-x-auto border-b border-line px-3.5"
      >
        {tabs.map((t) => (
          <button
            key={t}
            ref={(el) => {
              if (el) refs.current.set(t, el);
              else refs.current.delete(t);
            }}
            type="button"
            role="tab"
            id={`${baseId}-tab-${t}`}
            aria-selected={t === active}
            aria-controls={`${baseId}-panel`}
            tabIndex={t === active ? 0 : -1}
            onClick={() => onTab(t)}
            className={`inline-flex shrink-0 items-center gap-1 border-b-2 px-1.5 py-2 text-[0.8125rem] font-medium transition-colors ${
              t === active ? 'border-accent text-ink' : 'border-transparent text-dim hover:text-ink'
            }`}
          >
            {label(t)}
          </button>
        ))}
      </div>
      <div
        role="tabpanel"
        id={`${baseId}-panel`}
        aria-labelledby={`${baseId}-tab-${active}`}
        className="min-w-0 px-5 py-4"
      >
        {active === 'chat' ? (
          <div className="-mx-5 -my-4 [&>section]:rounded-none [&>section]:border-0 [&>section]:shadow-none">
            <Chat
              runId={run.id}
              messages={run.messages}
              open={canChat(run.status)}
              draft={draft}
              onDraft={setDraft}
              inputRef={chatInput}
            />
          </div>
        ) : active === 'activity' ? (
          <ActivityTab agent={agent} />
        ) : active === 'changes' ? (
          <ChangesTab runId={run.id} agent={agent} review={review} checks={checks} />
        ) : active === 'checks' ? (
          <ChecksTab runId={run.id} agent={agent} checks={checks} canRunAgain={pendingReview} />
        ) : active === 'approvals' ? (
          approvals.length === 0 ? (
            <p className="text-dim">{C.approvals.none}</p>
          ) : (
            <Approvals approvals={approvals} agents={run.agents} />
          )
        ) : (
          <DetailsTab agent={agent} review={review} />
        )}
      </div>
    </section>
  );
}
