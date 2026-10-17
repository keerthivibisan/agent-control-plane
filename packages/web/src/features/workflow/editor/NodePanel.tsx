import {
  APPROVAL_MODES,
  HARD_MAX_HELPERS,
  MAX_NODE_DESCRIPTION,
  MAX_NODE_LABEL,
  MAX_NODE_SKILLS,
  isEditorNode,
  type ApprovalMode,
  type WorkflowEdgeType,
  type WorkflowGraph,
  type WorkflowNode,
  type WorkflowNodeId,
} from '@acp/core';
import { useId, useState, type Dispatch, type ReactNode } from 'react';
import { Button } from '../../../components/Button';
import { AlertIcon } from '../../../components/icons';
import { Select, hintClass, labelClass } from '../../../components/Input';
import { REVIEW_LOOP_COPY, WORKFLOW_GRAPH_COPY } from '../../../lib/copy';
import { href } from '../../../lib/router';
import {
  CheckboxField,
  ChoiceCards,
  NumberChoice,
  TextAreaField,
  TextField,
} from '../../project-setup/fields';
import { FullAutoWarning } from '../../review-loop/ApprovalsEditor';
import { RemoveIcon } from '../icons';
import { LinkSample } from './GraphEditor';
import { kindText, kindWord } from './nodes';
import { allowedEdgeTypes, isRemovable, type EditorAction, type NodePatch } from './state';

const G = WORKFLOW_GRAPH_COPY;
const P = WORKFLOW_GRAPH_COPY.panel;
const M = REVIEW_LOOP_COPY.modes;
const MAX_MODEL = 100;
const INSTANCE_CHOICES: readonly number[] = Array.from(
  { length: HARD_MAX_HELPERS },
  (_, i) => i + 1,
);
/** "Project default" in the mode choice; the graph stores it as null. */
const PROJECT_DEFAULT = 'project-default';
type ModeChoice = ApprovalMode | typeof PROJECT_DEFAULT;

export interface NodePanelContext {
  projectId: string;
  /** The project's skills and agent files; undefined: unknown, so nothing is flagged. */
  skills: readonly string[] | undefined;
  agents: readonly string[] | undefined;
  agentModels: ReadonlyMap<string, string | null> | undefined;
  projectModel: string | null;
  projectMode: ApprovalMode | null;
  helperLimit: number;
}

/** A warning under a field: what is wrong and what happens because of it. */
function Callout({ testId, children }: { testId: string; children: ReactNode }) {
  return (
    <div
      role="status"
      className="mt-1 flex items-start gap-2 rounded-control border border-warning/25 bg-warning-soft px-3 py-2 text-caption text-warning"
      data-testid={testId}
    >
      <AlertIcon size={14} className="mt-px shrink-0" />
      <div className="min-w-0">{children}</div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="-mx-5 flex flex-col gap-4 border-t border-line px-5 pt-5">
      <h4 className="text-title font-semibold">{title}</h4>
      {children}
    </section>
  );
}

/**
 * Up to three of the project's skills as checkboxes. A chosen skill the project no longer has is
 * listed first, flagged, with a button to drop it.
 */
function SkillsField({
  value,
  skills,
  onChange,
}: {
  value: readonly string[];
  skills: readonly string[] | undefined;
  onChange: (next: string[]) => void;
}) {
  const id = useId();
  const known = skills ?? [];
  const missing = skills === undefined ? [] : value.filter((s) => !known.includes(s));
  const full = value.length >= MAX_NODE_SKILLS;
  return (
    <fieldset
      className="flex min-w-0 flex-col gap-1.5"
      aria-describedby={`${id}-hint`}
      data-testid="skills-field"
    >
      <legend className={`mb-1 ${labelClass}`}>{P.skills}</legend>
      {missing.map((s) => (
        <div
          key={s}
          className="flex items-center gap-2 rounded-control border border-warning/35 bg-warning-soft px-2.5 py-1.5 text-caption text-warning"
          data-testid="skill-missing"
        >
          <AlertIcon size={13} className="shrink-0" />
          <span className="min-w-0 flex-1">{P.skillMissingTip(s)}</span>
          <button
            type="button"
            onClick={() => onChange(value.filter((v) => v !== s))}
            aria-label={P.removeSkill(s)}
            className="inline-flex size-6 shrink-0 items-center justify-center rounded-control text-warning hover:bg-hover"
          >
            <RemoveIcon size={13} />
          </button>
        </div>
      ))}
      {known.length === 0 ? (
        <p className="text-caption text-dim">{P.skillsNone}</p>
      ) : (
        <div className="flex flex-col gap-1">
          {known.map((s) => {
            const checked = value.includes(s);
            return (
              <label key={s} className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={checked}
                  disabled={!checked && full}
                  onChange={(e) =>
                    onChange(e.target.checked ? [...value, s] : value.filter((v) => v !== s))
                  }
                  className="size-4 shrink-0 accent-accent"
                />
                <span className="font-mono text-[0.8125rem]">{s}</span>
              </label>
            );
          })}
        </div>
      )}
      <span id={`${id}-hint`} className={hintClass}>
        {full ? P.skillsFull(MAX_NODE_SKILLS) : P.skillsHint(MAX_NODE_SKILLS)}
      </span>
    </fieldset>
  );
}

function AgentFileField({
  projectId,
  value,
  agents,
  onChange,
}: {
  projectId: string;
  value: string | null;
  agents: readonly string[] | undefined;
  onChange: (next: string | null) => void;
}) {
  const id = useId();
  const names = agents ?? [];
  const missing = value !== null && agents !== undefined && !names.includes(value);
  const unknown = value !== null && agents === undefined;
  return (
    <div className="flex min-w-0 flex-col gap-1.5" data-testid="agent-file-field">
      <label htmlFor={id} className={labelClass}>
        {P.agentFile}
      </label>
      <Select
        id={id}
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value === '' ? null : e.target.value)}
        aria-describedby={`${id}-hint`}
        aria-invalid={missing ? true : undefined}
        className={missing ? 'aria-invalid:border-warning!' : ''}
      >
        <option value="">{P.agentFileNone}</option>
        {missing || unknown ? (
          <option value={value}>{missing ? G.agentMissing(value) : value}</option>
        ) : null}
        {names.map((n) => (
          <option key={n} value={n}>
            {n}
          </option>
        ))}
      </Select>
      <span id={`${id}-hint`} className={hintClass}>
        {P.agentFileHint}{' '}
        <a
          href={href.projectPage(projectId, 'skills', { tab: 'agents' })}
          className="text-accent hover:underline"
        >
          {P.manage}
        </a>
      </span>
      {missing ? <Callout testId="agent-missing">{P.agentFileMissing}</Callout> : null}
    </div>
  );
}

/** The approval mode of a block that edits: the project's, or one of the four modes. */
function ModeField({
  value,
  projectMode,
  onChange,
}: {
  value: ApprovalMode | null;
  projectMode: ApprovalMode | null;
  onChange: (next: ApprovalMode | null) => void;
}) {
  const name = useId();
  const options: { value: ModeChoice; label: string; hint: string }[] = [
    {
      value: PROJECT_DEFAULT,
      label: P.modeProjectDefault(projectMode === null ? null : M.word[projectMode]),
      hint: P.modeProjectDefaultHint,
    },
    ...APPROVAL_MODES.map((m) => ({ value: m, label: M.word[m], hint: M.hint[m] })),
  ];
  return (
    <div className="flex flex-col gap-3" data-testid="mode-field">
      <ChoiceCards<ModeChoice>
        legend={P.mode}
        name={`${name}-mode`}
        value={value ?? PROJECT_DEFAULT}
        columns={1}
        options={options}
        onChange={(v) => onChange(v === PROJECT_DEFAULT ? null : v)}
      />
      {value === 'full-auto' ? <FullAutoWarning /> : null}
      <p className="text-caption text-dim" data-testid="mode-careful">
        {P.modeCareful}
      </p>
    </div>
  );
}

/** The links that leave this block, and a keyboard way to add one (the canvas's drag, in a form). */
function LinksSection({
  node,
  graph,
  dispatch,
}: {
  node: WorkflowNode;
  graph: WorkflowGraph;
  dispatch: Dispatch<EditorAction>;
}) {
  const id = useId();
  const label = (nid: string) => graph.nodes.find((n) => n.id === nid)?.label ?? nid;
  const outgoing = graph.edges.filter((e) => e.from === node.id);
  const targets = graph.nodes.filter(
    (n) => n.id !== node.id && allowedEdgeTypes(graph, node.id, n.id).length > 0,
  );
  const [to, setTo] = useState<WorkflowNodeId>('');
  const target = targets.some((t) => t.id === to) ? to : (targets[0]?.id ?? '');
  const types = target === '' ? [] : allowedEdgeTypes(graph, node.id, target);
  const [type, setType] = useState<WorkflowEdgeType | ''>('');
  const kind = types.includes(type as WorkflowEdgeType) ? (type as WorkflowEdgeType) : types[0];
  return (
    <Section title={P.links}>
      {outgoing.length === 0 ? (
        <p className="text-caption text-dim">{P.noLinks}</p>
      ) : (
        <ul className="flex flex-col gap-1.5" aria-label={P.links} data-testid="node-links">
          {outgoing.map((e) => {
            const name = G.edgeName(G.edges[e.type], node.label, label(e.to));
            return (
              <li key={e.id} className="flex items-center gap-2 text-caption">
                <LinkSample type={e.type} />
                <span className="min-w-0 flex-1">
                  <span className="text-dim">{G.edges[e.type]}</span> →{' '}
                  <span className="font-medium">{label(e.to)}</span>
                </span>
                <button
                  type="button"
                  onClick={() => dispatch({ type: 'remove-edge', id: e.id })}
                  aria-label={P.removeLink(name)}
                  className="inline-flex size-6 shrink-0 items-center justify-center rounded-control text-dim hover:bg-hover hover:text-ink"
                >
                  <RemoveIcon size={13} />
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {targets.length === 0 || kind === undefined ? (
        node.type === 'done' ? null : (
          <p className="text-caption text-dim">{P.linkToNone}</p>
        )
      ) : (
        <div className="flex flex-col gap-2" data-testid="add-link">
          <span className={labelClass}>{P.addLink}</span>
          <div className="grid grid-cols-2 gap-2">
            <div className="flex min-w-0 flex-col gap-1">
              <label htmlFor={`${id}-to`} className={hintClass}>
                {P.linkTo}
              </label>
              <Select id={`${id}-to`} value={target} onChange={(e) => setTo(e.target.value)}>
                {targets.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.label}
                  </option>
                ))}
              </Select>
            </div>
            <div className="flex min-w-0 flex-col gap-1">
              <label htmlFor={`${id}-type`} className={hintClass}>
                {P.linkType}
              </label>
              <Select
                id={`${id}-type`}
                value={kind}
                onChange={(e) => setType(e.target.value as WorkflowEdgeType)}
              >
                {types.map((t) => (
                  <option key={t} value={t}>
                    {G.edges[t]}
                  </option>
                ))}
              </Select>
            </div>
          </div>
          <p className="text-caption text-dim">{G.edgeText[kind]}</p>
          <Button
            size="sm"
            className="w-fit"
            onClick={() => dispatch({ type: 'connect', from: node.id, to: target, edgeType: kind })}
          >
            {P.linkAdd}
          </Button>
        </div>
      )}
    </Section>
  );
}

function nameError(label: string): string | undefined {
  const t = label.trim();
  if (t.length === 0) return P.nameRequired;
  if (t.length > MAX_NODE_LABEL) return P.nameTooLong(MAX_NODE_LABEL);
  return undefined;
}

/** The fields of an agent block: name, model, skills, agent file, then its kind's own settings. */
function AgentFields({
  node,
  ctx,
  change,
}: {
  node: Extract<WorkflowNode, { skills: unknown }>;
  ctx: NodePanelContext;
  change: (patch: NodePatch) => void;
}) {
  const fileModel = node.agent === null ? null : (ctx.agentModels?.get(node.agent) ?? null);
  const placeholder =
    fileModel !== null ? P.modelFromFile(fileModel) : (ctx.projectModel ?? P.modelDefault);
  const model = node.model ?? '';
  return (
    <div className="flex flex-col gap-5">
      <TextField
        label={P.name}
        hint={node.type === 'helper' ? P.helperNameHint : P.nameHint}
        error={nameError(node.label)}
        value={node.label}
        onChange={(label) => change({ label })}
      />
      {node.type === 'helper' ? (
        <TextAreaField
          label={P.description}
          hint={P.descriptionHint}
          error={
            node.description.trim().length > MAX_NODE_DESCRIPTION
              ? P.descriptionTooLong(MAX_NODE_DESCRIPTION)
              : undefined
          }
          value={node.description}
          onChange={(description) => change({ description })}
          rows={3}
        />
      ) : null}
      <AgentFileField
        projectId={ctx.projectId}
        value={node.agent}
        agents={ctx.agents}
        onChange={(agent) => change({ agent })}
      />
      <TextField
        label={G.model}
        hint={P.modelHint}
        error={model.trim().length > MAX_MODEL ? P.modelTooLong : undefined}
        value={model}
        onChange={(v) => change({ model: v.trim() === '' ? null : v })}
        placeholder={placeholder}
        mono
      />
      <SkillsField
        value={node.skills}
        skills={ctx.skills}
        onChange={(skills) => change({ skills })}
      />
      {node.type === 'reviewer' ? (
        <ChoiceCards<'change' | 'final'>
          legend={P.scope}
          name={`scope-${node.id}`}
          value={node.scope}
          columns={1}
          options={(['change', 'final'] as const).map((s) => ({
            value: s,
            label: P.scopes[s],
            hint: P.scopeHints[s],
          }))}
          onChange={(scope) => change({ scope })}
        />
      ) : null}
      {node.type === 'helper' ? (
        <NumberChoice
          legend={P.maxInstances}
          hint={P.maxInstancesHint(ctx.helperLimit)}
          name={`instances-${node.id}`}
          value={node.maxInstances}
          choices={INSTANCE_CHOICES}
          onChange={(maxInstances) => change({ maxInstances })}
          valueText={P.maxInstancesValue}
        />
      ) : null}
      {node.type === 'helper' || node.type === 'helper-pool' ? (
        <CheckboxField
          label={P.canStartHelpers}
          hint={P.canStartHelpersHint}
          checked={node.canStartHelpers}
          onChange={(canStartHelpers) => change({ canStartHelpers })}
        />
      ) : null}
      {isEditorNode(node) ? (
        <ModeField
          value={node.approvalMode}
          projectMode={ctx.projectMode}
          onChange={(approvalMode) => change({ approvalMode })}
        />
      ) : (
        <p
          className="rounded-control border border-line bg-sunken px-3 py-2.5 text-caption text-dim"
          data-testid="no-mode"
        >
          {P.readOnlyMode}
        </p>
      )}
    </div>
  );
}

/**
 * The selected block's settings (README §5). The fields follow the block's kind: an agent's
 * name, model, skills and agent file; the approval mode only on blocks that edit (the helpers and
 * the tester), since a read-only block never asks; the plan approval's automatic switch. Every
 * change goes to the editor's reducer, so the canvas and the problems list follow at once.
 */
export function NodePanel({
  node,
  graph,
  ctx,
  dispatch,
  onClose,
}: {
  node: WorkflowNode;
  graph: WorkflowGraph;
  ctx: NodePanelContext;
  dispatch: Dispatch<EditorAction>;
  onClose: () => void;
}) {
  const change = (patch: NodePatch) => dispatch({ type: 'update-node', id: node.id, patch });
  return (
    <div
      className="flex flex-col"
      data-testid="node-panel"
      data-node={node.id}
      data-kind={node.type}
    >
      <PanelHeading
        eyebrow={kindWord(node)}
        title={node.label}
        text={kindText(node)}
        onClose={onClose}
      />
      <div className="flex flex-col gap-5 px-5 pt-5 pb-6">
        {'skills' in node ? (
          <AgentFields node={node} ctx={ctx} change={change} />
        ) : node.type === 'plan-approval' ? (
          <CheckboxField
            label={P.planAuto}
            hint={P.planAutoHint}
            checked={node.auto}
            onChange={(auto) => change({ auto })}
          />
        ) : null}
        <LinksSection key={node.id} node={node} graph={graph} dispatch={dispatch} />
        <div className="-mx-5 border-t border-line px-5 pt-5">
          {isRemovable(node) ? (
            <Button
              variant="danger"
              size="sm"
              onClick={() => dispatch({ type: 'remove-node', id: node.id })}
            >
              {P.remove}
            </Button>
          ) : (
            <p className="text-caption text-dim" data-testid="block-fixed">
              {P.fixed}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

/** The panel's heading: the kind, the name and one sentence, with a close button. */
export function PanelHeading({
  eyebrow,
  title,
  text,
  onClose,
}: {
  eyebrow: string;
  title: string;
  text: string;
  onClose: () => void;
}) {
  return (
    <div className="flex items-start gap-3 border-b border-line px-5 pt-4 pb-4">
      <div className="flex min-w-0 flex-col gap-1">
        <span className="text-micro font-semibold tracking-[0.06em] text-dim uppercase">
          {eyebrow}
        </span>
        <h3 className="truncate text-section font-semibold">{title.trim() === '' ? '—' : title}</h3>
        <p className="text-dim">{text}</p>
      </div>
      <button
        type="button"
        onClick={onClose}
        aria-label={P.close}
        title={P.close}
        className="-mt-1 -mr-1.5 ml-auto inline-flex size-7 shrink-0 items-center justify-center rounded-control text-dim transition-colors hover:bg-hover hover:text-ink"
      >
        <RemoveIcon size={16} />
      </button>
    </div>
  );
}
