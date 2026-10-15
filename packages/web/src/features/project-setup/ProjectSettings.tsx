import type {
  ContextCandidateDto,
  HarnessStatusDto,
  ProjectAgentSetupDto,
  ProjectDto,
} from '@acp/core/api';
import { useMemo, useState, type FormEvent } from 'react';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { CheckIcon } from '../../components/icons';
import { PageHeader } from '../../components/PageHeader';
import { QueryView } from '../../components/QueryView';
import {
  isProjectSetupPath,
  paths,
  projectSetupPaths,
  projectSetupSchemas,
  schemas,
  updateProjectSetup,
} from '../../lib/api';
import { PROJECT_SETUP_COPY } from '../../lib/copy';
import { useApiQuery } from '../../lib/query';
import type { QueryState } from '../../lib/query-store';
import { href } from '../../lib/router';
import { ActionError } from '../control/bits';
import { useSetupAction } from './actions';
import { FormSection } from './fields';
import {
  HarnessCheckList,
  HarnessStatusView,
  HarnessTicketAction,
  RunChecksNow,
} from './HarnessPanel';
import { AgentFields, AllowlistFields, ContextPicker } from './SetupSections';
import {
  draftFromSetup,
  draftToRequest,
  sameDraft,
  type SetupDraft,
  type SetupErrors,
} from './setup-form';

const C = PROJECT_SETUP_COPY;

/**
 * The AI work environment form. The draft starts from the saved setup; after a save the refetched
 * setup equals the draft again, so "unsaved changes" clears without resetting what is typed.
 */
function EnvironmentForm({
  projectId,
  setup,
  harness,
  candidates,
}: {
  projectId: string;
  setup: ProjectAgentSetupDto;
  harness: HarnessStatusDto | undefined;
  candidates: QueryState<ContextCandidateDto[]>;
}) {
  const saved = useMemo(() => draftFromSetup(setup), [setup]);
  const [draft, setDraft] = useState<SetupDraft>(saved);
  const [errors, setErrors] = useState<SetupErrors>({});
  const [justSaved, setJustSaved] = useState(false);
  const invalidate = useMemo(() => isProjectSetupPath(projectId), [projectId]);
  const save = useSetupAction(updateProjectSetup, invalidate);
  const dirty = !sameDraft(draft, saved);

  const change = (patch: Partial<SetupDraft>) => {
    setJustSaved(false);
    setDraft((d) => ({ ...d, ...patch }));
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const r = draftToRequest(draft, candidates.data);
    if (!r.ok) {
      setErrors(r.errors);
      return;
    }
    setErrors({});
    if ((await save.run(projectId, r.request)) !== null) setJustSaved(true);
  };

  return (
    <form
      noValidate
      aria-label={C.settings.environment}
      onSubmit={(e) => void submit(e)}
      className="flex flex-col gap-8 [&>section+section]:border-t [&>section+section]:border-line [&>section+section]:pt-8"
    >
      <FormSection
        title={C.agents.title}
        description={C.agents.description}
        testId="settings-agents"
      >
        <AgentFields draft={draft} errors={errors} onChange={change} />
      </FormSection>
      <FormSection
        title={C.allowlist.title}
        description={C.allowlist.description}
        testId="settings-allowlist"
      >
        <AllowlistFields draft={draft} onChange={change} harness={harness} />
      </FormSection>
      <FormSection
        title={C.context.title}
        description={C.context.description}
        testId="settings-context"
      >
        <ContextPicker draft={draft} errors={errors} onChange={change} candidates={candidates} />
      </FormSection>
      <ActionError error={save.error} message={C.settings.saveFailed} />
      <div className="sticky bottom-0 -mx-5 -mb-5 flex flex-wrap items-center gap-3 rounded-b-card border-t border-line bg-panel/95 px-5 py-3 backdrop-blur">
        <Button type="submit" variant="primary" disabled={!dirty || save.pending}>
          {save.pending ? C.settings.saving : C.settings.save}
        </Button>
        {dirty ? (
          <>
            <Button
              variant="quiet"
              onClick={() => {
                setDraft(saved);
                setErrors({});
              }}
              disabled={save.pending}
            >
              {C.settings.reset}
            </Button>
            <span className="text-caption text-dim">{C.settings.unsaved}</span>
          </>
        ) : justSaved ? (
          <span role="status" className="inline-flex items-center gap-1.5 text-success">
            <CheckIcon size={16} />
            {C.settings.saved}
          </span>
        ) : null}
      </div>
    </form>
  );
}

function HarnessCard({
  projectId,
  harness,
  contextFiles,
}: {
  projectId: string;
  harness: QueryState<HarnessStatusDto>;
  contextFiles: readonly string[] | undefined;
}) {
  return (
    <Card title={C.harness.title} description={C.harness.description} testId="settings-harness">
      <QueryView query={harness}>
        {(h) => (
          <div className="flex flex-col gap-6">
            <HarnessStatusView harness={h} />
            <HarnessCheckList harness={h} />
            {contextFiles !== undefined ? (
              <div className="flex flex-col gap-1.5">
                <h4 className="font-medium">{C.harness.contextFiles}</h4>
                {contextFiles.length === 0 ? (
                  <p className="text-dim">{C.harness.noContextFiles}</p>
                ) : (
                  <ul className="flex flex-wrap gap-1.5">
                    {contextFiles.map((f) => (
                      <li
                        key={f}
                        className="rounded bg-sunken px-1.5 py-0.5 font-mono text-caption"
                      >
                        {f}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ) : null}
            <RunChecksNow projectId={projectId} harness={h} />
            <HarnessTicketAction projectId={projectId} prominent={h.state === 'none'} />
          </div>
        )}
      </QueryView>
    </Card>
  );
}

function SettingsBody({ project }: { project: ProjectDto }) {
  const id = project.id;
  const setup = useApiQuery(projectSetupPaths.setup(id), projectSetupSchemas.setup);
  const harness = useApiQuery(projectSetupPaths.harness(id), projectSetupSchemas.harness);
  const candidates = useApiQuery(
    projectSetupPaths.contextCandidates(id),
    projectSetupSchemas.contextCandidates,
  );
  return (
    <div className="flex max-w-4xl flex-col gap-6">
      <PageHeader
        eyebrow={<a href={href.project(id)}>← {C.settings.back(project.name)}</a>}
        title={C.settings.title(project.name)}
        description={C.settings.description}
      />
      <Card
        title={C.settings.environment}
        description={C.settings.environmentDescription}
        testId="settings-environment"
      >
        <QueryView query={setup}>
          {(s) => (
            <EnvironmentForm
              projectId={id}
              setup={s}
              harness={harness.data}
              candidates={candidates}
            />
          )}
        </QueryView>
      </Card>
      <HarnessCard projectId={id} harness={harness} contextFiles={setup.data?.contextFiles} />
      <Card title={C.settings.danger} testId="settings-danger" className="border-danger/30">
        <p className="max-w-3xl text-dim">{C.settings.dangerText}</p>
      </Card>
    </div>
  );
}

/** `#/projects/:id/settings`: the project's AI work environment, harness and danger zone (§5.4). */
export function ProjectSettings({ id }: { id: string }) {
  const project = useApiQuery(paths.project(id), schemas.project);
  return <QueryView query={project}>{(p) => <SettingsBody project={p} />}</QueryView>;
}
