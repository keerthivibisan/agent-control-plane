/**
 * Starting points for a new skill (docs/history/redesign/README.md §4.3). Short on purpose: a skill
 * is read by an agent on every use, so each line should change what the agent does.
 */
export interface SkillTemplate {
  id: 'code-review' | 'unit-tests' | 'plan' | 'docs';
  label: string;
  /** The suggested folder name. */
  name: string;
  description: string;
  instructions: string;
}

export const SKILL_TEMPLATES: readonly SkillTemplate[] = [
  {
    id: 'code-review',
    label: 'Code review',
    name: 'code-review',
    description:
      'Review a finished change for bugs, risky edits and missing tests before it is merged.',
    instructions: `# Code review

Review the change like a careful senior engineer. Report findings; do not rewrite the code.

## Steps

1. Read the diff and the files it touches. Work out what the change is meant to do.
2. Look for correctness bugs first: wrong logic, unhandled errors, edge cases (empty, null, very large), races.
3. Check security: untrusted input, injection, secrets, unsafe file or shell use.
4. Check that changed behavior has tests, and that those tests would fail without the change.
5. Mention smaller issues (naming, dead code, duplication) only after the important ones.

## Output

For each finding: the file and line, what is wrong, why it matters, and a suggested fix. Order by severity. If nothing important is wrong, say so plainly.
`,
  },
  {
    id: 'unit-tests',
    label: 'Unit tests',
    name: 'unit-tests',
    description:
      'Write focused unit tests for new or changed behavior, or to pin down a bug before it is fixed.',
    instructions: `# Unit tests

Write tests that catch regressions, not tests that only raise coverage.

## Steps

1. Find the project's test framework, file layout and helpers, and follow them.
2. List the behaviors to cover: the main path, edge cases and error cases.
3. Write one small test per behavior, named after the expected result.
4. Keep tests deterministic: no network, no real clock, no state shared between tests.
5. Run the tests. Check that each new test fails when the behavior it covers breaks.

## Don't

- Change production code to make a test pass, unless you are fixing a real bug (say so).
- Mock the code under test.
`,
  },
  {
    id: 'plan',
    label: 'Plan',
    name: 'plan',
    description:
      'Turn a ticket into a short, reviewable implementation plan before any code is written.',
    instructions: `# Plan

Read before you plan, and do not edit files.

## Steps

1. Restate the goal in one or two sentences, and say what is out of scope.
2. Read the relevant code, docs and tests. Note the files that will change.
3. Split the work into small steps that can each be reviewed and tested on their own. Mark the steps that can run in parallel.
4. For each step, say what changes, where, and how it will be checked.
5. List risks, open questions and assumptions.

## Output

A numbered list of steps, then the risks and questions. Keep it short enough to review in two minutes.
`,
  },
  {
    id: 'docs',
    label: 'Docs',
    name: 'docs',
    description:
      'Update the documentation to match the code after behavior, commands or settings change.',
    instructions: `# Docs

Write for a reader who is new to the project.

## Steps

1. Find the docs that describe what changed: the README, guides, comments on public APIs, the changelog.
2. Update them to match the code exactly, and remove statements that are no longer true.
3. Use short sentences, concrete examples and commands you have actually run.
4. Don't describe planned behavior as if it already works.

## Output

The changed files, with a one-line summary of each change.
`,
  },
];
