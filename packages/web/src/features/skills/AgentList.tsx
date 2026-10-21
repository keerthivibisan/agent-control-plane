import type { WorkflowStageId } from '@acp/core';
import type { AgentDefinitionSummaryDto, NodeUseDto } from '@acp/core/api';
import { Button } from '../../components/Button';
import { EmptyState } from '../../components/EmptyState';
import { RelativeTime } from '../../components/RelativeTime';
import { AGENTS_COPY, SKILLS_COPY, STAGE_AGENT_COPY, WORKFLOW_LIVE_COPY } from '../../lib/copy';
import { AgentFileIcon } from '../workflow/icons';
import { CardRow, FileCard, FileGrid, ProblemList, StageChips, UncommittedBadge } from './bits';
import { AGENT_TEMPLATES, type AgentTemplate } from './agent-templates';

const A = AGENTS_COPY;
const S = SKILLS_COPY;
/** Chips shown on a card before "+N more". */
const SHOWN_TOOLS = 6;
const TOOL_CHIP =
  'inline-flex h-5 items-center rounded-[0.3125rem] border border-line bg-sunken px-1.5 font-mono text-[0.6875rem] text-ink';

/** "All tools" (null), "No tools" ([]) or the first few tool names as chips. */
export function ToolChips({ tools }: { tools: readonly string[] | null }) {
  if (tools === null) {
    return (
      <span className="inline-flex h-5 items-center rounded-[0.3125rem] border border-dashed border-line-strong px-1.5 text-caption text-dim">
        {A.card.allTools}
      </span>
    );
  }
  if (tools.length === 0) return <span className="text-caption text-dim">{A.card.noTools}</span>;
  return (
    <ul className="flex flex-wrap gap-1" aria-label={A.card.tools}>
      {tools.slice(0, SHOWN_TOOLS).map((t) => (
        <li key={t} className={TOOL_CHIP}>
          {t}
        </li>
      ))}
      {tools.length > SHOWN_TOOLS ? (
        <li className="inline-flex h-5 items-center px-1 text-caption text-dim">
          {A.card.more(tools.length - SHOWN_TOOLS)}
        </li>
      ) : null}
    </ul>
  );
}

/** Which workflow stages use each agent file (R-I), and where to change that. */
export interface AgentUsage {
  usedBy: (name: string) => readonly WorkflowStageId[];
  /** ADR-0023: the workflow blocks that use the file, once the project's graph is known. */
  usedByNodes?: ((name: string) => readonly NodeUseDto[]) | undefined;
  /** The Workflow page. */
  href: string;
}

function AgentCard({
  agent,
  index,
  usage,
  onOpen,
}: {
  agent: AgentDefinitionSummaryDto;
  index: number;
  usage: AgentUsage | undefined;
  onOpen: () => void;
}) {
  return (
    <FileCard
      testId={`agent-card-${agent.name}`}
      index={index}
      icon={<AgentFileIcon size={16} />}
      name={agent.name}
      openLabel={A.card.open(agent.name)}
      onOpen={onOpen}
      description={agent.description}
      badge={agent.uncommitted ? <UncommittedBadge /> : null}
      footer={
        <>
          {S.card.lastCommitted}:{' '}
          <RelativeTime iso={agent.lastCommittedAt} fallback={S.card.neverCommitted} />
        </>
      }
    >
      <dl className="grid grid-cols-[4.5rem_minmax(0,1fr)] items-start gap-x-3 gap-y-2">
        <CardRow label={A.card.tools}>
          <ToolChips tools={agent.tools} />
        </CardRow>
        <CardRow label={A.card.model}>
          <span
            className={
              agent.model === null
                ? 'text-caption text-dim'
                : 'font-mono text-[0.6875rem] leading-5'
            }
          >
            {agent.model ?? A.card.defaultModel}
          </span>
        </CardRow>
        {usage !== undefined ? (
          <>
            <dt className="pt-0.5 text-caption text-dim">{S.card.usedBy}</dt>
            <dd className="min-w-0" data-testid="agent-used-by">
              <StageChips
                stages={usage.usedBy(agent.name)}
                nodes={usage.usedByNodes?.(agent.name)}
                link={usage.href}
                linkLabel={
                  usage.usedByNodes !== undefined
                    ? WORKFLOW_LIVE_COPY.usedBy.openBlock
                    : STAGE_AGENT_COPY.openStage
                }
              />
            </dd>
          </>
        ) : null}
      </dl>
      <ProblemList problems={agent.problems} />
    </FileCard>
  );
}

export function AgentTemplateButtons({ onPick }: { onPick: (t: AgentTemplate | null) => void }) {
  return (
    <div className="flex flex-wrap justify-center gap-2">
      {AGENT_TEMPLATES.map((t) => (
        <Button key={t.id} onClick={() => onPick(t)}>
          <AgentFileIcon size={14} className="text-accent" />
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
          icon={<AgentFileIcon size={20} />}
          title={A.empty.title}
          text={A.empty.text}
          action={<AgentTemplateButtons onPick={onNew} />}
        />
      </div>
    );
  }
  return (
    <FileGrid label={S.page.agentsTab}>
      {agents.map((a, i) => (
        <AgentCard key={a.name} agent={a} index={i} usage={usage} onOpen={() => onOpen(a.name)} />
      ))}
    </FileGrid>
  );
}
