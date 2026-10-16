import { mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { ProjectDto } from '@acp/core/api';
import { tempDir } from '../../workspace/helpers.js';
import {
  createProject,
  createTicket,
  expectStatus,
  logLines,
  setupBody,
  startTicket,
  submitPlan,
  ticketDetail,
} from '../workspace/harness.js';
import {
  agentFileBody,
  appendedPrompt,
  bootRedesign,
  defaultStages,
  saveWorkflow,
  type RedesignServer,
} from './harness.js';

/*
 * R-V: which stage agent file reaches the lead, and what happens when a file can't be used
 * (docs/redesign/README.md §6a, ADR-0019 §6), end to end over HTTP with the real adapter's SDK
 * options. A missing or unsafe file never blocks the run: the agent starts without it, and the
 * server logs the reason code (never the file's text).
 */

const open: RedesignServer[] = [];
afterEach(async () => {
  for (const b of open.splice(0)) await b.close();
});

async function project(b: RedesignServer, model: string | null = null): Promise<ProjectDto> {
  const p = await createProject(b, 'shop');
  expectStatus(await b.put(`/api/projects/${p.id}/setup`, setupBody('SHOP', { model })), 200);
  return p;
}

async function addAgent(
  b: RedesignServer,
  p: ProjectDto,
  name: string,
  tools: string[] | null,
  model: string | null,
): Promise<void> {
  const body = agentFileBody(name, tools, model, `RV-${name.toUpperCase()}-BODY\n`);
  expectStatus(await b.post(`/api/projects/${p.id}/agents`, body), 201);
}

async function startLead(b: RedesignServer, p: ProjectDto) {
  const ticket = await createTicket(b, p.id, {
    title: 'Synthetic R-V ticket',
    description: 'Synthetic.',
    type: 'feature',
    priority: 'medium',
    labels: [],
  });
  return { ticket, ...(await startTicket(b, ticket.id)) };
}

describe('R-V: stage agent files reaching the lead (HTTP, real adapter options)', () => {
  it("lead mode: the orchestrate stage's file wins over the plan stage's", async () => {
    const b = await bootRedesign();
    open.push(b);
    const p = await project(b);
    await addAgent(b, p, 'plan-file', ['Read'], 'claude-plan-file-model');
    await addAgent(b, p, 'orch-file', ['Read', 'Grep', 'Glob', 'Agent'], null);
    const stages = defaultStages();
    stages.plan = { model: null, skill: null, agent: 'plan-file' };
    stages.orchestrate = { model: null, skill: null, agent: 'orch-file' };
    await saveWorkflow(b, p.id, { plannerMode: 'lead', stages });

    const { lead } = await startLead(b, p);
    expect(lead.spec.profile).toMatchObject({ name: 'orch-file' });
    const sdk = b.sdkFor(lead.id);
    // The file only narrows the lead's base set (ADR-0019 §7): its `Agent` is not added.
    expect(sdk.tools).toEqual(['Read', 'Grep', 'Glob']);
    expect(sdk.allowedTools).toBeUndefined();
    // No stage model, no file model, no project model: the provider default (no `model`).
    expect(sdk.model).toBeUndefined();
    expect(appendedPrompt(sdk)).toContain('RV-ORCH-FILE-BODY');
    expect(appendedPrompt(sdk)).not.toContain('RV-PLAN-FILE-BODY');
  });

  it("lead mode with only the plan stage's file: the lead uses it, and its model beats the project's", async () => {
    const b = await bootRedesign();
    open.push(b);
    const p = await project(b, 'claude-project-model');
    await addAgent(b, p, 'plan-file', null, 'claude-plan-file-model');
    const stages = defaultStages();
    stages.plan = { model: null, skill: null, agent: 'plan-file' };
    await saveWorkflow(b, p.id, { plannerMode: 'lead', stages });

    const { lead } = await startLead(b, p);
    expect(lead.spec.profile).toEqual({
      name: 'plan-file',
      instructions: 'RV-PLAN-FILE-BODY\n',
      tools: null,
    });
    const sdk = b.sdkFor(lead.id);
    // "All tools" (no `tools` in the file) means the role's base set (ADR-0019 §7): no narrowing.
    expect(sdk.tools).toEqual(['Read', 'Grep', 'Glob']);
    expect(sdk.model).toBe('claude-plan-file-model');
  });

  it('a missing file and a symlinked file: the agent starts without them and the run goes on', async () => {
    const b = await bootRedesign();
    open.push(b);
    const p = await project(b, 'claude-project-model');
    // A file outside the project, linked in: never read (ADR-0018 path rules).
    const outside = tempDir('acp-rv-outside-');
    writeFileSync(
      join(outside, 'linked.md'),
      '---\nname: linked\ndescription: Not ours.\n---\nRV-LINKED-SECRET-BODY\n',
    );
    mkdirSync(join(p.rootPath, '.claude', 'agents'), { recursive: true });
    symlinkSync(join(outside, 'linked.md'), join(p.rootPath, '.claude', 'agents', 'linked.md'));
    const stages = defaultStages();
    stages.orchestrate = { model: null, skill: null, agent: 'linked' };
    stages['code-review'] = { enabled: true, model: null, skill: null, agent: 'gone-agent' };
    await saveWorkflow(b, p.id, { plannerMode: 'lead', stages });

    const { ticket, lead } = await startLead(b, p);
    expect(lead.spec.profile).toBeUndefined();
    expect(lead.spec.model).toBe('claude-project-model');
    expect(appendedPrompt(b.sdkFor(lead.id))).not.toContain('Stage agent file');
    const logged = logLines(b.logs, 'project agent file unavailable');
    expect(logged).toHaveLength(1);
    expect(logged[0]).toMatchObject({ agentFile: 'linked' });
    expect(b.logs.join('\n')).not.toContain('RV-LINKED-SECRET-BODY');
    // The run is not blocked.
    await submitPlan(b, ticket.id, lead, 'Go on without the file');
    expect((await ticketDetail(b, ticket.id)).plans).toHaveLength(1);
  });

  it('refuses deleting an agent file that a stage uses (409, like skills), then allows it', async () => {
    const b = await bootRedesign();
    open.push(b);
    const p = await project(b);
    await addAgent(b, p, 'in-use', ['Read'], null);
    const stages = defaultStages();
    stages.orchestrate = { model: null, skill: null, agent: 'in-use' };
    await saveWorkflow(b, p.id, { plannerMode: 'lead', stages });
    // R-V finding 1, fixed in R-R: the saved workflow guards the file, as it does a skill.
    const refused = await b.del(`/api/projects/${p.id}/agents/in-use`);
    expect(refused.status).toBe(409);
    expect(refused.body).toMatchObject({
      error: {
        code: 'agent_in_use',
        message:
          'The agent file is used by these workflow stages: Orchestrate. Remove it from them first.',
      },
    });
    // The file is still there, so the stage still gets it.
    const { lead } = await startLead(b, p);
    expect(lead.spec.profile).toMatchObject({ name: 'in-use' });

    // Once no stage names it, the delete goes through.
    await saveWorkflow(b, p.id, { plannerMode: 'lead', stages: defaultStages() });
    expect((await b.del(`/api/projects/${p.id}/agents/in-use`)).status).toBe(204);
  });
});
