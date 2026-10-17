import type { WorkflowStageId } from '@acp/core';
import type {
  AgentRunDto,
  ProjectWorkflowDto,
  RunDetailDto,
  RunWorkflowDto,
  WorkflowStageState,
} from '@acp/core/api';
import {
  Background,
  BackgroundVariant,
  Handle,
  Position,
  ReactFlow,
  useReactFlow,
  useStore,
  type NodeMouseHandler,
  type NodeProps,
} from '@xyflow/react';
import { createContext, useContext, useEffect, useMemo, type ReactNode } from 'react';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { AlertIcon } from '../../components/icons';
import { Pill, type PillTone } from '../../components/Pill';
import {
  continueRun,
  runWorkflowPaths,
  runWorkflowSchemas,
  workflowPaths,
  workflowSchemas,
} from '../../lib/api';
import { TICKET_COPY, WORKFLOW_COPY } from '../../lib/copy';
import { useApiQuery } from '../../lib/query';
import { ActionError } from '../control/bits';
import { isAgentLive } from '../control/run-state';
import {
  buildWorkflowGraph,
  stageOfNode,
  type AgentNode,
  type GateNode,
  type HelperNode,
  type HelpersNode,
  type ReviewNode,
  type TerminalNode,
  type WorkflowGraph,
  type WorkflowNode,
} from '../workflow/graph';
import {
  AgentNodeView,
  GateNodeView,
  HelpersNodeView,
  ReviewNodeView,
  TerminalNodeView,
} from '../workflow/WorkflowNodes';
import { useTicketAction } from './actions';
import {
  COMMENTS_ID,
  heldStage,
  runPlannerMode,
  stageStates,
  type PostMergeStage,
} from './ticket-state';

const C = TICKET_COPY.workflow;

/*
 * The ticket page's live workflow (docs/redesign/README.md §4.2): R-B's graph and node views,
 * read-only, with each stage's state from `GET /runs/:id/workflow` drawn around its node. The
 * helpers box holds one summary row; the agent tree under the graph shows each helper.
 */

interface LiveRun {
  states: Readonly<Record<WorkflowStageId, WorkflowStageState>>;
  helpers: readonly AgentRunDto[];
  /** The run completed (every change merged or discarded): the Done node is lit. */
  completed: boolean;
}

const LiveRunContext = createContext<LiveRun | null>(null);

const STATE_TONE: Record<WorkflowStageState, PillTone> = {
  off: 'neutral',
  waiting: 'neutral',
  active: 'accent',
  'needs-you': 'warning',
  done: 'success',
  failed: 'danger',
  skipped: 'neutral',
};

// A 1.5px state outline just outside the square node, with a soft halo; the graph's own
// background (`canvas`) shows between them. Working is the brand's lime (an olive line with a lime
// halo on ivory, lime on graphite); warning and danger only for the real states.
const STATE_RING: Record<WorkflowStageState, string> = {
  off: '',
  waiting: '',
  active:
    'outline-[1.5px] outline-offset-2 outline-accent-fill-edge outline-solid shadow-[0_0_0_6px_color-mix(in_srgb,var(--color-accent-fill)_45%,transparent)] dark:shadow-[0_0_0_6px_color-mix(in_srgb,var(--color-accent-fill)_14%,transparent)]',
  'needs-you':
    'outline-[1.5px] outline-offset-2 outline-warning outline-solid shadow-[0_0_0_6px_color-mix(in_srgb,var(--color-warning)_14%,transparent)]',
  done: '',
  failed:
    'outline-[1.5px] outline-offset-2 outline-danger outline-solid shadow-[0_0_0_6px_color-mix(in_srgb,var(--color-danger)_12%,transparent)]',
  skipped: '',
};

const DONE_RING =
  'outline-[1.5px] outline-offset-2 outline-success outline-solid shadow-[0_0_0_6px_color-mix(in_srgb,var(--color-success)_12%,transparent)]';

/** A stage's node with its state: a ring while it works or waits for you, and a word on top. */
function LiveFrame({ stage, children }: { stage: WorkflowStageId; children: ReactNode }) {
  const live = useContext(LiveRunContext);
  const state = live?.states[stage] ?? 'waiting';
  const faded = state === 'waiting' || state === 'skipped';
  return (
    <div
      className={`relative h-full w-full rounded-[2px] ${STATE_RING[state]}`}
      data-testid={`live-${stage}`}
      data-state={state}
    >
      <div className={`h-full w-full ${faded ? 'opacity-60' : ''}`}>{children}</div>
      {/* "Off" is already on the node itself. */}
      {state === 'off' ? null : (
        <span className="pointer-events-none absolute -top-2.5 right-3 rounded-full bg-panel">
          <Pill tone={STATE_TONE[state]} testId="stage-state-word">
            {C.states[state]}
          </Pill>
        </span>
      )}
    </div>
  );
}

function LiveAgentNode(props: NodeProps<AgentNode>) {
  return (
    <LiveFrame stage={props.data.stage}>
      <AgentNodeView {...props} />
    </LiveFrame>
  );
}

function LiveHelpersNode(props: NodeProps<HelpersNode>) {
  return (
    <LiveFrame stage="helpers">
      <HelpersNodeView {...props} />
    </LiveFrame>
  );
}

function LiveReviewNode(props: NodeProps<ReviewNode>) {
  return (
    <LiveFrame stage="review">
      <ReviewNodeView {...props} />
    </LiveFrame>
  );
}

/** The plan approval belongs to the plan stage: it is ringed while a plan waits for you. */
function LiveGateNode(props: NodeProps<GateNode>) {
  const live = useContext(LiveRunContext);
  const waiting = live?.states.plan === 'needs-you';
  return (
    <div
      className={`h-full w-full rounded-[2px] ${waiting ? STATE_RING['needs-you'] : ''}`}
      data-testid="live-approve"
      data-state={waiting ? 'needs-you' : undefined}
    >
      <GateNodeView {...props} />
    </div>
  );
}

/** The end of the flow: lit, with a "Done" word, once the run completed. */
function LiveTerminalNode(props: NodeProps<TerminalNode>) {
  const live = useContext(LiveRunContext);
  const lit = props.data.terminal === 'done' && live?.completed === true;
  return (
    <div
      className={`relative h-full w-full rounded-full ${lit ? DONE_RING : ''}`}
      data-testid={`live-${props.data.terminal}`}
      data-state={lit ? 'done' : undefined}
    >
      <TerminalNodeView {...props} />
    </div>
  );
}

const HANDLE = 'opacity-0! border-0! size-1.5! min-w-0! min-h-0! pointer-events-none!';

/** The helpers box's one row: how many helpers there are, and how many work or wait for you. */
function LiveHelperRow(_: NodeProps<HelperNode>) {
  const live = useContext(LiveRunContext);
  const helpers = live?.helpers ?? [];
  const working = helpers.filter((a) => isAgentLive(a.status)).length;
  return (
    <div
      className="flex h-full w-full items-center justify-between gap-2 rounded-[2px] border border-line bg-panel px-2.5 text-caption shadow-card"
      data-testid="live-helpers-row"
    >
      <Handle id="in-left" type="target" position={Position.Left} className={HANDLE} />
      <Handle id="out-right" type="source" position={Position.Right} className={HANDLE} />
      {helpers.length === 0 ? (
        <span className="text-dim">{C.helperNone}</span>
      ) : (
        <>
          <span className="font-medium">{TICKET_COPY.summary.agents(helpers.length)}</span>
          {working > 0 ? <span className="text-dim">{C.helpersWorking(working)}</span> : null}
        </>
      )}
    </div>
  );
}

// Module level: React Flow wants the same object on every render.
const liveNodeTypes = {
  agent: LiveAgentNode,
  helpers: LiveHelpersNode,
  helper: LiveHelperRow,
  gate: LiveGateNode,
  review: LiveReviewNode,
  terminal: LiveTerminalNode,
};

const FIT = {
  padding: { top: '56px', right: '24px', bottom: '24px', left: '24px' },
  maxZoom: 1,
} as const;

function FitOnResize() {
  const { fitView } = useReactFlow();
  const width = useStore((s) => s.width);
  const height = useStore((s) => s.height);
  useEffect(() => {
    if (width === 0 || height === 0) return;
    void fitView(FIT);
  }, [fitView, width, height]);
  return null;
}

/**
 * The graph for one run: the project's stages and their models and skills (current settings),
 * the run's planner mode (from its agents) and which optional stages it runs (from the run's own
 * workflow states), with one helper row.
 */
export function liveGraph(
  run: Pick<RunDetailDto, 'agents'>,
  project: ProjectWorkflowDto,
  workflow: RunWorkflowDto,
): WorkflowGraph {
  const states = stageStates(workflow);
  const stages = project.workflow.stages;
  const graph = buildWorkflowGraph(
    {
      plannerMode: runPlannerMode(run, project.workflow.plannerMode),
      stages: {
        ...stages,
        'code-review': { ...stages['code-review'], enabled: states['code-review'] !== 'off' },
        'unit-tests': { ...stages['unit-tests'], enabled: states['unit-tests'] !== 'off' },
      },
    },
    // One row in the helpers box; the agent tree below lists each helper.
    { ...project.setup, maxConcurrentHelpers: 1 },
    project.skills,
    WORKFLOW_COPY.edges,
  );
  const nodes = graph.nodes.map((n): WorkflowNode => {
    if (n.type !== 'helpers') return n;
    // The box still states the project's own limit.
    return { ...n, data: { ...n.data, maxHelpers: project.setup.maxConcurrentHelpers } };
  });
  return { ...graph, nodes };
}

function HeldNotice({ runId, stage }: { runId: string; stage: PostMergeStage }) {
  const go = useTicketAction(continueRun);
  const name = WORKFLOW_COPY.stages[stage];
  return (
    <div
      role="status"
      data-testid="held-stage"
      data-stage={stage}
      className="mx-5 mb-4 flex flex-wrap items-center gap-x-4 gap-y-3 rounded-control border border-warning/30 bg-warning-soft px-4 py-3"
    >
      <AlertIcon size={16} className="shrink-0 self-start text-warning" />
      <div className="min-w-0 flex-1">
        <p className="font-medium text-ink">{C.held.title(name)}</p>
        <p className="text-dim">{C.held.text(name)}</p>
      </div>
      <Button variant="primary" disabled={go.pending} onClick={() => void go.run(runId)}>
        {go.pending ? C.held.pending : C.held.action}
      </Button>
      {go.error ? (
        <div className="basis-full">
          <ActionError error={go.error} message={C.held.failed} />
        </div>
      ) : null}
    </div>
  );
}

/**
 * The run's live workflow at the top of the ticket page. Hidden while either route has not
 * answered, and for a run the route doesn't know (404, or managed agents off).
 */
export function LiveWorkflow({
  run,
  projectId,
  reviewerComments,
  onSelectAgent,
}: {
  run: RunDetailDto;
  projectId: string;
  /** Reviewer findings on this run (ticket comments by `reviewer`). */
  reviewerComments: number;
  onSelectAgent: (agentId: string, stage: WorkflowStageId) => void;
}) {
  const runWorkflow = useApiQuery(runWorkflowPaths.workflow(run.id), runWorkflowSchemas.workflow);
  const project = useApiQuery(workflowPaths.workflow(projectId), workflowSchemas.workflow);
  const rw = runWorkflow.data;
  const pw = project.data;
  const graph = useMemo(
    () => (rw === undefined || pw === undefined ? null : liveGraph(run, pw, rw)),
    [run, pw, rw],
  );
  const live = useMemo<LiveRun | null>(
    () =>
      rw === undefined
        ? null
        : {
            states: stageStates(rw),
            helpers: run.agents.filter((a) => a.kind === 'worker'),
            completed: run.status === 'COMPLETED',
          },
    [rw, run.agents, run.status],
  );
  if (rw === undefined || pw === undefined || graph === null || live === null) return null;

  const held = heldStage(rw, run);
  const changed = pw.workflow.updatedAt > run.createdAt;
  const onNodeClick: NodeMouseHandler<WorkflowNode> = (_, node) => {
    const stage = stageOfNode(node.id);
    if (stage === null) return;
    const ids = rw.stages.find((s) => s.stage === stage)?.agentRunIds ?? [];
    // The agent working now, else the newest one of the stage.
    const agents = run.agents.filter((a) => ids.includes(a.id));
    const pick = agents.find((a) => isAgentLive(a.status)) ?? agents[agents.length - 1];
    if (pick !== undefined) onSelectAgent(pick.id, stage);
  };

  return (
    <Card
      title={C.title}
      tip={C.tip}
      description={C.description}
      padded={false}
      testId="live-workflow"
    >
      <div className="pt-4">
        {held !== null ? <HeldNotice runId={run.id} stage={held} /> : null}
        <div
          className={`w-full overflow-hidden border-t border-line ${
            changed || reviewerComments > 0 ? '' : 'rounded-b-card'
          }`}
          style={{
            aspectRatio: `${graph.width} / ${graph.height + 40}`,
            maxHeight: 620,
            minHeight: 340,
          }}
          role="group"
          aria-label={C.graphLabel}
          data-testid="live-workflow-graph"
        >
          <LiveRunContext.Provider value={live}>
            <ReactFlow
              nodes={graph.nodes}
              edges={graph.edges}
              nodeTypes={liveNodeTypes}
              onNodeClick={onNodeClick}
              nodesDraggable={false}
              nodesConnectable={false}
              elementsSelectable={false}
              edgesFocusable={false}
              zoomOnScroll={false}
              panOnScroll={false}
              panOnDrag={false}
              preventScrolling={false}
              zoomOnDoubleClick={false}
              zoomOnPinch={false}
              fitView
              fitViewOptions={FIT}
              minZoom={0.4}
              maxZoom={1}
              proOptions={{ hideAttribution: true }}
            >
              <Background variant={BackgroundVariant.Dots} gap={18} size={1} />
              <FitOnResize />
            </ReactFlow>
          </LiveRunContext.Provider>
        </div>
        {changed || reviewerComments > 0 ? (
          <div className="flex flex-col gap-1 border-t border-line px-5 py-3 text-caption text-dim">
            {reviewerComments > 0 ? (
              // A button, not a hash link: the hash is the app's route.
              <button
                type="button"
                className="w-fit text-left text-accent hover:underline"
                data-testid="reviewer-findings-link"
                onClick={() =>
                  document.getElementById(COMMENTS_ID)?.scrollIntoView?.({ behavior: 'smooth' })
                }
              >
                {C.reviewerComments(reviewerComments)}
              </button>
            ) : null}
            {changed ? <p>{C.changedSince}</p> : null}
          </div>
        ) : null}
      </div>
    </Card>
  );
}
