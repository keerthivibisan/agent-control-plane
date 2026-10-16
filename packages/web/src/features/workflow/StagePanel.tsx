import { HARD_MAX_HELPERS, type WorkflowStageId } from '@acp/core';
import type { ProjectAgentSetupDto } from '@acp/core/api';
import { useId, type ReactNode } from 'react';
import { buttonClass } from '../../components/Button';
import { Select } from '../../components/Input';
import { PROJECT_SETUP_COPY, WORKFLOW_COPY } from '../../lib/copy';
import { href } from '../../lib/router';
import { CheckboxField, NumberChoice, TextField } from '../project-setup/fields';
import { DEPTH_CHOICES, HELPER_CHOICES, parseTokens } from '../project-setup/setup-form';
import type { DraftErrors, LimitsDraft, StageDraft, WorkflowDraft } from './draft';
import { OPTIONAL_STAGES, type AgentStageId, type WorkflowRole } from './graph';

const C = WORKFLOW_COPY;
const P = WORKFLOW_COPY.panel;
const A = PROJECT_SETUP_COPY.agents;
const L = PROJECT_SETUP_COPY.allowlist;

export interface StagePanelProps {
  projectId: string;
  stage: WorkflowStageId;
  workflow: WorkflowDraft;
  limits: LimitsDraft;
  setup: ProjectAgentSetupDto;
  skills: readonly string[];
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
        className={missing ? 'border-warning' : ''}
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
      {missing ? (
        <p
          role="status"
          className="rounded-control border border-warning/30 bg-warning-soft px-3 py-2 text-caption text-warning"
          data-testid="skill-missing"
        >
          ⚠ {C.skillMissingTip(value)}
        </p>
      ) : null}
    </div>
  );
}

function Section({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-4 border-t border-line pt-5">
      <div>
        <h4 className="font-semibold">{title}</h4>
        {note ? <p className="text-caption text-dim">{note}</p> : null}
      </div>
      {children}
    </section>
  );
}

/** The fields of one agent stage: planner mode (plan/orchestrate), on/off, model and skill. */
function AgentStageFields({
  stage,
  workflow,
  setup,
  skills,
  errors,
  onWorkflow,
}: Omit<StagePanelProps, 'stage' | 'limits' | 'onLimits' | 'projectId'> & { stage: AgentStageId }) {
  const draft = workflow.stages[stage];
  const change = (patch: Partial<StageDraft>) =>
    onWorkflow({ ...workflow, stages: { ...workflow.stages, [stage]: { ...draft, ...patch } } });
  const optional = OPTIONAL_STAGES.includes(stage);
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
      <TextField
        label={C.model}
        hint={P.modelHint}
        error={errors[stage]}
        value={draft.model}
        onChange={(model) => change({ model })}
        placeholder={setup.model ?? P.modelPlaceholderDefault}
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
      <Section title={P.allowlistTitle}>
        <CheckboxField
          label={L.edit}
          hint={L.editHint}
          checked={limits.editInOwnWorktree}
          onChange={(v) => onLimits({ editInOwnWorktree: v })}
        />
        <CheckboxField
          label={L.checks}
          hint={L.checksHint}
          checked={limits.runHarnessChecks}
          onChange={(v) => onLimits({ runHarnessChecks: v })}
        />
      </Section>
    </>
  );
}

function ReviewFields({ projectId }: { projectId: string }) {
  const id = useId();
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start gap-3 rounded-control border border-line bg-sunken px-3 py-3">
        <input
          id={id}
          type="checkbox"
          checked
          disabled
          readOnly
          aria-describedby={`${id}-hint`}
          className="mt-1 size-4 shrink-0 accent-accent"
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
      </a>
    </div>
  );
}

/** One stage's settings: the fields for its kind, from the page's drafts. */
export function StageFields(props: StagePanelProps) {
  const { stage } = props;
  if (stage === 'review') return <ReviewFields projectId={props.projectId} />;
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
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <span className="text-caption font-medium tracking-wide text-dim uppercase">
        {role === null ? C.review.who : C.roles[role]}
      </span>
      <h3 className="text-title font-semibold tracking-tight">{C.stages[stage]}</h3>
      <p className="text-dim">{C.stageText[stage]}</p>
      {/* The helpers' role tip says what the stage text already says; one sentence is enough. */}
      {role !== null && role !== 'helper' ? (
        <p className="text-caption text-dim">{C.roleTips[role]}</p>
      ) : null}
    </div>
  );
}
