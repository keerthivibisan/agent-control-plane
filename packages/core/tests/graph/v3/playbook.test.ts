import { describe, expect, it } from 'vitest';
import {
  WORKFLOW_TEMPLATE_IDS,
  playbookStages,
  renderPlaybook,
  specialiseForTicket,
  whenToUse,
  workflowPlaybook,
  workflowTemplateV3,
  type PlaybookStage,
} from '../../../src/index.js';

/*
 * ADR-0040: the lead's playbook, the workflow in run order, and every block's stage.
 */

const keys = (stages: readonly PlaybookStage[]) => stages.map((s) => s.key);
const stage = (stages: readonly PlaybookStage[], key: string) =>
  stages.find((s) => s.key === key)?.steps.map((s) => s.text) ?? [];

describe('workflowPlaybook', () => {
  it('numbers the BDD template in run order, each failure under its stage', () => {
    const stages = workflowPlaybook(workflowTemplateV3('bdd'));
    expect(keys(stages)).toEqual(['start', 'plan', 'build', 'review', 'merge', 'final', 'finish']);
    expect(stages.map((s) => s.n)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(stage(stages, 'start')[1]).toMatch(
      /^"Behaviour analyst" researches before the plan, for "Lead" \(feature tickets only\)\./,
    );
    const build = stage(stages, 'build');
    expect(build[0]).toMatch(/several at the same time/);
    expect(build[1]).toMatch(/^- "Scenario tests" \(feature tickets only\): use for "Writes/);
    expect(build[2]).toMatch(/^- "Developer": use for "Builds the behaviour or the fix"\./);
    const final = stage(stages, 'final');
    expect(final[0]).toMatch(/^"Tester" tests the ticket branch\./);
    expect(final[1]).toBe('"Lead" reviews each change of "Tester".');
    expect(final[2]).toMatch(/^If tests fail at "Tester" → Author fixes and "Tester" tests again/);
    expect(stage(stages, 'merge').at(-1)).toBe(
      'If a merge conflicts at "Ticket branch" → Lead decides (default).',
    );
  });

  it('points each step at its blocks and links', () => {
    const stages = workflowPlaybook(workflowTemplateV3('bdd'));
    const dev = stages.find((s) => s.key === 'build')?.steps[2];
    expect(dev?.nodeIds).toEqual(['developer']);
    expect(dev?.edgeIds).toEqual(['implement-orchestrate-developer']);
    const fails = stages.find((s) => s.key === 'final')?.steps.at(-1);
    expect(fails?.routing).toBe('when');
    expect(fails?.edgeIds).toEqual(['when-unit-tests-author']);
  });

  it('leaves out the stages a bug ticket skips, and renumbers', () => {
    const bug = workflowPlaybook(specialiseForTicket(workflowTemplateV3('bdd'), 'bug').graph);
    expect(stage(bug, 'start')).toEqual(['A ticket starts the run.']);
    expect(stage(bug, 'build').join(' ')).not.toContain('Scenario tests');
  });

  it('says who plans: several planners, one planner, or the lead', () => {
    const one = workflowPlaybook(workflowTemplateV3('lead-only', { planner: true }));
    expect(stage(one, 'plan')[0]).toBe('"Planner" writes the plan; "Lead" runs it.');
    expect(stage(workflowPlaybook(workflowTemplateV3('lead-only')), 'plan')[0]).toBe(
      '"Lead" writes the plan.',
    );
  });

  for (const id of WORKFLOW_TEMPLATE_IDS) {
    for (const planner of [false, true]) {
      it(`gives every block of ${id}${planner ? ' with a planner' : ''} a stage, and every stage a step`, () => {
        const g = workflowTemplateV3(id, { planner });
        const stages = playbookStages(g);
        expect([...stages.keys()].sort()).toEqual(g.nodes.map((n) => n.id).sort());
        for (const s of workflowPlaybook(g)) expect(s.steps.length).toBeGreaterThan(0);
      });
    }
  }
});

describe('whenToUse', () => {
  const g = workflowTemplateV3('bdd');
  it('says what starts each agent the lead does not choose', () => {
    expect(whenToUse(g, 'behaviour')).toBe('Runs before the plan, for "Lead"');
    expect(whenToUse(g, 'unit-tests')).toBe('Tests the ticket branch after the merge');
    expect(whenToUse(g, 'developer')).toBeUndefined();
    expect(whenToUse(g, 'orchestrate')).toBeUndefined();
    const loop = workflowTemplateV3('reviewer-helper-loop');
    expect(whenToUse(loop, 'review')).toBe('Reviews each change of "Helpers"');
  });
});

describe('renderPlaybook', () => {
  it('is the data note, the numbered stages, then the agents', () => {
    const text = renderPlaybook(workflowTemplateV3('bdd'));
    expect(text.startsWith("Words in double quotes are the owner's")).toBe(true);
    expect(text).toContain('\n\n1. Ticket and research\n- A ticket starts the run.');
    expect(text).toContain('\n  - "Developer": use for');
    expect(text).toContain('\n\nAgents:\n- "Lead" is the lead');
  });
});
