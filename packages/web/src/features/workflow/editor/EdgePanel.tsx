import { MAX_EDGE_REWORK_ROUNDS, type WorkflowEdge, type WorkflowGraph } from '@acp/core';
import type { Dispatch } from 'react';
import { Button } from '../../../components/Button';
import { WORKFLOW_GRAPH_COPY } from '../../../lib/copy';
import { NumberChoice } from '../../project-setup/fields';
import { PanelHeading } from './NodePanel';
import type { EditorAction } from './state';

const G = WORKFLOW_GRAPH_COPY;
const E = WORKFLOW_GRAPH_COPY.edgePanel;
const ROUND_CHOICES: readonly number[] = Array.from(
  { length: MAX_EDGE_REWORK_ROUNDS + 1 },
  (_, i) => i,
);

/** The selected link: what it does, its rework rounds (0–5) when it is a rework link, Remove. */
export function EdgePanel({
  edge,
  graph,
  dispatch,
  onClose,
}: {
  edge: WorkflowEdge;
  graph: WorkflowGraph;
  dispatch: Dispatch<EditorAction>;
  onClose: () => void;
}) {
  const label = (id: string) => graph.nodes.find((n) => n.id === id)?.label ?? id;
  return (
    <div
      className="flex flex-col"
      data-testid="edge-panel"
      data-edge={edge.id}
      data-type={edge.type}
    >
      <PanelHeading
        eyebrow={G.edges[edge.type]}
        title={`${label(edge.from)} → ${label(edge.to)}`}
        text={G.edgeText[edge.type]}
        onClose={onClose}
      />
      <div className="flex flex-col gap-5 px-5 pt-5 pb-6">
        {edge.type === 'rework' ? (
          <NumberChoice
            legend={E.rounds}
            hint={E.roundsHint}
            name={`rounds-${edge.id}`}
            value={edge.maxRounds}
            choices={ROUND_CHOICES}
            onChange={(maxRounds) => dispatch({ type: 'set-rounds', id: edge.id, maxRounds })}
            valueText={E.roundsValue}
          />
        ) : null}
        <Button
          variant="danger"
          size="sm"
          className="w-fit"
          onClick={() => dispatch({ type: 'remove-edge', id: edge.id })}
        >
          {E.remove}
        </Button>
      </div>
    </div>
  );
}
