import {
  WORKFLOW_TEMPLATES,
  type ApprovalMode,
  type LegacyWorkflowV1,
  type WorkflowGraph,
  type WorkflowTemplateId,
} from '@acp/core';
import { useId, useState } from 'react';
import { Button } from '../../../components/Button';
import { Dialog } from '../../../components/Dialog';
import { AlertIcon } from '../../../components/icons';
import { WORKFLOW_GRAPH_COPY } from '../../../lib/copy';
import { CheckboxField, ChoiceCards } from '../../project-setup/fields';
import { restoredGraph, templateGraph } from './templates';

const T = WORKFLOW_GRAPH_COPY.templates;

/** A template's choice card: its name, then how changes are reviewed and what it is. */
export function templateOptions(): { value: WorkflowTemplateId; label: string; hint: string }[] {
  return WORKFLOW_TEMPLATES.map((t) => ({
    value: t.id,
    label: t.name,
    hint: `${T.styles[t.id]} ${t.description}`,
  }));
}

/**
 * "Start from a template" and "Restore my earlier setup" (README §5). Both replace what is in the
 * editor, never the saved workflow: nothing is stored until Save. With unsaved changes, the owner
 * confirms first. The earlier setup is offered only when the graph was migrated from version 1
 * (`legacyV1`), and a template keeps it, so it can still be restored later.
 */
export function TemplatePicker({
  graph,
  dirty,
  projectMode,
  onApply,
  onClose,
}: {
  graph: WorkflowGraph;
  dirty: boolean;
  projectMode: ApprovalMode;
  onApply: (graph: WorkflowGraph) => void;
  onClose: () => void;
}) {
  const name = useId();
  const [template, setTemplate] = useState<WorkflowTemplateId>(
    graph.template === 'custom' ? 'todays-setup' : graph.template,
  );
  const [planner, setPlanner] = useState(graph.nodes.some((n) => n.type === 'planner'));
  const [pending, setPending] = useState<WorkflowGraph | null>(null);
  const legacy: LegacyWorkflowV1 | undefined = graph.legacyV1;

  const choose = (next: WorkflowGraph) => {
    if (dirty) setPending(next);
    else onApply(next);
  };

  return (
    <Dialog
      title={T.title}
      description={T.description}
      onClose={onClose}
      testId="template-picker"
      closeLabel={T.cancel}
    >
      {pending !== null ? (
        <div className="flex flex-col gap-4" data-testid="template-confirm">
          <p
            role="alert"
            className="flex items-start gap-2 rounded-control border border-warning/25 bg-warning-soft px-3 py-2.5 text-caption text-warning"
          >
            <AlertIcon size={14} className="mt-px shrink-0" />
            {T.confirm}
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="quiet" onClick={() => setPending(null)}>
              {T.cancel}
            </Button>
            <Button variant="primary" data-autofocus onClick={() => onApply(pending)}>
              {T.replace}
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-5">
          <ChoiceCards<WorkflowTemplateId>
            legend={T.legend}
            name={`${name}-template`}
            value={template}
            columns={1}
            options={templateOptions()}
            onChange={setTemplate}
          />
          <CheckboxField
            label={T.planner}
            hint={T.plannerHint}
            checked={planner}
            onChange={setPlanner}
          />
          <Button
            variant="primary"
            className="w-fit"
            onClick={() =>
              choose(templateGraph(template, { planner, projectMode, legacyV1: legacy }))
            }
          >
            {T.use}
          </Button>
          {legacy !== undefined ? (
            <section
              className="-mx-5 flex flex-col gap-2 border-t border-line px-5 pt-4"
              data-testid="restore-earlier"
            >
              <h3 className="text-title font-semibold">{T.restoreTitle}</h3>
              <p className="text-caption text-dim">{T.restoreText}</p>
              <Button className="w-fit" onClick={() => choose(restoredGraph(legacy, projectMode))}>
                {T.restore}
              </Button>
            </section>
          ) : null}
        </div>
      )}
    </Dialog>
  );
}
