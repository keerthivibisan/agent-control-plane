import type { WorkflowStageId } from '@acp/core';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { createContext, useContext, type ReactNode } from 'react';
import { CheckIcon, TicketIcon } from '../../components/icons';
import { Tooltip } from '../../components/Tooltip';
import { WORKFLOW_COPY } from '../../lib/copy';
import { formatCount } from '../../lib/format';
import type {
  AgentNode,
  AgentWorkspace,
  GateNode,
  HandleId,
  HelperNode,
  HelpersNode,
  ReviewNode,
  StageAgent,
  TerminalNode,
} from './graph';

const C = WORKFLOW_COPY;

/**
 * The node views of the workflow graph (graph.ts builds their data). Every view renders the same
 * hidden handles, so any edge the model draws has its ends. Selection comes from context, so the
 * graph model stays free of view state and can be reused by the ticket page's live graph.
 */

export interface WorkflowGraphActions {
  selected: WorkflowStageId | null;
  /** Null when the graph is read-only (no panel). */
  select: ((stage: WorkflowStageId) => void) | null;
}

export const WorkflowGraphContext = createContext<WorkflowGraphActions>({
  selected: null,
  select: null,
});

const HANDLE = 'opacity-0! border-0! size-1.5! min-w-0! min-h-0! pointer-events-none!';
const HANDLES: { id: HandleId; type: 'source' | 'target'; position: Position }[] = [
  { id: 'in-left', type: 'target', position: Position.Left },
  { id: 'out-right', type: 'source', position: Position.Right },
  { id: 'in-top', type: 'target', position: Position.Top },
  { id: 'out-top', type: 'source', position: Position.Top },
  { id: 'out-bottom', type: 'source', position: Position.Bottom },
  { id: 'in-bottom', type: 'target', position: Position.Bottom },
];

function Handles({ only }: { only?: readonly HandleId[] }) {
  return (
    <>
      {HANDLES.filter((h) => only === undefined || only.includes(h.id)).map((h) => (
        <Handle
          key={h.id}
          id={h.id}
          type={h.type}
          position={h.position}
          isConnectable={false}
          className={HANDLE}
        />
      ))}
    </>
  );
}

function frame(selected: boolean, off = false): string {
  return `relative flex h-full w-full flex-col gap-1.5 overflow-hidden rounded-card border bg-panel px-3 py-2.5 text-left text-ink shadow-card transition-[border-color,box-shadow] ${
    selected
      ? 'border-accent ring-3 ring-accent/25'
      : off
        ? 'border-dashed border-line-strong'
        : 'border-line hover:border-line-strong'
  } ${off ? 'bg-sunken' : ''}`;
}

/** The stage title: the keyboard way to open its panel (a click anywhere on the node does too). */
function StageTitle({ stage, children }: { stage: WorkflowStageId; children?: ReactNode }) {
  const { selected, select } = useContext(WorkflowGraphContext);
  const title = C.stages[stage];
  return (
    <div className="flex min-w-0 items-center gap-2">
      {select ? (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            select(stage);
          }}
          aria-label={C.select(title)}
          aria-pressed={selected === stage}
          className="nodrag min-w-0 truncate rounded-control text-left font-semibold"
        >
          {title}
        </button>
      ) : (
        <span className="min-w-0 truncate font-semibold">{title}</span>
      )}
      {children}
    </div>
  );
}

function Eyebrow({ left, right }: { left: ReactNode; right?: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2 text-caption leading-4 text-dim">
      <span className="truncate font-medium tracking-wide uppercase">{left}</span>
      {right}
    </div>
  );
}

function WorkspaceTag({ workspace }: { workspace: AgentWorkspace }) {
  return (
    <Tooltip content={C.workspaceTips[workspace]} focusable={false}>
      <span
        className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap"
        data-testid="node-workspace"
      >
        <span
          aria-hidden="true"
          className={`inline-block size-2 rounded-[3px] border ${
            workspace === 'read-only' ? 'border-dim' : 'border-accent bg-accent/40'
          }`}
        />
        {C.workspace[workspace]}
      </span>
    </Tooltip>
  );
}

function modelText(agent: Pick<StageAgent, 'model' | 'projectModel'>): string {
  if (agent.model !== null) return agent.model;
  return agent.projectModel === null ? C.projectDefault : C.projectDefaultNamed(agent.projectModel);
}

function ModelLine({ agent }: { agent: StageAgent }) {
  const text = modelText(agent);
  return (
    <p className="flex min-w-0 items-baseline gap-1.5 text-caption" data-testid="node-model">
      <span className="shrink-0 text-dim">{C.model}</span>
      <span
        className={`min-w-0 truncate ${agent.model === null ? 'text-dim italic' : 'font-mono'}`}
        title={text}
      >
        {text}
      </span>
    </p>
  );
}

/** "✦ code-review", "No skill", or a warning when the mapped skill is gone (ADR-0019 §4). */
export function SkillChip({ agent }: { agent: Pick<StageAgent, 'skill' | 'skillMissing'> }) {
  if (agent.skill === null) {
    return (
      <span
        className="inline-flex w-fit max-w-full items-center rounded-full border border-dashed border-line-strong px-2 py-0.5 text-caption text-dim"
        data-testid="node-skill"
        data-skill="none"
      >
        {C.noSkill}
      </span>
    );
  }
  if (agent.skillMissing) {
    return (
      <Tooltip content={C.skillMissingTip(agent.skill)} focusable={false} className="min-w-0">
        <span
          className="inline-flex w-fit max-w-full items-center gap-1 rounded-full border border-warning/40 bg-warning-soft px-2 py-0.5 text-caption font-medium text-warning"
          data-testid="node-skill"
          data-skill="missing"
        >
          <span aria-hidden="true">⚠</span>
          <span className="truncate font-mono">{agent.skill}</span>
          <span className="shrink-0">· {C.skillMissing}</span>
        </span>
      </Tooltip>
    );
  }
  return (
    <span
      className="inline-flex w-fit max-w-full items-center rounded-full border border-accent/25 bg-accent-soft px-2 py-0.5 text-caption font-medium text-accent"
      data-testid="node-skill"
      data-skill="set"
    >
      <span className="truncate">{C.skillChip(agent.skill)}</span>
    </span>
  );
}

function SmallPill({
  children,
  tip,
  tone,
}: {
  children: ReactNode;
  tip: string;
  tone: 'accent' | 'neutral';
}) {
  return (
    <Tooltip content={tip} focusable={false} className="shrink-0">
      <span
        className={`inline-flex items-center rounded-full border px-1.5 py-px text-[11px] leading-4 font-medium whitespace-nowrap ${
          tone === 'accent'
            ? 'border-accent/25 bg-accent-soft text-accent'
            : 'border-line-strong bg-panel text-dim'
        }`}
      >
        {children}
      </span>
    </Tooltip>
  );
}

export function AgentNodeView({ data, id }: NodeProps<AgentNode>) {
  const { selected } = useContext(WorkflowGraphContext);
  const off = !data.enabled;
  return (
    <div
      className={frame(selected === data.stage, off)}
      data-testid={`wf-node-${id}`}
      data-role={data.role}
      data-enabled={data.enabled ? 'true' : 'false'}
    >
      <Handles />
      <div className={`flex min-h-0 flex-col gap-1.5 ${off ? 'opacity-60' : ''}`}>
        <Eyebrow left={C.roles[data.role]} right={<WorkspaceTag workspace={data.workspace} />} />
        <StageTitle stage={data.stage}>
          {data.sameAgentAs !== null ? (
            <SmallPill tone="accent" tip={C.sameAgentTip(C.stages[data.sameAgentAs])}>
              <span data-testid="same-agent">{C.sameAgent}</span>
            </SmallPill>
          ) : null}
          {data.optional ? (
            <SmallPill tone="neutral" tip={C.optionalTip}>
              <span data-testid="stage-state">{off ? C.off : C.optionalOn}</span>
            </SmallPill>
          ) : null}
        </StageTitle>
        <ModelLine agent={data} />
        <SkillChip agent={data} />
      </div>
    </div>
  );
}

export function HelpersNodeView({ data }: NodeProps<HelpersNode>) {
  const { selected } = useContext(WorkflowGraphContext);
  return (
    <div
      className={`${frame(selected === 'helpers')} bg-sunken/60`}
      data-testid="wf-node-helpers"
      data-role="helper"
    >
      <Eyebrow left={C.roles.helper} right={<WorkspaceTag workspace={data.workspace} />} />
      <StageTitle stage="helpers" />
      <p className="text-caption text-dim tabular-nums" data-testid="helpers-facts">
        {C.helperFacts(
          data.maxHelpers,
          data.maxDepth,
          formatCount(data.budgetTokensPerAgent, 'compact'),
        )}
      </p>
      <ModelLine agent={data} />
      <SkillChip agent={data} />
    </div>
  );
}

export function HelperNodeView({ data }: NodeProps<HelperNode>) {
  const { selected } = useContext(WorkflowGraphContext);
  return (
    <div
      className={`flex h-full w-full items-center justify-between gap-2 rounded-control border bg-panel px-2.5 text-caption shadow-card ${
        selected === 'helpers' ? 'border-accent/60' : 'border-line'
      }`}
      data-testid={`wf-helper-${data.index}`}
    >
      <Handles only={['in-left', 'out-right']} />
      <span className="font-medium">{C.helperName(data.index)}</span>
      {data.nested ? (
        <Tooltip content={C.nestedTip} focusable={false}>
          <span className="text-dim" data-testid="helper-nested">
            {C.nestedHint}
          </span>
        </Tooltip>
      ) : null}
    </div>
  );
}

/** "You approve the plan": the owner's gate, part of the plan stage. */
export function GateNodeView(_: NodeProps<GateNode>) {
  return (
    <div
      className="relative flex h-full w-full flex-col justify-center gap-1 rounded-card border border-accent/40 bg-accent-soft px-3 py-2.5 text-ink"
      data-testid="wf-node-approve"
    >
      <Handles />
      <Eyebrow left={<span className="text-accent">{C.approve.who}</span>} />
      <Tooltip content={C.approve.tip} focusable={false} className="w-fit">
        <span className="font-semibold">{C.approve.title}</span>
      </Tooltip>
      <p className="text-caption text-dim">{C.approve.text}</p>
    </div>
  );
}

/** Review & merge: you, plus the harness checks. No agent. */
export function ReviewNodeView({ data }: NodeProps<ReviewNode>) {
  const { selected } = useContext(WorkflowGraphContext);
  return (
    <div
      className={`${frame(selected === 'review')} border-accent/40 bg-accent-soft/60`}
      data-testid="wf-node-review"
    >
      <Handles />
      <Eyebrow left={<span className="text-accent">{C.review.who}</span>} />
      <StageTitle stage="review" />
      {data.requireChecks ? (
        <p className="flex items-center gap-1.5 text-caption">
          <CheckIcon size={14} className="shrink-0 text-success" />
          {C.review.checks}
        </p>
      ) : null}
      <p className="flex items-center gap-1.5 text-caption">
        <CheckIcon size={14} className="shrink-0 text-success" />
        {C.review.merge}
      </p>
    </div>
  );
}

export function TerminalNodeView({ data }: NodeProps<TerminalNode>) {
  const ticket = data.terminal === 'ticket';
  return (
    <div
      className="relative flex h-full w-full items-center justify-center gap-2 rounded-full border border-line-strong bg-panel font-semibold shadow-card"
      data-testid={`wf-node-${data.terminal}`}
    >
      <Handles />
      {ticket ? (
        <TicketIcon size={16} className="text-dim" />
      ) : (
        <CheckIcon size={16} className="text-success" />
      )}
      {ticket ? C.ticket : C.done}
    </div>
  );
}

export const workflowNodeTypes = {
  agent: AgentNodeView,
  helpers: HelpersNodeView,
  helper: HelperNodeView,
  gate: GateNodeView,
  review: ReviewNodeView,
  terminal: TerminalNodeView,
};
