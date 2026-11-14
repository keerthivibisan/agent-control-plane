import {
  arrowNoteReceiver,
  FAILURE_EVENT_NAMES,
  MAX_EDGE_LABEL,
  MAX_EDGE_PURPOSE,
  MAX_EDGE_REWORK_ROUNDS,
  MAX_WHEN_ROUNDS,
  type FailureEvent,
  type WorkflowEdgeV3,
  type WorkflowGraphV3,
} from '@acp/core';
import { useId, type Dispatch } from 'react';
import { TextArea, TextInput, hintClass, labelClass } from '../../../components/Input';
import { WORKFLOW_GRAPH_COPY } from '../../../lib/copy';
import { NumberChoice } from '../../project-setup/fields';
import { EDITOR_COPY } from './copy';
import { LinkSample } from './edges';
import { sourceEvents, toggledEvents } from './failure-routing';
import type { EditorIssue } from './IssuesList';
import { drawnLabel } from './linking';
import { PanelHeading, PanelIssues } from './NodePanel';
import type { EditorAction, EdgePatch } from './state';

const E = WORKFLOW_GRAPH_COPY.edgePanel;
const A = EDITOR_COPY.arrows;
const W = EDITOR_COPY.edgePanel;
const WN = EDITOR_COPY.when;
const ROUND_CHOICES: readonly number[] = Array.from(
  { length: MAX_EDGE_REWORK_ROUNDS + 1 },
  (_, i) => i,
);
const WHEN_ROUND_CHOICES: readonly number[] = Array.from(
  { length: MAX_WHEN_ROUNDS },
  (_, i) => i + 1,
);

type WhenEdge = Extract<WorkflowEdgeV3, { type: 'when' }>;

/**
 * A When arrow's settings (ADR-0038 §4): the failures it routes, as checkboxes limited to what its
 * source raises (an event the source never raises stays listed, flagged, so it can be unticked),
 * its rounds (1–5), and who receives a routed failure.
 */
function WhenFields({
  edge,
  graph,
  dispatch,
}: {
  edge: WhenEdge;
  graph: WorkflowGraphV3;
  dispatch: Dispatch<EditorAction>;
}) {
  const hintId = useId();
  const raised = sourceEvents(graph, edge.from);
  const foreign = edge.on.filter((e) => !raised.includes(e));
  const shown: readonly FailureEvent[] = [...raised, ...foreign];
  const target = graph.nodes.find((n) => n.id === edge.to);
  const receiver =
    target?.type === 'lead'
      ? ({ kind: 'lead' } as const)
      : target?.type === 'author'
        ? ({ kind: 'author' } as const)
        : ({ kind: 'node', label: drawnLabel(graph, edge.to) } as const);
  return (
    <>
      <fieldset
        className="flex min-w-0 flex-col gap-1.5"
        aria-describedby={hintId}
        data-testid="when-events"
      >
        <legend className={`mb-1.5 ${labelClass}`}>{WN.events}</legend>
        {shown.map((event) => {
          const checked = edge.on.includes(event);
          const bad = foreign.includes(event);
          // The last ticked event stays: an arrow routes at least one.
          const last = checked && edge.on.length === 1;
          return (
            <label
              key={event}
              className={`flex items-start gap-2.5 text-body ${last ? 'cursor-not-allowed' : 'cursor-pointer'}`}
            >
              <input
                type="checkbox"
                className="mt-1 accent-accent"
                checked={checked}
                disabled={last}
                onChange={(e) =>
                  dispatch({
                    type: 'set-when-events',
                    id: edge.id,
                    on: toggledEvents(edge, event, e.target.checked, raised),
                  })
                }
                data-testid={`when-event-${event}`}
              />
              <span className="flex flex-col">
                <span className={bad ? 'text-danger' : 'text-ink'}>
                  {WN.event(FAILURE_EVENT_NAMES[event])}
                </span>
                {bad ? (
                  <span className="text-caption text-danger" data-testid={`when-foreign-${event}`}>
                    {WN.foreign}
                  </span>
                ) : null}
              </span>
            </label>
          );
        })}
        <span id={hintId} className={hintClass}>
          {WN.eventsHint}
        </span>
      </fieldset>
      <NumberChoice
        legend={WN.rounds}
        hint={WN.roundsHint}
        name={`when-rounds-${edge.id}`}
        value={edge.maxRounds}
        choices={WHEN_ROUND_CHOICES}
        onChange={(maxRounds) => dispatch({ type: 'set-rounds', id: edge.id, maxRounds })}
        valueText={WN.roundsValue}
      />
      <p
        className="rounded-control border border-line bg-sunken px-3 py-2.5 text-caption text-dim"
        data-testid="when-receives"
        data-receiver={receiver.kind}
      >
        {WN.receives(receiver)} {receiver.kind === 'lead' ? null : WN.roundsOut}
      </p>
    </>
  );
}

/**
 * One of an arrow's words (ADR-0037 §2) with a live count of its characters against the limit. The
 * field keeps what the owner types; over the limit it says so, and the problems list blocks Save.
 */
function WordsField({
  label,
  hint,
  value,
  max,
  multiline,
  testId,
  onChange,
}: {
  label: string;
  hint: string;
  value: string;
  max: number;
  multiline: boolean;
  testId: string;
  onChange: (next: string) => void;
}) {
  const id = useId();
  const length = value.trim().length;
  const over = length > max;
  const described = `${id}-hint ${id}-count${over ? ` ${id}-error` : ''}`;
  const common = {
    id,
    value,
    'aria-describedby': described,
    'aria-invalid': over ? true : undefined,
    'data-testid': testId,
  };
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <label htmlFor={id} className={labelClass}>
          {label}
        </label>
        <span
          id={`${id}-count`}
          className={`text-caption tabular-nums ${over ? 'text-danger' : 'text-dim'}`}
          aria-label={W.counterLabel(length, max)}
          data-testid={`${testId}-count`}
        >
          {W.counter(length, max)}
        </span>
      </div>
      {multiline ? (
        <TextArea {...common} rows={4} onChange={(e) => onChange(e.target.value)} />
      ) : (
        <TextInput {...common} onChange={(e) => onChange(e.target.value)} />
      )}
      <span id={`${id}-hint`} className={hintClass}>
        {hint}
      </span>
      {over ? (
        <span
          id={`${id}-error`}
          className="text-caption text-danger"
          data-testid={`${testId}-error`}
        >
          {W.tooLong(max)}
        </span>
      ) : null}
    </div>
  );
}

/**
 * The selected arrow: its type and ends, its label and purpose (ADR-0037 §2), its rework rounds
 * (0–5) when it is a rework arrow, its events, rounds (1–5) and receiver when it is a When arrow
 * (ADR-0038 §4), and Remove (in the heading).
 */
export function EdgePanel({
  edge,
  graph,
  issues,
  dispatch,
  onClose,
}: {
  edge: WorkflowEdgeV3;
  graph: WorkflowGraphV3;
  /** The problems that name this link. */
  issues: readonly EditorIssue[];
  dispatch: Dispatch<EditorAction>;
  onClose: () => void;
}) {
  const from = drawnLabel(graph, edge.from);
  const to = drawnLabel(graph, edge.to);
  const change = (patch: EdgePatch) => dispatch({ type: 'update-edge', id: edge.id, patch });
  // ADR-0037 §2 (amended 2026-11-14): who reads this arrow's purpose, as the engine sends it.
  const receiver = arrowNoteReceiver(
    edge,
    graph.nodes.find((n) => n.id === edge.from),
    graph.nodes.find((n) => n.id === edge.to),
  );
  const purposeTo =
    receiver === null ? W.purposeToNone : W.purposeTo(edge.type, from, drawnLabel(graph, receiver));
  return (
    <div
      className="flex flex-col"
      data-testid="edge-panel"
      data-edge={edge.id}
      data-type={edge.type}
    >
      <PanelHeading
        icon={<LinkSample type={edge.type} width={22} />}
        eyebrow={A.names[edge.type]}
        title={edge.label ?? `${from} → ${to}`}
        text={A.text[edge.type]}
        remove={{
          label: E.remove,
          testId: 'remove-link',
          onClick: () => dispatch({ type: 'remove-edge', id: edge.id }),
        }}
        onClose={onClose}
      />
      <PanelIssues issues={issues} title={EDITOR_COPY.issues.linkTitle} />
      <div className="flex flex-col gap-5 px-4 pt-4 pb-5">
        <dl
          className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-caption"
          data-testid="edge-ends"
        >
          <dt className="text-dim">{W.from}</dt>
          <dd className="truncate font-medium" data-testid="edge-from">
            {from}
          </dd>
          <dt className="text-dim">{W.to}</dt>
          <dd className="truncate font-medium" data-testid="edge-to">
            {to}
          </dd>
        </dl>
        <WordsField
          label={W.label}
          hint={W.labelHint}
          value={edge.label ?? ''}
          max={MAX_EDGE_LABEL}
          multiline={false}
          testId="edge-label"
          onChange={(label) => change({ label })}
        />
        <WordsField
          label={W.purpose}
          hint={W.purposeHint}
          value={edge.purpose ?? ''}
          max={MAX_EDGE_PURPOSE}
          multiline
          testId="edge-purpose"
          onChange={(purpose) => change({ purpose })}
        />
        {edge.type === 'when' ? null : (
          // A When arrow says who receives it below, with its rounds (the Author is found at run time).
          <p className="-mt-3 text-caption text-dim" data-testid="edge-purpose-to">
            {purposeTo}
          </p>
        )}
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
        {edge.type === 'when' ? <WhenFields edge={edge} graph={graph} dispatch={dispatch} /> : null}
      </div>
    </div>
  );
}
