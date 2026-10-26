import {
  MAX_EDGE_REWORK_ROUNDS,
  MAX_NODE_LABEL,
  type CheckFailureRoute,
  type CheckSelection,
  type HarnessCheck,
  type HarnessStatus,
  type WorkflowGraph,
} from '@acp/core';
import { useId, type Dispatch, type ReactNode } from 'react';
import { AlertIcon, CheckIcon } from '../../../components/icons';
import { hintClass, labelClass } from '../../../components/Input';
import { HARNESS_BLOCKS_COPY, WORKFLOW_GRAPH_COPY } from '../../../lib/copy';
import { href } from '../../../lib/router';
import { ChoiceCards, NumberChoice, TextField } from '../../project-setup/fields';
import {
  checkFailureOf,
  checkPlaceOf,
  checkSelectionOf,
  checkedBlocks,
  failureRoutes,
  harnessLabels,
  missingSelection,
  reworkLinksOf,
  selectedChecks,
  usableHarness,
  type ChecksNode,
} from '../check-blocks';
import { RemoveIcon } from '../icons';
import { checksAvailability, type EditorAction, type NodePatch } from './state';

const H = HARNESS_BLOCKS_COPY;
const P = HARNESS_BLOCKS_COPY.panel;
/** Core's limits on a selection (`CheckSelectionSchema`). */
const MAX_IDS = 20;
const MAX_LABELS = 5;
const ROUND_CHOICES: readonly number[] = Array.from(
  { length: MAX_EDGE_REWORK_ROUNDS + 1 },
  (_, i) => i,
);
const W = WORKFLOW_GRAPH_COPY.panel;

/** A part of the panel under a rule; its field's legend is its title. */
function Part({ children }: { children: ReactNode }) {
  return <div className="-mx-4 flex flex-col gap-4 border-t border-line px-4 pt-4">{children}</div>;
}

function Note({ children, testId }: { children: ReactNode; testId?: string }) {
  return (
    <p
      className="rounded-control border border-line bg-sunken px-3 py-2.5 text-caption text-dim"
      data-testid={testId}
    >
      {children}
    </p>
  );
}

/** A pick the harness file no longer has: flagged, with a button to drop it. */
function MissingRow({
  text,
  name,
  onRemove,
}: {
  text: string;
  name: string;
  onRemove: () => void;
}) {
  return (
    <div
      className="flex items-center gap-2 rounded-control border border-warning/35 bg-warning-soft px-2.5 py-1.5 text-caption text-warning"
      data-testid="check-pick-missing"
    >
      <AlertIcon size={13} className="shrink-0" />
      <span className="min-w-0 flex-1">{text}</span>
      <button
        type="button"
        onClick={onRemove}
        aria-label={P.remove(name)}
        className="inline-flex size-6 shrink-0 items-center justify-center rounded-control text-warning hover:bg-hover"
      >
        <RemoveIcon size={13} />
      </button>
    </div>
  );
}

/** Where the block runs: fixed for the block before the lead's merge, else change or branch. */
function PlaceField({
  node,
  graph,
  dispatch,
}: {
  node: ChecksNode;
  graph: WorkflowGraph;
  dispatch: Dispatch<EditorAction>;
}) {
  const place = checkPlaceOf(node);
  if (place === 'merge') {
    return (
      <div className="flex flex-col gap-1.5" data-testid="check-place" data-place="merge">
        <span className={labelClass}>{P.place}</span>
        <p className="flex items-center gap-2 font-medium">
          <CheckIcon size={14} className="shrink-0 text-success" />
          {H.places.merge}
        </p>
        <Note testId="check-place-mandatory">{P.mandatory}</Note>
      </div>
    );
  }
  // The other place is offered only when the workflow may have this block there.
  const others = { ...graph, nodes: graph.nodes.filter((n) => n.id !== node.id) };
  const options = (['change', 'branch'] as const).filter(
    (p) => p === place || checksAvailability(others, p).ok,
  );
  const checked = place === 'change' ? checkedBlocks(graph, node) : [];
  return (
    <div className="flex flex-col gap-2" data-testid="check-place" data-place={place}>
      <ChoiceCards<'change' | 'branch'>
        legend={P.place}
        name={`place-${node.id}`}
        value={place}
        columns={1}
        options={options.map((p) => ({ value: p, label: H.places[p], hint: H.placeHints[p] }))}
        onChange={(p) => dispatch({ type: 'set-check-place', id: node.id, place: p })}
      />
      {options.length === 1 ? (
        <p className="text-caption text-dim">{place === 'change' ? P.branchTaken : P.noEditors}</p>
      ) : null}
      {place === 'change' ? (
        <p className="text-caption text-dim" data-testid="check-target">
          {checked.length === 0
            ? P.checks.unlinked
            : P.checks.for(checked.map((n) => n.label).join('”, “'))}
        </p>
      ) : null}
    </div>
  );
}

/** "Pick checks": the harness file's checks as a checklist, with their labels and required. */
function IdsField({
  ids,
  checks,
  onChange,
}: {
  ids: readonly string[];
  checks: readonly HarnessCheck[];
  onChange: (ids: string[]) => void;
}) {
  const id = useId();
  const missing = missingSelection({ kind: 'ids', ids: [...ids] }, checks).ids;
  const full = ids.length >= MAX_IDS;
  return (
    <fieldset
      className="flex min-w-0 flex-col gap-1.5"
      aria-describedby={`${id}-hint`}
      data-testid="check-ids"
    >
      <legend className={`mb-1 ${labelClass}`}>{P.checksLegend}</legend>
      {missing.map((m) => (
        <MissingRow
          key={m}
          name={m}
          text={P.missingCheck(m)}
          onRemove={() => onChange(ids.filter((v) => v !== m))}
        />
      ))}
      <div className="flex flex-col gap-1">
        {checks.map((c) => {
          const on = ids.includes(c.id);
          return (
            <label key={c.id} className="flex items-start gap-2 py-0.5" data-check={c.id}>
              <input
                type="checkbox"
                checked={on}
                disabled={!on && full}
                onChange={(e) =>
                  onChange(e.target.checked ? [...ids, c.id] : ids.filter((v) => v !== c.id))
                }
                className="mt-0.5 size-4 shrink-0 accent-accent"
              />
              <span className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1">
                <span className="font-medium">{c.name}</span>
                <span className="font-mono text-caption text-dim">{c.id}</span>
                {c.required ? (
                  <span className="rounded-full border border-accent/40 px-1.5 text-micro text-accent">
                    {P.required}
                  </span>
                ) : null}
                {(c.labels ?? []).map((l) => (
                  <span
                    key={l}
                    className="rounded-full border border-line-strong px-1.5 font-mono text-micro text-dim"
                  >
                    {l}
                  </span>
                ))}
              </span>
            </label>
          );
        })}
      </div>
      <span id={`${id}-hint`} className={hintClass}>
        {P.checksHint(MAX_IDS)}
      </span>
    </fieldset>
  );
}

/** "By label": the labels the harness's checks carry, as toggle chips. */
function LabelsField({
  labels,
  checks,
  onChange,
}: {
  labels: readonly string[];
  checks: readonly HarnessCheck[];
  onChange: (labels: string[]) => void;
}) {
  const id = useId();
  const known = harnessLabels(checks);
  const missing = missingSelection({ kind: 'labels', labels: [...labels] }, checks).labels;
  const full = labels.length >= MAX_LABELS;
  return (
    <div
      role="group"
      aria-labelledby={`${id}-legend`}
      aria-describedby={`${id}-hint`}
      className="flex min-w-0 flex-col gap-1.5"
      data-testid="check-labels"
    >
      <span id={`${id}-legend`} className={`mb-1 ${labelClass}`}>
        {P.labelsLegend}
      </span>
      {missing.map((m) => (
        <MissingRow
          key={m}
          name={m}
          text={P.missingLabel(m)}
          onRemove={() => onChange(labels.filter((v) => v !== m))}
        />
      ))}
      {known.length === 0 ? (
        <p className="text-caption text-dim">{P.noLabels}</p>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {known.map((l) => {
            const on = labels.includes(l);
            const count = checks.filter((c) => (c.labels ?? []).includes(l)).length;
            return (
              <button
                key={l}
                type="button"
                aria-pressed={on}
                disabled={!on && full}
                onClick={() => onChange(on ? labels.filter((v) => v !== l) : [...labels, l])}
                data-label={l}
                className={`inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-caption transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                  on
                    ? 'border-accent-fill-edge bg-accent-soft font-medium text-ink'
                    : 'border-line-strong text-dim hover:bg-hover hover:text-ink'
                }`}
              >
                {on ? <CheckIcon size={12} className="shrink-0 text-accent" /> : null}
                <span className="font-mono">{l}</span>
                <span className="text-dim tabular-nums">{P.labelChecks(count)}</span>
              </button>
            );
          })}
        </div>
      )}
      <span id={`${id}-hint`} className={hintClass}>
        {P.labelsHint(MAX_LABELS)}
      </span>
    </div>
  );
}

/** The selection a switch to `kind` starts from: what the block had, else a sensible start. */
function startSelection(
  kind: CheckSelection['kind'],
  current: CheckSelection,
  checks: readonly HarnessCheck[],
): CheckSelection {
  if (kind === current.kind) return current;
  if (kind === 'ids') {
    const required = checks.filter((c) => c.required).map((c) => c.id);
    const start = required.length > 0 ? required : checks.slice(0, 1).map((c) => c.id);
    return { kind: 'ids', ids: start.slice(0, MAX_IDS) };
  }
  if (kind === 'labels') return { kind: 'labels', labels: harnessLabels(checks).slice(0, 1) };
  return { kind: 'required' };
}

/** Which checks the block runs: all required ones, a list, or labels. */
function SelectField({
  node,
  harness,
  projectId,
  change,
}: {
  node: ChecksNode;
  harness: HarnessStatus | undefined;
  projectId: string;
  change: (patch: NodePatch) => void;
}) {
  const selection = checkSelectionOf(node);
  const checks = usableHarness(harness) ?? [];
  const runs = selectedChecks(selection, checks).map((c) => c.name);
  return (
    <div className="flex flex-col gap-3" data-testid="check-select" data-kind={selection.kind}>
      <ChoiceCards<CheckSelection['kind']>
        legend={P.select}
        name={`select-${node.id}`}
        value={selection.kind}
        columns={1}
        options={(['required', 'ids', 'labels'] as const).map((k) => ({
          value: k,
          label: P.selectKinds[k],
          hint: P.selectHints[k],
        }))}
        onChange={(kind) => change({ select: startSelection(kind, selection, checks) })}
      />
      {usableHarness(harness) === undefined ? (
        <p className="text-caption text-dim" data-testid="check-no-harness">
          {P.noHarness}{' '}
          <a href={href.projectPage(projectId, 'harness')} className="text-accent hover:underline">
            {P.openHarness}
          </a>
        </p>
      ) : null}
      {selection.kind === 'ids' ? (
        <IdsField
          ids={selection.ids}
          checks={checks}
          onChange={(ids) => change({ select: { kind: 'ids', ids } })}
        />
      ) : null}
      {selection.kind === 'labels' ? (
        <LabelsField
          labels={selection.labels}
          checks={checks}
          onChange={(labels) => change({ select: { kind: 'labels', labels } })}
        />
      ) : null}
      {usableHarness(harness) !== undefined ? (
        <p className="text-caption text-dim" data-testid="check-runs" aria-live="polite">
          {P.runs(runs)}
        </p>
      ) : null}
    </div>
  );
}

/** What a failure does, only the routes the place allows; rounds on the link back. */
function FailureField({
  node,
  graph,
  dispatch,
}: {
  node: ChecksNode;
  graph: WorkflowGraph;
  dispatch: Dispatch<EditorAction>;
}) {
  const place = checkPlaceOf(node);
  const routes = failureRoutes(place);
  const route = checkFailureOf(node);
  // One rework link per block it checks; the rounds are set on all of them at once.
  const reworks = reworkLinksOf(graph, node);
  const rework = reworks[0];
  return (
    <div className="flex flex-col gap-3" data-testid="check-failure" data-route={route}>
      <ChoiceCards<CheckFailureRoute>
        legend={P.failure}
        name={`failure-${node.id}`}
        value={route}
        columns={1}
        options={routes.map((r) => ({
          value: r,
          label: P.failures[r],
          hint: P.failureHints[r],
        }))}
        onChange={(onFailure) => dispatch({ type: 'set-check-failure', id: node.id, onFailure })}
      />
      {place === 'branch' ? <p className="text-caption text-dim">{P.branchFailure}</p> : null}
      {route === 'helper' ? (
        rework === undefined ? (
          <p
            role="status"
            className="flex items-start gap-2 rounded-control border border-warning/25 bg-warning-soft px-3 py-2 text-caption text-warning"
            data-testid="check-no-rework"
          >
            <AlertIcon size={14} className="mt-px shrink-0" />
            {P.noReworkLink}
          </p>
        ) : (
          <NumberChoice
            legend={P.rounds}
            hint={P.roundsHint}
            name={`check-rounds-${node.id}`}
            value={rework.maxRounds}
            choices={ROUND_CHOICES}
            onChange={(maxRounds) => {
              for (const r of reworks) dispatch({ type: 'set-rounds', id: r.id, maxRounds });
            }}
            valueText={P.roundsValue}
          />
        )
      ) : null}
    </div>
  );
}

/**
 * A Checks block's settings (ADR-0027 §5): its name, where it runs (the block before the lead's
 * merge is fixed: every workflow has it), which checks (all required, a list or labels, from the
 * project's harness file) and what a failure does (only the routes its place allows; "back to the
 * helper" with its rounds). Every change goes to the editor's reducer.
 */
export function CheckBlockFields({
  node,
  graph,
  harness,
  projectId,
  dispatch,
}: {
  node: ChecksNode;
  graph: WorkflowGraph;
  /** The project's harness status; undefined while unknown. */
  harness: HarnessStatus | undefined;
  projectId: string;
  dispatch: Dispatch<EditorAction>;
}) {
  const change = (patch: NodePatch) => dispatch({ type: 'update-node', id: node.id, patch });
  const t = node.label.trim();
  return (
    <div className="flex flex-col gap-5" data-testid="check-block-fields">
      <TextField
        label={W.name}
        hint={P.nameHint}
        error={
          t.length === 0
            ? W.nameRequired
            : t.length > MAX_NODE_LABEL
              ? W.nameTooLong(MAX_NODE_LABEL)
              : undefined
        }
        value={node.label}
        onChange={(label) => change({ label })}
      />
      <PlaceField node={node} graph={graph} dispatch={dispatch} />
      <Part>
        <SelectField node={node} harness={harness} projectId={projectId} change={change} />
      </Part>
      <Part>
        <FailureField node={node} graph={graph} dispatch={dispatch} />
      </Part>
    </div>
  );
}
