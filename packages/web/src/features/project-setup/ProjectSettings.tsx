import { approvalsOf } from '@acp/core';
import type { ContextCandidateDto, ProjectAgentSetupDto, ProjectDto } from '@acp/core/api';
import { useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { Button, ButtonLink } from '../../components/Button';
import { Card } from '../../components/Card';
import { AlertIcon, CheckIcon, HarnessIcon, WorkflowIcon } from '../../components/icons';
import { ApprovalsIcon } from '../review-loop/icons';
import { labelClass } from '../../components/Input';
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
import { PROJECT_SETUP_COPY, REVIEW_LOOP_COPY } from '../../lib/copy';
import { useApiQuery } from '../../lib/query';
import type { QueryState } from '../../lib/query-store';
import { href } from '../../lib/router';
import { ActionError } from '../control/bits';
import { useSetupAction } from './actions';
import { TextField } from './fields';
import { ContextPicker } from './SetupSections';
import { draftFromSetup, draftToRequest, type SetupDraft, type SetupErrors } from './setup-form';

const C = PROJECT_SETUP_COPY;
const S = PROJECT_SETUP_COPY.settings;

/**
 * What Settings edits (docs/redesign/README.md §4.7): the board key, the project's default model
 * and the context files. Agent limits and the allowlist moved to the Workflow page.
 */
type SettingsDraft = Pick<SetupDraft, 'projectKey' | 'model' | 'contextFiles'>;

function pickDraft(setup: ProjectAgentSetupDto): SettingsDraft {
  const { projectKey, model, contextFiles } = draftFromSetup(setup);
  return { projectKey, model, contextFiles };
}

function sameSettings(a: SettingsDraft, b: SettingsDraft): boolean {
  return (
    a.projectKey === b.projectKey &&
    a.model === b.model &&
    a.contextFiles.length === b.contextFiles.length &&
    a.contextFiles.every((f, i) => f === b.contextFiles[i])
  );
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <dt className={labelClass}>{label}</dt>
      <dd className="min-w-0 break-words text-dim">{children}</dd>
    </div>
  );
}

/**
 * The project and context cards in one form. The PUT body is the setup as saved now with only
 * these fields changed, so a limit saved on the Workflow page meanwhile is never overwritten.
 */
function SettingsForm({
  project,
  setup,
  candidates,
}: {
  project: ProjectDto;
  setup: ProjectAgentSetupDto;
  candidates: QueryState<ContextCandidateDto[]>;
}) {
  const saved = useMemo(() => pickDraft(setup), [setup]);
  const [draft, setDraft] = useState<SettingsDraft>(saved);
  const [errors, setErrors] = useState<SetupErrors>({});
  const [justSaved, setJustSaved] = useState(false);
  const invalidate = useMemo(() => isProjectSetupPath(project.id), [project.id]);
  const save = useSetupAction(updateProjectSetup, invalidate);
  const dirty = !sameSettings(draft, saved);

  const change = (patch: Partial<SetupDraft>) => {
    setJustSaved(false);
    setDraft((d) => ({ ...d, ...patch }));
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const r = draftToRequest({ ...draftFromSetup(setup), ...draft }, candidates.data);
    if (!r.ok) {
      setErrors(r.errors);
      return;
    }
    setErrors({});
    if ((await save.run(project.id, r.request)) !== null) setJustSaved(true);
  };

  return (
    <form
      noValidate
      aria-label={S.formLabel}
      onSubmit={(e) => void submit(e)}
      className="flex flex-col gap-6"
    >
      <Card title={S.project.title} description={S.project.description} testId="settings-project">
        <div className="flex flex-col gap-6">
          <dl className="grid gap-6 sm:grid-cols-2">
            <Fact label={S.project.name}>{project.name}</Fact>
            <Fact label={S.project.folder}>
              <span className="font-mono text-caption">{project.rootPath}</span>
            </Fact>
          </dl>
          <div className="grid gap-6 sm:grid-cols-2">
            <TextField
              label={S.project.boardKey}
              hint={S.project.boardKeyHint}
              error={errors.projectKey}
              value={draft.projectKey}
              onChange={(v) => change({ projectKey: v.toUpperCase() })}
              placeholder="WEB"
              mono
              inputClassName="max-w-32 uppercase"
            />
            <TextField
              label={S.project.model}
              hint={S.project.modelHint}
              error={errors.model}
              value={draft.model}
              onChange={(v) => change({ model: v })}
              placeholder={C.agents.modelPlaceholder}
              mono
            />
          </div>
        </div>
      </Card>
      <Card title={C.context.title} description={C.context.description} testId="settings-context">
        <ContextPicker
          draft={{ ...draftFromSetup(setup), ...draft }}
          errors={errors}
          onChange={change}
          candidates={candidates}
        />
      </Card>
      <ActionError error={save.error} message={S.saveFailed} />
      <div className="flex flex-wrap items-center gap-3" data-testid="settings-save">
        <Button type="submit" variant="primary" disabled={!dirty || save.pending}>
          {save.pending ? S.saving : S.save}
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
              {S.reset}
            </Button>
            <span className="text-caption text-dim">{S.unsaved}</span>
          </>
        ) : justSaved ? (
          <span role="status" className="inline-flex items-center gap-1.5 text-success">
            <CheckIcon size={16} />
            {S.saved}
          </span>
        ) : null}
      </div>
    </form>
  );
}

/** One line that says where a setting lives now, with a link there. */
function MovedRow({
  icon,
  text,
  link,
  to,
  testId,
}: {
  icon: ReactNode;
  text: string;
  link: string;
  to: string;
  testId: string;
}) {
  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3" data-testid={testId}>
      <span
        aria-hidden="true"
        className="flex size-8 shrink-0 items-center justify-center rounded-control border border-line bg-sunken text-dim"
      >
        {icon}
      </span>
      <span className="min-w-0 flex-1">{text}</span>
      <ButtonLink href={to} size="sm">
        {link}
      </ButtonLink>
    </li>
  );
}

/**
 * The project's approvals in one line (ADR-0021), read-only: they are edited on the Workflow page,
 * with the helper limits.
 */
function approvalsSummary(setup: ProjectAgentSetupDto): string {
  const A = REVIEW_LOOP_COPY.approvals;
  const { mode, commands } = approvalsOf(setup);
  const text = A.summary(REVIEW_LOOP_COPY.modes.word[mode]);
  return mode === 'auto' ? `${text} ${A.summaryCommands(commands.length)}` : text;
}

function SettingsBody({ project }: { project: ProjectDto }) {
  const id = project.id;
  const setup = useApiQuery(projectSetupPaths.setup(id), projectSetupSchemas.setup);
  const candidates = useApiQuery(
    projectSetupPaths.contextCandidates(id),
    projectSetupSchemas.contextCandidates,
  );
  return (
    <div className="max-w-4xl">
      <PageHeader title={S.title} tip={S.tip} description={S.description} />
      <div className="flex flex-col gap-6">
        <QueryView query={setup}>
          {(s) => <SettingsForm project={project} setup={s} candidates={candidates} />}
        </QueryView>
        <Card title={S.elsewhere.title} testId="settings-elsewhere">
          <ul className="-my-3 flex flex-col divide-y divide-line">
            <MovedRow
              icon={<WorkflowIcon size={16} />}
              text={S.elsewhere.workflow}
              link={S.elsewhere.workflowLink}
              to={href.projectPage(id, 'workflow')}
              testId="settings-workflow-link"
            />
            {setup.data !== undefined ? (
              <MovedRow
                icon={<ApprovalsIcon size={16} />}
                text={approvalsSummary(setup.data)}
                link={REVIEW_LOOP_COPY.approvals.summaryLink}
                to={href.projectPage(id, 'workflow')}
                testId="settings-approvals"
              />
            ) : null}
            <MovedRow
              icon={<HarnessIcon size={16} />}
              text={S.elsewhere.harness}
              link={S.elsewhere.harnessLink}
              to={href.projectPage(id, 'harness')}
              testId="settings-harness-link"
            />
          </ul>
        </Card>
        <Card title={S.danger} testId="settings-danger" className="border-danger/30">
          <p className="flex items-start gap-2.5 rounded-control border border-danger/20 bg-danger-soft/50 px-3 py-2.5 text-dim">
            <AlertIcon size={16} className="mt-0.5 shrink-0 text-danger" />
            <span>{S.dangerText}</span>
          </p>
        </Card>
      </div>
    </div>
  );
}

/**
 * `#/p/:projectId/settings` (docs/redesign/README.md §4.7): the project's name and folder, its
 * board key and default model, the context files, links to where limits and checks live now, and
 * the danger zone.
 */
export function ProjectSettings({ id }: { id: string }) {
  const project = useApiQuery(paths.project(id), schemas.project);
  return <QueryView query={project}>{(p) => <SettingsBody project={p} />}</QueryView>;
}
