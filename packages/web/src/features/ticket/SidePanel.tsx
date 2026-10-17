import type {
  AgentRunDto,
  ChatMessageDto,
  CheckRunDto,
  ReviewDto,
  RunDetailDto,
  TicketCommentDto,
} from '@acp/core/api';
import { motion } from 'motion/react';
import { useRef, useState, type ReactNode } from 'react';
import { ButtonLink } from '../../components/Button';
import { EstimatedCost } from '../../components/EstimatedCost';
import { enter, fade } from '../../components/motion';
import { RelativeTime } from '../../components/RelativeTime';
import { Skeleton } from '../../components/Skeleton';
import { Tab, TabList, TabPanel, Tabs } from '../../components/Tabs';
import { paths, schemas } from '../../lib/api';
import {
  CONTROL_COPY,
  describeEvent,
  FOLLOW_UP_COPY,
  NOT_REPORTED,
  REVIEW_LOOP_COPY,
  TICKET_COPY,
} from '../../lib/copy';
import { useApiQuery } from '../../lib/query';
import { href } from '../../lib/router';
import { Approvals } from '../control/Approvals';
import { agentStatusCopy, StatusWord } from '../control/bits';
import { Chat, type SpeakerOf } from '../control/Chat';
import { canChat, isAgentLive } from '../control/run-state';
import { activityText } from '../../lib/activity';
import { ChangeCard } from '../review-loop/ChangeCard';
import { canRecheckChange, isReviewLoopRun } from '../review-loop/logic';
import { ChangesTab } from './ChangesTab';
import { ChecksTab } from './ChecksTab';
import {
  agentBranch,
  canHoldChat,
  chatAgent,
  chatSpeaker,
  hasWorktree,
  leadFollowUp,
} from './ticket-state';

const C = TICKET_COPY;
const D = TICKET_COPY.details;
const F = FOLLOW_UP_COPY;

export type PanelTab = 'chat' | 'activity' | 'changes' | 'checks' | 'approvals' | 'details';

/**
 * Chat is with the lead (README §5.3), and with a separate planner, which holds the conversation
 * until the plan is approved (ADR-0019); every other agent's tabs start at Activity.
 */
export function tabsFor(agent: Pick<AgentRunDto, 'kind'>): PanelTab[] {
  const all: PanelTab[] = ['chat', 'activity', 'changes', 'checks', 'approvals', 'details'];
  return canHoldChat(agent.kind) ? all : all.filter((t) => t !== 'chat');
}

/** The chat box stays while the run takes chat and the agent it reaches is still working. */
function chatOpen(run: RunDetailDto): boolean {
  const target = chatAgent(run);
  const agent = run.agents.find((a) => a.id === target?.id);
  return canChat(run.status) && agent !== undefined && isAgentLive(agent.status);
}

/**
 * The chat's box on this agent's panel. While the lead is live (no `followUp`) it is as before
 * R-J; once the lead ended, the lead's panel follows the server's follow-up state (ADR-0020).
 */
function chatBox(
  run: RunDetailDto,
  agent: AgentRunDto,
): {
  open: boolean;
  closedText?: string;
  notice?: string;
  waiting?: string;
  placeholder?: string;
} {
  const followUp = leadFollowUp(run, agent);
  if (followUp === null) {
    return {
      open: chatOpen(run),
      ...(canChat(run.status) ? { closedText: C.speaker.chatEnded } : {}),
    };
  }
  if (followUp.state === 'unavailable') {
    return {
      open: false,
      closedText: followUp.reason === null ? F.unavailableFallback : F.unavailable[followUp.reason],
    };
  }
  return followUp.state === 'running'
    ? { open: true, waiting: F.running, placeholder: F.placeholder }
    : { open: true, notice: F.available, placeholder: F.placeholder };
}

/**
 * Who the chat box reaches, in words: the planner while it plans, else the lead (`chatAgent`), so
 * the planner's panel never says "lead agent" while the planner holds the conversation.
 */
function chatWho(run: RunDetailDto, agent: AgentRunDto): string {
  const kind = chatAgent(run)?.kind ?? agent.kind;
  return C.roles[kind].term.toLowerCase();
}

/**
 * The name on a chat bubble: planner chat arrives as `lead` (decision C), so it is worked out.
 * Messages of a follow-up turn after the run carry a "Follow-up" tag (ADR-0020).
 */
function speakerLabel(m: ChatMessageDto, agents: readonly AgentRunDto[]): ReturnType<SpeakerOf> {
  const who = chatSpeaker(m, agents);
  const tag = m.followUp === true ? { tag: { label: F.tag, tip: F.tagTip } } : {};
  return who === 'lead-or-planner'
    ? { label: C.speaker[who], tip: C.speaker.leadOrPlannerTip, ...tag }
    : { label: C.speaker[who], ...tag };
}

/**
 * The Changes tab of a review-loop run (ADR-0021): the agent's change card, from the run's
 * `changes`. The lead and read-only agents say what they always said.
 */
function LoopChangesTab({
  run,
  agent,
  review,
  comments,
}: {
  run: RunDetailDto;
  agent: AgentRunDto;
  review: ReviewDto['agents'][number] | undefined;
  comments: readonly TicketCommentDto[];
}) {
  if (agent.kind === 'lead') return <p className="text-dim">{C.changes.leadNone}</p>;
  if (!hasWorktree(agent.kind)) return <p className="text-dim">{C.changes.readOnlyNone}</p>;
  const change = run.changes?.find((c) => c.agentRunId === agent.id);
  if (change === undefined) {
    return <p className="text-dim">{REVIEW_LOOP_COPY.changes.stillWorking}</p>;
  }
  return (
    <ChangeCard
      run={run}
      change={change}
      review={review}
      comments={comments.filter((c) => c.runId === null || c.runId === run.id)}
      branch={run.ticketBranch?.branch ?? null}
    />
  );
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
      <p className="rounded-control border border-line bg-sunken px-3 py-2 text-caption">
        <span className="text-dim">{C.activity.latest}: </span>
        {agent.latestActivity !== null ? (
          activityText(agent.latestActivity)
        ) : (
          <span className="text-unavailable">{CONTROL_COPY.agents.noActivity}</span>
        )}
      </p>
      {agent.sessionId === null ? (
        <p className="text-dim">{C.activity.noSession}</p>
      ) : events.data === undefined ? (
        events.error ? (
          <p className="text-dim">{events.error.message}</p>
        ) : (
          <div data-loading="" className="flex flex-col gap-3 py-1">
            <span className="sr-only">{C.activity.loading}</span>
            {[0, 1, 2].map((i) => (
              <span key={i} aria-hidden="true" className="flex items-center gap-3">
                <Skeleton className="size-1.5 rounded-full" />
                <Skeleton className={`h-3.5 ${i === 2 ? 'w-1/2' : 'w-3/4'}`} />
                <Skeleton className="ml-auto h-3 w-12" />
              </span>
            ))}
          </div>
        )
      ) : items.length === 0 ? (
        <p className="text-dim">{C.activity.empty}</p>
      ) : (
        <ol
          className="relative flex flex-col before:absolute before:top-3 before:bottom-3 before:left-[2.5px] before:border-l before:border-line"
          aria-label={C.activity.title}
        >
          {items.map((e) => (
            <li
              key={e.id}
              data-event-type={e.eventType}
              className="relative flex items-baseline gap-3 py-1.5"
            >
              <span
                aria-hidden="true"
                className="inline-block size-1.5 shrink-0 translate-y-[-2px] rounded-full bg-line-strong ring-3 ring-panel"
              />
              <span className="min-w-0 flex-1 break-words">{describeEvent(e)}</span>
              <span className="shrink-0 text-caption text-dim tabular-nums">
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
      <dt className="text-caption leading-5 text-dim">{label}</dt>
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
      className="grid grid-cols-[max-content_minmax(0,1fr)] gap-x-5 gap-y-2.5"
      data-testid="details"
    >
      <Row label={D.kind}>{C.roles[agent.kind].term}</Row>
      <Row label={D.task}>
        {agent.task ? (
          <span className="whitespace-pre-wrap">{agent.task}</span>
        ) : (
          <span className="text-dim">{D.noTask}</span>
        )}
      </Row>
      {hasWorktree(agent.kind) ? (
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
  comments = [],
}: {
  run: RunDetailDto;
  agent: AgentRunDto;
  tab: PanelTab;
  onTab: (tab: PanelTab) => void;
  review: ReviewDto['agents'][number] | undefined;
  checks: readonly CheckRunDto[];
  /** The ticket's comments: a change card shows the reviewer's findings kept there. */
  comments?: readonly TicketCommentDto[];
}) {
  const tabs = tabsFor(agent);
  const active = tabs.includes(tab) ? tab : (tabs[0] ?? 'activity');
  const [draft, setDraft] = useState('');
  const chatInput = useRef<HTMLTextAreaElement | null>(null);
  const approvals = run.approvals.filter((a) => a.agentRunId === agent.id);
  const waiting = approvals.filter((a) => a.status === 'pending').length;
  // A loop run's change is checked again on its sealed commit until it is decided (RL-V); a
  // legacy run's while its review is pending.
  const canRunAgain = isReviewLoopRun(run)
    ? canRecheckChange(run, agent.id)
    : review?.state === 'pending';

  const label = (t: PanelTab) =>
    t === 'approvals' && waiting > 0 ? (
      <>
        {C.panel.tabs[t]}{' '}
        <span className="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-warning px-1 text-micro font-semibold text-panel tabular-nums">
          {waiting}
        </span>
      </>
    ) : (
      C.panel.tabs[t]
    );

  const body = (t: PanelTab): ReactNode =>
    t === 'chat' ? (
      <div className="-mx-5 -my-4 [&>section]:rounded-none [&>section]:border-0 [&>section]:bg-transparent [&>section]:shadow-none">
        <Chat
          runId={run.id}
          messages={run.messages}
          draft={draft}
          onDraft={setDraft}
          inputRef={chatInput}
          speakerOf={(m) => speakerLabel(m, run.agents)}
          followUpDivider={F.divider}
          who={chatWho(run, agent)}
          {...chatBox(run, agent)}
        />
      </div>
    ) : t === 'activity' ? (
      <ActivityTab agent={agent} />
    ) : t === 'changes' ? (
      isReviewLoopRun(run) ? (
        <LoopChangesTab run={run} agent={agent} review={review} comments={comments} />
      ) : (
        <ChangesTab runId={run.id} agent={agent} review={review} checks={checks} />
      )
    ) : t === 'checks' ? (
      <ChecksTab runId={run.id} agent={agent} checks={checks} canRunAgain={canRunAgain} />
    ) : t === 'approvals' ? (
      approvals.length === 0 ? (
        <p className="text-dim">{C.approvals.none}</p>
      ) : (
        <Approvals approvals={approvals} agents={run.agents} />
      )
    ) : (
      <DetailsTab agent={agent} review={review} />
    );

  return (
    <section
      aria-label={C.panel.label}
      data-testid="side-panel"
      className="flex min-w-0 flex-col rounded-card border border-line bg-panel shadow-card"
    >
      {/* A soft fade when another agent opens in the panel (the panel itself stays). */}
      <motion.header
        key={agent.id}
        className="flex flex-col gap-1 px-5 pt-4"
        initial={{ opacity: 0.4 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.15 }}
      >
        <span
          className="text-micro font-medium tracking-wider text-dim uppercase"
          title={C.roles[agent.kind].tip}
        >
          {C.roles[agent.kind].term}
        </span>
        <h2 className="text-title font-semibold break-words">{agent.role}</h2>
        <span className="text-caption">
          <StatusWord status={agentStatusCopy(agent, run)} value={agent.status} />
        </span>
      </motion.header>
      <Tabs value={active} onValueChange={onTab}>
        <TabList label={agent.role} className="mt-3 gap-3! px-5 text-[0.8125rem]">
          {tabs.map((t) => (
            <Tab key={t} value={t}>
              {label(t)}
            </Tab>
          ))}
        </TabList>
        {tabs.map((t) => (
          <TabPanel key={t} value={t} className="px-5 py-4">
            {/* Each tab's content mounts when it opens, and fades in. */}
            <motion.div {...enter(fade)}>{body(t)}</motion.div>
          </TabPanel>
        ))}
      </Tabs>
    </section>
  );
}
