import type { WorkflowEdgeType } from '@acp/core';
import { countOf } from '../../../lib/copy';

/*
 * The editor's words added by v0.3.0 D-C (the clearer Workflow editor). They sit next to the
 * editor rather than in lib/copy.ts because D-C owns only `features/workflow/**`; the rest of the
 * editor's words stay in `WORKFLOW_GRAPH_COPY`. Plain owner words: blocks and links.
 */
export const EDITOR_COPY = {
  header: {
    problems: 'Problems',
    problemsLabel: (errors: number, warnings: number) =>
      errors + warnings === 0
        ? 'Problems: none'
        : `Problems: ${[
            errors > 0 ? countOf(errors, 'problem to fix', 'problems to fix') : null,
            warnings > 0 ? countOf(warnings, 'warning') : null,
          ]
            .filter((p) => p !== null)
            .join(', ')}`,
  },
  toolbar: {
    label: 'Canvas tools',
    addBlock: 'Add block',
    agents: 'Agents',
    checkers: 'Reviewers and testers',
    legend: 'Legend',
    showLegend: 'Show the legend',
    hideLegend: 'Hide the legend',
    how: 'How this works',
    howSentences: [
      'Each block is an agent or a step, and its kind fixes what it may do.',
      'Drag from any edge or dot of a block onto another block (or click a dot, then the block) to link them; only allowed links light up.',
      'Fix the problems, then press Save: nothing changes until you do.',
    ],
    undo: 'Undo',
    redo: 'Redo',
    undoTitle: (keys: string) => `Undo (${keys})`,
    redoTitle: (keys: string) => `Redo (${keys})`,
    tidy: 'Tidy layout',
    tidyTitle: 'Put every block back in the automatic layout',
    tidyDone: 'Already tidy: every block is in the automatic layout',
  },
  linkTo: {
    button: 'Link to…',
    title: (label: string) => `Link ${label} to…`,
    none: 'No block can be linked from here',
  },
  clickLink: {
    hint: (label: string) =>
      `Linking from ${label}: click a highlighted block to link it, or press Escape.`,
    cancel: 'Cancel',
  },
  zoom: {
    label: 'Zoom',
    in: 'Zoom in',
    out: 'Zoom out',
    fit: 'Fit',
    fitLabel: 'Fit the workflow to the canvas',
    level: (percent: number) => `${percent}%`,
  },
  legend: {
    blocks: 'Blocks',
    links: 'Links',
    agent: 'Agent',
    lead: 'Lead',
    step: 'Step',
    you: 'You decide',
    edges: {
      flow: 'Next step',
      assigns: 'Assigns work',
      review: 'Review',
      findings: 'Findings',
      rework: 'Rework',
      merge: 'Merge',
    } satisfies Record<WorkflowEdgeType, string>,
  },
  block: {
    skills: (n: number) => (n === 0 ? 'No skills' : countOf(n, 'skill')),
    skillsMissing: (names: readonly string[]) =>
      `Not in the project: ${names.join(', ')}. The agent starts without ${names.length === 1 ? 'it' : 'them'}.`,
    skillsList: (names: readonly string[]) => `Skills: ${names.join(', ')}`,
    agentFile: (name: string) => `Agent file: ${name}`,
    agentFileMissing: (name: string) =>
      `Agent file not found: ${name}. The agent starts without it.`,
    instances: (n: number) => `×${n}`,
    defaultModel: 'Default model',
    you: 'You',
    auto: 'Auto',
    problems: (errors: number, warnings: number) =>
      [
        errors > 0 ? countOf(errors, 'problem') : null,
        warnings > 0 ? countOf(warnings, 'warning') : null,
      ]
        .filter((p) => p !== null)
        .join(', '),
    more: (n: number) => `and ${countOf(n, 'more')}`,
    validTarget: 'Can link here',
    linkFrom: (label: string) => `Link from ${label}: press Enter, then choose a block`,
  },
  chooser: {
    title: 'What does this link do?',
  },
  issues: {
    errors: 'Fix these to save',
    warnings: 'Warnings (you can still save)',
    selectHint: 'Select a block or a link on the canvas to change it.',
    blockTitle: 'Problems with this block',
    linkTitle: 'Problems with this link',
  },
} as const;
