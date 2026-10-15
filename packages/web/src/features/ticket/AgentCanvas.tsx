import type { AgentRunDto } from '@acp/core/api';
import { useId, useState, type KeyboardEvent } from 'react';
import { Card } from '../../components/Card';
import { messageAgent, sendChat, stopAgent } from '../../lib/api';
import { AGENT_STATUS_COPY, CONTROL_COPY, TICKET_COPY } from '../../lib/copy';
import { formatCount } from '../../lib/format';
import { BudgetBar } from '../control/AgentTree';
import { ActionError, ConfirmAction, StatusWord } from '../control/bits';
import { buildAgentTree, isAgentLive, type AgentNode } from '../control/run-state';
import { useTicketAction } from './actions';
import { descendantsBudget } from './ticket-state';

const C = TICKET_COPY.canvas;
const A = CONTROL_COPY.agents;
const MAX_CHARS = 8000;

export interface CanvasContext {
  runId: string;
  selectedId: string | null;
  onSelect: (agentId: string) => void;
  /** The run still takes messages (not ended, not stopping). */
  canMessage: boolean;
  /** Pending approvals per agent id. */
  pending: ReadonlyMap<string, number>;
  /** Worktree branch per agent id, once the review reports it. */
  branches: ReadonlyMap<string, string>;
}

/** "acp/run-1/agent-ui" → "…/agent-ui": the part that tells helpers apart. */
function shortBranch(branch: string): string {
  const parts = branch.split('/');
  return parts.length > 2 ? `…/${parts[parts.length - 1] ?? branch}` : branch;
}

/**
 * The prompt box on a card: the lead's goes to the chat; a helper's is sent through the engine's
 * `message_agent`, like the lead would.
 */
function PromptBox({ agent, runId }: { agent: AgentRunDto; runId: string }) {
  const lead = agent.kind === 'lead';
  const chat = useTicketAction(sendChat);
  const direct = useTicketAction(messageAgent);
  const action = lead ? chat : direct;
  const [text, setText] = useState('');
  const id = useId();
  const tooLong = text.length > MAX_CHARS;

  const submit = async () => {
    const t = text.trim();
    if (t.length === 0 || tooLong || action.pending) return;
    const sent = lead
      ? await chat.run(runId, { text: t })
      : await direct.run(runId, agent.id, { text: t });
    if (sent !== null) setText('');
  };
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void submit();
    }
  };

  return (
    <form
      className="flex flex-col gap-1.5"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <div className="flex items-center gap-1.5">
        <label htmlFor={id} className="sr-only">
          {C.messageLabel(agent.role)}
        </label>
        <input
          id={id}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={lead ? C.messagePlaceholderLead : C.messagePlaceholder}
          aria-invalid={tooLong ? true : undefined}
          className={`min-w-0 flex-1 rounded-control border bg-canvas px-2.5 py-1.5 text-caption text-ink placeholder:text-dim/70 ${
            tooLong ? 'border-danger' : 'border-line'
          }`}
        />
        <button
          type="submit"
          aria-label={C.send}
          title={C.send}
          disabled={action.pending || tooLong || text.trim().length === 0}
          className="inline-flex size-8 shrink-0 items-center justify-center rounded-control border border-accent bg-accent text-accent-ink hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <SendIcon />
        </button>
      </div>
      {tooLong ? <span className="text-caption text-danger">{C.tooLong}</span> : null}
      <ActionError error={action.error} message={C.sendFailed} />
    </form>
  );
}

function SendIcon() {
  return (
    <svg
      width={15}
      height={15}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  );
}

function AgentCard({ node, ctx }: { node: AgentNode; ctx: CanvasContext }) {
  const { agent } = node;
  const stop = useTicketAction(stopAgent);
  const live = isAgentLive(agent.status);
  const lead = agent.kind === 'lead';
  const selected = ctx.selectedId === agent.id;
  const waiting = ctx.pending.get(agent.id) ?? 0;
  const branch = ctx.branches.get(agent.id);
  const helpersBudget = descendantsBudget(node);
  const term = lead ? CONTROL_COPY.terms.lead : CONTROL_COPY.terms.worker;
  return (
    <article
      aria-label={agent.role}
      data-testid={`agent-${agent.id}`}
      data-selected={selected ? 'true' : undefined}
      // A click anywhere on the card selects it; the header button is the keyboard way.
      onClick={() => ctx.onSelect(agent.id)}
      className={`relative flex w-60 flex-col gap-2 rounded-card border bg-panel px-3.5 py-3 text-left shadow-card transition-shadow ${
        selected ? 'border-accent ring-2 ring-accent/25' : 'border-line hover:border-line-strong'
      } ${waiting > 0 ? 'border-t-4 border-t-warning' : ''}`}
    >
      <header className="flex flex-col gap-1">
        <button
          type="button"
          onClick={() => ctx.onSelect(agent.id)}
          aria-pressed={selected}
          aria-label={C.select(agent.role)}
          className="rounded-control text-left"
        >
          <span className="block text-caption tracking-wide text-dim uppercase">{term.term}</span>
          <span className="block font-semibold break-words">{agent.role}</span>
        </button>
        <StatusWord status={AGENT_STATUS_COPY[agent.status]} value={agent.status} withTip={false} />
      </header>
      {waiting > 0 ? (
        <p className="w-fit rounded-full bg-warning-soft px-2 py-0.5 text-caption font-medium text-warning">
          ⚠ {C.needsYou(waiting)}
        </p>
      ) : null}
      {lead ? null : (
        <p className="text-caption" data-testid="agent-branch">
          {branch ? (
            <span className="font-mono" title={branch}>
              {shortBranch(branch)}
            </span>
          ) : (
            <span className="text-dim">{C.branchUnknown}</span>
          )}
        </p>
      )}
      <BudgetBar budget={agent.budget} />
      {helpersBudget > 0 ? (
        <p className="text-caption text-dim tabular-nums">
          {C.withHelpers(formatCount(agent.budget.used + helpersBudget))}
        </p>
      ) : null}
      <p className="line-clamp-2 text-caption">
        <span className="text-dim">{A.latest}: </span>
        {agent.latestActivity ?? <span className="text-unavailable">{A.noActivity}</span>}
      </p>
      <div className="flex flex-col gap-2">
        {ctx.canMessage && (lead || live) ? <PromptBox agent={agent} runId={ctx.runId} /> : null}
        {live ? (
          <ConfirmAction
            label={A.stop}
            question={lead ? A.confirmStopLead : A.confirmStop(agent.role)}
            confirmLabel={A.stopConfirm}
            cancelLabel={A.keep}
            pendingLabel={A.stopping}
            pending={stop.pending}
            onConfirm={() => stop.run(ctx.runId, agent.id)}
          />
        ) : null}
        <ActionError error={stop.error} message={A.stopFailed} />
      </div>
    </article>
  );
}

// An org chart in CSS: each child draws its half of the bar above it and a stub down to its card;
// the first and last child drop the outer half, an only child keeps just the stub.
const CHILD_ROW =
  'relative flex justify-center pt-6 before:absolute before:top-0 before:left-1/2 before:h-6 before:border-l-2 before:border-accent/40';
const CHILD =
  'relative flex flex-col items-center px-2 pt-6 ' +
  'before:absolute before:top-0 before:right-1/2 before:w-1/2 before:border-t-2 before:border-accent/40 ' +
  'after:absolute after:top-0 after:left-1/2 after:h-6 after:w-1/2 after:border-t-2 after:border-l-2 after:border-accent/40 ' +
  'first:before:border-t-0 last:after:border-t-0';

function Branch({ node, ctx }: { node: AgentNode; ctx: CanvasContext }) {
  return (
    <>
      <AgentCard node={node} ctx={ctx} />
      {node.children.length > 0 ? (
        <ul className={CHILD_ROW} aria-label={A.startedBy(node.agent.role)}>
          {node.children.map((c) => (
            <li key={c.agent.id} className={CHILD}>
              <Branch node={c} ctx={ctx} />
            </li>
          ))}
        </ul>
      ) : null}
    </>
  );
}

/**
 * The run's agents as a tree of cards (README §5.3): the lead on top, its helpers beneath, and
 * depth-2 helpers beneath the helper that started them. Built only from `parentAgentRunId`; an agent
 * whose parent is unknown starts its own tree rather than being attached anywhere.
 */
export function AgentCanvas({
  agents,
  note,
  ...ctx
}: CanvasContext & { agents: readonly AgentRunDto[]; note?: string | undefined }) {
  const tree = buildAgentTree(agents);
  const helpers = agents.filter((a) => a.kind === 'worker').length;
  return (
    <Card title={C.title} description={C.description} testId="agent-canvas" padded={false}>
      <div className="overflow-x-auto px-5 pt-2 pb-6">
        {tree.length === 0 ? (
          <p className="text-dim">{C.noAgents}</p>
        ) : (
          <ul className="flex w-max min-w-full flex-col items-center gap-8" aria-label={C.title}>
            {tree.map((n) => (
              <li key={n.agent.id} className="flex flex-col items-center">
                <Branch node={n} ctx={ctx} />
              </li>
            ))}
          </ul>
        )}
        {note ? (
          <p className="mx-auto mt-5 max-w-lg rounded-control bg-sunken px-4 py-3 text-center text-dim">
            {note}
          </p>
        ) : tree.length > 0 && helpers === 0 ? (
          <p className="mt-5 text-center text-caption text-dim">{C.noHelpers}</p>
        ) : null}
      </div>
    </Card>
  );
}
