import type { WorkflowStageId } from '@acp/core';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { createContext, useContext, type CSSProperties, type ReactNode } from 'react';
import { AlertIcon, CheckIcon, TicketIcon } from '../../components/icons';
import { Tooltip } from '../../components/Tooltip';
import { REVIEW_LOOP_COPY, STAGE_AGENT_COPY, WORKFLOW_COPY } from '../../lib/copy';
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
  WorkflowRole,
} from './graph';
import {
  AgentFileIcon,
  DoneIcon,
  MergeIcon,
  OwnCopyIcon,
  ReadOnlyIcon,
  ROLE_ICON,
  YouIcon,
} from './icons';

const C = WORKFLOW_COPY;
const AF = STAGE_AGENT_COPY;
const RL = REVIEW_LOOP_COPY;

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
const HANDLES: {
  id: HandleId;
  type: 'source' | 'target';
  position: Position;
  style?: CSSProperties;
}[] = [
  { id: 'in-left', type: 'target', position: Position.Left },
  { id: 'out-right', type: 'source', position: Position.Right },
  { id: 'in-top', type: 'target', position: Position.Top },
  { id: 'out-top', type: 'source', position: Position.Top },
  { id: 'out-bottom', type: 'source', position: Position.Bottom },
  { id: 'in-bottom', type: 'target', position: Position.Bottom },
  // The review loop's rework edge leaves Review off-centre, clear of the line coming down from the
  // plan approval above it.
  { id: 'out-top-loop', type: 'source', position: Position.Top, style: { left: '78%' } },
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
          {...(h.style === undefined ? {} : { style: h.style })}
          isConnectable={false}
          className={HANDLE}
        />
      ))}
    </>
  );
}

/** A tag on a node: square, like the node, because it names a thing (DESIGN.md, "Agent views"). */
const TAG =
  'inline-flex h-5 w-fit max-w-full min-w-0 items-center gap-1 rounded-[2px] border px-1.5 text-caption font-medium';

/**
 * How a stage node looks at rest: an agent, the lead (the controller, framed in ink like the
 * logo's centre), an agent stage that is off, the helpers box, you. Square corners throughout
 * (DESIGN.md, "Agent views"); lime only for the selection.
 */
type FrameKind = 'agent' | 'lead' | 'off' | 'helpers' | 'you';

const FRAME_REST: Record<FrameKind, string> = {
  agent: 'border-line bg-panel shadow-card hover:border-line-strong hover:shadow-raised',
  lead: 'border-ink/70 bg-panel shadow-card hover:border-ink hover:shadow-raised',
  off: 'border-dashed border-line-strong bg-sunken',
  // A shade between the well and the cards, so the helper rows inside read as cards on it.
  helpers:
    'border-line bg-[color-mix(in_srgb,var(--color-sunken)_55%,var(--color-panel))] hover:border-line-strong',
  you: 'border-line-strong bg-sunken hover:border-dim/60',
};

const FRAME_SELECTED: Record<FrameKind, string> = {
  agent: 'border-accent-fill-edge bg-panel shadow-raised',
  lead: 'border-ink bg-panel shadow-raised',
  off: 'border-accent-fill-edge bg-sunken',
  helpers:
    'border-accent-fill-edge bg-[color-mix(in_srgb,var(--color-sunken)_55%,var(--color-panel))]',
  you: 'border-accent-fill-edge bg-sunken',
};

function frame(selected: boolean, kind: FrameKind = 'agent'): string {
  return `relative flex h-full w-full flex-col gap-1.5 overflow-hidden rounded-[2px] border px-3 py-2.5 text-left text-ink transition-[border-color,box-shadow,background-color] duration-150 ${
    selected
      ? `${FRAME_SELECTED[kind]} ring-3 ring-accent-fill/55 dark:ring-accent-fill/25`
      : FRAME_REST[kind]
  }`;
}

/** The stage title: the keyboard way to open its panel (a click anywhere on the node does too). */
function StageTitle({ stage, children }: { stage: WorkflowStageId; children?: ReactNode }) {
  const { selected, select } = useContext(WorkflowGraphContext);
  const title = C.stages[stage];
  return (
    <div className="flex min-w-0 items-center gap-1.5">
      {select ? (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            select(stage);
          }}
          aria-label={C.select(title)}
          aria-pressed={selected === stage}
          className="nodrag min-w-0 truncate rounded-[0.25rem] text-left font-semibold tracking-[-0.006em] hover:text-accent"
        >
          {title}
        </button>
      ) : (
        <span className="min-w-0 truncate font-semibold tracking-[-0.006em]">{title}</span>
      )}
      {children}
    </div>
  );
}

/** The small line above the title: who acts (a role or "You"), and where an agent works. */
function Eyebrow({
  left,
  icon,
  right,
  accent = false,
}: {
  left: ReactNode;
  icon?: ReactNode;
  right?: ReactNode;
  accent?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-2 text-micro leading-4">
      <span
        className={`flex min-w-0 items-center gap-1.5 font-semibold tracking-[0.06em] uppercase ${
          accent ? 'text-accent' : 'text-dim'
        }`}
      >
        {icon}
        <span className="truncate">{left}</span>
      </span>
      {right}
    </div>
  );
}

function RoleIcon({ role }: { role: WorkflowRole }) {
  const Icon = ROLE_ICON[role];
  return <Icon size={13} className="shrink-0" />;
}

function WorkspaceTag({ workspace }: { workspace: AgentWorkspace }) {
  const readOnly = workspace === 'read-only';
  return (
    <Tooltip content={C.workspaceTips[workspace]} focusable={false}>
      <span
        className={`inline-flex shrink-0 items-center gap-1 text-caption whitespace-nowrap ${
          readOnly ? 'text-dim' : 'text-accent'
        }`}
        data-testid="node-workspace"
      >
        {readOnly ? (
          <ReadOnlyIcon size={12} className="shrink-0" />
        ) : (
          <OwnCopyIcon size={12} className="shrink-0" />
        )}
        {C.workspace[workspace]}
      </span>
    </Tooltip>
  );
}

/** The model the stage's agent gets: stage > agent file > project > Claude Code (ADR-0019 §6). */
export function modelText(
  agent: Pick<StageAgent, 'model' | 'projectModel' | 'agent' | 'agentModel'>,
): { text: string; own: boolean; fileModel?: string } {
  if (agent.model !== null) return { text: agent.model, own: true };
  if (agent.agent !== null) {
    if (typeof agent.agentModel === 'string') {
      return {
        text: AF.modelFromFile(agent.agentModel),
        own: true,
        fileModel: agent.agentModel,
      };
    }
    // The file list isn't known here (the ticket page's live graph): don't guess which applies.
    if (agent.agentModel === undefined) return { text: AF.modelFileOrDefault, own: false };
  }
  return {
    text:
      agent.projectModel === null ? C.projectDefault : C.projectDefaultNamed(agent.projectModel),
    own: false,
  };
}

function ModelLine({ agent }: { agent: StageAgent }) {
  const { text, own, fileModel } = modelText(agent);
  return (
    <p
      className="flex min-w-0 items-baseline gap-1.5 text-caption"
      data-testid="node-model"
      title={text}
    >
      <span className="shrink-0 text-dim">{C.model}</span>
      {fileModel !== undefined ? (
        // The model may be cut short; where it comes from stays readable.
        <>
          <span className="min-w-0 truncate font-mono text-[0.6875rem]">{fileModel}</span>{' '}
          <span className="-ml-1 shrink-0 text-dim">{AF.modelFromFileSuffix}</span>
        </>
      ) : (
        <span
          className={`min-w-0 truncate ${own ? 'font-mono text-[0.6875rem]' : 'text-dim italic'}`}
        >
          {text}
        </span>
      )}
    </p>
  );
}

/** "✦ code-review", "No skill", or a warning when the mapped skill is gone (ADR-0019 §4). */
export function SkillChip({
  agent,
  compact = false,
}: {
  agent: Pick<StageAgent, 'skill' | 'skillMissing'>;
  /** Shares its line with the agent chip: "(missing)" is for screen readers only. */
  compact?: boolean;
}) {
  if (agent.skill === null) {
    return (
      <span
        className={`${TAG} border-dashed border-line-strong text-dim`}
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
          className={`${TAG} border-warning/35 bg-warning-soft text-warning`}
          data-testid="node-skill"
          data-skill="missing"
        >
          <AlertIcon size={12} className="shrink-0" />
          <span className="truncate font-mono text-[0.6875rem]">{agent.skill}</span>
          <span className={compact ? 'sr-only' : 'shrink-0'}>({C.skillMissing})</span>
        </span>
      </Tooltip>
    );
  }
  return (
    <span
      className={`${TAG} border-accent/20 bg-accent-soft text-accent`}
      data-testid="node-skill"
      data-skill="set"
    >
      <span className="truncate">{C.skillChip(agent.skill)}</span>
    </span>
  );
}

/**
 * The stage's agent file (ADR-0019 §6): its name with the agent icon, or a warning when the file
 * is gone. Nothing when the stage has none, so a node without one reads as before.
 */
export function AgentChip({ agent }: { agent: Pick<StageAgent, 'agent' | 'agentMissing'> }) {
  if (agent.agent === null) return null;
  const missing = agent.agentMissing;
  return (
    <Tooltip
      content={missing ? AF.missingTip(agent.agent) : AF.chipTip(agent.agent)}
      focusable={false}
      className="inline-flex min-w-0"
    >
      <span
        className={`${TAG} ${
          missing
            ? 'border-warning/35 bg-warning-soft text-warning'
            : 'border-line-strong bg-sunken text-ink'
        }`}
        data-testid="node-agent"
        data-agent={missing ? 'missing' : 'set'}
      >
        {missing ? (
          <AlertIcon size={12} className="shrink-0" />
        ) : (
          <AgentFileIcon size={12} className="shrink-0 text-accent" />
        )}
        <span className="truncate">{agent.agent}</span>
        {/* Next to the skill chip there is no room for the word; the icon, the tone and the tip say it. */}
        {missing ? <span className="sr-only">({AF.missing})</span> : null}
      </span>
    </Tooltip>
  );
}

/** The agent file, then the skill, on one line ("test-writer + ✦ unit-tests", redesign §6a). */
function UsesLine({ agent }: { agent: StageAgent }) {
  return (
    <div className="flex min-w-0 items-center gap-1">
      <AgentChip agent={agent} />
      <SkillChip agent={agent} compact={agent.agent !== null} />
    </div>
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
        className={`inline-flex h-4 items-center rounded-full border px-1.5 text-micro font-medium whitespace-nowrap ${
          tone === 'accent'
            ? 'border-accent/20 bg-accent-soft text-accent'
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
      className={frame(
        selected === data.stage,
        off ? 'off' : data.role === 'lead' ? 'lead' : 'agent',
      )}
      data-testid={`wf-node-${id}`}
      data-role={data.role}
      data-enabled={data.enabled ? 'true' : 'false'}
    >
      <Handles />
      <div className={`flex min-h-0 flex-col gap-1.5 ${off ? 'opacity-60' : ''}`}>
        <Eyebrow
          left={C.roles[data.role]}
          icon={<RoleIcon role={data.role} />}
          right={<WorkspaceTag workspace={data.workspace} />}
        />
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
        <UsesLine agent={data} />
      </div>
    </div>
  );
}

export function HelpersNodeView({ data }: NodeProps<HelpersNode>) {
  const { selected } = useContext(WorkflowGraphContext);
  return (
    <div
      className={frame(selected === 'helpers', 'helpers')}
      data-testid="wf-node-helpers"
      data-role="helper"
    >
      {/* The review loop's "rework" edge comes back in at the top. */}
      <Handles only={['in-top']} />
      <Eyebrow
        left={C.roles.helper}
        icon={<RoleIcon role="helper" />}
        right={<WorkspaceTag workspace={data.workspace} />}
      />
      <StageTitle stage="helpers" />
      <p className="text-caption text-dim tabular-nums" data-testid="helpers-facts">
        {C.helperFacts(
          data.maxHelpers,
          data.maxDepth,
          formatCount(data.budgetTokensPerAgent, 'compact'),
        )}
      </p>
      <ModelLine agent={data} />
      <UsesLine agent={data} />
    </div>
  );
}

export function HelperNodeView({ data }: NodeProps<HelperNode>) {
  const { selected } = useContext(WorkflowGraphContext);
  return (
    <div
      className={`flex h-full w-full items-center justify-between gap-2 rounded-[2px] border bg-panel px-2.5 text-caption shadow-card transition-colors duration-150 ${
        selected === 'helpers'
          ? 'border-accent-fill-edge/60'
          : 'border-line hover:border-line-strong'
      }`}
      data-testid={`wf-helper-${data.index}`}
    >
      <Handles only={['in-left', 'out-right']} />
      <span className="flex items-center gap-1.5 font-medium">
        {/* A small square node, neutral: this is the setup, not an agent at work. */}
        <span aria-hidden="true" className="size-1.5 shrink-0 bg-dim/70" />
        {C.helperName(data.index)}
      </span>
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

/** "You merge into main": the owner's one merge of the ticket branch (ADR-0021 §4). */
function OwnerMergeGateView() {
  const G = RL.graph.ownerMerge;
  return (
    <div
      className="relative flex h-full w-full flex-col justify-center gap-1 rounded-[2px] border border-line-strong bg-sunken px-3 py-2.5 text-ink"
      data-testid="wf-node-owner-merge"
    >
      <Handles />
      <Eyebrow left={G.who} icon={<YouIcon size={13} className="shrink-0" />} accent />
      <Tooltip content={G.tip} focusable={false} className="w-fit">
        <span className="font-semibold tracking-[-0.006em]">{G.title}</span>
      </Tooltip>
      <p className="text-caption text-dim">{G.text}</p>
    </div>
  );
}

/** "You approve the plan": the owner's gate, part of the plan stage. */
export function GateNodeView({ data }: NodeProps<GateNode>) {
  if (data.gate === 'owner-merge') return <OwnerMergeGateView />;
  return (
    <div
      className="relative flex h-full w-full flex-col justify-center gap-1 rounded-[2px] border border-line-strong bg-sunken px-3 py-2.5 text-ink"
      data-testid="wf-node-approve"
    >
      <Handles />
      <Eyebrow left={C.approve.who} icon={<YouIcon size={13} className="shrink-0" />} accent />
      <Tooltip content={C.approve.tip} focusable={false} className="w-fit">
        <span className="font-semibold tracking-[-0.006em]">{C.approve.title}</span>
      </Tooltip>
      <p className="text-caption text-dim">{C.approve.text}</p>
    </div>
  );
}

type ReviewCounts = NonNullable<NonNullable<ReviewNode['data']['loop']>['counts']>;

/** "1 in review · 2 merged · 1 for you": the run's changes, only the parts that have any. */
function ReviewCountsLine({ counts }: { counts: ReviewCounts }) {
  const W = RL.graph.counts;
  const parts = [
    { key: 'needs-owner', text: W.needsOwner(counts.needsOwner), n: counts.needsOwner },
    { key: 'waiting', text: W.waiting(counts.waiting), n: counts.waiting },
    { key: 'in-review', text: W.inReview(counts.inReview), n: counts.inReview },
    { key: 'rework', text: W.rework(counts.rework), n: counts.rework },
    { key: 'merged', text: W.merged(counts.merged), n: counts.merged },
    { key: 'discarded', text: W.discarded(counts.discarded), n: counts.discarded },
    { key: 'no-changes', text: W.noChanges(counts.noChanges), n: counts.noChanges },
  ].filter((p) => p.n > 0);
  return (
    <p
      className="line-clamp-2 text-caption text-dim tabular-nums"
      data-testid="review-counts"
      title={parts.map((p) => p.text).join(' · ')}
    >
      {parts.length === 0
        ? W.none
        : parts.map((p, i) => (
            <span key={p.key} className={p.key === 'needs-owner' ? 'font-medium text-warning' : ''}>
              {i > 0 ? ' · ' : ''}
              {p.text}
            </span>
          ))}
    </p>
  );
}

/**
 * Review with the loop (ADR-0021 §3): a reviewer reads each change and the lead merges it into the
 * ticket branch; on the ticket page the run's counts replace the rounds line.
 */
function ReviewLoopNodeView({
  loop,
  requireChecks,
}: {
  loop: NonNullable<ReviewNode['data']['loop']>;
  requireChecks: boolean;
}) {
  const { selected } = useContext(WorkflowGraphContext);
  const ReviewerIcon = ROLE_ICON[loop.reviewer === 'agent' ? 'reviewer' : 'lead'];
  return (
    <div
      className={frame(selected === 'review', 'agent')}
      data-testid="wf-node-review"
      data-reviewer={loop.reviewer}
    >
      <Handles />
      <Eyebrow
        left={RL.review.who[loop.reviewer]}
        icon={<ReviewerIcon size={13} className="shrink-0" />}
        right={<MergeIcon size={13} className="shrink-0 text-dim" />}
      />
      <StageTitle stage="review" />
      {requireChecks ? (
        <p className="flex items-center gap-1.5 text-caption">
          <CheckIcon size={13} className="shrink-0 text-success" />
          {C.review.checks}
        </p>
      ) : null}
      {/* On the ticket page the run's counts take the place of the settings lines. */}
      {loop.counts !== undefined ? (
        <ReviewCountsLine counts={loop.counts} />
      ) : (
        <>
          <p className="flex items-center gap-1.5 text-caption">
            <CheckIcon size={13} className="shrink-0 text-success" />
            {RL.review.leadMerges}
          </p>
          <p className="text-caption text-dim" data-testid="review-rounds">
            {RL.review.roundsLine(loop.maxReworkRounds)}
          </p>
        </>
      )}
    </div>
  );
}

/** Review & merge: you, plus the harness checks. No agent. */
export function ReviewNodeView({ data }: NodeProps<ReviewNode>) {
  const { selected } = useContext(WorkflowGraphContext);
  if (data.loop !== undefined) {
    return <ReviewLoopNodeView loop={data.loop} requireChecks={data.requireChecks} />;
  }
  return (
    <div className={frame(selected === 'review', 'you')} data-testid="wf-node-review">
      <Handles />
      <Eyebrow left={C.review.who} icon={<MergeIcon size={13} className="shrink-0" />} accent />
      <StageTitle stage="review" />
      {data.requireChecks ? (
        <p className="flex items-center gap-1.5 text-caption">
          <CheckIcon size={13} className="shrink-0 text-success" />
          {C.review.checks}
        </p>
      ) : null}
      <p className="flex items-center gap-1.5 text-caption">
        <CheckIcon size={13} className="shrink-0 text-success" />
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
        <TicketIcon size={15} className="text-dim" />
      ) : (
        <DoneIcon size={15} className="text-success" />
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
