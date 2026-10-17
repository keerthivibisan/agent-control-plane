import { reviewStageOf, type WorkflowStageId } from '@acp/core';
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
import { Card } from '../../components/Card';
import {
  isGraphUnavailable,
  runWorkflowPaths,
  runWorkflowSchemas,
  workflowPaths,
  workflowSchemas,
} from '../../lib/api';
import { REVIEW_LOOP_COPY, TICKET_COPY, WORKFLOW_COPY } from '../../lib/copy';
import { useApiQuery } from '../../lib/query';
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
import { isReviewLoopRun, runMaxRounds, runReviewer } from '../review-loop/logic';
import { DONE_RING, STATE_RING, StateFrame } from './live-frame';
import { HeldNotice, ReviewerFindingsLink, type LiveWorkflowProps } from './live-parts';
import { LiveRunGraph } from './LiveRunGraph';
import { heldStage, runPlannerMode, stageStates } from './ticket-state';

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
  /**
   * The owner's merge of the ticket branch (review-loop runs): waiting, waiting for you (the run
   * is in REVIEW with the branch open), or done (merged). Null for a run without the loop.
   */
  ownerMerge: 'waiting' | 'needs-you' | 'done' | null;
}

const LiveRunContext = createContext<LiveRun | null>(null);

/** A stage's node with its state: a ring while it works or waits for you, and a word on top. */
function LiveFrame({ stage, children }: { stage: WorkflowStageId; children: ReactNode }) {
  const live = useContext(LiveRunContext);
  return (
    <StateFrame state={live?.states[stage] ?? 'waiting'} testId={`live-${stage}`}>
      {children}
    </StateFrame>
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

/** The owner's merge (ADR-0021 §4): ringed while it waits for you, green once merged. */
function LiveOwnerMergeNode(props: NodeProps<GateNode>) {
  const live = useContext(LiveRunContext);
  const state = live?.ownerMerge ?? 'waiting';
  return (
    <div
      className={`h-full w-full rounded-[2px] ${
        state === 'needs-you' ? STATE_RING['needs-you'] : state === 'done' ? DONE_RING : ''
      }`}
      data-testid="live-owner-merge"
      data-state={state}
    >
      <div className={`h-full w-full ${state === 'waiting' ? 'opacity-60' : ''}`}>
        <GateNodeView {...props} />
      </div>
    </div>
  );
}

/** The plan approval belongs to the plan stage: it is ringed while a plan waits for you. */
function LiveGateNode(props: NodeProps<GateNode>) {
  const live = useContext(LiveRunContext);
  if (props.data.gate === 'owner-merge') return <LiveOwnerMergeNode {...props} />;
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
  const waitingReview = helpers.filter((a) => a.status === 'AWAITING_REVIEW').length;
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
          {waitingReview > 0 ? (
            <span className="whitespace-nowrap text-dim" data-testid="helpers-waiting-review">
              {REVIEW_LOOP_COPY.graph.helpersWaiting(waitingReview)}
            </span>
          ) : null}
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
  run: Pick<RunDetailDto, 'agents'> & Partial<Pick<RunDetailDto, 'changes' | 'ticketBranch'>>,
  project: ProjectWorkflowDto,
  workflow: RunWorkflowDto,
): WorkflowGraph {
  const states = stageStates(workflow);
  const stages = project.workflow.stages;
  // ADR-0021: a review-loop run shows its review counts, the rework loop and the owner's merge;
  // a run from before it keeps the graph it always had.
  const review = reviewStageOf(project.workflow);
  const reworkRounds =
    workflow.review?.reworkRounds ?? (run.changes ?? []).reduce((n, c) => n + c.reworkRounds, 0);
  const loop = isReviewLoopRun({ changes: run.changes, ticketBranch: run.ticketBranch })
    ? {
        reviewer: runReviewer(run, review.reviewer),
        maxReworkRounds: runMaxRounds(run, review.maxReworkRounds),
        counts: workflow.review,
        reworkLabel: REVIEW_LOOP_COPY.graph.rework(reworkRounds),
      }
    : null;
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
    undefined,
    loop,
  );
  const nodes = graph.nodes.map((n): WorkflowNode => {
    if (n.type !== 'helpers') return n;
    // The box still states the project's own limit.
    return { ...n, data: { ...n.data, maxHelpers: project.setup.maxConcurrentHelpers } };
  });
  return { ...graph, nodes };
}

/**
 * The run's live workflow at the top of the ticket page (ADR-0023): the run's own graph from
 * `GET /api/runs/:id/workflow-graph`. A server from before it answers 404 or 409, and the page
 * keeps the version 1 stages. Hidden while the route has not answered, or on another error.
 */
export function LiveWorkflow(props: LiveWorkflowProps) {
  const graph = useApiQuery(runWorkflowPaths.graph(props.run.id), runWorkflowSchemas.graph);
  if (graph.data !== undefined) return <LiveRunGraph dto={graph.data} {...props} />;
  if (isGraphUnavailable(graph.error)) return <LiveWorkflowV1 {...props} />;
  return null;
}

/**
 * The version 1 live workflow (redesign R-H): the project's stages with each stage's state from
 * `GET /runs/:id/workflow`, for a server without the run's graph. Hidden while either route has
 * not answered, and for a run the route doesn't know (404, or managed agents off).
 */
export function LiveWorkflowV1({
  run,
  projectId,
  reviewerComments,
  onSelectAgent,
}: LiveWorkflowProps) {
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
            ownerMerge: !isReviewLoopRun(run)
              ? null
              : run.ticketBranch?.state === 'merged'
                ? 'done'
                : run.status === 'REVIEW' && run.ticketBranch?.state === 'open'
                  ? 'needs-you'
                  : 'waiting',
          },
    [rw, run],
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
        {held !== null ? (
          <HeldNotice runId={run.id} name={WORKFLOW_COPY.stages[held]} stage={held} />
        ) : null}
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
            {reviewerComments > 0 ? <ReviewerFindingsLink count={reviewerComments} /> : null}
            {changed ? <p>{C.changedSince}</p> : null}
          </div>
        ) : null}
      </div>
    </Card>
  );
}
