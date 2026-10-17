import { HARD_MAX_HELPERS, MAX_REWORK_ROUNDS, type WorkflowStageId } from '@acp/core';
import type { AgentDefinitionSummaryDto, ProjectAgentSetupDto } from '@acp/core/api';
import { useId, type ReactNode } from 'react';
import { buttonClass } from '../../components/Button';
import { AlertIcon, ArrowRightIcon } from '../../components/icons';
import { Select } from '../../components/Input';
import {
  PROJECT_SETUP_COPY,
  REVIEW_LOOP_COPY,
  STAGE_AGENT_COPY,
  WORKFLOW_COPY,
} from '../../lib/copy';
import { href } from '../../lib/router';
import { CheckboxField, ChoiceCards, NumberChoice, TextField } from '../project-setup/fields';
import { DEPTH_CHOICES, HELPER_CHOICES, parseTokens } from '../project-setup/setup-form';
import { ApprovalModeChoice, ModeWarning, CommandListEditor } from '../review-loop/ApprovalsEditor';
import type { DraftErrors, LimitsDraft, ReviewDraft, StageDraft, WorkflowDraft } from './draft';
import { OPTIONAL_STAGES, type AgentStageId, type WorkflowRole } from './graph';
import { MergeIcon, ROLE_ICON } from './icons';

const C = WORKFLOW_COPY;
const P = WORKFLOW_COPY.panel;
const A = PROJECT_SETUP_COPY.agents;
const RL = REVIEW_LOOP_COPY;
/** Rework rounds the owner can pick: 0 (none) to the hard limit. */
const ROUND_CHOICES: readonly number[] = Array.from({ length: MAX_REWORK_ROUNDS + 1 }, (_, i) => i);
const AF = STAGE_AGENT_COPY;
/** Roles that never edit files; an agent file's tools can't change that (ADR-0019 §6). */
const READ_ONLY_ROLES: readonly WorkflowRole[] = ['planner', 'lead', 'reviewer'];

export interface StagePanelProps {
  projectId: string;
  stage: WorkflowStageId;
  workflow: WorkflowDraft;
  limits: LimitsDraft;
  setup: ProjectAgentSetupDto;
  skills: readonly string[];
  /** The project's agent files; undefined while the list isn't known (loading or not served). */
  agentFiles: readonly AgentDefinitionSummaryDto[] | undefined;
  errors: DraftErrors;
  onWorkflow: (next: WorkflowDraft) => void;
  onLimits: (patch: Partial<LimitsDraft>) => void;
}

/** The role a stage's agent has in the draft (Plan's agent is the lead in `lead` mode). */
export function roleOf(stage: AgentStageId, workflow: WorkflowDraft): WorkflowRole {
  switch (stage) {
    case 'plan':
      return workflow.plannerMode === 'separate' ? 'planner' : 'lead';
    case 'orchestrate':
      return 'lead';
    case 'helpers':
      return 'helper';
    case 'code-review':
      return 'reviewer';
    case 'unit-tests':
      return 'tester';
  }
}

/**
 * A choice that is gone (a deleted skill or agent file): `aria-invalid`, in the warning tone of the
 * note under it rather than the error red, because the stage still runs without it.
 */
const MISSING_FIELD = 'aria-invalid:border-warning! aria-invalid:focus:ring-warning/20!';

/** A warning under a field: the alert icon, then what is wrong and what happens because of it. */
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

function SkillSelect({
  value,
  skills,
  onChange,
}: {
  value: string | null;
  skills: readonly string[];
  onChange: (skill: string | null) => void;
}) {
  const id = useId();
  const missing = value !== null && !skills.includes(value);
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <label htmlFor={id} className="font-medium">
        {P.skill}
      </label>
      <Select
        id={id}
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value === '' ? null : e.target.value)}
        aria-describedby={`${id}-hint`}
        aria-invalid={missing ? true : undefined}
        className={missing ? MISSING_FIELD : ''}
      >
        <option value="">{C.noSkill}</option>
        {missing ? <option value={value}>{P.skillMissingOption(value)}</option> : null}
        {skills.map((s) => (
          <option key={s} value={s}>
            {s}
          </option>
        ))}
      </Select>
      <span id={`${id}-hint`} className="text-caption text-dim">
        {P.skillHint}
      </span>
      {missing ? <Callout testId="skill-missing">{C.skillMissingTip(value)}</Callout> : null}
    </div>
  );
}

/**
 * The stage's agent file (ADR-0019 §6): "None" or one of the project's `.claude/agents/*.md`.
 * `files` is undefined while the list isn't known; the saved choice is still shown, never flagged.
 */
function AgentFileSelect({
  projectId,
  value,
  files,
  readOnly,
  leadMode,
  onChange,
}: {
  projectId: string;
  value: string | null;
  files: readonly AgentDefinitionSummaryDto[] | undefined;
  /** The role is read-only (planner, lead, reviewer): say the file can't change that. */
  readOnly: boolean;
  /** Plan or Orchestrate while one lead agent does both (`plannerMode: 'lead'`). */
  leadMode: boolean;
  onChange: (agent: string | null) => void;
}) {
  const id = useId();
  const names = files?.map((f) => f.name) ?? [];
  const missing = value !== null && files !== undefined && !names.includes(value);
  const unknown = value !== null && files === undefined;
  const problems = files?.find((f) => f.name === value)?.problems ?? [];
  return (
    <div className="flex min-w-0 flex-col gap-1" data-testid="agent-file-field">
      <label htmlFor={id} className="font-medium">
        {AF.label}
      </label>
      <Select
        id={id}
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value === '' ? null : e.target.value)}
        aria-describedby={`${id}-hint`}
        aria-invalid={missing ? true : undefined}
        className={missing ? MISSING_FIELD : ''}
      >
        <option value="">{AF.none}</option>
        {missing ? <option value={value}>{AF.missingOption(value)}</option> : null}
        {unknown ? <option value={value}>{value}</option> : null}
        {names.map((n) => (
          <option key={n} value={n}>
            {n}
          </option>
        ))}
      </Select>
      <span id={`${id}-hint`} className="text-caption text-dim">
        {AF.hint}
        {readOnly ? ` ${AF.readOnlyHint}` : ''}
        {/* Lead mode: one lead covers both stages; the engine picks Orchestrate's file first. */}
        {leadMode ? ` ${AF.leadModeNote}` : ''}{' '}
        <a
          href={href.projectPage(projectId, 'skills', { tab: 'agents' })}
          className="text-accent hover:underline"
        >
          {AF.manage}
        </a>
      </span>
      {missing ? <Callout testId="agent-missing">{AF.missingWarning}</Callout> : null}
      {problems.length > 0 ? (
        <Callout testId="agent-problems">
          <p>{AF.problems}</p>
          <ul className="mt-0.5 list-disc pl-4">
            {problems.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </Callout>
      ) : null}
    </div>
  );
}

function Section({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <section className="-mx-5 flex flex-col gap-4 border-t border-line px-5 pt-5">
      <div className="flex flex-col gap-0.5">
        <h4 className="text-title font-semibold">{title}</h4>
        {note ? <p className="text-caption text-dim">{note}</p> : null}
      </div>
      {children}
    </section>
  );
}

/** The model field's placeholder: what an empty field means (stage > agent file > project). */
export function modelPlaceholder(
  agent: string | null,
  agentFiles: readonly AgentDefinitionSummaryDto[] | undefined,
  projectModel: string | null,
): string {
  const fileModel =
    agent === null ? null : (agentFiles?.find((f) => f.name === agent)?.model ?? null);
  if (fileModel !== null) return AF.modelPlaceholder(fileModel);
  return projectModel ?? P.modelPlaceholderDefault;
}

/** The fields of one agent stage: planner mode (plan/orchestrate), on/off, agent file, model, skill. */
function AgentStageFields({
  projectId,
  stage,
  workflow,
  setup,
  skills,
  agentFiles,
  errors,
  onWorkflow,
}: Omit<StagePanelProps, 'stage' | 'limits' | 'onLimits'> & { stage: AgentStageId }) {
  const draft = workflow.stages[stage];
  const change = (patch: Partial<StageDraft>) =>
    onWorkflow({ ...workflow, stages: { ...workflow.stages, [stage]: { ...draft, ...patch } } });
  const optional = OPTIONAL_STAGES.includes(stage);
  const role = roleOf(stage, workflow);
  return (
    <div className="flex flex-col gap-5">
      {stage === 'plan' || stage === 'orchestrate' ? (
        <CheckboxField
          label={P.separatePlanner}
          hint={P.separatePlannerHint}
          checked={workflow.plannerMode === 'separate'}
          onChange={(on) => onWorkflow({ ...workflow, plannerMode: on ? 'separate' : 'lead' })}
        />
      ) : null}
      {optional ? (
        <CheckboxField
          label={P.enabled}
          hint={P.enabledHint}
          checked={draft.enabled}
          onChange={(enabled) => change({ enabled })}
        />
      ) : null}
      <AgentFileSelect
        projectId={projectId}
        value={draft.agent}
        files={agentFiles}
        readOnly={READ_ONLY_ROLES.includes(role)}
        leadMode={workflow.plannerMode === 'lead' && (stage === 'plan' || stage === 'orchestrate')}
        onChange={(agent) => change({ agent })}
      />
      <TextField
        label={C.model}
        hint={draft.agent === null ? P.modelHint : AF.modelHint}
        error={errors[stage]}
        value={draft.model}
        onChange={(model) => change({ model })}
        placeholder={modelPlaceholder(draft.agent, agentFiles, setup.model)}
        mono
      />
      <SkillSelect value={draft.skill} skills={skills} onChange={(skill) => change({ skill })} />
    </div>
  );
}

function HelperLimits({
  limits,
  errors,
  onLimits,
}: Pick<StagePanelProps, 'limits' | 'errors' | 'onLimits'>) {
  const name = useId();
  const tokens = parseTokens(limits.budget);
  return (
    <>
      <Section title={P.limitsTitle} note={P.limitsNote}>
        <NumberChoice
          legend={A.helpers}
          hint={A.helpersHint(HARD_MAX_HELPERS)}
          name={`${name}-helpers`}
          value={limits.maxConcurrentHelpers}
          choices={HELPER_CHOICES}
          onChange={(n) => onLimits({ maxConcurrentHelpers: n })}
          valueText={A.helpersValue}
        />
        {/* A short row like the helper count: two cards side by side don't fit the panel. */}
        <NumberChoice
          legend={A.depth}
          hint={A.depthOptions[limits.maxDepth].hint}
          name={`${name}-depth`}
          value={limits.maxDepth}
          choices={DEPTH_CHOICES}
          onChange={(d) => onLimits({ maxDepth: d >= 2 ? 2 : 1 })}
          valueText={P.depthValue}
        />
        <TextField
          label={A.budget}
          hint={tokens === null ? A.budgetHint : `${A.budgetValue(tokens)}. ${A.budgetHint}`}
          error={errors.budget}
          value={limits.budget}
          onChange={(budget) => onLimits({ budget })}
          numeric
          inputClassName="max-w-48"
        />
      </Section>
      {/* ADR-0021: the approval mode replaces the two pre-approved actions. */}
      <Section title={RL.approvals.title} note={RL.approvals.note}>
        <div className="flex flex-col gap-4" data-testid="approvals-editor">
          <ApprovalModeChoice
            value={limits.approvalMode}
            onChange={(approvalMode) => onLimits({ approvalMode })}
          />
          <ModeWarning mode={limits.approvalMode} />
          {limits.approvalMode === 'auto' || limits.commands.length > 0 ? (
            <CommandListEditor
              commands={limits.commands}
              active={limits.approvalMode === 'auto'}
              onChange={(commands) => onLimits({ commands })}
            />
          ) : null}
        </div>
      </Section>
    </>
  );
}

/**
 * The review stage (ADR-0021 §3): who reviews each change, how many rework rounds the lead may
 * ask for, and the review agent's agent file, model and skill (the same fields as an agent stage).
 */
function ReviewFields({
  projectId,
  workflow,
  setup,
  skills,
  agentFiles,
  errors,
  onWorkflow,
}: Omit<StagePanelProps, 'stage' | 'limits' | 'onLimits'>) {
  const id = useId();
  const name = useId();
  const review = workflow.review;
  const change = (patch: Partial<ReviewDraft>) =>
    onWorkflow({ ...workflow, review: { ...review, ...patch } });
  return (
    <div className="flex flex-col gap-5" data-testid="review-fields">
      <ChoiceCards
        legend={RL.review.reviewerLegend}
        name={`${name}-reviewer`}
        value={review.reviewer}
        columns={1}
        options={(['agent', 'lead'] as const).map((r) => ({
          value: r,
          label: RL.review.reviewer[r],
          hint: RL.review.reviewerHint[r],
        }))}
        onChange={(reviewer) => change({ reviewer })}
      />
      <NumberChoice
        legend={RL.review.rounds}
        hint={RL.review.roundsHint}
        name={`${name}-rounds`}
        value={review.maxReworkRounds}
        choices={ROUND_CHOICES}
        onChange={(maxReworkRounds) => change({ maxReworkRounds })}
        valueText={RL.review.roundsValue}
      />
      <ChecksGate projectId={projectId} id={id} />
      <Section
        title={RL.review.agentTitle}
        note={review.reviewer === 'agent' ? RL.review.agentNote : RL.review.leadNote}
      >
        {review.reviewer === 'agent' ? (
          <div className="flex flex-col gap-5" data-testid="review-agent-fields">
            <AgentFileSelect
              projectId={projectId}
              value={review.agent}
              files={agentFiles}
              readOnly
              leadMode={false}
              onChange={(agent) => change({ agent })}
            />
            <TextField
              label={C.model}
              hint={review.agent === null ? P.modelHint : AF.modelHint}
              error={errors.review}
              value={review.model}
              onChange={(model) => change({ model })}
              placeholder={modelPlaceholder(review.agent, agentFiles, setup.model)}
              mono
            />
            <SkillSelect
              value={review.skill}
              skills={skills}
              onChange={(skill) => change({ skill })}
            />
          </div>
        ) : null}
      </Section>
    </div>
  );
}

/** The required-checks gate: always on (ADR-0017), with a link to the Harness page. */
function ChecksGate({ projectId, id }: { projectId: string; id: string }) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start gap-3 rounded-control border border-line bg-sunken px-3.5 py-3">
        <input
          id={id}
          type="checkbox"
          checked
          disabled
          readOnly
          aria-describedby={`${id}-hint`}
          className="mt-0.5 size-4 shrink-0 accent-accent"
        />
        <div className="flex min-w-0 flex-col gap-0.5">
          <label htmlFor={id} className="font-medium">
            {P.requireChecks}
          </label>
          <span id={`${id}-hint`} className="text-caption text-dim">
            {P.requireChecksHint}
          </span>
        </div>
      </div>
      <a
        href={href.projectPage(projectId, 'harness')}
        className={`${buttonClass('secondary', 'sm')} w-fit`}
      >
        {P.harnessLink}
        <ArrowRightIcon size={14} />
      </a>
    </div>
  );
}

/** One stage's settings: the fields for its kind, from the page's drafts. */
export function StageFields(props: StagePanelProps) {
  const { stage } = props;
  if (stage === 'review') return <ReviewFields {...props} />;
  return (
    <div className="flex flex-col gap-5">
      <AgentStageFields {...props} stage={stage} />
      {stage === 'helpers' ? (
        <HelperLimits limits={props.limits} errors={props.errors} onLimits={props.onLimits} />
      ) : null}
    </div>
  );
}

/** The panel's heading for a stage: role, title and one sentence on what it does. */
export function StageHeading({
  stage,
  workflow,
}: {
  stage: WorkflowStageId;
  workflow: WorkflowDraft;
}) {
  const role = stage === 'review' ? null : roleOf(stage, workflow);
  const Icon = role === null ? MergeIcon : ROLE_ICON[role];
  // ADR-0021: the review stage is a reviewer and the lead now, not the owner.
  const who = role === null ? RL.review.who[workflow.review.reviewer] : C.roles[role];
  const text = stage === 'review' ? RL.review.stageText : C.stageText[stage];
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <span
        className={`flex items-center gap-1.5 text-micro font-semibold tracking-[0.06em] uppercase ${
          role === null ? 'text-accent' : 'text-dim'
        }`}
      >
        <Icon size={13} className="shrink-0" />
        {who}
      </span>
      <h3 className="text-section font-semibold">{C.stages[stage]}</h3>
      <p className="text-dim">{text}</p>
      {/* The helpers' role tip says what the stage text already says; one sentence is enough. */}
      {role !== null && role !== 'helper' ? (
        <p className="text-caption text-dim">{C.roleTips[role]}</p>
      ) : null}
    </div>
  );
}
