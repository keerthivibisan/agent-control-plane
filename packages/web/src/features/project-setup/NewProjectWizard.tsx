import type { ProjectDto } from '@acp/core/api';
import { useMemo, useState, type ReactNode } from 'react';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { CheckIcon } from '../../components/icons';
import { PageHeader } from '../../components/PageHeader';
import { QueryView } from '../../components/QueryView';
import {
  isProjectSetupPath,
  projectSetupPaths,
  projectSetupSchemas,
  updateProjectSetup,
} from '../../lib/api';
import { PROJECT_SETUP_COPY, SETUP_COPY } from '../../lib/copy';
import { useApiQuery } from '../../lib/query';
import { href, navigate } from '../../lib/router';
import { ActionError } from '../control/bits';
import { useSetupAction } from './actions';
import { HarnessCheckList, HarnessStatusView, HarnessTicketAction } from './HarnessPanel';
import { AgentFields, AllowlistFields, ContextPicker } from './SetupSections';
import {
  boardHash,
  draftFromSetup,
  draftToRequest,
  initialContextFiles,
  validateAgentFields,
  type SetupDraft,
  type SetupErrors,
} from './setup-form';
import { SourceDone, SourceStep, useSourceStep, type SourceMode } from './SourceStep';

const W = PROJECT_SETUP_COPY.wizard;
const STEPS = ['source', 'agents', 'allowlist', 'context', 'harness'] as const;
type StepKey = (typeof STEPS)[number];

const STEP_TEXT: Record<StepKey, { title: string; description: string }> = {
  source: PROJECT_SETUP_COPY.source,
  agents: PROJECT_SETUP_COPY.agents,
  allowlist: PROJECT_SETUP_COPY.allowlist,
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
                className={`flex size-7 shrink-0 items-center justify-center rounded-full text-caption font-semibold ${
                  done
                    ? 'bg-accent text-accent-ink'
                    : active
                      ? 'bg-accent-soft text-accent ring-2 ring-accent'
                      : 'border border-line-strong bg-panel text-dim'
                }`}
              >
                {done ? <CheckIcon size={14} /> : i + 1}
              </span>
              <span className={active ? 'font-medium text-ink' : 'text-dim'}>{W.steps[key]}</span>
              {i < STEPS.length - 1 ? (
                <span aria-hidden="true" className="mx-1 hidden h-px w-8 bg-line-strong sm:block" />
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
  const [errors, setErrors] = useState<SetupErrors>({});

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

  const key = STEPS[step] ?? 'source';
  const pending = source.pending || save.pending;

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
      if (Object.keys(e).length === 0) setStep(2);
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
      const saved = await save.run(id, r.request);
      if (saved !== null) setStep(4);
      return;
    }
    navigate(boardHash(id));
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
    body = <AgentFields draft={draft} errors={errors} onChange={change} />;
  } else if (key === 'allowlist') {
    body = <AllowlistFields draft={draft} onChange={change} harness={harness.data} />;
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
            <span className="text-caption text-dim">{W.stepOf(step + 1, STEPS.length)}</span>
          }
          testId={`wizard-step-${key}`}
        >
          <div className="flex flex-col gap-6">
            {body}
            <ActionError error={save.error} message={W.saveFailed} />
            <div className="flex items-center gap-2 border-t border-line pt-4">
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
