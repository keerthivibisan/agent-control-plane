import type { AgentRunDto } from '@acp/core/api';
import { useState } from 'react';
import { Button, ButtonLink } from '../../components/Button';
import { Card } from '../../components/Card';
import { Details } from '../../components/Details';
import { EstimatedCost } from '../../components/EstimatedCost';
import { InfoTip } from '../../components/InfoTip';
import { RelativeTime } from '../../components/RelativeTime';
import { paths, schemas, stopAgent } from '../../lib/api';
import { AGENT_STATUS_COPY, CONTROL_COPY } from '../../lib/copy';
import { formatCount } from '../../lib/format';
import { useApiQuery } from '../../lib/query';
import { href } from '../../lib/router';
import { SessionFamily } from '../sessions/FamilyTree';
import { useControlAction } from './actions';
import { ActionError, ConfirmAction, StatusWord } from './bits';
import { budgetView, buildAgentTree, isAgentLive, type AgentNode } from './run-state';

const C = CONTROL_COPY.agents;
const T = CONTROL_COPY.technical;

const BAR: Record<ReturnType<typeof budgetView>['level'], string> = {
  ok: 'bg-accent',
  near: 'bg-warning',
  over: 'bg-danger',
};

/** "120,000 of 500,000 budget tokens" with a bar and the ADR-0014 explanation. */
export function BudgetBar({ budget }: { budget: AgentRunDto['budget'] }) {
  const v = budgetView(budget);
  const text = C.budgetText(formatCount(budget.used), formatCount(budget.limit));
  return (
    <div className="flex flex-col gap-1" data-testid="budget">
      <div className="flex flex-wrap items-center gap-x-1 text-caption">
        <span className="text-dim">{CONTROL_COPY.terms.budget.term}</span>
        <InfoTip tip={CONTROL_COPY.terms.budget.tip} label={CONTROL_COPY.terms.budget.term} />
        <span className="ml-auto font-medium tabular-nums">{text}</span>
      </div>
      <div
        role="meter"
        aria-label={CONTROL_COPY.terms.budget.term}
        aria-valuemin={0}
        aria-valuemax={budget.limit}
        aria-valuenow={Math.min(budget.used, budget.limit)}
        aria-valuetext={text}
        className="h-1.5 overflow-hidden rounded-full bg-sunken"
      >
        <div className={`h-full rounded-full ${BAR[v.level]}`} style={{ width: `${v.percent}%` }} />
      </div>
      {v.over > 0 ? (
        <span className="text-caption text-danger">{C.overBy(formatCount(v.over))}</span>
      ) : null}
    </div>
  );
}

/**
 * The agent's estimated cost, read from its observed session's latest Claude Code report. Never
 * computed, never added to other agents' costs; "Not reported" until there is one.
 */
function AgentCost({ sessionId }: { sessionId: string | null }) {
  const session = useApiQuery(sessionId ? paths.session(sessionId) : null, schemas.session);
  const cost = session.data?.latestSnapshot?.reportedCostUsd ?? {
    provenance: 'unavailable' as const,
    value: null,
  };
  return (
    <div className="flex flex-col gap-1 text-caption">
      <EstimatedCost cost={cost} />
      {sessionId !== null && session.data && session.data.childCount > 0 ? (
        <Details summary={`${C.helpers} (${formatCount(session.data.childCount)})`}>
          <SessionFamily sessionId={sessionId} outlineRoot={false} />
        </Details>
      ) : null}
    </div>
  );
}

function Task({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const long = text.length > 180 || text.split('\n').length > 3;
  return (
    <div className="text-caption">
      <span className="text-dim">{C.task}: </span>
      <span className={`whitespace-pre-wrap ${open || !long ? '' : 'line-clamp-3'}`}>{text}</span>
      {long ? (
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="ml-1 text-accent hover:underline"
        >
          {open ? C.showLess : C.showAll}
        </button>
      ) : null}
    </div>
  );
}

function AgentCard({
  agent,
  runId,
  canMessage,
  onMessage,
}: {
  agent: AgentRunDto;
  runId: string;
  canMessage: boolean;
  onMessage: (agent: AgentRunDto) => void;
}) {
  const stop = useControlAction(stopAgent);
  const live = isAgentLive(agent.status);
  const lead = agent.kind === 'lead';
  const term = lead ? CONTROL_COPY.terms.lead : CONTROL_COPY.terms.worker;
  return (
    <article
      aria-label={agent.role}
      data-testid={`agent-${agent.id}`}
      className="relative flex max-w-2xl flex-col gap-2.5 rounded-card border border-line bg-panel px-4 py-3 shadow-card"
    >
      <header className="flex flex-wrap items-start gap-x-3 gap-y-1">
        <div className="min-w-40 flex-1">
          <h3 className="font-medium break-words">{agent.role}</h3>
          <span className="inline-flex items-center gap-0.5 text-caption text-dim">
            {term.term}
            <InfoTip tip={term.tip} label={term.term} />
          </span>
        </div>
        <StatusWord status={AGENT_STATUS_COPY[agent.status]} value={agent.status} />
      </header>
      {agent.task ? <Task text={agent.task} /> : null}
      <p className="text-caption">
        <span className="text-dim">{C.latest}: </span>
        {agent.latestActivity ?? <span className="text-unavailable">{C.noActivity}</span>}
      </p>
      <BudgetBar budget={agent.budget} />
      <AgentCost sessionId={agent.sessionId} />
      {agent.review ? (
        <p className="text-caption" data-testid="agent-review-state">
          {CONTROL_COPY.review.state[agent.review.state]}
          {agent.review.changedFiles !== null
            ? ` · ${CONTROL_COPY.review.files(agent.review.changedFiles)}`
            : null}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        {canMessage && (lead || live) ? (
          <Button onClick={() => onMessage(agent)}>{C.message}</Button>
        ) : null}
        {agent.sessionId ? (
          <ButtonLink href={href.session(agent.sessionId)} variant="quiet">
            {C.openSession}
          </ButtonLink>
        ) : null}
        {live ? (
          <ConfirmAction
            label={C.stop}
            question={lead ? C.confirmStopLead : C.confirmStop(agent.role)}
            confirmLabel={C.stopConfirm}
            cancelLabel={C.keep}
            pendingLabel={C.stopping}
            pending={stop.pending}
            onConfirm={() => stop.run(runId, agent.id)}
          />
        ) : null}
      </div>
      <ActionError error={stop.error} message={C.stopFailed} />
      <Details summary={T.summary}>
        <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-caption">
          <dt className="text-dim">{T.agentId}</dt>
          <dd className="font-mono break-all">{agent.id}</dd>
          <dt className="text-dim">{T.sessionId}</dt>
          <dd className="font-mono break-all">{agent.sessionId ?? T.noSession}</dd>
          <dt className="text-dim">{CONTROL_COPY.facts.started}</dt>
          <dd>
            <RelativeTime iso={agent.createdAt} />
          </dd>
          <dt className="text-dim">{T.ended}</dt>
          <dd>
            <RelativeTime iso={agent.endedAt} fallback={T.notEnded} />
          </dd>
        </dl>
      </Details>
    </article>
  );
}

// Connector geometry shared with the sessions family tree (features/sessions/FamilyTree.tsx), so
// both trees read the same way.
const BRANCH = 'relative pt-3 pl-7';
const VERTICAL = 'before:absolute before:top-0 before:left-0 before:h-full before:border-l-2';
const LAST_VERTICAL = 'last:before:h-[2.05rem]';
const ELBOW = 'after:absolute after:top-[2.05rem] after:left-0 after:w-6 after:border-t-2';

function Branch({ node, ...rest }: { node: AgentNode } & Omit<CardProps, 'agent'>) {
  return (
    <div>
      <AgentCard agent={node.agent} {...rest} />
      {node.children.length > 0 ? (
        <ul className="ml-5" aria-label={C.startedBy(node.agent.role)}>
          {node.children.map((c) => (
            <li
              key={c.agent.id}
              className={`${BRANCH} ${VERTICAL} ${LAST_VERTICAL} ${ELBOW} before:border-accent/45 after:border-accent/45`}
            >
              <Branch node={c} {...rest} />
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

type CardProps = Parameters<typeof AgentCard>[0];

/**
 * The run's live family tree: the lead agent on top, the helper agents it started beneath it with
 * connecting lines. Built only from `parentAgentRunId`; each agent's own Claude Code helper agents
 * are drawn with the sessions family tree inside its card.
 */
export function AgentTree({
  agents,
  runId,
  canMessage,
  onMessage,
}: {
  agents: readonly AgentRunDto[];
  runId: string;
  canMessage: boolean;
  onMessage: (agent: AgentRunDto) => void;
}) {
  const tree = buildAgentTree(agents);
  const workers = agents.filter((a) => a.kind === 'worker').length;
  return (
    <Card title={C.title} description={C.description} testId="agent-tree">
      {tree.length === 0 ? (
        <p className="text-dim">{C.noAgents}</p>
      ) : (
        <ul className="flex flex-col gap-6" aria-label={C.title}>
          {tree.map((n) => (
            <li key={n.agent.id}>
              <Branch node={n} runId={runId} canMessage={canMessage} onMessage={onMessage} />
            </li>
          ))}
        </ul>
      )}
      {workers === 0 ? <p className="mt-3 text-caption text-dim">{C.none}</p> : null}
    </Card>
  );
}
