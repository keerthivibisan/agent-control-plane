import { approvalsOf, type WorkflowGraph } from '@acp/core';
import type { WorkflowGraphDto } from '@acp/core/api';
import { useCallback, useEffect, useMemo, useReducer, useState, type ReactNode } from 'react';
import { Button } from '../../components/Button';
import { Details } from '../../components/Details';
import { ErrorNotice } from '../../components/ErrorNotice';
import { AlertIcon, CheckIcon } from '../../components/icons';
import { InfoTip } from '../../components/InfoTip';
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
import { EDITOR_COPY } from './editor/copy';
import { EdgePanel } from './editor/EdgePanel';
import type { BlockContext } from './editor/flow';
import { GraphEditor, type FocusRequest } from './editor/GraphEditor';
import { editorIssues, hasErrors } from './editor/issues';
import { IssueCounter, IssuesList, type EditorIssue } from './editor/IssuesList';
import { NodePanel, type NodePanelContext } from './editor/NodePanel';
import { saveWorkflowGraph } from './editor/save';
import { editorReducer, initialEditorState, sameGraph, type Selection } from './editor/state';
import { TemplatePicker } from './editor/TemplatePicker';
import { useUnsavedGuard } from './editor/useUnsavedGuard';
import { ProjectDefaults } from './ProjectDefaults';

const G = WORKFLOW_GRAPH_COPY;
const S = WORKFLOW_GRAPH_COPY.save;
const H = EDITOR_COPY.header;

/** The last save the server refused: its error, and its issues for the graph that was sent. */
interface Refused {
  error: ApiError;
  graph: WorkflowGraph;
  issues: EditorIssue[] | null;
}

/**
 * How far below the top bar a sticky header sits: under the demo banner too, when there is one
 * (the shell's banner is sticky under the top bar; real projects have none). Measured, because the
 * banner's height follows its text; re-measured on scroll and resize, which is cheap and enough.
 */
function useBannerOffset(): number {
  const [offset, setOffset] = useState(0);
  useEffect(() => {
    const measure = () => {
      const banner = document.querySelector('[data-testid="demo-banner"]');
      setOffset(banner === null ? 0 : Math.round(banner.getBoundingClientRect().height));
    };
    measure();
    window.addEventListener('scroll', measure, { passive: true });
    window.addEventListener('resize', measure);
    return () => {
      window.removeEventListener('scroll', measure);
      window.removeEventListener('resize', measure);
    };
  }, []);
  return offset;
}

/**
 * The page's header, GitHub-like and sticky under the top bar: the title, its one line and ⓘ, and
 * on the right the problems count, Templates and Save / Discard, so saving is always in reach.
 */
function EditorHeader({ actions, status }: { actions: ReactNode; status: ReactNode }) {
  const offset = useBannerOffset();
  return (
    <header
      className="sticky z-10 -mt-2 flex flex-col gap-3 border-b border-line bg-canvas pt-2 pb-4 sm:flex-row sm:flex-wrap sm:items-end sm:gap-x-6"
      style={{ top: `calc(var(--spacing-topbar) + ${offset}px)` }}
      data-testid="workflow-header"
    >
      <div className="min-w-0 sm:flex-[1_1_18rem]">
        <h1 className="flex items-center gap-2 text-page font-semibold break-words">
          <span className="min-w-0">{WORKFLOW_COPY.title}</span>
          <InfoTip tip={G.tip} label={WORKFLOW_COPY.title} />
        </h1>
        <p className="mt-1 max-w-3xl text-dim">{G.description}</p>
      </div>
      <div className="flex flex-col items-start gap-1.5 sm:items-end">
        <div className="flex flex-wrap items-center gap-2">{actions}</div>
        {status}
      </div>
    </header>
  );
}

/**
 * The editor (v0.3.0 D-C): a sticky header with Save; the canvas box (Add block, the legend, How
 * this works, zoom) and beside it the selected block's or link's settings, or the problems list
 * when nothing is selected; the project defaults below. The graph being edited is a reducer over
 * the saved graph, and the problems are checked live with core's validator. Like the settings
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
  const errorCount = issues.filter((i) => i.severity === 'error').length;
  const warningCount = issues.length - errorCount;
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
    if (result.ok) {
      setStored(sent);
    } else {
      setRefused({ error: result.error, graph: sent, issues: result.issues });
      // The server's own issues are in the problems list: show it.
      if (result.issues !== null && result.issues.length > 0) {
        dispatch({ type: 'select', selection: null });
      }
    }
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

  const showProblems = () => {
    close();
    // Below 1200px the list sits under the canvas: bring it into view.
    requestAnimationFrame(() =>
      document
        .querySelector('[data-testid="issues"]')
        ?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }),
    );
  };

  const status = blocked ? (
    <span
      id="workflow-save-blocked"
      className="text-caption text-danger"
      data-testid="save-blocked"
    >
      {S.blocked}
    </span>
  ) : dirty ? (
    <span className="inline-flex items-center gap-1.5 text-caption text-dim" data-testid="unsaved">
      <span aria-hidden="true" className="size-1.5 rounded-full bg-warning" />
      {S.unsaved}
    </span>
  ) : justSaved ? (
    <span
      role="status"
      data-testid="saved"
      className="inline-flex items-center gap-1.5 text-caption font-medium text-success"
    >
      <CheckIcon size={15} />
      {S.saved}
    </span>
  ) : null;

  return (
    <div className="flex flex-col gap-4">
      <EditorHeader
        status={
          // "Unsaved changes" stays readable next to the blocked note.
          blocked && dirty ? (
            <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span
                className="inline-flex items-center gap-1.5 text-caption text-dim"
                data-testid="unsaved"
              >
                <span aria-hidden="true" className="size-1.5 rounded-full bg-warning" />
                {S.unsaved}
              </span>
              {status}
            </span>
          ) : (
            status
          )
        }
        actions={
          <>
            <Button
              onClick={showProblems}
              aria-label={H.problemsLabel(errorCount, warningCount)}
              data-testid="problems-button"
              data-errors={errorCount}
              data-warnings={warningCount}
            >
              {H.problems}
              <IssueCounter errors={errorCount} warnings={warningCount} />
            </Button>
            <Button onClick={() => setTemplates(true)} data-testid="open-templates">
              {G.templates.button}
            </Button>
            {dirty ? (
              <Button
                onClick={() => {
                  setRefused(null);
                  dispatch({ type: 'replace', graph: dto.graph });
                }}
                disabled={pending}
                data-testid="discard-workflow"
              >
                {S.discard}
              </Button>
            ) : null}
            <Button
              variant="primary"
              onClick={() => void save()}
              disabled={!dirty || blocked || pending}
              aria-describedby={blocked ? 'workflow-save-blocked' : undefined}
              data-testid="save-workflow"
            >
              {pending ? S.saving : S.save}
            </Button>
          </>
        }
      />
      {refused !== null ? (
        <div className="flex flex-col gap-1.5" data-testid="save-refusal">
          <p
            role="alert"
            className="flex items-start gap-2 rounded-card border border-danger/30 bg-danger-soft px-4 py-3 text-danger"
          >
            <AlertIcon size={15} className="mt-0.5 shrink-0" />
            <span className="min-w-0">
              {S.refused}{' '}
              {refused.issues === null || refused.issues.length === 0
                ? refusalMessage(refused.error)
                : null}
            </span>
          </p>
          <Details>
            <ErrorNotice error={refused.error} />
          </Details>
        </div>
      ) : null}
      <div className="grid grid-cols-1 items-start gap-4 min-[1200px]:grid-cols-[minmax(0,1fr)_21rem]">
        <GraphEditor
          graph={graph}
          selection={selection}
          issues={issues}
          context={context}
          refusal={state.refusal}
          dispatch={dispatch}
          focus={focus}
        />
        <div className="flex min-w-0 flex-col gap-4">
          {node !== undefined || edge !== undefined ? (
            <aside
              aria-label={G.panel.label}
              data-testid="block-panel"
              className="min-w-0 rounded-card border border-line bg-panel shadow-card"
            >
              {node !== undefined ? (
                <div key={node.id} className="animate-fade-in">
                  <NodePanel
                    node={node}
                    graph={graph}
                    ctx={context}
                    issues={issues.filter((i) => i.nodeId === node.id && i.edgeId === undefined)}
                    dispatch={dispatch}
                    onClose={close}
                  />
                </div>
              ) : edge !== undefined ? (
                <div key={edge.id} className="animate-fade-in">
                  <EdgePanel
                    edge={edge}
                    graph={graph}
                    issues={issues.filter((i) => i.edgeId === edge.id)}
                    dispatch={dispatch}
                    onClose={close}
                  />
                </div>
              ) : null}
            </aside>
          ) : (
            <IssuesList issues={issues} serverIssues={serverIssues} onFocus={focusOn} />
          )}
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
      {q.data === undefined ? (
        <PageHeader title={WORKFLOW_COPY.title} tip={G.tip} description={G.description} />
      ) : null}
      <QueryView query={q} loading={G.loading}>
        {(dto) => <WorkflowEditor projectId={projectId} dto={dto} />}
      </QueryView>
    </div>
  );
}
