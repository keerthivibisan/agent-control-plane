import { approvalsOf, type WorkflowGraph } from '@acp/core';
import type { WorkflowGraphDto } from '@acp/core/api';
import { useCallback, useMemo, useReducer, useState } from 'react';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { Details } from '../../components/Details';
import { ErrorNotice } from '../../components/ErrorNotice';
import { AlertIcon, CheckIcon } from '../../components/icons';
import { PageHeader } from '../../components/PageHeader';
import { QueryView } from '../../components/QueryView';
import {
  isWorkflowGraphPath,
  workflowGraphPaths,
  workflowGraphSchemas,
  workflowPaths,
  workflowSchemas,
  type ApiError,
} from '../../lib/api';
import { WORKFLOW_COPY, WORKFLOW_GRAPH_COPY } from '../../lib/copy';
import { useApiQuery, useQueryStore } from '../../lib/query';
import { refusalMessage } from './draft';
import { EdgePanel } from './editor/EdgePanel';
import type { BlockContext } from './editor/flow';
import { GraphEditor, LinkSample, type FocusRequest } from './editor/GraphEditor';
import { editorIssues, hasErrors } from './editor/issues';
import { IssuesList, type EditorIssue } from './editor/IssuesList';
import { NodePanel, type NodePanelContext } from './editor/NodePanel';
import { Palette } from './editor/Palette';
import { saveWorkflowGraph } from './editor/save';
import { editorReducer, initialEditorState, sameGraph, type Selection } from './editor/state';
import { TemplatePicker } from './editor/TemplatePicker';
import { useUnsavedGuard } from './editor/useUnsavedGuard';
import { PickStageIcon } from './icons';
import { ProjectDefaults } from './ProjectDefaults';

const G = WORKFLOW_GRAPH_COPY;
const S = WORKFLOW_GRAPH_COPY.save;

/** The last save the server refused: its error, and its issues for the graph that was sent. */
interface Refused {
  error: ApiError;
  graph: WorkflowGraph;
  issues: EditorIssue[] | null;
}

function Legend() {
  return (
    <ul
      className="flex flex-wrap items-center gap-x-5 gap-y-2 text-caption text-dim"
      aria-label={G.legend.label}
      data-testid="workflow-legend"
    >
      {(['flow', 'assigns', 'review', 'findings', 'rework', 'merge'] as const).map((t) => (
        <li key={t} className="flex items-center gap-2">
          <LinkSample type={t} />
          {G.edges[t]}
        </li>
      ))}
      <li className="flex items-center gap-2">
        <span
          aria-hidden="true"
          className="inline-block h-3.5 w-5 shrink-0 rounded-[2px] border border-line-strong bg-panel"
        />
        {G.legend.agent}
      </li>
      <li className="flex items-center gap-2">
        <span
          aria-hidden="true"
          className="inline-block h-3.5 w-5 shrink-0 rounded-[2px] border border-line-strong bg-sunken"
        />
        {G.legend.you}
      </li>
    </ul>
  );
}

/**
 * The editor: the graph being edited (a reducer over the saved graph), the problems checked live
 * with core's validator, the selected block's or link's settings, and Save. Like the settings
 * page, the editor starts from the saved graph, and after a save the refetched graph equals it,
 * so "Unsaved changes" clears without resetting the canvas.
 */
function WorkflowEditor({ projectId, dto }: { projectId: string; dto: WorkflowGraphDto }) {
  const store = useQueryStore();
  const [state, dispatch] = useReducer(editorReducer, dto.graph, initialEditorState);
  const [templates, setTemplates] = useState(false);
  const [focus, setFocus] = useState<FocusRequest | null>(null);
  const [pending, setPending] = useState(false);
  const [refused, setRefused] = useState<Refused | null>(null);
  /** The graph the last save stored, until the refetch brings it back as `dto.graph`. */
  const [stored, setStored] = useState<WorkflowGraph | null>(null);
  const agentFiles = useApiQuery(workflowPaths.agents(projectId), workflowSchemas.agents).data;

  const graph = state.graph;
  const projectMode = approvalsOf(dto.setup).mode;
  const helperLimit = dto.setup.maxConcurrentHelpers;
  const issues = useMemo(
    () =>
      editorIssues(graph, {
        skills: dto.skills,
        agents: dto.agents,
        maxConcurrentHelpers: helperLimit,
        projectMode,
      }),
    [graph, dto.skills, dto.agents, helperLimit, projectMode],
  );
  const blocked = hasErrors(issues);
  const dirty = !sameGraph(graph, dto.graph) && !(stored !== null && sameGraph(graph, stored));
  useUnsavedGuard(dirty, S.leave);

  const agentModels = useMemo(
    () =>
      agentFiles === undefined ? undefined : new Map(agentFiles.map((f) => [f.name, f.model])),
    [agentFiles],
  );
  const context: BlockContext & NodePanelContext = useMemo(
    () => ({
      projectId,
      skills: dto.skills,
      agents: dto.agents,
      agentModels,
      projectModel: dto.setup.model,
      projectMode,
      helperLimit,
    }),
    [projectId, dto.skills, dto.agents, agentModels, dto.setup.model, projectMode, helperLimit],
  );

  const focusOn = useCallback((selection: NonNullable<Selection>) => {
    dispatch({ type: 'select', selection });
    setFocus((f) => ({ selection, nonce: (f?.nonce ?? 0) + 1 }));
  }, []);

  const save = async () => {
    if (blocked || pending) return;
    setPending(true);
    setRefused(null);
    const sent = graph;
    const result = await saveWorkflowGraph(store.client, projectId, sent);
    setPending(false);
    if (result.ok) setStored(sent);
    else setRefused({ error: result.error, graph: sent, issues: result.issues });
    store.invalidate(isWorkflowGraphPath(projectId));
  };

  const selection = state.selection;
  const node =
    selection?.kind === 'node' ? graph.nodes.find((n) => n.id === selection.id) : undefined;
  const edge =
    selection?.kind === 'edge' ? graph.edges.find((e) => e.id === selection.id) : undefined;
  const close = () => dispatch({ type: 'select', selection: null });
  // A refusal is about the graph that was sent; any change after it may have fixed it.
  const serverIssues = refused !== null && refused.graph === graph ? refused.issues : null;
  const justSaved = !dirty && stored !== null && sameGraph(graph, stored);

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-1 items-start gap-6 min-[1360px]:grid-cols-[minmax(0,1fr)_24rem]">
        <Card
          title={G.canvasTitle}
          tip={G.canvasHint}
          padded={false}
          testId="workflow-card"
          actions={
            <Button size="sm" onClick={() => setTemplates(true)} data-testid="open-templates">
              {G.templates.button}
            </Button>
          }
        >
          <div className="mt-1 border-t border-line px-5 py-3">
            <Palette graph={graph} dispatch={dispatch} />
          </div>
          <div className="border-t border-line">
            <GraphEditor
              graph={graph}
              selection={selection}
              issues={issues}
              context={context}
              refusal={state.refusal}
              dispatch={dispatch}
              focus={focus}
            />
          </div>
          <div className="border-t border-line px-5 py-3.5">
            <Legend />
          </div>
          <div
            className="sticky bottom-0 flex flex-col gap-3 rounded-b-card border-t border-line bg-panel/90 px-5 py-3.5 backdrop-blur-md"
            data-testid="save-bar"
          >
            {refused !== null ? (
              <div className="flex flex-col gap-1.5" data-testid="save-refusal">
                <p
                  role="alert"
                  className="flex items-start gap-2 rounded-control border border-danger/30 bg-danger-soft px-3 py-2 text-danger"
                >
                  <AlertIcon size={15} className="mt-0.5 shrink-0" />
                  <span className="min-w-0">
                    {S.refused} {refused.issues === null ? refusalMessage(refused.error) : null}
                  </span>
                </p>
                <Details>
                  <ErrorNotice error={refused.error} />
                </Details>
              </div>
            ) : null}
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="primary"
                onClick={() => void save()}
                disabled={!dirty || blocked || pending}
                aria-describedby={blocked ? 'workflow-save-blocked' : undefined}
                data-testid="save-workflow"
              >
                {pending ? S.saving : S.save}
              </Button>
              {dirty ? (
                <Button
                  variant="quiet"
                  onClick={() => {
                    setRefused(null);
                    dispatch({ type: 'replace', graph: dto.graph });
                  }}
                  disabled={pending}
                >
                  {S.discard}
                </Button>
              ) : null}
              {blocked ? (
                <span
                  id="workflow-save-blocked"
                  className="text-caption text-danger"
                  data-testid="save-blocked"
                >
                  {S.blocked}
                </span>
              ) : null}
              {dirty ? (
                <span
                  className="ml-auto inline-flex items-center gap-1.5 text-caption text-dim"
                  data-testid="unsaved"
                >
                  <span aria-hidden="true" className="size-1.5 rounded-full bg-warning" />
                  {S.unsaved}
                </span>
              ) : justSaved ? (
                <span
                  role="status"
                  data-testid="saved"
                  className="ml-auto inline-flex items-center gap-1.5 text-caption font-medium text-success"
                >
                  <CheckIcon size={15} />
                  {S.saved}
                </span>
              ) : null}
            </div>
          </div>
        </Card>
        <div className="flex min-w-0 flex-col gap-6">
          <aside
            aria-label={G.panel.label}
            data-testid="block-panel"
            className="rounded-card border border-line bg-panel shadow-card"
          >
            {node !== undefined ? (
              <div key={node.id} className="animate-fade-in">
                <NodePanel
                  node={node}
                  graph={graph}
                  ctx={context}
                  dispatch={dispatch}
                  onClose={close}
                />
              </div>
            ) : edge !== undefined ? (
              <div key={edge.id} className="animate-fade-in">
                <EdgePanel edge={edge} graph={graph} dispatch={dispatch} onClose={close} />
              </div>
            ) : (
              <div className="flex flex-col items-center gap-3 px-6 py-10 text-center">
                <span
                  aria-hidden="true"
                  className="flex size-9 items-center justify-center rounded-control border border-line bg-sunken text-dim"
                >
                  <PickStageIcon size={17} />
                </span>
                <p className="max-w-60 text-dim">{G.panel.empty}</p>
              </div>
            )}
          </aside>
          <IssuesList issues={issues} serverIssues={serverIssues} onFocus={focusOn} />
        </div>
      </div>
      <ProjectDefaults projectId={projectId} setup={dto.setup} />
      {templates ? (
        <TemplatePicker
          graph={graph}
          dirty={dirty}
          projectMode={projectMode}
          onClose={() => setTemplates(false)}
          onApply={(next) => {
            setTemplates(false);
            setRefused(null);
            dispatch({ type: 'replace', graph: next });
          }}
        />
      ) : null}
    </div>
  );
}

/** `#/p/:projectId/workflow`: the project's workflow as an editable graph (ADR-0023). */
export function WorkflowPage({ projectId }: { projectId: string }) {
  const q = useApiQuery(workflowGraphPaths.graph(projectId), workflowGraphSchemas.graph);
  return (
    <div className="flex flex-col">
      <PageHeader title={WORKFLOW_COPY.title} tip={G.tip} description={G.description} />
      <QueryView query={q} loading={G.loading}>
        {(dto) => <WorkflowEditor projectId={projectId} dto={dto} />}
      </QueryView>
    </div>
  );
}
