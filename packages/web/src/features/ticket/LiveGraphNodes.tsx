import { NODE_CAPABILITIES, type WorkflowNode } from '@acp/core';
import type { AgentRunDto } from '@acp/core/api';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { createContext, useContext, type ReactNode } from 'react';
import { CheckIcon, TicketIcon } from '../../components/icons';
import { Tooltip } from '../../components/Tooltip';
import { AGENT_STATUS_COPY, REVIEW_LOOP_COPY, WORKFLOW_LIVE_COPY } from '../../lib/copy';
import { isAgentLive } from '../control/run-state';
import {
  AgentFileIcon,
  DoneIcon,
  MergeIcon,
  OwnCopyIcon,
  ReadOnlyIcon,
  ROLE_ICON,
  YouIcon,
} from '../workflow/icons';
import { DONE_RING, STATE_RING, StateFrame } from './live-frame';
import { kindWord, type LiveBlock } from './live-graph';

const G = WORKFLOW_LIVE_COPY.graph;
const MODE_WORD = REVIEW_LOOP_COPY.modes.word;

/*
 * The live graph's block views (DESIGN.md, "Agent views"), the same look as the Workflow page's
 * editor: square agent blocks framed in `line`, the lead framed in `ink`, smaller steps on the
 * `sunken` well, Ticket and Done as pills. Read-only: the only controls are the agents on a block,
 * which show that agent in the side panel. Lime marks only what is working.
 */

export interface LiveGraphActions {
  /** Shows one agent in the side panel. */
  selectAgent: (agent: AgentRunDto, node: WorkflowNode) => void;
}

export const LiveGraphContext = createContext<LiveGraphActions>({ selectAgent: () => undefined });

const HANDLE = 'opacity-0! border-0! size-1.5! min-w-0! min-h-0! pointer-events-none!';

/** Hidden handles on every side, so any link the model draws has its ends. */
function Handles() {
  return (
    <>
      <Handle
        id="in"
        type="target"
        position={Position.Left}
        isConnectable={false}
        className={HANDLE}
      />
      <Handle
        id="out"
        type="source"
        position={Position.Right}
        isConnectable={false}
        className={HANDLE}
      />
      <Handle
        id="in-top"
        type="target"
        position={Position.Top}
        isConnectable={false}
        className={HANDLE}
      />
      <Handle
        id="out-top"
        type="source"
        position={Position.Top}
        isConnectable={false}
        className={HANDLE}
      />
      <Handle
        id="in-bottom"
        type="target"
        position={Position.Bottom}
        isConnectable={false}
        className={HANDLE}
      />
      <Handle
        id="out-bottom"
        type="source"
        position={Position.Bottom}
        isConnectable={false}
        className={HANDLE}
      />
    </>
  );
}

const TAG =
  'inline-flex h-5 w-fit max-w-full min-w-0 items-center gap-1 rounded-[2px] border px-1.5 text-caption font-medium';

function Eyebrow({
  icon,
  left,
  right,
  accent = false,
}: {
  icon: ReactNode;
  left: string;
  right?: ReactNode;
  accent?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-2 text-micro leading-4">
      <span
        className={`flex min-w-0 items-center gap-1.5 font-semibold tracking-[0.06em] uppercase ${accent ? 'text-accent' : 'text-dim'}`}
      >
        {icon}
        <span className="truncate">{left}</span>
      </span>
      {right}
    </div>
  );
}

function RoleIcon({ node }: { node: WorkflowNode }) {
  const props = { size: 13, className: 'shrink-0' };
  switch (node.type) {
    case 'planner':
      return <ROLE_ICON.planner {...props} />;
    case 'lead':
      return <ROLE_ICON.lead {...props} />;
    case 'reviewer':
      return <ROLE_ICON.reviewer {...props} />;
    case 'tester':
      return <ROLE_ICON.tester {...props} />;
    default:
      return <ROLE_ICON.helper {...props} />;
  }
}

/** The model the block's agent gets, as far as the snapshot says. */
function modelText(node: WorkflowNode): { text: string; own: boolean } {
  if (!('model' in node)) return { text: '', own: false };
  if (node.model !== null) return { text: node.model, own: true };
  return { text: node.agent !== null ? G.fileOrProjectModel : G.projectModel, own: false };
}

/** The status dot of one agent: lime while it works, the warning tone while it waits for you. */
function agentDot(agent: AgentRunDto): string {
  if (agent.status === 'WAITING_APPROVAL' || agent.status === 'BLOCKED') return 'bg-warning';
  if (isAgentLive(agent.status)) return 'bg-accent-fill-edge';
  if (agent.status === 'FAILED') return 'bg-danger';
  return 'bg-dim/60';
}

const SHOWN_AGENTS = 2;

/** The block's agents: each shows itself in the side panel; the rest are counted. */
function Agents({ node, agents }: { node: WorkflowNode; agents: readonly AgentRunDto[] }) {
  const { selectAgent } = useContext(LiveGraphContext);
  if (agents.length === 0) return null;
  // The ones working now first, then the newest.
  const ordered = [
    ...agents.filter((a) => isAgentLive(a.status)),
    ...[...agents].reverse().filter((a) => !isAgentLive(a.status)),
  ];
  const shown = ordered.slice(0, SHOWN_AGENTS);
  const more = agents.length - shown.length;
  return (
    <ul
      className="mt-auto flex min-w-0 items-center gap-1"
      aria-label={G.agentsLabel(node.label)}
      data-testid="live-agents"
    >
      {shown.map((a) => (
        <li key={a.id} className="min-w-0">
          <button
            type="button"
            className="nodrag nopan flex h-5 max-w-full min-w-0 items-center gap-1 rounded-[2px] border border-line-strong bg-sunken px-1.5 text-caption font-medium text-ink transition-colors hover:border-dim/60 hover:bg-hover"
            aria-label={G.selectAgent(a.role)}
            title={`${a.role} · ${AGENT_STATUS_COPY[a.status].word}`}
            data-testid="live-agent"
            data-agent={a.id}
            data-status={a.status}
            onClick={(e) => {
              e.stopPropagation();
              selectAgent(a, node);
            }}
          >
            <span aria-hidden="true" className={`size-1.5 shrink-0 ${agentDot(a)}`} />
            <span className="truncate">{a.role}</span>
          </button>
        </li>
      ))}
      {more > 0 ? (
        <li className="shrink-0">
          <Tooltip content={G.agentsMoreTip(more)} focusable={false}>
            <span className="text-caption text-dim tabular-nums" data-testid="live-agents-more">
              {G.agentsMore(more)}
            </span>
          </Tooltip>
        </li>
      ) : null}
    </ul>
  );
}

/** An agent block: kind, name, model, skills and agent file, the run's mode, its agents. */
export function LiveAgentBlock({ data }: NodeProps<LiveBlock>) {
  const { node } = data;
  if (!('skills' in node)) return null;
  const edits = NODE_CAPABILITIES[node.type].edits;
  const lead = node.type === 'lead';
  const model = modelText(node);
  return (
    <StateFrame state={data.state} testId={`live-block-${node.id}`}>
      <div
        className={`relative flex h-full w-full flex-col gap-1 overflow-hidden rounded-[2px] border bg-panel px-3 py-2.5 text-left text-ink shadow-card ${
          lead ? 'border-ink/70' : 'border-line'
        }`}
        data-testid={`live-node-${node.id}`}
        data-kind={node.type}
      >
        <Handles />
        <Eyebrow
          icon={<RoleIcon node={node} />}
          left={kindWord(node)}
          right={
            <Tooltip
              content={edits ? G.ownCopy : G.readOnly}
              focusable={false}
              className="shrink-0"
            >
              <span className={`inline-flex items-center ${edits ? 'text-accent' : 'text-dim'}`}>
                {edits ? (
                  <OwnCopyIcon size={12} className="shrink-0" />
                ) : (
                  <ReadOnlyIcon size={12} className="shrink-0" />
                )}
                <span className="sr-only">{edits ? G.ownCopy : G.readOnly}</span>
              </span>
            </Tooltip>
          }
        />
        <span
          className="min-w-0 truncate font-semibold tracking-[-0.006em]"
          data-testid="live-label"
        >
          {node.label}
        </span>
        <p className="flex min-w-0 items-baseline gap-1.5 text-caption" title={model.text}>
          <span className="shrink-0 text-dim">{G.model}</span>
          <span
            className={`min-w-0 truncate ${model.own ? 'font-mono text-[0.6875rem]' : 'text-dim italic'}`}
          >
            {model.text}
          </span>
        </p>
        <div className="flex h-5 min-w-0 items-center gap-1 overflow-hidden">
          {node.agent !== null ? (
            <span className={`${TAG} border-line-strong bg-sunken text-ink`}>
              <AgentFileIcon size={12} className="shrink-0 text-accent" />
              <span className="truncate">{node.agent}</span>
            </span>
          ) : null}
          {node.skills.length === 0 && node.agent === null ? (
            <span className={`${TAG} border-dashed border-line-strong text-dim`}>{G.noSkills}</span>
          ) : null}
          {node.skills.map((s) => (
            <span key={s} className={`${TAG} border-accent/20 bg-accent-soft text-accent`}>
              <span className="truncate">✦ {s}</span>
            </span>
          ))}
        </div>
        {data.mode !== null || data.sandbox ? (
          <div className="flex min-w-0 items-center gap-1">
            {data.mode !== null ? (
              <Tooltip content={G.modeTip} focusable={false} className="min-w-0">
                <span
                  className={`${TAG} border-line-strong bg-panel text-ink`}
                  data-testid="live-mode"
                  data-mode={data.mode}
                >
                  <span className="truncate">{G.mode(MODE_WORD[data.mode])}</span>
                </span>
              </Tooltip>
            ) : null}
            {data.sandbox ? (
              <Tooltip content={G.sandboxTip} focusable={false} className="shrink-0">
                <span
                  className={`${TAG} border-line-strong bg-sunken text-dim`}
                  data-testid="live-sandbox"
                >
                  <ReadOnlyIcon size={11} className="shrink-0" />
                  {G.sandboxed}
                </span>
              </Tooltip>
            ) : null}
          </div>
        ) : null}
        {data.direct ? (
          <Tooltip content={G.directTip} focusable={false} className="min-w-0">
            <p className="truncate text-caption text-dim" data-testid="live-direct">
              {G.direct}
            </p>
          </Tooltip>
        ) : null}
        {!edits || data.agents.length > 0 ? <Agents node={node} agents={data.agents} /> : null}
      </div>
    </StateFrame>
  );
}

/** A step: Ticket and Done as pills; plan approval and your merge as "You"; checks and the branch. */
export function LiveGateBlock({ data }: NodeProps<LiveBlock>) {
  const { node, state } = data;
  if (node.type === 'ticket' || node.type === 'done') {
    const ticket = node.type === 'ticket';
    const lit = !ticket && state === 'done';
    return (
      <div
        className={`relative h-full w-full rounded-full ${lit ? DONE_RING : ''}`}
        data-testid={`live-block-${node.id}`}
        data-state={state}
      >
        <div
          className="relative flex h-full w-full items-center justify-center gap-2 rounded-full border border-line-strong bg-panel font-semibold shadow-card"
          data-testid={`live-node-${node.id}`}
          data-kind={node.type}
        >
          <Handles />
          {ticket ? (
            <TicketIcon size={15} className="text-dim" />
          ) : (
            <DoneIcon size={15} className="text-success" />
          )}
          {node.label}
        </div>
      </div>
    );
  }
  const you = node.type === 'plan-approval' || node.type === 'owner-merge';
  const icon = you ? (
    <YouIcon size={13} className="shrink-0" />
  ) : node.type === 'checks' ? (
    <CheckIcon size={13} className="shrink-0 text-success" />
  ) : (
    <MergeIcon size={13} className="shrink-0" />
  );
  // Small steps say only what needs attention; your merge turns green once it is done.
  const loud = state === 'active' || state === 'needs-you' || state === 'failed';
  const ring = node.type === 'owner-merge' && state === 'done' ? DONE_RING : STATE_RING[state];
  return (
    <StateFrame state={state} testId={`live-block-${node.id}`} word={loud} ring={ring}>
      <div
        className="relative flex h-full w-full flex-col justify-center gap-0.5 rounded-[2px] border border-line-strong bg-sunken px-3 py-2 text-ink"
        data-testid={`live-node-${node.id}`}
        data-kind={node.type}
      >
        <Handles />
        <Eyebrow icon={icon} left={kindWord(node)} accent={you} />
        <span className="truncate font-semibold tracking-[-0.006em]">
          {node.type === 'plan-approval'
            ? G.gateTitle['plan-approval']
            : node.type === 'owner-merge'
              ? G.gateTitle['owner-merge']
              : node.label}
        </span>
        {node.type === 'plan-approval' ? (
          <span className="truncate text-caption text-dim" data-testid="live-plan-auto">
            {node.auto ? G.planAuto : G.planAsks}
          </span>
        ) : null}
      </div>
    </StateFrame>
  );
}

// Module level: React Flow wants the same object on every render.
export const liveBlockTypes = { agent: LiveAgentBlock, gate: LiveGateBlock };
