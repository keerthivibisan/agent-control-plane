import {
  AGENT_EFFORTS,
  APPROVAL_MODES,
  HARD_MAX_HELPERS,
  MAX_NODE_DESCRIPTION,
  MAX_NODE_LABEL,
  MAX_NODE_SKILLS,
  isEditorNode,
  type AgentEffort,
  type ApprovalMode,
  type WorkflowGraph,
  type WorkflowNode,
} from '@acp/core';
import type { HarnessStatusDto } from '@acp/core/api';
import { useId, type Dispatch, type ReactNode } from 'react';
import { Button } from '../../../components/Button';
import { AlertIcon } from '../../../components/icons';
import { Menu, MenuLabel } from '../../../components/Menu';
import { Select, hintClass, labelClass } from '../../../components/Input';
import { FINISH_COPY, REVIEW_LOOP_COPY, WORKFLOW_GRAPH_COPY } from '../../../lib/copy';
import { href } from '../../../lib/router';
import {
  CheckboxField,
  ChoiceCards,
  NumberChoice,
  TextAreaField,
  TextField,
} from '../../project-setup/fields';
import { FullAutoWarning } from '../../review-loop/ApprovalsEditor';
import { isChecksNode } from '../check-blocks';
import { finishParts, finishView } from '../finish';
import { LinkIcon, RemoveIcon } from '../icons';
import { CheckBlockFields } from './CheckBlockFields';
import { LinkSample } from './edges';
import { EDITOR_COPY } from './copy';
import { IssueRow, type EditorIssue } from './IssuesList';
import { LinkChoiceItems } from './LinkMenu';
import { drawnLabel, linkChoices } from './linking';
import { RoleIcon, kindText, kindWord } from './nodes';
import { isRemovable, type EditorAction, type NodePatch } from './state';

const G = WORKFLOW_GRAPH_COPY;
const P = WORKFLOW_GRAPH_COPY.panel;
const M = REVIEW_LOOP_COPY.modes;
const E = EDITOR_COPY.issues;
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
  /** The project's harness, for the Checks blocks' picks; undefined while unknown. */
  harness?: HarnessStatusDto | undefined;
  /** The project's default target branch, for the Finish block; null: not known. */
  target?: string | null;
}

/** "Default" in the effort choice; the graph leaves the field out. */
const EFFORT_DEFAULT = 'default';

/** How much the agent thinks before acting (ADR-0028 §1): Default, Low, Medium or High. */
function EffortField({
  value,
  onChange,
}: {
  value: AgentEffort | undefined;
  onChange: (next: AgentEffort | null) => void;
}) {
  const id = useId();
  return (
    <div className="flex min-w-0 flex-col gap-1.5" data-testid="effort-field">
      <label htmlFor={id} className={labelClass}>
        {P.effort}
      </label>
      <Select
        id={id}
        value={value ?? EFFORT_DEFAULT}
        onChange={(e) => {
          const next = AGENT_EFFORTS.find((x) => x === e.target.value);
          onChange(next ?? null);
        }}
        aria-describedby={`${id}-hint`}
        data-testid="effort-select"
      >
        <option value={EFFORT_DEFAULT}>{P.efforts.default}</option>
        {AGENT_EFFORTS.map((x) => (
          <option key={x} value={x}>
            {P.efforts[x]}
          </option>
        ))}
      </Select>
      <span id={`${id}-hint`} className={hintClass}>
        {P.effortHint}
      </span>
    </div>
  );
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
    <section className="-mx-4 flex flex-col gap-4 border-t border-line px-4 pt-4">
      <h4 className="font-semibold">{title}</h4>
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
  // The blocks and links as drawn: the Finish block stands for the end steps (ADR-0028 §3).
  const view = finishView(graph);
  const label = (nid: string) => drawnLabel(graph, nid);
  const outgoing = view.graph.edges.filter((e) => e.from === node.id);
  // Only the links core allows, one entry per kind that fits (v0.3.1 P-C).
  const choices = linkChoices(graph, node.id);
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
      {choices.length === 0 ? (
        node.type === 'done' ? null : (
          <p className="text-caption text-dim">{P.linkToNone}</p>
        )
      ) : (
        <Menu
          label={EDITOR_COPY.linkTo.title(label(node.id))}
          testId="link-to-menu"
          loop
          className="max-h-[min(24rem,70vh)] w-72 max-w-[calc(100vw-1rem)] overflow-y-auto"
          trigger={
            <Button size="sm" className="w-fit" data-testid="link-to">
              <LinkIcon size={14} />
              {EDITOR_COPY.linkTo.button}
            </Button>
          }
        >
          <MenuLabel>{EDITOR_COPY.linkTo.title(label(node.id))}</MenuLabel>
          <LinkChoiceItems
            choices={choices}
            onPick={(c) =>
              dispatch({ type: 'connect', from: c.link.from, to: c.link.to, edgeType: c.type })
            }
          />
        </Menu>
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
      <EffortField value={node.effort} onChange={(effort) => change({ effort })} />
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
  issues,
  dispatch,
  onClose,
}: {
  node: WorkflowNode;
  graph: WorkflowGraph;
  ctx: NodePanelContext;
  /** The problems that name this block. */
  issues: readonly EditorIssue[];
  dispatch: Dispatch<EditorAction>;
  onClose: () => void;
}) {
  const change = (patch: NodePatch) => dispatch({ type: 'update-node', id: node.id, patch });
  if (node.type === 'owner-merge' && finishParts(graph) !== null) {
    return (
      <FinishPanel node={node} target={ctx.target ?? null} issues={issues} onClose={onClose} />
    );
  }
  return (
    <div
      className="flex flex-col"
      data-testid="node-panel"
      data-node={node.id}
      data-kind={node.type}
    >
      <PanelHeading
        icon={<RoleIcon node={node} />}
        eyebrow={kindWord(node)}
        title={
          node.type === 'plan-approval' || node.type === 'owner-merge'
            ? G.gateTitle[node.type]
            : node.label
        }
        text={kindText(node)}
        onClose={onClose}
      />
      <PanelIssues issues={issues} title={E.blockTitle} />
      <div className="flex flex-col gap-5 px-4 pt-4 pb-5">
        {'skills' in node ? (
          <AgentFields node={node} ctx={ctx} change={change} />
        ) : isChecksNode(node) ? (
          <CheckBlockFields
            node={node}
            graph={graph}
            harness={ctx.harness}
            projectId={ctx.projectId}
            dispatch={dispatch}
          />
        ) : node.type === 'plan-approval' ? (
          <CheckboxField
            label={P.planAuto}
            hint={P.planAutoHint}
            checked={node.auto}
            onChange={(auto) => change({ auto })}
          />
        ) : null}
        <LinksSection key={node.id} node={node} graph={graph} dispatch={dispatch} />
        <div className="-mx-4 border-t border-line px-4 pt-4">
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

/**
 * The Finish block's panel (ADR-0028 §3): what happens at the end of every ticket, with the
 * project's target. Nothing to set: the owner's final step is a click on the ticket page.
 */
function FinishPanel({
  node,
  target,
  issues,
  onClose,
}: {
  node: WorkflowNode;
  target: string | null;
  issues: readonly EditorIssue[];
  onClose: () => void;
}) {
  return (
    <div className="flex flex-col" data-testid="node-panel" data-node={node.id} data-kind="finish">
      <PanelHeading
        icon={<RoleIcon node={node} />}
        eyebrow={FINISH_COPY.kind}
        title={FINISH_COPY.title}
        text={FINISH_COPY.panelText(target)}
        onClose={onClose}
      />
      <PanelIssues issues={issues} title={E.blockTitle} />
      <div className="flex flex-col gap-5 px-4 pt-4 pb-5">
        <section className="flex flex-col gap-2" data-testid="finish-steps">
          <h4 className="font-semibold">{FINISH_COPY.stepsTitle}</h4>
          <ol className="flex list-decimal flex-col gap-1 pl-5 text-caption text-dim">
            {FINISH_COPY.steps(target).map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
        </section>
        <div className="-mx-4 border-t border-line px-4 pt-4">
          <p className="text-caption text-dim" data-testid="block-fixed">
            {FINISH_COPY.fixed}
          </p>
        </div>
      </div>
    </div>
  );
}

/** The panel's heading, GitHub's Box header: the kind, the name and a close button; one sentence. */
export function PanelHeading({
  icon,
  eyebrow,
  title,
  text,
  onClose,
}: {
  icon?: ReactNode;
  eyebrow: string;
  title: string;
  text: string;
  onClose: () => void;
}) {
  return (
    <>
      <div className="flex items-start gap-3 rounded-t-[calc(var(--radius-card)-1px)] border-b border-line bg-subtle px-4 py-3">
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="flex items-center gap-1.5 text-caption text-dim">
            {icon}
            {eyebrow}
          </span>
          <h3 className="truncate text-title font-semibold">{title.trim() === '' ? '—' : title}</h3>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label={P.close}
          title={P.close}
          className="-mr-1.5 ml-auto inline-flex size-7 shrink-0 items-center justify-center rounded-control text-dim transition-colors hover:bg-hover hover:text-ink"
        >
          <RemoveIcon size={16} />
        </button>
      </div>
      <p className="px-4 pt-3 text-caption text-dim">{text}</p>
    </>
  );
}

/** The problems that name the selected block or link, at the top of its panel. */
export function PanelIssues({ issues, title }: { issues: readonly EditorIssue[]; title: string }) {
  if (issues.length === 0) return null;
  const errors = issues.filter((i) => i.severity === 'error');
  const warnings = issues.filter((i) => i.severity === 'warning');
  return (
    <div className="mx-4 mt-3 rounded-control border border-line py-1" data-testid="panel-issues">
      <p className="px-3 pt-1 text-caption font-semibold text-dim">{title}</p>
      <ul className="flex flex-col px-1" aria-label={title}>
        {[...errors, ...warnings].map((issue, i) => (
          <IssueRow key={`${issue.code}-${i}`} issue={issue} />
        ))}
      </ul>
    </div>
  );
}
