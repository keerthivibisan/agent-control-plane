import { DEFAULT_APPROVAL_MODE, type ApprovalMode } from '@acp/core';
import type { ProjectDto } from '@acp/core/api';
import { useMemo, useState, type ReactNode } from 'react';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { Details } from '../../components/Details';
import { CheckIcon } from '../../components/icons';
import { PageHeader } from '../../components/PageHeader';
import { QueryView } from '../../components/QueryView';
import {
  isProjectSetupPath,
  isWorkflowGraphPath,
  projectSetupPaths,
  projectSetupSchemas,
  updateProjectSetup,
  updateWorkflowGraph,
} from '../../lib/api';
import {
  BRANCHING_COPY,
  PROJECT_SETUP_COPY,
  REVIEW_LOOP_COPY,
  SETUP_COPY,
  WORKFLOW_GRAPH_COPY,
} from '../../lib/copy';
import { useApiQuery } from '../../lib/query';
import { href, navigate } from '../../lib/router';
import { ActionError } from '../control/bits';
import { useSetupAction } from './actions';
import { HarnessCheckList, HarnessStatusView, HarnessTicketAction } from './HarnessPanel';
import { ApprovalModeChoice, ModeWarning } from '../review-loop/ApprovalsEditor';
import { BranchingFields } from '../branching/BranchingFields';
import {
  draftFromStrategy,
  draftToStrategy,
  hasBranchingErrors,
  sameBranching,
  validateBranching,
  type BranchingDraft,
} from '../branching/strategy-form';
import { AgentFields, ContextPicker } from './SetupSections';
import {
  draftFromSetup,
  draftToRequest,
  initialContextFiles,
  validateAgentFields,
  type SetupDraft,
  type SetupErrors,
} from './setup-form';
import { SourceDone, SourceStep, useSourceStep, type SourceMode } from './SourceStep';
import {
  DEFAULT_WORKFLOW_CHOICE,
  WorkflowTemplateChoice,
  choiceGraph,
  isDefaultChoice,
  type WorkflowChoice,
} from './WorkflowTemplateChoice';

const W = PROJECT_SETUP_COPY.wizard;
const STEPS = ['source', 'agents', 'allowlist', 'context', 'harness'] as const;
type StepKey = (typeof STEPS)[number];

const STEP_TEXT: Record<StepKey, { title: string; description: string }> = {
  source: PROJECT_SETUP_COPY.source,
  agents: PROJECT_SETUP_COPY.agents,
  // ADR-0021: the third step chooses the approval mode (the step keeps its key and test hook).
  allowlist: REVIEW_LOOP_COPY.wizard,
  context: PROJECT_SETUP_COPY.context,
  harness: PROJECT_SETUP_COPY.harness,
};

/** Five dots with names; done steps get a check, the current one is marked for screen readers. */
function Progress({ current }: { current: number }) {
  return (
    <nav aria-label={W.progressLabel} className="mb-6">
      <ol className="flex flex-wrap items-center gap-x-2 gap-y-3">
        {STEPS.map((key, i) => {
          const done = i < current;
          const active = i === current;
          return (
            <li
              key={key}
              aria-current={active ? 'step' : undefined}
              data-step-state={done ? 'done' : active ? 'current' : 'todo'}
              className="flex items-center gap-2"
            >
              <span
                aria-hidden="true"
                className={`flex size-6 shrink-0 items-center justify-center rounded-full text-caption font-semibold tabular-nums transition-colors duration-200 ${
                  done
                    ? 'bg-accent-fill text-accent-fill-ink'
                    : active
                      ? 'border border-accent bg-accent-soft text-accent shadow-[0_0_0_3px_color-mix(in_srgb,var(--color-accent)_18%,transparent)]'
                      : 'border border-line-strong bg-panel text-dim'
                }`}
              >
                {done ? <CheckIcon size={13} strokeWidth={2.5} /> : i + 1}
              </span>
              <span className={active ? 'font-medium text-ink' : done ? 'text-ink' : 'text-dim'}>
                {key === 'allowlist' ? REVIEW_LOOP_COPY.wizard.step : W.steps[key]}
              </span>
              {i < STEPS.length - 1 ? (
                <span
                  aria-hidden="true"
                  className={`mx-1 hidden h-px w-6 sm:block xl:w-10 ${done ? 'bg-accent/60' : 'bg-line-strong'}`}
                />
              ) : null}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

/** The main button says what it does: add, create, save and continue, or finish. */
function nextLabel(key: StepKey, pending: boolean, sourceMode: SourceMode | null): string {
  const S = PROJECT_SETUP_COPY.source;
  if (key === 'source' && sourceMode !== null) {
    if (sourceMode === 'new') return pending ? S.creating : S.create;
    return pending ? SETUP_COPY.addProject.submitting : SETUP_COPY.addProject.submit;
  }
  if (pending) return W.saving;
  return key === 'harness' ? W.finish : W.next;
}

/** `#/projects/new`: add or create a project, then set up its AI work environment (§4.1). */
export function NewProjectWizard() {
  const [step, setStep] = useState(0);
  const [project, setProject] = useState<ProjectDto | null>(null);
  const [created, setCreated] = useState(false);
  const [edits, setEdits] = useState<Partial<SetupDraft>>({});
  /** The owner's pick; until then a new project starts in Auto edits (ADR-0021 §1). */
  const [mode, setMode] = useState<ApprovalMode | null>(null);
  const [errors, setErrors] = useState<SetupErrors>({});
  /** WG-D: how changes are reviewed; saved as the project's workflow graph on finish. */
  const [workflow, setWorkflow] = useState<WorkflowChoice>(DEFAULT_WORKFLOW_CHOICE);
  /** ADR-0025: the owner's branching strategy, if they open that section; saved with the setup. */
  const [branchingEdit, setBranchingEdit] = useState<BranchingDraft | null>(null);

  const source = useSourceStep((p) => {
    setProject(p);
    setCreated(source.draft.mode === 'new');
    setStep(1);
  });

  const id = project?.id ?? null;
  const setup = useApiQuery(id && projectSetupPaths.setup(id), projectSetupSchemas.setup);
  const harness = useApiQuery(id && projectSetupPaths.harness(id), projectSetupSchemas.harness);
  const candidates = useApiQuery(
    id && projectSetupPaths.contextCandidates(id),
    projectSetupSchemas.contextCandidates,
  );
  const invalidate = useMemo(() => isProjectSetupPath(id ?? ''), [id]);
  const save = useSetupAction(updateProjectSetup, invalidate);
  const graphInvalidate = useMemo(() => isWorkflowGraphPath(id ?? ''), [id]);
  const saveGraph = useSetupAction(updateWorkflowGraph, graphInvalidate);

  // The draft is what the server holds (its defaults for a new project) plus the owner's edits.
  // Until the owner picks files, CLAUDE.md and other suggested files are pre-selected.
  const draft: SetupDraft | null =
    setup.data === undefined
      ? null
      : {
          ...draftFromSetup(setup.data),
          ...(candidates.data === undefined
            ? {}
            : { contextFiles: initialContextFiles(setup.data.contextFiles, candidates.data) }),
          ...edits,
        };

  const change = (patch: Partial<SetupDraft>) => {
    setEdits((e) => ({ ...e, ...patch }));
  };

  const approvalMode = mode ?? setup.data?.approvals?.mode ?? DEFAULT_APPROVAL_MODE;
  const savedBranching = draftFromStrategy(setup.data?.branching);
  const branching = branchingEdit ?? savedBranching;
  const branchErrors = validateBranching(branching);

  const key = STEPS[step] ?? 'source';
  const pending = source.pending || save.pending || saveGraph.pending;

  const next = async () => {
    if (key === 'source') {
      if (project !== null) setStep(1);
      else await source.submit();
      return;
    }
    if (draft === null || id === null) return;
    if (key === 'agents') {
      const e = validateAgentFields(draft);
      setErrors(e);
      if (Object.keys(e).length === 0 && !hasBranchingErrors(branchErrors)) setStep(2);
      return;
    }
    if (key === 'allowlist') {
      setStep(3);
      return;
    }
    if (key === 'context') {
      const r = draftToRequest(draft, candidates.data);
      if (!r.ok) {
        setErrors(r.errors);
        // A step-2 problem (only possible if the server's defaults were odd): show it there.
        if (r.errors.projectKey || r.errors.budget || r.errors.model) setStep(1);
        return;
      }
      setErrors({});
      // The mode, without the legacy allowlist (the server keeps that in step with the mode).
      const { allowlist: _legacy, ...request } = r.request;
      // Sent only when the owner changed it: absent keeps what the project has.
      const b = draftToStrategy(branching);
      const branchingChange =
        b.ok && !sameBranching(branching, savedBranching) ? { branching: b.branching } : {};
      const saved = await save.run(id, {
        ...request,
        approvals: { mode: approvalMode, commands: [...(setup.data?.approvals?.commands ?? [])] },
        ...branchingChange,
      });
      if (saved !== null) setStep(4);
      return;
    }
    // The chosen workflow (WG-D). The default needs no save: a project without a stored graph
    // answers today's setup, the same workflow.
    if (!isDefaultChoice(workflow)) {
      const graph = choiceGraph(workflow, approvalMode);
      if ((await saveGraph.run(id, { graph })) === null) return;
    }
    navigate(href.board(id));
  };

  let body: ReactNode;
  if (key === 'source') {
    body =
      project === null ? (
        <SourceStep state={source} />
      ) : (
        <SourceDone project={project} created={created} />
      );
  } else if (key === 'harness') {
    body = (
      <QueryView query={harness}>
        {(h) => (
          <div className="flex flex-col gap-5">
            <HarnessStatusView harness={h} />
            <HarnessCheckList harness={h} />
            {id !== null && h.state !== 'ready' ? (
              <HarnessTicketAction projectId={id} prominent={h.state === 'none'} />
            ) : null}
          </div>
        )}
      </QueryView>
    );
  } else if (draft === null) {
    body = <QueryView query={setup}>{() => null}</QueryView>;
  } else if (key === 'agents') {
    body = (
      <div className="flex flex-col gap-8">
        <AgentFields draft={draft} errors={errors} onChange={change} />
        <WorkflowTemplateChoice value={workflow} onChange={setWorkflow} />
        <Details
          summary={BRANCHING_COPY.wizardSummary}
          testId="wizard-branching"
          defaultOpen={branching.choice !== 'none'}
        >
          <BranchingFields
            draft={branching}
            errors={branchErrors}
            onChange={setBranchingEdit}
            projectKey={draft.projectKey}
          />
        </Details>
      </div>
    );
  } else if (key === 'allowlist') {
    body = (
      <div className="flex flex-col gap-4" data-testid="wizard-approvals">
        <ApprovalModeChoice value={approvalMode} onChange={setMode} columns={2} />
        <ModeWarning mode={approvalMode} />
        {approvalMode === 'auto' ? (
          <p className="text-caption text-dim">{REVIEW_LOOP_COPY.wizard.autoCommands}</p>
        ) : null}
      </div>
    );
  } else {
    body = (
      <ContextPicker draft={draft} errors={errors} onChange={change} candidates={candidates} />
    );
  }

  const text = STEP_TEXT[key];
  return (
    <div className="max-w-4xl">
      <PageHeader
        eyebrow={<a href={href.projects()}>← {W.toProjects}</a>}
        title={W.title}
        description={W.description}
      />
      <Progress current={step} />
      <form
        noValidate
        aria-label={W.title}
        onSubmit={(e) => {
          e.preventDefault();
          void next();
        }}
      >
        <Card
          title={text.title}
          description={text.description}
          actions={
            <span className="text-caption text-dim tabular-nums">
              {W.stepOf(step + 1, STEPS.length)}
            </span>
          }
          testId={`wizard-step-${key}`}
        >
          <div className="flex flex-col gap-6">
            {body}
            <ActionError error={save.error} message={W.saveFailed} />
            <ActionError error={saveGraph.error} message={WORKFLOW_GRAPH_COPY.wizard.failed} />
            <div className="-mx-5 -mb-5 flex items-center gap-2 rounded-b-card border-t border-line bg-sunken/40 px-5 py-3">
              {step > 0 ? (
                <Button onClick={() => setStep(step - 1)} disabled={pending}>
                  {W.back}
                </Button>
              ) : null}
              <Button
                type="submit"
                variant="primary"
                className="ml-auto"
                disabled={pending || (key !== 'source' && draft === null)}
              >
                {nextLabel(key, pending, project === null ? source.draft.mode : null)}
              </Button>
            </div>
          </div>
        </Card>
      </form>
    </div>
  );
}
