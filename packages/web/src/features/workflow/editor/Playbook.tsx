import {
  workflowPlaybook,
  type ManagedProviderId,
  type PlaybookStep,
  type WorkflowGraphV3,
} from '@acp/core';
import { useId, useMemo, type ReactNode } from 'react';
import { buttonClass } from '../../../components/Button';
import { ChevronDownIcon, ChevronRightIcon } from '../../../components/icons';
import { EDITOR_COPY } from './copy';
import { useFlowWordsOpen } from './FlowWords';

const W = EDITOR_COPY.playbook;

/** The blocks and links a playbook step lights on the canvas (ADR-0040). */
export interface StepFocus {
  nodes: readonly string[];
  edges: readonly string[];
}

/** The step's text with the owner's quoted words set apart (the quotes stay). */
function withQuotes(text: string): ReactNode[] {
  return text.split(/("[^"]*")/).map((part, i) =>
    part.startsWith('"') && part.endsWith('"') && part.length > 1 ? (
      <span key={i} className="font-medium text-ink" data-quoted="true">
        {part}
      </span>
    ) : (
      part
    ),
  );
}

const sameStep = (a: StepFocus | null, step: PlaybookStep) =>
  a !== null &&
  a.nodes.join(' ') === step.nodeIds.join(' ') &&
  a.edges.join(' ') === step.edgeIds.join(' ');

/**
 * ADR-0040: the lead's playbook, core's `workflowPlaybook` of the graph being edited: the stages in
 * the order a run follows them, numbered as the canvas's columns, each failure under its stage.
 * The lead reads exactly this text. Selecting a step lights its blocks' links on the canvas;
 * selecting it again clears it. A failure nobody routes is marked "Lead decides (default)".
 * Collapsible, remembered in this browser (the same choice as Flow in words before it).
 */
export function Playbook({
  graph,
  projectProvider,
  focus,
  onFocus,
}: {
  graph: WorkflowGraphV3;
  projectProvider?: ManagedProviderId | null | undefined;
  focus: StepFocus | null;
  onFocus: (focus: StepFocus | null) => void;
}) {
  const [open, setOpen] = useFlowWordsOpen();
  const bodyId = useId();
  const stages = useMemo(
    () =>
      workflowPlaybook(
        graph,
        projectProvider === null || projectProvider === undefined ? {} : { projectProvider },
      ),
    [graph, projectProvider],
  );
  return (
    <section
      aria-label={W.title}
      data-testid="playbook"
      className="min-w-0 rounded-card border border-line bg-panel shadow-card"
    >
      <div className="flex items-center gap-2 px-3 py-2">
        <button
          type="button"
          className={`${buttonClass('quiet', 'sm')} font-semibold text-ink`}
          aria-expanded={open}
          aria-controls={bodyId}
          title={open ? W.hide : W.show}
          onClick={() => setOpen(!open)}
          data-testid="playbook-toggle"
        >
          {open ? <ChevronDownIcon size={14} /> : <ChevronRightIcon size={14} />}
          {W.title}
        </button>
      </div>
      {open ? (
        <div
          id={bodyId}
          className="flex flex-col gap-4 border-t border-line px-4 pt-3 pb-4"
          data-testid="playbook-body"
        >
          <p className="text-caption text-dim">{W.intro}</p>
          {stages.length === 0 ? (
            <p className="text-caption text-dim">{W.empty}</p>
          ) : (
            <ol className="flex flex-col gap-3">
              {stages.map((stage) => (
                <li
                  key={stage.key}
                  className="flex flex-col gap-1"
                  data-testid={`playbook-${stage.key}`}
                >
                  <h3 className="flex items-center gap-2 text-caption font-semibold text-ink">
                    <span className="inline-flex size-5 shrink-0 items-center justify-center rounded-full border border-line-strong text-micro tabular-nums">
                      {stage.n}
                    </span>
                    {stage.title}
                  </h3>
                  <ul className="flex flex-col gap-0.5 pl-7">
                    {stage.steps.map((step, i) => {
                      const sub = step.text.startsWith('- ');
                      const text = sub ? step.text.slice(2) : step.text;
                      const selected = sameStep(focus, step);
                      const gap = step.routing === 'default';
                      return (
                        <li
                          key={i}
                          data-testid="playbook-step"
                          data-routing={step.routing}
                          data-selected={selected ? 'true' : undefined}
                          className={sub ? 'pl-4' : undefined}
                        >
                          <button
                            type="button"
                            onClick={() =>
                              onFocus(
                                selected ? null : { nodes: step.nodeIds, edges: step.edgeIds },
                              )
                            }
                            aria-pressed={selected}
                            className={`flex w-full items-start gap-2 rounded-control px-2 py-1 text-left text-body transition-colors hover:bg-hover focus-visible:-outline-offset-2 ${
                              selected ? 'bg-accent-soft' : ''
                            } ${gap ? 'border-l-2 border-warning/60' : ''}`}
                          >
                            <span className="min-w-0 text-dim" data-testid="playbook-text">
                              {withQuotes(text)}
                            </span>
                            {gap ? (
                              <span
                                className="ml-auto shrink-0 rounded-full border border-warning/40 bg-warning-soft px-2 py-0.5 text-caption text-warning"
                                title={W.defaultHint}
                              >
                                {W.defaultMark}
                              </span>
                            ) : null}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </li>
              ))}
            </ol>
          )}
        </div>
      ) : null}
    </section>
  );
}
