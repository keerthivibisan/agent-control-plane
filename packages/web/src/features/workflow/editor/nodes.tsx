import { NODE_CAPABILITIES, type ApprovalMode, type WorkflowNode } from '@acp/core';
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import type { ReactNode } from 'react';
import { AlertIcon, CheckIcon, TicketIcon } from '../../../components/icons';
import { REVIEW_LOOP_COPY, WORKFLOW_GRAPH_COPY } from '../../../lib/copy';
import {
  AgentFileIcon,
  DoneIcon,
  MergeIcon,
  OwnCopyIcon,
  ReadOnlyIcon,
  ROLE_ICON,
  YouIcon,
} from '../icons';

const G = WORKFLOW_GRAPH_COPY;
const MODE_WORD = REVIEW_LOOP_COPY.modes.word;

/**
 * The editor's block views (DESIGN.md, "Agent views"): square agent blocks framed in `line`, the
 * lead framed in `ink`, smaller steps on the `sunken` well, Ticket and Done as pills. Lime only
 * for the selection. Every block has one visible link handle on each side it can link from or
 * to (out on the right, in on the left); the hidden top and bottom handles carry the links that go
 * back (findings over the top, rework underneath) so they don't sit on the forward links.
 */

export interface BlockData {
  [key: string]: unknown;
  node: WorkflowNode;
  /** Errors and warnings that name this block. */
  problems: number;
  warnings: number;
  /** Skills the block names that the project doesn't have. */
  missingSkills: readonly string[];
  /** The block's agent file isn't among the project's agent files. */
  agentMissing: boolean;
  /** What the model line says, and whether it is the block's own choice. */
  model: { text: string; own: boolean };
  /** The project's approval mode, for "Project default (…)". */
  projectMode: ApprovalMode | null;
  /** The project's helper limit, the pool's instances. */
  helperLimit: number;
}

export type BlockNode = Node<BlockData, 'agent' | 'gate'>;

/** The word for a block's kind ("Change reviewer", "You"). */
export function kindWord(node: WorkflowNode): string {
  if (node.type === 'reviewer') {
    return node.scope === 'change' ? G.kinds['reviewer-change'] : G.kinds['reviewer-final'];
  }
  return G.kinds[node.type];
}

/** One sentence on what a block of this kind does. */
export function kindText(node: WorkflowNode): string {
  if (node.type === 'reviewer') {
    return node.scope === 'change' ? G.kindText['reviewer-change'] : G.kindText['reviewer-final'];
  }
  return G.kindText[node.type];
}

/** The role's icon, the same per kind as the version 1 graph (the kind's word is next to it). */
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

const VISIBLE_HANDLE =
  'size-2.5! min-w-0! min-h-0! rounded-[2px]! border! border-line-strong! bg-panel! transition-colors hover:bg-accent-fill! hover:border-accent-fill-edge!';
const HIDDEN_HANDLE = 'opacity-0! border-0! size-1.5! min-w-0! min-h-0! pointer-events-none!';

function BlockHandles({ node }: { node: WorkflowNode }) {
  const canEnd = node.type !== 'ticket';
  const canStart = node.type !== 'done';
  return (
    <>
      {canEnd ? (
        <Handle
          type="target"
          position={Position.Left}
          id="in"
          isConnectableStart={false}
          className={VISIBLE_HANDLE}
          data-testid={`handle-in-${node.id}`}
        />
      ) : null}
      {canStart ? (
        <Handle
          type="source"
          position={Position.Right}
          id="out"
          isConnectableEnd={false}
          className={VISIBLE_HANDLE}
          data-testid={`handle-out-${node.id}`}
        />
      ) : null}
      <Handle
        type="target"
        position={Position.Top}
        id="in-top"
        isConnectable={false}
        className={HIDDEN_HANDLE}
      />
      <Handle
        type="source"
        position={Position.Top}
        id="out-top"
        isConnectable={false}
        className={HIDDEN_HANDLE}
      />
      <Handle
        type="target"
        position={Position.Bottom}
        id="in-bottom"
        isConnectable={false}
        className={HIDDEN_HANDLE}
      />
      <Handle
        type="source"
        position={Position.Bottom}
        id="out-bottom"
        isConnectable={false}
        className={HIDDEN_HANDLE}
      />
    </>
  );
}

const TAG =
  'inline-flex h-5 w-fit max-w-full min-w-0 items-center gap-1 rounded-[2px] border px-1.5 text-caption font-medium';

function ProblemsTag({ problems, warnings }: { problems: number; warnings: number }) {
  if (problems === 0 && warnings === 0) return null;
  const error = problems > 0;
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1 text-micro font-semibold ${error ? 'text-danger' : 'text-warning'}`}
      data-testid="block-problems"
      data-severity={error ? 'error' : 'warning'}
    >
      <AlertIcon size={12} className="shrink-0" />
      {G.blockProblems(error ? problems : warnings)}
    </span>
  );
}

function frameClass(selected: boolean, lead: boolean, problems: number): string {
  const rest = lead
    ? 'border-ink/70 hover:border-ink'
    : problems > 0
      ? 'border-danger/45 hover:border-danger/70'
      : 'border-line hover:border-line-strong';
  const chosen = lead ? 'border-ink' : 'border-accent-fill-edge';
  return `relative flex h-full w-full flex-col gap-1 overflow-hidden rounded-[2px] border bg-panel px-3 py-2.5 text-left text-ink shadow-card transition-[border-color,box-shadow] duration-150 ${
    selected ? `${chosen} shadow-raised ring-3 ring-accent-fill/55 dark:ring-accent-fill/25` : rest
  }`;
}

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

function modeText(node: WorkflowNode, projectMode: ApprovalMode | null): string | null {
  if (node.type !== 'helper' && node.type !== 'helper-pool' && node.type !== 'tester') return null;
  if (node.approvalMode === null) {
    return G.modeDefaultBadge(projectMode === null ? null : MODE_WORD[projectMode]);
  }
  return G.modeBadge(MODE_WORD[node.approvalMode]);
}

/** An agent block: kind, name, model, skills and agent file, the mode on editing blocks. */
export function AgentBlockView({ data, selected }: NodeProps<BlockNode>) {
  const { node } = data;
  if (
    node.type !== 'planner' &&
    node.type !== 'lead' &&
    node.type !== 'helper' &&
    node.type !== 'helper-pool' &&
    node.type !== 'reviewer' &&
    node.type !== 'tester'
  ) {
    return null;
  }
  const edits = NODE_CAPABILITIES[node.type].edits;
  const mode = modeText(node, data.projectMode);
  return (
    <div
      className={frameClass(selected, node.type === 'lead', data.problems)}
      data-testid={`block-${node.id}`}
      data-kind={node.type}
      data-selected={selected ? 'true' : 'false'}
    >
      <BlockHandles node={node} />
      <Eyebrow
        icon={<RoleIcon node={node} />}
        left={kindWord(node)}
        right={
          <span
            className={`inline-flex shrink-0 items-center gap-1 text-caption whitespace-nowrap normal-case tracking-normal ${edits ? 'text-accent' : 'text-dim'}`}
          >
            {edits ? (
              <OwnCopyIcon size={12} className="shrink-0" />
            ) : (
              <ReadOnlyIcon size={12} className="shrink-0" />
            )}
            {edits ? G.ownCopy : G.readOnly}
          </span>
        }
      />
      <div className="flex min-w-0 items-center gap-1.5">
        <span
          className="min-w-0 truncate font-semibold tracking-[-0.006em]"
          data-testid="block-label"
        >
          {node.label}
        </span>
        <ProblemsTag problems={data.problems} warnings={data.warnings} />
      </div>
      <p
        className="flex min-w-0 items-baseline gap-1.5 text-caption"
        data-testid="block-model"
        title={data.model.text}
      >
        <span className="shrink-0 text-dim">{G.model}</span>
        <span
          className={`min-w-0 truncate ${data.model.own ? 'font-mono text-[0.6875rem]' : 'text-dim italic'}`}
        >
          {data.model.text}
        </span>
      </p>
      <div className="flex min-w-0 flex-wrap items-center gap-1" data-testid="block-uses">
        {node.agent !== null ? (
          <span
            className={`${TAG} ${data.agentMissing ? 'border-warning/35 bg-warning-soft text-warning' : 'border-line-strong bg-sunken text-ink'}`}
            data-testid="block-agent"
            data-agent={data.agentMissing ? 'missing' : 'set'}
          >
            {data.agentMissing ? (
              <AlertIcon size={12} className="shrink-0" />
            ) : (
              <AgentFileIcon size={12} className="shrink-0 text-accent" />
            )}
            <span className="truncate">{node.agent}</span>
          </span>
        ) : null}
        {node.skills.length === 0 && node.agent === null ? (
          <span className={`${TAG} border-dashed border-line-strong text-dim`}>{G.noSkills}</span>
        ) : null}
        {node.skills.map((s) => {
          const missing = data.missingSkills.includes(s);
          return (
            <span
              key={s}
              className={`${TAG} ${missing ? 'border-warning/35 bg-warning-soft text-warning' : 'border-accent/20 bg-accent-soft text-accent'}`}
              data-testid="block-skill"
              data-skill={missing ? 'missing' : 'set'}
            >
              {missing ? <AlertIcon size={12} className="shrink-0" /> : null}
              <span className="truncate">✦ {s}</span>
            </span>
          );
        })}
      </div>
      {mode !== null || node.type === 'helper' || node.type === 'helper-pool' ? (
        <div className="mt-auto flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-caption text-dim">
          {mode !== null ? (
            <span
              className={`${TAG} border-line-strong bg-panel text-ink`}
              data-testid="block-mode"
            >
              {mode}
            </span>
          ) : null}
          {node.type === 'helper' ? (
            <span className="tabular-nums">{G.instances(node.maxInstances)}</span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/** A step: Ticket and Done as pills; plan approval and your merge as "You" cards; the rest small. */
export function GateBlockView({ data, selected }: NodeProps<BlockNode>) {
  const { node } = data;
  const ring = selected
    ? 'border-accent-fill-edge ring-3 ring-accent-fill/55 dark:ring-accent-fill/25'
    : '';
  if (node.type === 'ticket' || node.type === 'done') {
    const ticket = node.type === 'ticket';
    return (
      <div
        className={`relative flex h-full w-full items-center justify-center gap-2 rounded-full border border-line-strong bg-panel font-semibold shadow-card ${ring}`}
        data-testid={`block-${node.id}`}
        data-kind={node.type}
      >
        <BlockHandles node={node} />
        {ticket ? (
          <TicketIcon size={15} className="text-dim" />
        ) : (
          <DoneIcon size={15} className="text-success" />
        )}
        {node.label}
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
  return (
    <div
      className={`relative flex h-full w-full flex-col justify-center gap-0.5 rounded-[2px] border border-line-strong bg-sunken px-3 py-2 text-ink ${ring}`}
      data-testid={`block-${node.id}`}
      data-kind={node.type}
    >
      <BlockHandles node={node} />
      <Eyebrow
        icon={icon}
        left={kindWord(node)}
        accent={you}
        right={<ProblemsTag problems={data.problems} warnings={data.warnings} />}
      />
      <span className="truncate font-semibold tracking-[-0.006em]">
        {node.type === 'plan-approval'
          ? G.gateTitle['plan-approval']
          : node.type === 'owner-merge'
            ? G.gateTitle['owner-merge']
            : node.label}
      </span>
      {node.type === 'plan-approval' ? (
        <span
          className="text-caption text-dim"
          data-testid="plan-auto"
          data-auto={node.auto ? 'true' : 'false'}
        >
          {node.auto ? G.planAuto : G.planAsks}
        </span>
      ) : null}
    </div>
  );
}

export const blockNodeTypes = { agent: AgentBlockView, gate: GateBlockView };
