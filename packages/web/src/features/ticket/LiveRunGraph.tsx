import type { WorkflowNode } from '@acp/core';
import type { AgentRunDto, RunWorkflowGraphDto } from '@acp/core/api';
import {
  Background,
  BackgroundVariant,
  ReactFlow,
  useReactFlow,
  useStore,
  type NodeMouseHandler,
} from '@xyflow/react';
import { useEffect, useMemo } from 'react';
import { Card } from '../../components/Card';
import { REVIEW_LOOP_COPY, TICKET_COPY, WORKFLOW_LIVE_COPY } from '../../lib/copy';
import { agentToShow, buildLiveGraph, heldBlock, stageOfBlock, type LiveBlock } from './live-graph';
import { HeldNotice, ReviewerFindingsLink, type LiveWorkflowProps } from './live-parts';
import { LiveGraphContext, liveBlockTypes, type LiveGraphActions } from './LiveGraphNodes';

const G = WORKFLOW_LIVE_COPY.graph;

const FIT = {
  padding: { top: '56px', right: '24px', bottom: '40px', left: '24px' },
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

type ReviewCounts = NonNullable<RunWorkflowGraphDto['review']>;

/** "Changes: 1 in review · 2 merged · 1 for you": only the parts that have any. */
function ReviewCountsLine({ counts }: { counts: ReviewCounts }) {
  const W = REVIEW_LOOP_COPY.graph.counts;
  const parts = [
    { key: 'needs-owner', text: W.needsOwner(counts.needsOwner), n: counts.needsOwner },
    { key: 'waiting', text: W.waiting(counts.waiting), n: counts.waiting },
    { key: 'in-review', text: W.inReview(counts.inReview), n: counts.inReview },
    { key: 'rework', text: W.rework(counts.rework), n: counts.rework },
    { key: 'merged', text: W.merged(counts.merged), n: counts.merged },
    { key: 'discarded', text: W.discarded(counts.discarded), n: counts.discarded },
    { key: 'no-changes', text: W.noChanges(counts.noChanges), n: counts.noChanges },
  ].filter((p) => p.n > 0);
  return (
    <p className="mx-5 mb-3 flex flex-wrap items-baseline gap-x-2 text-caption tabular-nums">
      <span className="font-medium text-ink">{G.changes}</span>
      <span className="text-dim" data-testid="review-counts">
        {parts.length === 0
          ? W.none
          : parts.map((p, i) => (
              <span
                key={p.key}
                className={p.key === 'needs-owner' ? 'font-medium text-warning' : ''}
              >
                {i > 0 ? ' · ' : ''}
                {p.text}
              </span>
            ))}
      </span>
    </p>
  );
}

/**
 * The run's own workflow graph (ADR-0023): the blocks and links it started with, each block's
 * state and agents, the editing blocks' modes for this run, and the rework counts. Read-only;
 * a click on a block shows its working (else newest) agent, a click on an agent shows that one.
 */
export function LiveRunGraph({
  dto,
  run,
  reviewerComments,
  onSelectAgent,
}: LiveWorkflowProps & { dto: RunWorkflowGraphDto }) {
  const graph = useMemo(() => buildLiveGraph(dto, run), [dto, run]);
  const held = heldBlock(dto, run);
  // A notice above the graph gets the gap and a divider; otherwise the graph meets the card's header.
  const above = held !== null || dto.review !== undefined;
  const actions = useMemo<LiveGraphActions>(
    () => ({
      selectAgent: (agent: AgentRunDto, node: WorkflowNode) =>
        onSelectAgent(agent.id, stageOfBlock(node)),
    }),
    [onSelectAgent],
  );
  const onNodeClick: NodeMouseHandler<LiveBlock> = (_, block) => {
    const pick = agentToShow(block.data.agents);
    if (pick !== undefined) onSelectAgent(pick.id, stageOfBlock(block.data.node));
  };

  return (
    <Card
      title={TICKET_COPY.workflow.title}
      tip={G.tip}
      description={G.description}
      padded={false}
      testId="live-workflow"
    >
      <div
        className={above ? 'pt-4' : ''}
        data-testid="live-run-graph"
        data-template={dto.graph.template}
      >
        {held !== null ? <HeldNotice runId={run.id} name={held.label} stage={held.id} /> : null}
        {dto.review !== undefined ? <ReviewCountsLine counts={dto.review} /> : null}
        <div
          className={`w-full overflow-hidden ${above ? 'border-t border-line' : ''} ${
            reviewerComments > 0 ? '' : 'rounded-b-card'
          }`}
          style={{
            aspectRatio: `${Math.max(graph.width, 1)} / ${graph.height + 96}`,
            maxHeight: 680,
            minHeight: 360,
          }}
          role="group"
          aria-label={G.label}
          data-testid="live-workflow-graph"
        >
          <LiveGraphContext.Provider value={actions}>
            <ReactFlow
              nodes={graph.nodes}
              edges={graph.edges}
              nodeTypes={liveBlockTypes}
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
              minZoom={0.3}
              maxZoom={1}
              proOptions={{ hideAttribution: true }}
            >
              <Background variant={BackgroundVariant.Dots} gap={18} size={1} />
              <FitOnResize />
            </ReactFlow>
          </LiveGraphContext.Provider>
        </div>
        {reviewerComments > 0 ? (
          <div className="flex flex-col gap-1 border-t border-line px-5 py-3 text-caption text-dim">
            <ReviewerFindingsLink count={reviewerComments} />
          </div>
        ) : null}
      </div>
    </Card>
  );
}
