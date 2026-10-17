import type { AgentRunDto } from '@acp/core/api';
import { useId, useState, type KeyboardEvent } from 'react';
import { buttonClass } from '../../components/Button';
import { Card } from '../../components/Card';
import { ArrowRightIcon } from '../../components/icons';
import { fieldClass } from '../../components/Input';
import { messageAgent, sendChat, stopAgent } from '../../lib/api';
import { AGENT_FINISHED_COPY, AGENT_STATUS_COPY, CONTROL_COPY, TICKET_COPY } from '../../lib/copy';
import { formatCount } from '../../lib/format';
import { BudgetBar } from '../control/AgentTree';
import { ActionError, ConfirmAction, StatusWord } from '../control/bits';
import { buildAgentTree, isAgentLive, type AgentNode } from '../control/run-state';
import { useTicketAction } from './actions';
import { canHoldChat, descendantsBudget, hasWorktree, ROOT_ORDER } from './ticket-state';

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
  /** Worktree branch per helper id, once its workspace exists (`agentBranch`). */
  branches: ReadonlyMap<string, string>;
  /** The agent the owner's chat reaches now (`chatAgent`): the planner or the lead. */
  chatAgentId: string | null;
  /** Agents the engine closed after good work (`closedByEngine`): they read "Finished". */
  finished: ReadonlySet<string>;
}

/** Longer last parts (the engine's agent UUIDs) keep their first 8 characters. */
const SHORT_PART = 12;

/**
 * "acp/run-1/agent-ui" → "…/agent-ui": the part that tells helpers apart; the engine's
 * "acp/<run uuid>/<agent uuid>" → "…/0ff5eab0". The card's title has the full branch, and the
 * Details tab shows it in full.
 */
export function shortBranch(branch: string): string {
  const parts = branch.split('/');
  if (parts.length <= 2) return branch;
  const last = parts[parts.length - 1] ?? branch;
  return `…/${last.length > SHORT_PART ? last.slice(0, 8) : last}`;
}

/**
 * The prompt box on a card: the lead's goes to the chat; a helper's is sent through the engine's
 * `message_agent`, like the lead would.
 */
function PromptBox({ agent, runId }: { agent: AgentRunDto; runId: string }) {
  // The lead's and the planner's box goes to the chat (the engine routes it to whichever of the
  // two holds the conversation); a helper's through `message_agent`.
  const lead = canHoldChat(agent.kind);
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
          placeholder={
            agent.kind === 'planner'
              ? C.messagePlaceholderPlanner
              : lead
                ? C.messagePlaceholderLead
                : C.messagePlaceholder
          }
          aria-invalid={tooLong ? true : undefined}
          className={`h-8 flex-1 px-2 py-0 text-caption ${fieldClass}`}
        />
        <button
          type="submit"
          aria-label={C.send}
          title={C.send}
          disabled={action.pending || tooLong || text.trim().length === 0}
          className={`${buttonClass('primary')} w-8 px-0!`}
        >
          <ArrowRightIcon size={15} />
        </button>
      </div>
      {tooLong ? <span className="text-caption text-danger">{C.tooLong}</span> : null}
      <ActionError error={action.error} message={C.sendFailed} />
    </form>
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
  const term = TICKET_COPY.roles[agent.kind];
  // Chat reaches the agent that holds the conversation now; helpers take a direct message while
  // they work. The reviewer and the tester run after review, when the engine takes no messages.
  // The engine refuses chat to an agent that has ended, so the box goes with it.
  const promptable = canHoldChat(agent.kind)
    ? ctx.chatAgentId === agent.id && live
    : agent.kind === 'worker' && live;
  return (
    <article
      aria-label={agent.role}
      data-testid={`agent-${agent.id}`}
      data-selected={selected ? 'true' : undefined}
      // A click anywhere on the card selects it; the header button is the keyboard way.
      onClick={() => ctx.onSelect(agent.id)}
      data-kind={agent.kind}
      // A request waiting for you: a warning line along the top edge (with the words below it).
      className={`relative flex w-48 cursor-pointer flex-col gap-2.5 rounded-card border bg-panel p-3 text-left transition-[border-color,box-shadow] duration-150 ${
        selected
          ? 'border-accent ring-3 ring-accent/20'
          : waiting > 0
            ? 'border-warning/60 hover:border-warning'
            : 'border-line hover:border-line-strong'
      } ${
        waiting > 0
          ? 'shadow-[inset_0_2px_0_var(--color-warning)]'
          : selected
            ? 'shadow-card'
            : 'shadow-card hover:shadow-raised'
      }`}
    >
      <header className="flex flex-col gap-1.5">
        <button
          type="button"
          onClick={() => ctx.onSelect(agent.id)}
          aria-pressed={selected}
          aria-label={C.select(agent.role)}
          className="flex flex-col gap-0.5 rounded-control text-left"
        >
          <span
            className="block text-micro font-medium tracking-wider text-dim uppercase"
            data-testid="agent-term"
            title={term.tip}
          >
            {term.term}
          </span>
          <span className="block leading-5 font-semibold break-words">{agent.role}</span>
        </button>
        <span className="text-caption">
          <StatusWord
            status={
              ctx.finished.has(agent.id) ? AGENT_FINISHED_COPY : AGENT_STATUS_COPY[agent.status]
            }
            value={agent.status}
            withTip={false}
          />
        </span>
      </header>
      {waiting > 0 ? (
        <p className="w-fit rounded-full border border-warning/25 bg-warning-soft px-2 py-0.5 text-caption font-medium text-warning">
          ⚠ {C.needsYou(waiting)}
        </p>
      ) : null}
      {!hasWorktree(agent.kind) ? null : (
        <p className="text-caption" data-testid="agent-branch">
          {branch ? (
            <span className="block truncate font-mono text-dim" title={branch}>
              {shortBranch(branch)}
            </span>
          ) : (
            <span className="text-dim">{C.branchUnknown}</span>
          )}
        </p>
      )}
      <BudgetBar budget={agent.budget} />
      {!lead && helpersBudget > 0 ? (
        <p className="text-caption text-dim tabular-nums">
          {C.withHelpers(formatCount(agent.budget.used + helpersBudget))}
        </p>
      ) : null}
      <p className="line-clamp-2 border-t border-line pt-2 text-caption">
        <span className="text-dim">{A.latest}: </span>
        {agent.latestActivity ?? <span className="text-unavailable">{A.noActivity}</span>}
      </p>
      <div className="flex flex-col gap-2">
        {ctx.canMessage && promptable ? <PromptBox agent={agent} runId={ctx.runId} /> : null}
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
// v2: hairline connectors in the strong border color, quieter than the cards they join.
const CHILD_ROW =
  'relative flex justify-center pt-6 before:absolute before:top-0 before:left-1/2 before:h-6 before:border-l before:border-line-strong';
const CHILD =
  'relative flex flex-col items-center px-1.5 pt-6 ' +
  'before:absolute before:top-0 before:right-1/2 before:w-1/2 before:border-t before:border-line-strong ' +
  'after:absolute after:top-0 after:left-1/2 after:h-6 after:w-1/2 after:border-t after:border-l after:border-line-strong ' +
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
  // Roots in the flow's order: the planner, the lead with its helpers, then the reviewer and tester.
  const tree = buildAgentTree(agents).sort(
    (a, b) => ROOT_ORDER[a.agent.kind] - ROOT_ORDER[b.agent.kind],
  );
  const helpers = agents.filter((a) => a.kind === 'worker').length;
  return (
    <Card title={C.title} description={C.description} testId="agent-canvas" padded={false}>
      {/* The side padding sits on the tree itself, so a wide tree keeps it when it scrolls. */}
      <div className="overflow-x-auto pt-3 pb-6">
        {tree.length === 0 ? (
          <p className="px-5 text-dim">{C.noAgents}</p>
        ) : (
          <ul
            className="flex w-max min-w-full flex-col items-center gap-8 px-5"
            aria-label={C.title}
          >
            {tree.map((n) => (
              <li key={n.agent.id} className="flex flex-col items-center">
                <Branch node={n} ctx={ctx} />
              </li>
            ))}
          </ul>
        )}
        {note ? (
          <p className="mx-5 mt-5 max-w-lg rounded-control border border-dashed border-line-strong px-4 py-3 text-center text-dim sm:mx-auto">
            {note}
          </p>
        ) : tree.length > 0 && helpers === 0 ? (
          <p className="mt-5 px-5 text-center text-caption text-dim">{C.noHelpers}</p>
        ) : null}
      </div>
    </Card>
  );
}
