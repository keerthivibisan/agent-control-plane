import {
  describeWorkflow,
  type ManagedProviderId,
  type WorkflowGraphV3,
  type WorkflowSentence,
  type WorkflowSentenceSection,
} from '@acp/core';
import { useCallback, useId, useMemo, useState, type ReactNode } from 'react';
import { buttonClass } from '../../../components/Button';
import { ChevronDownIcon, ChevronRightIcon } from '../../../components/icons';
import { finishParts, isHiddenByFinish } from '../finish';
import { EDITOR_COPY } from './copy';
import type { Selection } from './state';

const W = EDITOR_COPY.words;
const SECTIONS: readonly WorkflowSentenceSection[] = ['agents', 'links', 'failures'];
const STORAGE_KEY = 'acp.workflow.words';

/** Whether the panel is open, remembered in this browser (every access guarded). */
export function useFlowWordsOpen(): [boolean, (open: boolean) => void] {
  const [open, setOpenState] = useState(() => {
    try {
      return window.localStorage.getItem(STORAGE_KEY) !== 'hidden';
    } catch {
      return true;
    }
  });
  const setOpen = useCallback((next: boolean) => {
    setOpenState(next);
    try {
      if (next) window.localStorage.removeItem(STORAGE_KEY);
      else window.localStorage.setItem(STORAGE_KEY, 'hidden');
    } catch {
      // No storage: the choice lasts for this page.
    }
  }, []);
  return [open, setOpen];
}

/**
 * What selecting a sentence selects: its arrow (a link, or the When arrow routing a failure), else
 * its block; a step the Finish block hides selects the Finish block.
 */
export function sentenceSelection(
  graph: WorkflowGraphV3,
  sentence: WorkflowSentence,
): NonNullable<Selection> | null {
  if (sentence.edgeId !== undefined) return { kind: 'edge', id: sentence.edgeId };
  if (sentence.nodeId === undefined) return null;
  const parts = finishParts(graph);
  const id =
    parts !== null && isHiddenByFinish(parts, sentence.nodeId) ? parts.ownerMerge : sentence.nodeId;
  return { kind: 'node', id };
}

/** The sentence with the owner's quoted words set apart (the quotes stay: the text is unchanged). */
function withQuotes(text: string): ReactNode[] {
  // `quoteInline` turns the owner's own double quotes into single ones, so pairs never nest.
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

/**
 * "Flow in words" (ADR-0038 §5): core's `describeWorkflow` of the graph being edited, the same
 * sentences the lead reads in its brief, grouped as the lead reads them. Selecting a sentence
 * selects its block or arrow; a failure nobody routes is marked "Lead decides (default)", so the
 * gaps stand out. Collapsible; the choice is remembered in this browser.
 */
export function FlowWords({
  graph,
  projectProvider,
  selection,
  onSelect,
}: {
  graph: WorkflowGraphV3;
  projectProvider?: ManagedProviderId | null | undefined;
  selection: Selection;
  onSelect: (selection: NonNullable<Selection>) => void;
}) {
  const [open, setOpen] = useFlowWordsOpen();
  const bodyId = useId();
  const sentences = useMemo(
    () =>
      describeWorkflow(
        graph,
        projectProvider === null || projectProvider === undefined ? {} : { projectProvider },
      ),
    [graph, projectProvider],
  );
  return (
    <section
      aria-label={W.title}
      data-testid="flow-words"
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
          data-testid="flow-words-toggle"
        >
          {open ? <ChevronDownIcon size={14} /> : <ChevronRightIcon size={14} />}
          {W.title}
        </button>
      </div>
      {open ? (
        <div
          id={bodyId}
          className="flex flex-col gap-4 border-t border-line px-4 pt-3 pb-4"
          data-testid="flow-words-body"
        >
          <p className="text-caption text-dim">{W.intro}</p>
          {sentences.length === 0 ? (
            <p className="text-caption text-dim">{W.empty}</p>
          ) : (
            SECTIONS.map((section) => {
              const list = sentences.filter((s) => s.section === section);
              if (list.length === 0) return null;
              return (
                <div key={section} className="flex flex-col gap-1.5">
                  <h3 className="text-caption font-semibold text-dim">{W.sections[section]}</h3>
                  <ul className="flex flex-col gap-0.5" data-testid={`flow-words-${section}`}>
                    {list.map((s, i) => (
                      <SentenceRow
                        key={`${section}-${i}`}
                        sentence={s}
                        target={sentenceSelection(graph, s)}
                        selection={selection}
                        onSelect={onSelect}
                      />
                    ))}
                  </ul>
                </div>
              );
            })
          )}
        </div>
      ) : null}
    </section>
  );
}

function SentenceRow({
  sentence,
  target,
  selection,
  onSelect,
}: {
  sentence: WorkflowSentence;
  target: NonNullable<Selection> | null;
  selection: Selection;
  onSelect: (selection: NonNullable<Selection>) => void;
}) {
  const gap = sentence.routing === 'default';
  const selected = target !== null && selection?.kind === target.kind && selection.id === target.id;
  const text = (
    <span className="min-w-0 text-dim" data-testid="flow-words-text">
      {withQuotes(sentence.text)}
    </span>
  );
  const mark = gap ? (
    <span
      className="ml-auto shrink-0 rounded-full border border-warning/40 bg-warning-soft px-2 py-0.5 text-caption text-warning"
      title={W.defaultHint}
      data-testid="flow-words-default"
    >
      {W.defaultMark}
    </span>
  ) : null;
  return (
    <li
      data-testid="flow-words-sentence"
      data-routing={sentence.routing}
      data-selected={selected ? 'true' : undefined}
    >
      {target === null ? (
        <span className="flex items-start gap-2 px-2 py-1 text-body">
          {text}
          {mark}
        </span>
      ) : (
        <button
          type="button"
          onClick={() => onSelect(target)}
          className={`flex w-full items-start gap-2 rounded-control px-2 py-1 text-left text-body transition-colors hover:bg-hover focus-visible:-outline-offset-2 ${
            selected ? 'bg-accent-soft' : ''
          } ${gap ? 'border-l-2 border-warning/60' : ''}`}
          data-testid="flow-words-select"
        >
          {text}
          {mark}
        </button>
      )}
    </li>
  );
}
