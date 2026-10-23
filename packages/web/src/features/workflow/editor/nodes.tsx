import { NODE_CAPABILITIES, type ApprovalMode, type WorkflowNode } from '@acp/core';
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import { AlertIcon, CheckIcon, SparkIcon, TicketIcon } from '../../../components/icons';
import { Tooltip } from '../../../components/Tooltip';
import { HARNESS_BLOCKS_COPY, REVIEW_LOOP_COPY, WORKFLOW_GRAPH_COPY } from '../../../lib/copy';
import { checkPlaceOf, checkSelectionOf, isChecksNode, type ChecksNode } from '../check-blocks';
import {
  AgentFileIcon,
  DoneIcon,
  ErrorIcon,
  MergeIcon,
  OwnCopyIcon,
  ReadOnlyIcon,
  ROLE_ICON,
  YouIcon,
} from '../icons';
import { EDITOR_COPY } from './copy';
import { HANDLE_SPOTS, IN_HANDLE, OUT_HANDLE, handleId } from './routing';

const G = WORKFLOW_GRAPH_COPY;
const B = EDITOR_COPY.block;
const MODE_WORD = REVIEW_LOOP_COPY.modes.word;
/** At most this many problem lines in a block's marker tooltip. */
const MAX_TIP_LINES = 3;

/**
 * The editor's block views (DESIGN.md, "Agent views"; v0.3.0 D-C). Agents are square cards of one
 * size per kind: the role icon and kind, the name in bold, the model, then a skills count and the
 * agent file, and on blocks that edit files their approval mode. The lead is framed in `ink`.
 * Steps are lighter pills (Ticket and Done shorter); the steps that are yours have the accent
 * "you" icon. Problems are a small icon whose tooltip says what is wrong. The accent only for the
 * selection and, while a link is being dragged, for the blocks it can end on (the others fade).
 *
 * Every block has one visible link handle on each side it can link from or to (out on the right,
 * in on the left); hidden handles along the top and bottom carry the links between rows and the
 * links that go back (`routing.ts`).
 */

/** Where a dragged link may end (`flow.ts` `linkTargets`). */
export type LinkTarget = 'source' | 'valid' | 'invalid';

export interface BlockData {
  [key: string]: unknown;
  node: WorkflowNode;
  /** Errors and warnings that name this block, and their words (errors first). */
  problems: number;
  warnings: number;
  messages: readonly string[];
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
  /** While a link is being dragged: this block is its start, a valid end or not. */
  linkTarget: LinkTarget | null;
}

export type BlockNode = Node<BlockData, 'agent' | 'gate'>;

/** The word for a block's kind ("Change reviewer", "You"). */
export function kindWord(node: WorkflowNode): string {
  if (isChecksNode(node)) return HARNESS_BLOCKS_COPY.kinds[checkPlaceOf(node)];
  if (node.type === 'reviewer') {
    return node.scope === 'change' ? G.kinds['reviewer-change'] : G.kinds['reviewer-final'];
  }
  return G.kinds[node.type];
}

/** One sentence on what a block of this kind does. */
export function kindText(node: WorkflowNode): string {
  // The merge block keeps its words until it is configured (a block from before ADR-0027).
  if (isChecksNode(node) && (node.place !== undefined || node.select !== undefined)) {
    return HARNESS_BLOCKS_COPY.kindText[checkPlaceOf(node)];
  }
  if (node.type === 'reviewer') {
    return node.scope === 'change' ? G.kindText['reviewer-change'] : G.kindText['reviewer-final'];
  }
  return G.kindText[node.type];
}

/** The role's icon, the same per kind as the version 1 graph (the kind's word is next to it). */
export function RoleIcon({ node, size = 14 }: { node: WorkflowNode; size?: number }) {
  const props = { size, className: 'shrink-0' };
  switch (node.type) {
    case 'planner':
      return <ROLE_ICON.planner {...props} />;
    case 'lead':
      return <ROLE_ICON.lead {...props} />;
    case 'reviewer':
      return <ROLE_ICON.reviewer {...props} />;
    case 'tester':
      return <ROLE_ICON.tester {...props} />;
    case 'helper':
    case 'helper-pool':
      return <ROLE_ICON.helper {...props} />;
    case 'ticket':
      return <TicketIcon {...props} />;
    case 'done':
      return <DoneIcon {...props} />;
    case 'checks':
      return <CheckIcon {...props} />;
    case 'ticket-merge':
      return <MergeIcon {...props} />;
    case 'plan-approval':
    case 'owner-merge':
      return <YouIcon {...props} />;
  }
}

const VISIBLE_HANDLE =
  'size-2.5! min-w-0! min-h-0! rounded-[2px]! border! border-line-strong! bg-panel! transition-[background-color,border-color,width,height] hover:bg-accent-fill! hover:border-accent-fill-edge!';
/** The `in` handle of a block a dragged link can end on: larger and in the accent. */
const TARGET_HANDLE = 'size-3.5! bg-accent-fill! border-accent-fill-edge!';
const HIDDEN_HANDLE = 'opacity-0! border-0! size-px! min-w-0! min-h-0! pointer-events-none!';

function BlockHandles({ node, target }: { node: WorkflowNode; target: LinkTarget | null }) {
  const canEnd = node.type !== 'ticket';
  const canStart = node.type !== 'done';
  return (
    <>
      {canEnd ? (
        <Handle
          type="target"
          position={Position.Left}
          id={IN_HANDLE}
          isConnectableStart={false}
          className={`${VISIBLE_HANDLE} ${target === 'valid' ? TARGET_HANDLE : ''}`}
          data-testid={`handle-in-${node.id}`}
        />
      ) : null}
      {canStart ? (
        <Handle
          type="source"
          position={Position.Right}
          id={OUT_HANDLE}
          isConnectableEnd={false}
          className={VISIBLE_HANDLE}
          data-testid={`handle-out-${node.id}`}
        />
      ) : null}
      {(['top', 'bottom'] as const).map((side) =>
        HANDLE_SPOTS.map((at) =>
          (['source', 'target'] as const).map((kind) => (
            <Handle
              key={`${side}-${at}-${kind}`}
              type={kind}
              position={side === 'top' ? Position.Top : Position.Bottom}
              id={handleId(kind, side, at)}
              isConnectable={false}
              className={HIDDEN_HANDLE}
              style={{ left: `${at}%` }}
            />
          )),
        ),
      )}
    </>
  );
}

/** A small problem or warning icon; its tooltip says what is wrong (the problems list has all). */
function ProblemMarker({ data }: { data: BlockData }) {
  if (data.problems === 0 && data.warnings === 0) return null;
  const error = data.problems > 0;
  const lines = data.messages.slice(0, MAX_TIP_LINES);
  const rest = data.messages.length - lines.length;
  const summary = B.problems(data.problems, data.warnings);
  return (
    <Tooltip
      focusable={false}
      className="inline-flex shrink-0"
      content={
        <span className="flex flex-col gap-1">
          <span className="font-semibold">{summary}</span>
          {lines.map((m, i) => (
            <span key={i}>{m}</span>
          ))}
          {rest > 0 ? <span>{B.more(rest)}</span> : null}
        </span>
      }
    >
      <span
        className={`inline-flex items-center ${error ? 'text-danger' : 'text-warning'}`}
        data-testid="block-problems"
        data-severity={error ? 'error' : 'warning'}
      >
        {error ? (
          <ErrorIcon size={15} className="shrink-0" />
        ) : (
          <AlertIcon size={15} className="shrink-0" />
        )}
        <span className="sr-only">{summary}</span>
      </span>
    </Tooltip>
  );
}

/** The frame of an agent card: the lead in `ink`; the accent for the selection and link targets. */
function cardClass(selected: boolean, lead: boolean, problems: number, target: LinkTarget | null) {
  const rest = lead
    ? 'border-ink/80 hover:border-ink'
    : problems > 0
      ? 'border-danger/50 hover:border-danger/80'
      : 'border-line-strong hover:border-dim';
  const state =
    target === 'valid'
      ? 'border-accent-fill-edge bg-accent-soft ring-4 ring-accent/20'
      : selected
        ? `${lead ? 'border-ink' : 'border-accent-fill-edge'} shadow-raised ring-3 ring-accent/25`
        : rest;
  return `relative flex h-full w-full flex-col gap-1 rounded-[2px] border bg-panel px-3 pt-2.5 pb-2.5 [&>*]:shrink-0 text-left text-ink shadow-card transition-[border-color,box-shadow,opacity,background-color] duration-150 ${
    lead ? 'border-[1.5px]' : ''
  } ${target === 'invalid' ? 'opacity-35' : ''} ${state}`;
}

/** A small outlined label on a card (GitHub's labels): skills, the agent file, the mode. */
const CHIP =
  'inline-flex h-5 max-w-full min-w-0 shrink-0 items-center gap-1 rounded-full border px-1.5 text-micro font-medium';
const CHIP_TONE = {
  neutral: 'border-line-strong text-dim',
  warning: 'border-warning/50 text-warning',
} as const;

function modeText(node: WorkflowNode, projectMode: ApprovalMode | null): string | null {
  if (node.type !== 'helper' && node.type !== 'helper-pool' && node.type !== 'tester') return null;
  if (node.approvalMode === null) {
    return G.modeDefaultBadge(projectMode === null ? null : MODE_WORD[projectMode]);
  }
  return G.modeBadge(MODE_WORD[node.approvalMode]);
}

function SkillsChip({ node, missing }: { node: WorkflowNode; missing: readonly string[] }) {
  if (!('skills' in node)) return null;
  const n = node.skills.length;
  const warn = missing.length > 0;
  const chip = (
    <span
      className={`${CHIP} ${CHIP_TONE[warn ? 'warning' : 'neutral']}`}
      data-testid="block-skills"
      data-count={n}
      data-missing={missing.length}
    >
      {warn ? (
        <AlertIcon size={11} className="shrink-0" />
      ) : (
        <SparkIcon size={11} className="shrink-0" />
      )}
      {B.skills(n)}
    </span>
  );
  if (n === 0) return chip;
  return (
    <Tooltip
      focusable={false}
      className="inline-flex min-w-0 shrink-0"
      content={
        <span className="flex flex-col gap-1">
          <span>{B.skillsList(node.skills)}</span>
          {warn ? <span>{B.skillsMissing(missing)}</span> : null}
        </span>
      }
    >
      {chip}
    </Tooltip>
  );
}

function AgentFileChip({ name, missing }: { name: string; missing: boolean }) {
  return (
    <Tooltip
      focusable={false}
      className="inline-flex min-w-0"
      content={missing ? B.agentFileMissing(name) : B.agentFile(name)}
    >
      <span
        className={`${CHIP} shrink ${CHIP_TONE[missing ? 'warning' : 'neutral']}`}
        data-testid="block-agent-chip"
        data-agent={missing ? 'missing' : 'set'}
      >
        {missing ? (
          <AlertIcon size={11} className="shrink-0" />
        ) : (
          <AgentFileIcon size={11} className="shrink-0" />
        )}
        <span className="min-w-0 truncate font-mono" data-testid="block-agent">
          {name}
        </span>
      </span>
    </Tooltip>
  );
}

/** An agent card: kind, name, model, skills count and agent file, the mode on editing blocks. */
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
  const lead = node.type === 'lead';
  return (
    <div
      className={cardClass(selected, lead, data.problems, data.linkTarget)}
      data-testid={`block-${node.id}`}
      data-kind={node.type}
      data-selected={selected ? 'true' : 'false'}
      data-link-target={data.linkTarget ?? undefined}
    >
      <BlockHandles node={node} target={data.linkTarget} />
      <div className="flex min-w-0 items-center justify-between gap-2 text-caption leading-4">
        <span className={`flex min-w-0 items-center gap-1.5 ${lead ? 'text-ink' : 'text-dim'}`}>
          <RoleIcon node={node} />
          <span className="truncate">{kindWord(node)}</span>
        </span>
        <span className="flex shrink-0 items-center gap-1.5">
          <ProblemMarker data={data} />
          {/* The icon only; its word is the tooltip and its spoken name (the shapes differ, so
              colour is not the only signal). */}
          <Tooltip
            content={edits ? G.ownCopy : G.readOnly}
            focusable={false}
            className="inline-flex"
          >
            <span
              className="inline-flex items-center text-dim"
              data-testid="block-workspace"
              data-workspace={edits ? 'own-copy' : 'read-only'}
            >
              {edits ? (
                <OwnCopyIcon size={13} className="shrink-0" />
              ) : (
                <ReadOnlyIcon size={13} className="shrink-0" />
              )}
              <span className="sr-only">{edits ? G.ownCopy : G.readOnly}</span>
            </span>
          </Tooltip>
        </span>
      </div>
      <span className="truncate leading-5 font-semibold" data-testid="block-label">
        {node.label}
      </span>
      <p
        className="flex min-w-0 items-baseline gap-1.5 text-caption leading-4"
        data-testid="block-model"
        title={data.model.text}
      >
        <span className="shrink-0 text-dim">{G.model}</span>
        <span
          className={`min-w-0 truncate ${data.model.own ? 'font-mono text-micro' : 'text-dim'}`}
        >
          {data.model.text}
        </span>
      </p>
      <div className="mt-auto flex min-w-0 items-center gap-1" data-testid="block-uses">
        <SkillsChip node={node} missing={data.missingSkills} />
        {node.agent !== null ? (
          <AgentFileChip name={node.agent} missing={data.agentMissing} />
        ) : null}
      </div>
      {mode !== null ? (
        <div className="flex min-w-0 items-center justify-between gap-2">
          <span
            className={`${CHIP} shrink truncate border-line-strong text-ink`}
            data-testid="block-mode"
          >
            <span className="truncate">{mode}</span>
          </span>
          {node.type === 'helper' ? (
            <Tooltip content={G.instances(node.maxInstances)} focusable={false}>
              <span className="text-caption text-dim tabular-nums" data-testid="block-instances">
                <span aria-hidden="true">{B.instances(node.maxInstances)}</span>
                <span className="sr-only">{G.instances(node.maxInstances)}</span>
              </span>
            </Tooltip>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/** What a Checks block runs, in a few words: "Required", "2 checks", "fast · full". */
export function selectionChip(node: ChecksNode): string {
  const C = HARNESS_BLOCKS_COPY.chip;
  const s = checkSelectionOf(node);
  if (s.kind === 'ids') return C.ids(s.ids.length);
  if (s.kind === 'labels') return C.labels(s.labels);
  return C.required;
}

function stepTitle(node: WorkflowNode): string {
  if (node.type === 'plan-approval') return G.gateTitle['plan-approval'];
  if (node.type === 'owner-merge') return G.gateTitle['owner-merge'];
  return node.label;
}

/** A step: a light pill with its icon and name; your steps have the accent "you" icon. */
export function GateBlockView({ data, selected }: NodeProps<BlockNode>) {
  const { node } = data;
  const you = node.type === 'plan-approval' || node.type === 'owner-merge';
  const target = data.linkTarget;
  const state =
    target === 'valid'
      ? 'border-accent-fill-edge bg-accent-soft ring-4 ring-accent/20'
      : selected
        ? 'border-accent-fill-edge ring-3 ring-accent/25'
        : data.problems > 0
          ? 'border-danger/50'
          : 'border-line-strong hover:border-dim';
  const iconTone =
    node.type === 'done' || node.type === 'checks'
      ? 'text-success'
      : you
        ? 'text-accent'
        : 'text-dim';
  return (
    <div
      className={`relative flex h-full w-full items-center gap-2 rounded-full border bg-subtle px-3.5 text-ink shadow-card transition-[border-color,box-shadow,opacity,background-color] duration-150 ${
        node.type === 'ticket' || node.type === 'done' ? 'justify-center' : ''
      } ${target === 'invalid' ? 'opacity-35' : ''} ${state}`}
      data-testid={`block-${node.id}`}
      data-kind={node.type}
      data-selected={selected ? 'true' : 'false'}
      data-link-target={target ?? undefined}
    >
      <BlockHandles node={node} target={target} />
      <span className={`inline-flex ${iconTone}`}>
        <RoleIcon node={node} size={15} />
      </span>
      {you ? <span className="sr-only">{`${B.you}: `}</span> : null}
      <span className="min-w-0 truncate font-medium" data-testid="block-label">
        {stepTitle(node)}
      </span>
      {isChecksNode(node) ? (
        <span
          className={`${CHIP} ml-auto max-w-[45%] min-w-0 shrink-0 truncate border-line-strong text-dim`}
          data-testid="checks-select"
        >
          <span className="sr-only">{HARNESS_BLOCKS_COPY.chip.runs}</span>
          {selectionChip(node)}
        </span>
      ) : null}
      {node.type === 'plan-approval' ? (
        <span
          className={node.auto ? `${CHIP} border-line-strong text-dim` : 'sr-only'}
          data-testid="plan-auto"
          data-auto={node.auto ? 'true' : 'false'}
        >
          {node.auto ? B.auto : G.planAsks}
        </span>
      ) : null}
      {data.problems > 0 || data.warnings > 0 ? (
        <span className="ml-auto inline-flex">
          <ProblemMarker data={data} />
        </span>
      ) : null}
    </div>
  );
}

export const blockNodeTypes = { agent: AgentBlockView, gate: GateBlockView };
