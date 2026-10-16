import type { WorkflowStageId } from '@acp/core';

/**
 * Starting points for a new agent definition (Claude Code subagent; ADR-0018 amendment). Each one
 * names only the tools its job needs, so a review or a plan cannot edit files by accident, and
 * only tools the stages it suits really get: a stage's agent file narrows the role's base set,
 * never widens it (ADR-0019 §6/§7). The description says which stages it suits.
 */
export interface AgentTemplate {
  id: 'reviewer' | 'test-writer' | 'planner';
  label: string;
  /** The suggested file name (without `.md`). */
  name: string;
  description: string;
  /** Null would mean "all tools"; every template narrows them on purpose. */
  tools: readonly string[];
  /** The workflow stages it suits; its tools fit each stage's base set (tests check this). */
  stages: readonly WorkflowStageId[];
  instructions: string;
}

const READ_ONLY = ['Read', 'Grep', 'Glob'] as const;

export const AGENT_TEMPLATES: readonly AgentTemplate[] = [
  {
    id: 'reviewer',
    label: 'Code reviewer',
    name: 'reviewer',
    description:
      'Reviews a finished change for bugs, risky edits and missing tests by reading the code. Use after code is written and merged. Suits the Final code review stage, which only reads.',
    tools: [...READ_ONLY],
    stages: ['code-review'],
    instructions: `You are a careful senior code reviewer. You only read files: you do not edit them and you do not run commands.

Your folder holds the merged result. When you are given a change:

1. Start from the task and the merged work you are told about. Find the files it touches with Glob and Grep (file names, function and type names, error messages), then read each one in full, not only the lines that look new.
2. Look for correctness bugs first: wrong logic, unhandled errors, edge cases, races.
3. Then security: untrusted input, injection, secrets, unsafe file or shell use.
4. Then tests: find the tests for the changed behavior (Glob for test files, Grep for the names). Would they fail without the change?
5. Mention style only after everything above.

Report each finding with the file and line, what is wrong, why it matters and a suggested fix, most severe first. If nothing important is wrong, say so plainly.
`,
  },
  {
    id: 'test-writer',
    label: 'Test writer',
    name: 'test-writer',
    description:
      'Writes focused unit tests for new or changed behavior and runs them. Use when code changed without tests. Suits the Unit tests stage (and Helpers), which can edit files and run commands.',
    tools: [...READ_ONLY, 'Edit', 'Write', 'Bash'],
    stages: ['unit-tests', 'helpers'],
    instructions: `You write unit tests that catch regressions.

1. Find the project's test framework, file layout and helpers, and follow them.
2. List the behaviors to cover: the main path, edge cases and errors.
3. Write one small, deterministic test per behavior, named after the expected result. No network, no real clock.
4. Run the tests and make sure each new test fails when the behavior it covers breaks.

Do not change production code. If a test shows a bug, leave the test and say so in your answer. Reply with the tests you added and the command you ran.
`,
  },
  {
    id: 'planner',
    label: 'Planner',
    name: 'planner',
    description:
      'Turns a task into a short, reviewable implementation plan without editing anything. Use before starting larger work. Suits the Plan stage, which only reads.',
    tools: [...READ_ONLY],
    stages: ['plan'],
    instructions: `You plan; you never edit files.

1. Restate the goal in one or two sentences, and say what is out of scope.
2. Read the relevant code, docs and tests, and note the files that will change.
3. Split the work into small steps that can each be reviewed and tested on their own; mark those that can run in parallel.
4. For each step, say what changes, where, and how it will be checked.
5. End with risks, open questions and assumptions.

Keep the plan short enough to review in two minutes.
`,
  },
];

/** Tools offered as quick-add chips (Claude Code's built-in tool names). */
export const COMMON_TOOLS: readonly string[] = [
  'Read',
  'Grep',
  'Glob',
  'Edit',
  'Write',
  'Bash',
  'WebFetch',
  'WebSearch',
  'TodoWrite',
];
