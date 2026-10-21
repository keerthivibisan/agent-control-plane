import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { workflowTemplate, type WorkflowGraph } from '@acp/core';
import { body, setupSkills } from './helpers.js';

/*
 * "Used by" and the delete guard from the project's workflow graph (ADR-0023, WG-C): a node that
 * names a skill or an agent file counts; version 1 stage ids are still answered for older clients.
 * Throwaway repositories only.
 */

/** Today's setup with skills and agent files on some nodes, plus a named helper. */
function graphUsing(): WorkflowGraph {
  const g = workflowTemplate('todays-setup');
  const nodes = g.nodes.map((n) => {
    if (n.type === 'lead') return { ...n, skills: ['code-review'] };
    if (n.type === 'reviewer') return { ...n, agent: 'reviewer' };
    return n;
  });
  return {
    ...g,
    template: 'custom',
    nodes: [
      ...nodes,
      {
        type: 'helper',
        id: 'frontend',
        label: 'Frontend helper',
        description: '',
        model: null,
        skills: ['code-review', 'plan'],
        agent: 'reviewer',
        approvalMode: null,
        maxInstances: 1,
        canStartHelpers: false,
      },
    ],
    edges: [
      ...g.edges,
      { type: 'assigns', id: 'assigns-frontend', from: 'orchestrate', to: 'frontend' },
      { type: 'review', id: 'review-frontend', from: 'frontend', to: 'orchestrate' },
    ],
  };
}

function agentBody(name: string) {
  return {
    name,
    description: `The ${name}`,
    tools: null,
    model: null,
    instructions: 'Be brief.\n',
  };
}

describe('skills used by graph nodes', () => {
  it('lists usedByNodes and the version 1 stage ids among them', async () => {
    const { project, skills, state } = setupSkills();
    await skills.create(project, body('code-review'));
    await skills.create(project, body('plan'));
    await skills.create(project, body('unused'));
    state.graph = graphUsing();
    const list = await skills.list(project);
    expect(list.map((s) => [s.name, s.usedBy, s.usedByNodes])).toEqual([
      [
        'code-review',
        ['orchestrate'],
        [
          { nodeId: 'orchestrate', label: 'Lead' },
          { nodeId: 'frontend', label: 'Frontend helper' },
        ],
      ],
      ['plan', [], [{ nodeId: 'frontend', label: 'Frontend helper' }]],
      ['unused', [], []],
    ]);
  });

  it('refuses to delete a skill a node uses, naming the blocks; deletes it once none does', async () => {
    const { root, project, skills, state } = setupSkills();
    await skills.create(project, body('plan'));
    state.graph = graphUsing();
    const error = await skills.delete(project, 'plan').catch((e: unknown) => e);
    expect(error).toMatchObject({ status: 409, code: 'skill_in_use' });
    expect((error as Error).message).toBe(
      'The skill is used by these workflow blocks: Frontend helper. Remove it from them first.',
    );
    expect(existsSync(join(root, '.claude/skills/plan/SKILL.md'))).toBe(true);
    state.graph = workflowTemplate('lead-only');
    await skills.delete(project, 'plan');
    expect(existsSync(join(root, '.claude/skills/plan/SKILL.md'))).toBe(false);
  });

  it('a version 1 project answers its usedBy exactly as before, plus the migrated nodes', async () => {
    const { project, skills, state } = setupSkills();
    await skills.create(project, body('plan'));
    // Lead planner mode: the plan stage's skill goes to the lead node (`orchestrate`).
    state.workflow.stages.plan.skill = 'plan';
    const [dto] = await skills.list(project);
    expect(dto?.usedBy).toEqual(['plan']);
    expect(dto?.usedByNodes).toEqual([{ nodeId: 'orchestrate', label: 'Lead' }]);
  });
});

describe('agent files used by graph nodes', () => {
  it('refuses to delete an agent file a node uses, naming the blocks', async () => {
    const { root, project, agents, state } = setupSkills();
    await agents.create(project, agentBody('reviewer'));
    state.graph = graphUsing();
    const error = await agents.delete(project, 'reviewer').catch((e: unknown) => e);
    expect(error).toMatchObject({ status: 409, code: 'agent_in_use' });
    expect((error as Error).message).toBe(
      'The agent file is used by these workflow blocks: Change reviewer, Frontend helper. Remove it from them first.',
    );
    expect(existsSync(join(root, '.claude/agents/reviewer.md'))).toBe(true);
    state.graph = workflowTemplate('todays-setup');
    await agents.delete(project, 'reviewer');
    expect(existsSync(join(root, '.claude/agents/reviewer.md'))).toBe(false);
  });
});
