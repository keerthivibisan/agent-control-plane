import type { WorkflowStageId } from '@acp/core';
import type { ProjectWorkflowDto } from '@acp/core/api';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { Details } from '../../components/Details';
import { ErrorNotice } from '../../components/ErrorNotice';
import { CheckIcon } from '../../components/icons';
import { PageHeader } from '../../components/PageHeader';
import { QueryView } from '../../components/QueryView';
import {
  isWorkflowPath,
  updateProjectSetup,
  updateWorkflow,
  workflowPaths,
  workflowSchemas,
  type ApiError,
} from '../../lib/api';
import { WORKFLOW_COPY } from '../../lib/copy';
import { useApiQuery } from '../../lib/query';
import { useSetupAction } from '../project-setup/actions';
import { AgentFiles } from './AgentFiles';
import {
  limitsDraft,
  refusalMessage,
  sameLimits,
  sameWorkflow,
  setupRequest,
  setupView,
  workflowDraft,
  workflowRequest,
  workflowView,
  type DraftErrors,
  type LimitsDraft,
  type WorkflowDraft,
} from './draft';
import { AGENT_STAGES, buildWorkflowGraph } from './graph';
import { StageFields, StageHeading } from './StagePanel';
import { WorkflowGraph, WorkflowLegend } from './WorkflowGraph';

const C = WORKFLOW_COPY;
const P = WORKFLOW_COPY.panel;

function Refusal({
  error,
  part,
  note,
}: {
  error: ApiError;
  part: string;
  note?: string | undefined;
}) {
  return (
    <div className="flex flex-col gap-1.5" data-testid="save-refusal">
      <p
        role="alert"
        className="rounded-control border border-danger/30 bg-danger-soft px-3 py-2 text-danger"
      >
        {part} {refusalMessage(error)}
        {note ? <span className="mt-1 block text-caption text-dim">{note}</span> : null}
      </p>
      <Details>
        <ErrorNotice error={error} />
      </Details>
    </div>
  );
}

/**
 * The editor: drafts of the stage settings and of the helper limits, the graph built from those
 * drafts (so a change shows at once), and the panel of the selected stage. Like the settings page,
 * the drafts start from the saved values; after a save the refetched values equal the drafts, so
 * "unsaved changes" clears without resetting what is typed.
 */
function WorkflowEditor({ projectId, dto }: { projectId: string; dto: ProjectWorkflowDto }) {
  const savedWorkflow = useMemo(() => workflowDraft(dto.workflow), [dto.workflow]);
  const savedLimits = useMemo(() => limitsDraft(dto.setup), [dto.setup]);
  const [workflow, setWorkflow] = useState<WorkflowDraft>(savedWorkflow);
  const [limits, setLimits] = useState<LimitsDraft>(savedLimits);
  const [selected, setSelected] = useState<WorkflowStageId | null>(null);
  const [errors, setErrors] = useState<DraftErrors>({});
  const [justSaved, setJustSaved] = useState(false);
  /** The last save stored the stage settings but the limits were refused. */
  const [partial, setPartial] = useState(false);
  const invalidate = useMemo(() => isWorkflowPath(projectId), [projectId]);
  const saveWorkflow = useSetupAction(updateWorkflow, invalidate);
  const saveSetup = useSetupAction(updateProjectSetup, invalidate);
  const panelRef = useRef<HTMLElement>(null);
  // The project's agent files (R-D's route): offered per stage, and a named file that is gone is
  // flagged. Undefined while loading or not served, so nothing is flagged without a list.
  const agentFiles = useApiQuery(workflowPaths.agents(projectId), workflowSchemas.agents).data;

  const workflowDirty = !sameWorkflow(workflow, savedWorkflow);
  const limitsDirty = !sameLimits(limits, savedLimits);
  const dirty = workflowDirty || limitsDirty;
  const pending = saveWorkflow.pending || saveSetup.pending;

  const view = useMemo(() => workflowView(workflow), [workflow]);
  const drafted = useMemo(() => ({ ...dto.workflow, ...view }), [dto.workflow, view]);
  const graph = useMemo(
    () => buildWorkflowGraph(view, setupView(dto.setup, limits), dto.skills, C.edges, agentFiles),
    [view, limits, dto.setup, dto.skills, agentFiles],
  );

  const select = useCallback((stage: WorkflowStageId) => setSelected(stage), []);

  // Below the wide layout the panel sits under the graph: bring it into view when a stage opens.
  useEffect(() => {
    const el = panelRef.current;
    if (selected === null || el === null || typeof el.scrollIntoView !== 'function') return;
    if (el.getBoundingClientRect().top > window.innerHeight - 120) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, [selected]);

  const changeWorkflow = (next: WorkflowDraft) => {
    setJustSaved(false);
    setWorkflow(next);
  };
  const changeLimits = (patch: Partial<LimitsDraft>) => {
    setJustSaved(false);
    setLimits((l) => ({ ...l, ...patch }));
  };

  const save = async () => {
    const wf = workflowRequest(workflow);
    const lim = setupRequest(dto.setup, limits);
    const found: DraftErrors = { ...(wf.ok ? {} : wf.errors), ...(lim.ok ? {} : lim.errors) };
    if (!wf.ok || !lim.ok) {
      setErrors(found);
      const first = found.budget !== undefined ? 'helpers' : AGENT_STAGES.find((s) => found[s]);
      if (first !== undefined) setSelected(first);
      return;
    }
    setErrors({});
    setPartial(false);
    // Stage settings first: a refused limits save then leaves only the limits to retry.
    if (workflowDirty && (await saveWorkflow.run(projectId, wf.request)) === null) return;
    if (limitsDirty && (await saveSetup.run(projectId, lim.request)) === null) {
      setPartial(workflowDirty);
      return;
    }
    setJustSaved(true);
  };

  const discard = () => {
    setWorkflow(savedWorkflow);
    setLimits(savedLimits);
    setErrors({});
  };

  return (
    <div className="grid grid-cols-1 items-start gap-6 min-[1360px]:grid-cols-[minmax(0,1fr)_23rem]">
      {/* The flow sentence is the title's ⓘ, so the graph starts higher on the page. */}
      <Card title={C.graphTitle} tip={C.flowSentence} padded={false} testId="workflow-card">
        <div className="px-3 pt-2">
          <WorkflowGraph graph={graph} selected={selected} onSelect={select} />
        </div>
        <div className="border-t border-line px-6 py-4">
          <WorkflowLegend />
        </div>
      </Card>
      <div className="flex min-w-0 flex-col gap-6">
        <aside
          ref={panelRef}
          aria-label={P.label}
          data-testid="stage-panel"
          data-stage={selected ?? undefined}
          className="scroll-mt-24 rounded-card border border-line bg-panel shadow-card"
        >
          <div className="flex flex-col gap-5 px-6 pt-5 pb-6">
            {selected === null ? (
              <p className="text-dim">{P.empty}</p>
            ) : (
              <>
                <div className="flex items-start gap-3">
                  <StageHeading stage={selected} workflow={workflow} />
                  <button
                    type="button"
                    onClick={() => setSelected(null)}
                    aria-label={P.close}
                    title={P.close}
                    className="ml-auto inline-flex size-8 shrink-0 items-center justify-center rounded-control text-dim hover:bg-sunken hover:text-ink"
                  >
                    <span aria-hidden="true" className="text-lg leading-none">
                      ×
                    </span>
                  </button>
                </div>
                <StageFields
                  projectId={projectId}
                  stage={selected}
                  workflow={workflow}
                  limits={limits}
                  setup={dto.setup}
                  skills={dto.skills}
                  agentFiles={agentFiles}
                  errors={errors}
                  onWorkflow={changeWorkflow}
                  onLimits={changeLimits}
                />
              </>
            )}
          </div>
          {dirty || justSaved || saveWorkflow.error || saveSetup.error ? (
            <div className="sticky bottom-0 flex flex-col gap-3 rounded-b-card border-t border-line bg-panel/95 px-6 py-4 backdrop-blur">
              {saveWorkflow.error ? (
                <Refusal error={saveWorkflow.error} part={C.refusals.workflow} />
              ) : null}
              {saveSetup.error ? (
                <Refusal
                  error={saveSetup.error}
                  part={C.refusals.limits}
                  note={partial ? C.refusals.workflowSavedFirst : undefined}
                />
              ) : null}
              <div className="flex flex-wrap items-center gap-3">
                <Button variant="primary" onClick={() => void save()} disabled={!dirty || pending}>
                  {pending ? P.saving : P.save}
                </Button>
                {dirty ? (
                  <>
                    <Button variant="quiet" onClick={discard} disabled={pending}>
                      {P.discard}
                    </Button>
                    <span className="text-caption text-dim" data-testid="unsaved">
                      {P.unsaved}
                    </span>
                  </>
                ) : justSaved ? (
                  <span
                    role="status"
                    data-testid="saved"
                    className="inline-flex items-center gap-1.5 text-success"
                  >
                    <CheckIcon size={16} />
                    {P.saved}
                  </span>
                ) : null}
              </div>
            </div>
          ) : null}
        </aside>
        {/* "Used by" follows the draft, like the graph. */}
        <AgentFiles projectId={projectId} workflow={drafted} onSelect={select} />
      </div>
    </div>
  );
}

/** `#/p/:projectId/workflow`: how agents work on a ticket (docs/redesign/README.md §4.2). */
export function WorkflowPage({ projectId }: { projectId: string }) {
  const q = useApiQuery(workflowPaths.workflow(projectId), workflowSchemas.workflow);
  return (
    <div className="flex flex-col">
      <PageHeader title={C.title} tip={C.tip} description={C.description} />
      <QueryView query={q} loading={C.loading}>
        {(dto) => <WorkflowEditor projectId={projectId} dto={dto} />}
      </QueryView>
    </div>
  );
}
