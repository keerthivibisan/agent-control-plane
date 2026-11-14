import type { ApprovalMode, ManagedProviderId, WorkflowNodeV3 } from '@acp/core';
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import {
  memo,
  useContext,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from 'react';
import { AlertIcon, CheckIcon, SparkIcon, TicketIcon } from '../../../components/icons';
import { ProviderBadge } from '../../../components/ProviderBadge';
import { Tooltip } from '../../../components/Tooltip';
import {
  EFFORT_COPY,
  FINISH_COPY,
  HARNESS_BLOCKS_COPY,
  REVIEW_LOOP_COPY,
  WORKFLOW_GRAPH_COPY,
} from '../../../lib/copy';
import { checkPlaceOf, checkSelectionOf, isChecksNode, type ChecksNode } from '../check-blocks';
import {
  AgentBlockIcon,
  AgentFileIcon,
  AuthorIcon,
  DoneIcon,
  ErrorIcon,
  MergeIcon,
  OwnCopyIcon,
  ReadOnlyIcon,
  ResearcherIcon,
  ROLE_ICON,
  YouIcon,
} from '../icons';
import { EDITOR_COPY } from './copy';
import { LinkActionsContext, useLinkState } from './link-store';
import { isEditingKind, isRoleProblem, type AgentKind, type BlockKind } from './roles';
import { HANDLE_SPOTS, IN_HANDLE, OUT_HANDLE, handleId } from './routing';

const G = WORKFLOW_GRAPH_COPY;
const B = EDITOR_COPY.block;
const R = EDITOR_COPY.roles;
type WorkflowNode = WorkflowNodeV3;
const MODE_WORD = REVIEW_LOOP_COPY.modes.word;
/** At most this many problem lines in a block's marker tooltip. */
const MAX_TIP_LINES = 3;

/**
 * The editor's block views (DESIGN.md, "Agent views"; v0.3.0 D-C). Agents are square cards of one
 * size per kind: the role icon and kind, the name in bold, the model, then a skills count and the
 * agent file, and on blocks that edit files their approval mode. The lead is framed in `ink`.
 * Steps are lighter pills (Ticket shorter); the steps that are yours have the accent "you" icon.
 * A Checks block names its place over its own name. The end of the flow is one Finish block
 * (ADR-0028 §3): "Merge into <target> or open a pull request", then Done. Problems are a small icon whose tooltip says what is wrong. The accent only for the
 * selection and, while a link is being dragged, for the blocks it can end on (the others fade).
 *
 * Linking (v0.3.1 P-C): a block a link can start from has a connector on each side (a dot that
 * shows on hover, focus or selection; the right one always faintly there) and a thin strip along
 * each edge; dragging either starts a link, and a click on a connector starts a click-to-link.
 * Links end anywhere on a block (`linking.ts`), so the `in` handle on the left is never drawn.
 * Hidden handles along the top and bottom carry the links between rows and the links that go
 * back (`routing.ts`). The views are memoised and read the link being made from the link store,
 * so a drag re-renders only the blocks whose look changes.
 */

/** Where a dragged link may end (`flow.ts` `linkTargets`). */
export type LinkTarget = 'source' | 'valid' | 'invalid';

export interface BlockData {
  [key: string]: unknown;
  node: WorkflowNode;
  /** What the block is: an agent's role derived from its arrows (ADR-0037), else its type. */
  kind: BlockKind;
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
  /** The provider the block's agents run on (its own, else the project's); null: not an agent block. */
  provider: ManagedProviderId | null;
  /** The project's approval mode, for "Project default (…)". */
  projectMode: ApprovalMode | null;
  /** The project's helper limit, the pool's instances. */
  helperLimit: number;
  /** While a link is being dragged: this block is its start, a valid end or not. */
  linkTarget: LinkTarget | null;
  /** The Finish block's target branch; null: not known ("your target branch"). */
  target: string | null;
}

export type BlockNode = Node<BlockData, 'agent' | 'gate' | 'finish'>;

/** The word for a block's kind ("Change reviewer", "You"); an agent's comes from its role. */
export function kindWord(node: WorkflowNode, kind: BlockKind): string {
  if (isChecksNode(node)) return HARNESS_BLOCKS_COPY.kinds[checkPlaceOf(node)];
  if (node.type === 'agent') return R.kinds[asAgentKind(kind)];
  return G.kinds[node.type];
}

/** One sentence on what a block of this kind does. */
export function kindText(node: WorkflowNode, kind: BlockKind): string {
  if (isChecksNode(node)) return HARNESS_BLOCKS_COPY.kindText[checkPlaceOf(node)];
  if (node.type === 'agent') return R.kindText[asAgentKind(kind)];
  return G.kindText[node.type];
}

/** An agent block's `data-kind`: its role in the version 2 block words, so selectors stay stable. */
const KIND_ATTR: Readonly<Record<AgentKind, string>> = {
  researcher: 'researcher',
  planner: 'planner',
  helper: 'helper',
  'helper-pool': 'helper-pool',
  'reviewer-change': 'reviewer',
  'reviewer-final': 'reviewer',
  tester: 'tester',
  agent: 'agent',
  mixed: 'agent',
};

/** An agent block's kind (a gate's or the lead's kind never reaches an agent block). */
export function asAgentKind(kind: BlockKind): AgentKind {
  return Object.hasOwn(R.kinds, kind) ? (kind as AgentKind) : 'agent';
}

/** The role's icon, the same per role as the version 1 graph (the role's word is next to it). */
export function RoleIcon({
  node,
  kind,
  size = 14,
}: {
  node: WorkflowNode;
  kind: BlockKind;
  size?: number;
}) {
  return node.type === 'agent' ? (
    <RoleIconFor kind={asAgentKind(kind)} size={size} />
  ) : (
    <StepIcon node={node} size={size} />
  );
}

/** A step's or the lead's icon. */
function StepIcon({ node, size }: { node: WorkflowNode; size: number }) {
  const props = { size, className: 'shrink-0' };
  switch (node.type) {
    case 'agent':
      return <AgentBlockIcon {...props} />;
    case 'lead':
      return <ROLE_ICON.lead {...props} />;
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
    case 'author':
      return <AuthorIcon {...props} />;
  }
}

/**
 * The `in` handle: where stored links end on the left side. A link may be dropped anywhere on a
 * block (`linking.ts` snaps it), so it is never drawn; it stays for routing and for tests.
 */
const IN_HANDLE_CLASS =
  'size-2.5! min-w-0! min-h-0! border-0! bg-transparent! opacity-0! pointer-events-none!';
const HIDDEN_HANDLE = 'opacity-0! border-0! size-px! min-w-0! min-h-0! pointer-events-none!';

/**
 * A connector (v0.3.1 P-C): a 28px hit area centred on a side with a 14px dot (at least 24px and
 * 12px on screen at the usual fitted zoom) that shows while the block is hovered, focused or
 * selected. Drag it to another block, or click it and then click the other block. The right one is
 * always faintly there (where links have always started).
 */
const CONNECTOR =
  'group/dot size-7! min-w-0! min-h-0! rounded-full! border-0! bg-transparent! cursor-crosshair! z-10';
const DOT_BASE =
  'pointer-events-none absolute inset-0 m-auto size-3.5 rounded-full border-2 border-accent bg-panel shadow-card transition-[opacity,scale,background-color,border-radius] duration-150 group-hover/dot:scale-125! group-hover/dot:bg-accent group-focus-visible/dot:scale-125! group-focus-visible/dot:bg-accent group-focus-visible/dot:opacity-100!';
/*
 * Shown on hover or focus of the block, and on the selected block. `in-[…]` matches an ancestor:
 * React Flow's node wrapper is the focusable one and carries `selected`.
 */
const DOT_ON_HOVER =
  'opacity-0 scale-75 group-hover/block:opacity-100 group-hover/block:scale-100 in-[:focus-visible]:opacity-100 in-[:focus-visible]:scale-100 in-[.selected]:opacity-100 in-[.selected]:scale-100';
/** The right connector at rest: the small square dot links have always started from. */
const DOT_REST =
  'scale-75 rounded-[2px] border border-line-strong group-hover/block:scale-100 group-hover/block:rounded-full group-hover/block:border-2 group-hover/block:border-accent in-[.selected]:scale-100 in-[.selected]:rounded-full in-[.selected]:border-2 in-[.selected]:border-accent';
/** A thin strip along each side: dragging from a block's edge starts a link too. */
const STRIP = 'min-w-0! min-h-0! rounded-none! border-0! bg-transparent! cursor-crosshair!';
const STRIP_SIZE = {
  top: 'h-2! w-[calc(100%-28px)]!',
  bottom: 'h-2! w-[calc(100%-28px)]!',
  left: 'w-2! h-[calc(100%-20px)]!',
  right: 'w-2! h-[calc(100%-20px)]!',
} as const;

const SIDES = [
  { side: 'right', position: Position.Right, id: OUT_HANDLE },
  { side: 'left', position: Position.Left, id: 'c-left' },
  { side: 'top', position: Position.Top, id: 'c-top' },
  { side: 'bottom', position: Position.Bottom, id: 'c-bottom' },
] as const;

function BlockHandles({
  node,
  label,
  target,
  start = node.type !== 'done' && node.type !== 'author',
}: {
  node: WorkflowNode;
  /** The block's name, for the connector's spoken name. */
  label: string;
  target: LinkTarget | null;
  /**
   * Whether a link can be dragged from it: not from Done or the Author block (ADR-0038 §4: only
   * When arrows end on it). The Finish block starts only the ticket merge's When arrows.
   */
  start?: boolean;
}) {
  const actions = useContext(LinkActionsContext);
  const canEnd = node.type !== 'ticket';
  // While a link is being made, only the block it starts from keeps its connectors.
  const linking = target !== null && target !== 'source';
  return (
    <>
      {canEnd ? (
        <Handle
          type="target"
          position={Position.Left}
          id={IN_HANDLE}
          isConnectableStart={false}
          className={IN_HANDLE_CLASS}
          data-testid={`handle-in-${node.id}`}
        />
      ) : null}
      {start
        ? SIDES.map(({ side, position }) => (
            <Handle
              key={`strip-${side}`}
              type="source"
              position={position}
              id={`e-${side}`}
              isConnectableEnd={false}
              className={`${STRIP} ${STRIP_SIZE[side]} ${linking ? 'pointer-events-none!' : ''}`}
              aria-hidden="true"
              data-testid={`strip-${side}-${node.id}`}
            />
          ))
        : null}
      {start
        ? SIDES.map(({ side, position, id }) => {
            const primary = side === 'right';
            return (
              <Handle
                key={id}
                type="source"
                position={position}
                id={id}
                isConnectableEnd={false}
                className={`${CONNECTOR} ${linking ? 'invisible' : ''}`}
                data-testid={primary ? `handle-out-${node.id}` : `connector-${side}-${node.id}`}
                onClick={(e: ReactMouseEvent) => {
                  e.stopPropagation();
                  actions?.connector(node.id);
                }}
                {...(primary
                  ? {
                      role: 'button',
                      tabIndex: 0,
                      'aria-label': B.linkFrom(label),
                      onKeyDown: (e: ReactKeyboardEvent) => {
                        if (e.key !== 'Enter' && e.key !== ' ') return;
                        e.preventDefault();
                        e.stopPropagation();
                        actions?.connector(node.id);
                      },
                    }
                  : { 'aria-hidden': true })}
              >
                <span className={`${DOT_BASE} ${primary ? DOT_REST : DOT_ON_HOVER}`} />
              </Handle>
            );
          })
        : null}
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

/**
 * The block's place in the link being made: from the link store while one is (only this block's
 * entry, so the others don't re-render), else what the canvas mapped (tests draw blocks alone).
 */
function useBlockLink(
  id: string,
  mapped: LinkTarget | null,
): { target: LinkTarget | null; snapped: boolean } {
  const live = useLinkState((s) => s.targets?.get(id) ?? null);
  const snapped = useLinkState((s) => s.snap === id);
  const target = live ?? mapped;
  return { target, snapped: snapped && target === 'valid' };
}

/** The frame of a block a link may end on; brighter on the one it would end on now. */
function targetLook(snapped: boolean): string {
  return snapped
    ? 'border-accent bg-accent-soft ring-4 ring-accent/45 shadow-raised'
    : 'border-accent-fill-edge bg-accent-soft ring-4 ring-accent/20';
}

/** The block a link starts from: a dashed accent outline while the link is being made. */
const SOURCE_LOOK = 'outline-2 outline-dashed outline-offset-4 outline-accent/70';

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
function cardClass(
  selected: boolean,
  lead: boolean,
  problems: number,
  link: { target: LinkTarget | null; snapped: boolean },
) {
  const rest = lead
    ? 'border-ink/80 hover:border-ink'
    : problems > 0
      ? 'border-danger/50 hover:border-danger/80'
      : 'border-line-strong hover:border-dim';
  const state =
    link.target === 'valid'
      ? targetLook(link.snapped)
      : selected
        ? `${lead ? 'border-ink' : 'border-accent-fill-edge'} shadow-raised ring-3 ring-accent/25`
        : rest;
  return `group/block relative flex h-full w-full flex-col gap-1 rounded-[2px] border bg-panel px-3 pt-2.5 pb-2.5 [&>*]:shrink-0 text-left text-ink shadow-card transition-[border-color,box-shadow,opacity,background-color,outline-color] duration-150 ${
    lead ? 'border-[1.5px]' : ''
  } ${linkFade(link.target)} ${state}`;
}

/** An invalid end fades; the start gets its dashed outline. */
function linkFade(target: LinkTarget | null): string {
  return target === 'invalid' ? 'opacity-35' : target === 'source' ? SOURCE_LOOK : '';
}

/** A small outlined label on a card (GitHub's labels): skills, the agent file, the mode. */
const CHIP =
  'inline-flex h-5 max-w-full min-w-0 shrink-0 items-center gap-1 rounded-full border px-1.5 text-micro font-medium';
const CHIP_TONE = {
  neutral: 'border-line-strong text-dim',
  warning: 'border-warning/50 text-warning',
} as const;

function modeText(
  node: WorkflowNode,
  kind: BlockKind,
  projectMode: ApprovalMode | null,
): string | null {
  if (node.type !== 'agent' || !isEditingKind(kind)) return null;
  if (node.approvalMode === null || node.approvalMode === undefined) {
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
export const AgentBlockView = memo(function AgentBlockView({
  data,
  selected,
}: NodeProps<BlockNode>) {
  const { node, kind } = data;
  const link = useBlockLink(node.id, data.linkTarget);
  if (node.type !== 'agent' && node.type !== 'lead') return null;
  const edits = isEditingKind(kind);
  const mode = modeText(node, kind, data.projectMode);
  const lead = node.type === 'lead';
  const roleProblem = isRoleProblem(kind);
  return (
    <div
      className={cardClass(selected, lead, data.problems, link)}
      data-testid={`block-${node.id}`}
      data-kind={node.type === 'agent' ? KIND_ATTR[asAgentKind(kind)] : 'lead'}
      data-role={node.type === 'agent' ? kind : 'lead'}
      data-selected={selected ? 'true' : 'false'}
      data-link-target={link.target ?? undefined}
      data-snapped={link.snapped ? 'true' : undefined}
    >
      <BlockHandles node={node} label={node.label} target={link.target} />
      <div className="flex min-w-0 items-center justify-between gap-2 text-caption leading-4">
        {node.type === 'agent' ? (
          <RoleBadge kind={asAgentKind(kind)} problem={roleProblem} />
        ) : (
          <span className="flex min-w-0 items-center gap-1.5 text-ink">
            <RoleIcon node={node} kind={kind} />
            <span className="truncate">{kindWord(node, kind)}</span>
          </span>
        )}
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
        {data.provider !== null ? (
          <ProviderBadge provider={data.provider} testId="block-provider" className="ml-auto" />
        ) : null}
      </p>
      <div className="mt-auto flex min-w-0 items-center gap-1" data-testid="block-uses">
        <SkillsChip node={node} missing={data.missingSkills} />
        {node.effort !== undefined ? (
          <Tooltip content={EFFORT_COPY.chipTip} focusable={false} className="inline-flex shrink-0">
            <span
              className={`${CHIP} ${CHIP_TONE.neutral}`}
              data-testid="block-effort"
              data-effort={node.effort}
            >
              {EFFORT_COPY.chip(node.effort)}
            </span>
          </Tooltip>
        ) : null}
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
          {node.type === 'agent' && kind === 'helper' ? (
            <Tooltip content={G.instances(node.maxInstances ?? 1)} focusable={false}>
              <span className="text-caption text-dim tabular-nums" data-testid="block-instances">
                <span aria-hidden="true">{B.instances(node.maxInstances ?? 1)}</span>
                <span className="sr-only">{G.instances(node.maxInstances ?? 1)}</span>
              </span>
            </Tooltip>
          ) : null}
        </div>
      ) : null}
    </div>
  );
});

/**
 * An agent block's role (ADR-0037 §1), derived from its arrows, as a small badge with its icon. An
 * agent with no role or two is in its error state: the badge in the danger tone, so the problem
 * shows on the block and not only in the problems list.
 */
function RoleBadge({ kind, problem }: { kind: AgentKind; problem: boolean }) {
  const word = R.badge[kind];
  return (
    <Tooltip content={R.kindText[kind]} focusable={false} className="inline-flex min-w-0">
      <span
        className={`${CHIP} ${
          problem ? 'border-danger/50 bg-danger-soft text-danger' : 'border-line-strong text-dim'
        }`}
        data-testid="block-role"
        data-role={kind}
        data-problem={problem ? 'true' : 'false'}
      >
        {problem ? (
          <ErrorIcon size={11} className="shrink-0" />
        ) : (
          <RoleIconFor kind={kind} size={11} />
        )}
        <span className="truncate">{word}</span>
        <span className="sr-only">{`. ${R.badgeLabel(word)}`}</span>
      </span>
    </Tooltip>
  );
}

function RoleIconFor({ kind, size }: { kind: AgentKind; size: number }) {
  const props = { size, className: 'shrink-0' };
  switch (kind) {
    case 'researcher':
      return <ResearcherIcon {...props} />;
    case 'planner':
      return <ROLE_ICON.planner {...props} />;
    case 'reviewer-change':
    case 'reviewer-final':
      return <ROLE_ICON.reviewer {...props} />;
    case 'tester':
      return <ROLE_ICON.tester {...props} />;
    case 'helper':
    case 'helper-pool':
      return <ROLE_ICON.helper {...props} />;
    default:
      return <AgentBlockIcon {...props} />;
  }
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

/** The frame of a step: the accent for the selection and link targets, danger for problems. */
function stepState(
  data: BlockData,
  selected: boolean,
  link: { target: LinkTarget | null; snapped: boolean },
): string {
  const base = linkFade(link.target);
  if (link.target === 'valid') return `${base} ${targetLook(link.snapped)}`;
  if (selected) return `${base} border-accent-fill-edge ring-3 ring-accent/25`;
  return `${base} ${data.problems > 0 ? 'border-danger/50' : 'border-line-strong hover:border-dim'}`;
}

const STEP_FRAME =
  'group/block relative flex h-full w-full border bg-subtle text-ink shadow-card transition-[border-color,box-shadow,opacity,background-color,outline-color] duration-150';

/** A Checks block: where it runs over its name, and what it runs (ADR-0028: plain names). */
function ChecksBlockView({ data, selected }: { data: BlockData; selected: boolean }) {
  const node = data.node;
  const link = useBlockLink(node.id, data.linkTarget);
  if (!isChecksNode(node)) return null;
  return (
    <div
      className={`${STEP_FRAME} flex-col justify-center gap-0.5 rounded-control px-3 ${stepState(data, selected, link)}`}
      title={kindText(node, data.kind)}
      data-testid={`block-${node.id}`}
      data-kind={node.type}
      data-place={checkPlaceOf(node)}
      data-selected={selected ? 'true' : 'false'}
      data-link-target={link.target ?? undefined}
      data-snapped={link.snapped ? 'true' : undefined}
    >
      <BlockHandles node={node} label={node.label} target={link.target} />
      <span className="flex min-w-0 items-center gap-1.5 text-caption leading-4 text-dim">
        <CheckIcon size={13} className="shrink-0 text-success" />
        <span className="truncate" data-testid="checks-kind">
          {kindWord(node, data.kind)}
        </span>
        {data.problems > 0 || data.warnings > 0 ? (
          <span className="ml-auto inline-flex">
            <ProblemMarker data={data} />
          </span>
        ) : null}
      </span>
      <span className="flex min-w-0 items-center gap-2">
        <span className="min-w-0 truncate font-medium" data-testid="block-label">
          {node.label}
        </span>
        <span
          className={`${CHIP} ml-auto max-w-[45%] min-w-0 shrink-0 truncate border-line-strong text-dim`}
          data-testid="checks-select"
        >
          <span className="sr-only">{HARNESS_BLOCKS_COPY.chip.runs}</span>
          {selectionChip(node)}
        </span>
      </span>
    </div>
  );
}

/**
 * The Finish block (ADR-0028 §3): the ticket merge, your merge and Done as one fixed block. It is
 * the `owner-merge` node; links end on it, and only the ticket merge's When arrows (ADR-0038 §4,
 * merge conflicts) start from it.
 */
export const FinishBlockView = memo(function FinishBlockView({
  data,
  selected,
}: NodeProps<BlockNode>) {
  const { node } = data;
  const link = useBlockLink(node.id, data.linkTarget);
  const text = FINISH_COPY.text(data.target);
  return (
    <div
      className={`${STEP_FRAME} items-center gap-2.5 rounded-control px-3.5 ${stepState(data, selected, link)}`}
      data-testid={`block-${node.id}`}
      data-kind="finish"
      data-selected={selected ? 'true' : 'false'}
      data-link-target={link.target ?? undefined}
      data-snapped={link.snapped ? 'true' : undefined}
    >
      <BlockHandles node={node} label={FINISH_COPY.title} target={link.target} />
      <span className="inline-flex shrink-0 self-start pt-0.5 text-accent">
        <YouIcon size={15} />
      </span>
      <span className="sr-only">{`${B.you}: `}</span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex min-w-0 items-center gap-2">
          <span className="truncate font-semibold" data-testid="block-label">
            {FINISH_COPY.title}
          </span>
          {data.problems > 0 || data.warnings > 0 ? <ProblemMarker data={data} /> : null}
          <span
            className="ml-auto inline-flex shrink-0 items-center gap-1 text-caption text-dim"
            data-testid="finish-done"
            data-done="false"
          >
            <DoneIcon size={13} className="shrink-0 text-success" />
            {FINISH_COPY.thenDone}
          </span>
        </span>
        <span
          className="line-clamp-2 text-caption leading-4 text-dim"
          data-testid="finish-text"
          title={text}
        >
          {text}
        </span>
      </span>
    </div>
  );
});

/** A step: a light pill with its icon and name; your steps have the accent "you" icon. */
function StepView({ data, selected }: { data: BlockData; selected: boolean }) {
  const { node } = data;
  const link = useBlockLink(node.id, data.linkTarget);
  const you = node.type === 'plan-approval' || node.type === 'owner-merge';
  const iconTone =
    node.type === 'done'
      ? 'text-success'
      : node.type === 'author'
        ? 'text-danger'
        : you
          ? 'text-accent'
          : 'text-dim';
  return (
    <div
      className={`${STEP_FRAME} items-center gap-2 rounded-full px-3.5 ${
        node.type === 'ticket' || node.type === 'done' ? 'justify-center' : ''
      } ${stepState(data, selected, link)}`}
      data-testid={`block-${node.id}`}
      data-kind={node.type}
      data-selected={selected ? 'true' : 'false'}
      data-link-target={link.target ?? undefined}
      data-snapped={link.snapped ? 'true' : undefined}
    >
      <BlockHandles node={node} label={stepTitle(node)} target={link.target} />
      <span className={`inline-flex ${iconTone}`}>
        <RoleIcon node={node} kind={data.kind} size={15} />
      </span>
      {you ? <span className="sr-only">{`${B.you}: `}</span> : null}
      <span className="min-w-0 truncate font-medium" data-testid="block-label">
        {stepTitle(node)}
      </span>
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

/** A step or a Checks block (both are `gate` nodes on the canvas). */
export const GateBlockView = memo(function GateBlockView({ data, selected }: NodeProps<BlockNode>) {
  return isChecksNode(data.node) ? (
    <ChecksBlockView data={data} selected={selected} />
  ) : (
    <StepView data={data} selected={selected} />
  );
});

export const blockNodeTypes = {
  agent: AgentBlockView,
  gate: GateBlockView,
  finish: FinishBlockView,
};
