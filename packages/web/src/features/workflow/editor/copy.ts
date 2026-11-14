import type { WorkflowEdgeTypeV3 } from '@acp/core';
import { countOf } from '../../../lib/copy';
import type { AgentKind } from './roles';

/** What the "Add block" menu adds (ADR-0037): the Agent block, or an agent with its arrow drawn. */
export type PresetKey =
  'agent' | 'researcher' | 'planner' | 'helper' | 'change-reviewer' | 'final-reviewer' | 'tester';

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
      'Each block is an agent or a step. An agent’s role comes from its arrows, and its role fixes what it may do.',
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
      research: 'Research',
      plan: 'Plan',
      implement: 'Implement',
      review: 'Review',
      findings: 'Findings',
      rework: 'Rework',
      test: 'Test',
      custom: 'Custom',
      merge: 'Merge',
      when: 'When',
    } satisfies Record<WorkflowEdgeTypeV3, string>,
  },
  /** Version 3 arrows (ADR-0037 §2): the long name and one sentence per type. */
  arrows: {
    names: {
      flow: 'Next step',
      research: 'Researches for',
      plan: 'Sends its plan',
      implement: 'Gives work',
      review: 'Sends its change for review',
      findings: 'Sends its findings',
      rework: 'Sends the change back for rework',
      test: 'Hands the ticket branch for tests',
      custom: 'Custom hand-off',
      merge: 'Merges through',
      when: 'When it fails, sends to',
    } satisfies Record<WorkflowEdgeTypeV3, string>,
    text: {
      flow: 'The order of the steps: the plan path, then after the ticket merge the final reviewers and the Finish block. A flow into an agent on the final chain makes it a final reviewer.',
      research:
        'The source runs first and only reads; its findings note goes into the target’s prompt. It makes the source a researcher.',
      plan: 'The source writes a plan and sends it to Plan approval. It makes the source a planner; with two or more planners you pick one plan.',
      implement:
        'The lead gives work to the target, which makes it a helper: it changes files in its own copy of the project.',
      review:
        'Who reviews this agent’s change: a change reviewer or the lead. Several review arrows send the change to every reviewer.',
      findings: 'The change reviewer passes its verdict and findings to the lead, who decides.',
      rework:
        'This reviewer or the lead may send the change back to its author, up to a number of rounds. A change reviewer that does this works with the helper directly and keeps the lead informed.',
      test: 'The tester writes tests for the merged ticket branch in its own copy. It makes the target a tester.',
      custom:
        'Order and hand-off only: the target starts after the source finishes and gets the source’s output note with this arrow’s label and purpose. It gives no role.',
      merge:
        'The lead merges each reviewed change into the ticket branch, through the Checks block before the merge when the workflow has one.',
      when: 'When a failure happens here (tests or checks fail, a reviewer asks for rework, the harness cannot run, a merge conflicts), the target fixes it: a helper, the lead or the author, up to a number of rounds; then the lead decides. It gives no role.',
    } satisfies Record<WorkflowEdgeTypeV3, string>,
  },
  /** One Agent block (ADR-0037 §1): its role comes from its arrows. */
  roles: {
    kinds: {
      researcher: 'Researcher',
      planner: 'Planner',
      helper: 'Named helper',
      'helper-pool': 'Helper pool',
      'reviewer-change': 'Change reviewer',
      'reviewer-final': 'Final reviewer',
      tester: 'Tester',
      agent: 'Agent',
      mixed: 'Agent',
    } satisfies Record<AgentKind, string>,
    badge: {
      researcher: 'Researcher',
      planner: 'Planner',
      helper: 'Helper',
      'helper-pool': 'Helper pool',
      'reviewer-change': 'Change reviewer',
      'reviewer-final': 'Final reviewer',
      tester: 'Tester',
      agent: 'No role',
      mixed: 'Two roles',
    } satisfies Record<AgentKind, string>,
    badgeLabel: (role: string) => `Role: ${role}`,
    kindText: {
      researcher:
        'Reads the project and reports what it finds to the agent it researches for. It never changes a file.',
      planner: 'Reads the ticket and the project and writes a plan. It never changes a file.',
      helper:
        'A helper with its own name, for example “Frontend helper”. Plan steps can name it, and it works in its own copy of the project.',
      'helper-pool':
        'Helpers the lead starts for any step no named helper takes, each in its own copy of the project.',
      'reviewer-change':
        'Reads each change it is sent and passes its findings to the lead. It never changes a file.',
      'reviewer-final':
        'Reads the merged ticket branch at the end and posts its findings as ticket comments. It never changes a file.',
      tester:
        'Writes unit tests for the merged work in its own copy. Its change is reviewed like any other.',
      agent:
        'An agent gets its role from its arrows. Draw a research, plan, review or test arrow, or have the lead give it work.',
      mixed:
        'Its arrows give this agent two roles. An agent has one role: remove an arrow, or add another agent block.',
    } satisfies Record<AgentKind, string>,
    roleTitle: 'Role',
    roleHint: 'The role comes from the arrows: change them to change what this agent does.',
    pool: 'This helper is the helper pool',
    poolHint:
      'The lead starts it for any step no named helper takes, up to the project’s helper limit. A workflow has at most one pool.',
  },
  palette: {
    agentGroup: 'Agent',
    presetGroup: 'Agent with its arrow',
    items: {
      agent: 'Agent',
      researcher: 'Researcher',
      planner: 'Planner',
      helper: 'Helper',
      'change-reviewer': 'Reviewer (change)',
      'final-reviewer': 'Final reviewer',
      tester: 'Tester',
    } satisfies Record<PresetKey, string>,
    hints: {
      agent: 'One block for any agent: its role comes from the arrows you draw.',
      researcher: 'Reads first and reports to the planner, or to the lead without one.',
      planner: 'Writes a plan for Plan approval. With two or more planners you pick one plan.',
      helper: 'The lead gives it work; it changes files in its own copy.',
      'change-reviewer': 'Reviews a helper’s change and passes its findings to the lead.',
      'final-reviewer': 'Reads the merged ticket branch at the end. Added just before your merge.',
      tester: 'Writes unit tests for the merged work. Added just before your merge.',
    } satisfies Record<PresetKey, string>,
    newLabels: {
      agent: 'Agent',
      researcher: 'Researcher',
      planner: 'Planner',
      helper: (n: number) => `Helper ${n}`,
      'change-reviewer': 'Change reviewer',
      'final-reviewer': 'Code reviewer',
      tester: 'Tester',
    },
  },
  edgePanel: {
    from: 'From',
    to: 'To',
    label: 'Label',
    labelHint: 'A few words shown on the arrow in the canvas.',
    purpose: 'Purpose',
    purposeHint:
      'Why this arrow exists, in your words. The target agent reads it as information, never as instructions.',
    /**
     * Who reads the purpose (ADR-0037 §2, amended 2026-11-14), from core's `arrowNoteReceiver`:
     * `to` is the agent that receives it (a plan arrow's planner is its source), `from` the
     * arrow's source.
     */
    purposeTo: (type: WorkflowEdgeTypeV3, from: string, to: string): string => {
      switch (type) {
        case 'research':
          return `Sent to ${from} in its brief, and to ${to} with the findings.`;
        case 'custom':
          return `Sent to ${to} with ${from}’s hand-off.`;
        case 'implement':
          return `Sent to ${to} in its brief and rework requests; the Lead sees it in its helper list.`;
        case 'review':
          return `Sent to ${to} in its brief for each change it reviews.`;
        case 'findings':
          return `Sent to ${to} with ${from}’s verdict.`;
        case 'rework':
          return `Sent to ${to} with each rework request from ${from}.`;
        default:
          return `Sent to ${to} in its brief.`;
      }
    },
    purposeToNone: 'Not sent to any agent (arrow between steps).',
    counter: (n: number, max: number) => `${n}/${max}`,
    counterLabel: (n: number, max: number) => `${n} of ${max} characters`,
    tooLong: (max: number) => `Use at most ${max} characters.`,
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
  /** ADR-0038 §4: the Author block, a routing block in the "Add block" menu. */
  author: {
    group: 'Routing',
    item: 'Author',
    hint: 'Whoever wrote the failing code: ACP finds the helper whose change touched the failing files. Point a When arrow at it.',
    full: 'The workflow already has its Author block.',
  },
  /** ADR-0038 §4: a When arrow's settings in the link's panel. */
  when: {
    events: 'When',
    eventsHint: 'The failures at this block that this arrow routes. Each failure has one route.',
    /** An event name after "When" ("tests fail"), as a checkbox label. */
    event: (name: string) => `${name.charAt(0).toUpperCase()}${name.slice(1)}`,
    foreign: 'This block never raises it: untick it.',
    rounds: 'Fix rounds',
    roundsHint: 'How many times the fixer may try before the lead decides.',
    roundsValue: (n: number) => countOf(n, 'fix round', 'fix rounds'),
    /** Who receives a routed failure (FR-D "Run time"), by the arrow's target. */
    receives: (target: { kind: 'lead' } | { kind: 'author' } | { kind: 'node'; label: string }) => {
      switch (target.kind) {
        case 'lead':
          return 'The lead gets the failure with its context and decides who fixes it.';
        case 'author':
          return 'The helper whose change touched the failing files gets a fix turn with the failure’s context and this arrow’s purpose. The lead is told and can step in.';
        case 'node':
          return `${target.label} gets a fix turn with the failure’s context and this arrow’s purpose. The lead is told and can step in.`;
      }
    },
    roundsOut: 'When the rounds run out, the lead decides.',
    /** The arrow's words on the canvas: its events, then its rounds. */
    canvas: (names: readonly string[], rounds: number) => `${names.join(', ')} ×${rounds}`,
  },
  /** ADR-0038 §5: the workflow in words, the same sentences the lead reads. */
  words: {
    title: 'Flow in words',
    show: 'Show the flow in words',
    hide: 'Hide the flow in words',
    intro:
      'The lead reads exactly these sentences. Words in double quotes are yours. Select a sentence to select its block or link.',
    sections: {
      agents: 'Agents',
      links: 'Links',
      failures: 'When something fails',
    },
    defaultMark: 'Lead decides (default)',
    defaultHint: 'No route: draw a When arrow from this block to choose who fixes it.',
    empty: 'Nothing to describe yet.',
  },
  issues: {
    errors: 'Fix these to save',
    warnings: 'Warnings (you can still save)',
    selectHint: 'Select a block or a link on the canvas to change it.',
    blockTitle: 'Problems with this block',
    linkTitle: 'Problems with this link',
  },
} as const;
