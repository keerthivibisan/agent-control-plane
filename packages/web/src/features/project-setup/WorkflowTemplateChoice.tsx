import type { ApprovalMode, WorkflowGraph, WorkflowTemplateId } from '@acp/core';
import { useId } from 'react';
import { WORKFLOW_GRAPH_COPY } from '../../lib/copy';
import { templateOptions } from '../workflow/editor/TemplatePicker';
import { templateGraph } from '../workflow/editor/templates';
import { CheckboxField, ChoiceCards, FormSection } from './fields';

const W = WORKFLOW_GRAPH_COPY.wizard;
const T = WORKFLOW_GRAPH_COPY.templates;

/** The wizard's workflow choice: a template, or "Build my own" (today's setup, marked custom). */
export interface WorkflowChoice {
  template: WorkflowTemplateId | 'custom';
  planner: boolean;
}

/** What a new project gets when the owner doesn't choose: the server's default, today's setup. */
export const DEFAULT_WORKFLOW_CHOICE: WorkflowChoice = { template: 'todays-setup', planner: false };

/**
 * True when the choice is the default. Then the wizard saves no graph: a project without one
 * answers today's setup (migrated from its version 1 default), which is the same workflow.
 */
export function isDefaultChoice(choice: WorkflowChoice): boolean {
  return (
    choice.template === DEFAULT_WORKFLOW_CHOICE.template &&
    choice.planner === DEFAULT_WORKFLOW_CHOICE.planner
  );
}

/** The graph the wizard saves for the choice, with the plan step following the project's mode. */
export function choiceGraph(choice: WorkflowChoice, projectMode: ApprovalMode): WorkflowGraph {
  const graph = templateGraph(choice.template === 'custom' ? 'todays-setup' : choice.template, {
    planner: choice.planner,
    projectMode,
  });
  return choice.template === 'custom' ? { ...graph, template: 'custom' } : graph;
}

/**
 * How changes are reviewed: the three templates, each with its review style in one sentence, or
 * "Build my own", plus the planner switch (every template takes it).
 */
export function WorkflowTemplateChoice({
  value,
  onChange,
}: {
  value: WorkflowChoice;
  onChange: (next: WorkflowChoice) => void;
}) {
  const name = useId();
  return (
    <FormSection title={W.legend} description={W.hint} testId="wizard-workflow">
      <ChoiceCards<WorkflowTemplateId | 'custom'>
        legend={T.legend}
        name={`${name}-template`}
        value={value.template}
        columns={2}
        options={[
          ...templateOptions(),
          { value: 'custom', label: W.buildOwn, hint: W.buildOwnHint },
        ]}
        onChange={(template) => onChange({ ...value, template })}
      />
      <CheckboxField
        label={T.planner}
        hint={T.plannerHint}
        checked={value.planner}
        onChange={(planner) => onChange({ ...value, planner })}
      />
    </FormSection>
  );
}
