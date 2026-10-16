import type { WorkflowStageId } from '@acp/core';
import type { AgentDefinitionSummaryDto } from '@acp/core/api';
import { Button } from '../../components/Button';
import { EmptyState } from '../../components/EmptyState';
import { RelativeTime } from '../../components/RelativeTime';
import { SessionsIcon } from '../../components/icons';
import { AGENTS_COPY, SKILLS_COPY, STAGE_AGENT_COPY } from '../../lib/copy';
import { ProblemList, StageChips, UncommittedBadge } from './bits';
import { AGENT_TEMPLATES, type AgentTemplate } from './agent-templates';

const A = AGENTS_COPY;
const S = SKILLS_COPY;
/** Chips shown on a card before "+N more". */
const SHOWN_TOOLS = 6;

/** "All tools" (null), "No tools" ([]) or the first few tool names as chips. */
export function ToolChips({ tools }: { tools: readonly string[] | null }) {
  if (tools === null) {
    return (
      <span className="rounded-full border border-line px-2 py-px text-caption text-dim">
        {A.card.allTools}
      </span>
    );
  }
  if (tools.length === 0) return <span className="text-caption text-dim">{A.card.noTools}</span>;
  return (
    <ul className="flex flex-wrap gap-1.5" aria-label={A.card.tools}>
      {tools.slice(0, SHOWN_TOOLS).map((t) => (
        <li
          key={t}
          className="rounded-full border border-line bg-sunken px-2 py-px font-mono text-caption"
        >
          {t}
        </li>
      ))}
      {tools.length > SHOWN_TOOLS ? (
        <li className="px-1 text-caption text-dim">{A.card.more(tools.length - SHOWN_TOOLS)}</li>
      ) : null}
    </ul>
  );
}

/** Which workflow stages use each agent file (R-I), and where to change that. */
export interface AgentUsage {
  usedBy: (name: string) => readonly WorkflowStageId[];
  /** The Workflow page. */
  href: string;
}

function AgentCard({
  agent,
  usage,
  onOpen,
}: {
  agent: AgentDefinitionSummaryDto;
  usage: AgentUsage | undefined;
  onOpen: () => void;
}) {
  return (
    <li
      data-testid={`agent-card-${agent.name}`}
      className="flex min-w-0 flex-col gap-3 rounded-card border border-line bg-panel p-5 shadow-card transition-colors hover:border-line-strong"
    >
      <div className="flex items-start gap-2">
        <span
          aria-hidden
          className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-control bg-accent-soft text-accent"
        >
          <SessionsIcon size={16} />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="truncate font-mono font-semibold">
            <button
              type="button"
              onClick={onOpen}
              aria-label={A.card.open(agent.name)}
              className="text-left hover:text-accent hover:underline focus-visible:underline"
            >
              {agent.name}
            </button>
          </h2>
          <p className={`mt-0.5 line-clamp-2 ${agent.description === '' ? 'text-dim italic' : ''}`}>
            {agent.description === '' ? S.card.noDescription : agent.description}
          </p>
        </div>
        {agent.uncommitted ? <UncommittedBadge /> : null}
      </div>
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] items-baseline gap-x-3 gap-y-2">
        <dt className="text-caption text-dim">{A.card.tools}</dt>
        <dd>
          <ToolChips tools={agent.tools} />
        </dd>
        <dt className="text-caption text-dim">{A.card.model}</dt>
        <dd className={agent.model === null ? 'text-dim' : 'font-mono text-caption'}>
          {agent.model ?? A.card.defaultModel}
        </dd>
        {usage !== undefined ? (
          <>
            <dt className="text-caption text-dim">{S.card.usedBy}</dt>
            <dd data-testid="agent-used-by">
              <StageChips
                stages={usage.usedBy(agent.name)}
                link={usage.href}
                linkLabel={STAGE_AGENT_COPY.openStage}
              />
            </dd>
          </>
        ) : null}
      </dl>
      <ProblemList problems={agent.problems} />
      <p className="mt-auto border-t border-line pt-3 text-caption text-dim">
        {S.card.lastCommitted}:{' '}
        <RelativeTime iso={agent.lastCommittedAt} fallback={S.card.neverCommitted} />
      </p>
    </li>
  );
}

export function AgentTemplateButtons({ onPick }: { onPick: (t: AgentTemplate | null) => void }) {
  return (
    <div className="flex flex-wrap justify-center gap-2">
      {AGENT_TEMPLATES.map((t) => (
        <Button key={t.id} onClick={() => onPick(t)}>
          <SessionsIcon size={14} aria-hidden />
          {t.label}
        </Button>
      ))}
      <Button variant="quiet" onClick={() => onPick(null)}>
        {A.empty.blank}
      </Button>
    </div>
  );
}

export function AgentList({
  agents,
  usage,
  onOpen,
  onNew,
}: {
  agents: readonly AgentDefinitionSummaryDto[];
  /** Undefined while the workflow isn't known: the cards then leave "Used by" out. */
  usage?: AgentUsage | undefined;
  onOpen: (name: string) => void;
  onNew: (template: AgentTemplate | null) => void;
}) {
  if (agents.length === 0) {
    return (
      <div className="rounded-card border border-dashed border-line-strong bg-panel">
        <EmptyState
          testId="agents-empty"
          icon={<SessionsIcon size={22} />}
          title={A.empty.title}
          text={A.empty.text}
          action={<AgentTemplateButtons onPick={onNew} />}
        />
      </div>
    );
  }
  return (
    <ul className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3" aria-label={S.page.agentsTab}>
      {agents.map((a) => (
        <AgentCard key={a.name} agent={a} usage={usage} onOpen={() => onOpen(a.name)} />
      ))}
    </ul>
  );
}
