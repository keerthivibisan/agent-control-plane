import { MAX_EDGE_REWORK_ROUNDS, type WorkflowEdge, type WorkflowGraph } from '@acp/core';
import type { Dispatch } from 'react';
import { Button } from '../../../components/Button';
import { WORKFLOW_GRAPH_COPY } from '../../../lib/copy';
import { NumberChoice } from '../../project-setup/fields';
import { EDITOR_COPY } from './copy';
import { LinkSample } from './edges';
import type { EditorIssue } from './IssuesList';
import { PanelHeading, PanelIssues } from './NodePanel';
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
  issues,
  dispatch,
  onClose,
}: {
  edge: WorkflowEdge;
  graph: WorkflowGraph;
  /** The problems that name this link. */
  issues: readonly EditorIssue[];
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
        icon={<LinkSample type={edge.type} width={22} />}
        eyebrow={G.edges[edge.type]}
        title={`${label(edge.from)} → ${label(edge.to)}`}
        text={G.edgeText[edge.type]}
        onClose={onClose}
      />
      <PanelIssues issues={issues} title={EDITOR_COPY.issues.linkTitle} />
      <div className="flex flex-col gap-5 px-4 pt-4 pb-5">
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
        <div className="-mx-4 border-t border-line px-4 pt-4">
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
    </div>
  );
}
