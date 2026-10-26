import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  RunWorkflowDtoSchema,
  SkillCommitResultDtoSchema,
  TicketDetailDtoSchema,
  type ProjectDto,
} from '@acp/core/api';
import type { FakeAgent } from '../../control/fake-adapter.js';
import {
  createProject,
  createTicket,
  expectStatus,
  listenToStream,
  logLines,
  runDetail,
  setupBody,
  ticketDetail,
  waitFor,
  waitForRun,
  waitForTicket,
} from '../workspace/harness.js';
import {
  agentFileBody,
  appendedPrompt,
  bootRedesign,
  defaultStages,
  gate,
  mergeChange,
  saveWorkflow,
  type RedesignServer,
} from './harness.js';

/*
 * R-V: the redesign's workflow end to end over HTTP (docs/history/redesign/README.md §4.2, §6a;
 * ADR-0019). One ticket goes through every stage with the owner's own skills and agent files,
 * written and committed through the Skills & Agents routes:
 *
 *   separate planner (skill `planning`, agent file `plan-style`) → plan review → lead (agent file
 *   `lead-style`) → one helper → review & merge → final code review (agent file `strict-reviewer`,
 *   which lists `Read, Bash`) → unit tests (skill `unit-tests`, a stage model, and an agent file
 *   that does not exist) → Done.
 *
 * Each agent's SDK options come from the real Claude Code adapter over a capturing `query` (see
 * harness.ts), so the checks below are what the SDK would really receive: the skills plugin, the
 * agent file under its heading in the system prompt, the narrowed `tools` (never wider than the
 * role), the read-only `disallowedTools`, the model order (stage > file > project) and the real
 * permission gate. The fake agents drive the run; nothing is spawned.
 */

const open: RedesignServer[] = [];
afterEach(async () => {
  for (const b of open.splice(0)) await b.close();
});

/** The adapter's gate message for a role tool the stage's agent file does not list. */
const NOT_IN_AGENT_FILE = "This stage's agent file does not list this tool.";
/** The adapter's gate message for an edit or shell tool of a reading role (ADR-0019 §7). */
const READ_ONLY = 'This agent only reads files inside its folder.';

const MARK = {
  planFile: 'RV-PLAN-FILE-INSTRUCTIONS',
  leadFile: 'RV-LEAD-FILE-INSTRUCTIONS',
  reviewFile: 'RV-REVIEW-FILE-INSTRUCTIONS',
  planSkill: 'RV-PLANNING-SKILL-BODY',
  testSkill: 'RV-UNIT-TESTS-SKILL-BODY',
  finding: 'RV-REVIEWER-FINDING',
} as const;

async function writeSkillsAndAgents(b: RedesignServer, project: ProjectDto): Promise<void> {
  const p = `/api/projects/${project.id}`;
  const skills = [
    { name: 'planning', description: 'Plan in small steps.', instructions: `${MARK.planSkill}\n` },
    { name: 'unit-tests', description: 'Write unit tests.', instructions: `${MARK.testSkill}\n` },
  ];
  for (const skill of skills) {
    expectStatus(await b.post(`${p}/skills`, skill), 201);
    const commit = SkillCommitResultDtoSchema.parse(
      expectStatus(await b.post(`${p}/skills/${skill.name}/commit`), 200),
    );
    expect(commit.branch).toBe('main');
  }
  const agents = [
    agentFileBody(
      'plan-style',
      ['Read', 'Grep', 'Bash', 'Edit'],
      'claude-plan-file-model',
      `${MARK.planFile}\n`,
    ),
    agentFileBody('lead-style', ['Read', 'Grep', 'Bash'], null, `${MARK.leadFile}\n`),
    agentFileBody(
      'strict-reviewer',
      ['Read', 'Bash'],
      'claude-review-file-model',
      `${MARK.reviewFile}\n`,
    ),
  ];
  for (const agent of agents) {
    expectStatus(await b.post(`${p}/agents`, agent), 201);
    expectStatus(await b.post(`${p}/agents/${agent.name}/commit`), 200);
  }
}

async function stageStates(b: RedesignServer, runId: string): Promise<Record<string, string>> {
  const dto = RunWorkflowDtoSchema.parse(
    expectStatus(await b.get(`/api/runs/${runId}/workflow`), 200),
  );
  return Object.fromEntries(dto.stages.map((s) => [s.stage, s.state]));
}

function agentOfKind(b: RedesignServer, kind: string): Promise<FakeAgent> {
  return waitFor(() => b.fake.agents.find((a) => a.spec.kind === kind), `the ${kind}`);
}

describe('R-V: a ticket through every redesign stage (HTTP, fake agents, real adapter options)', () => {
  it('planner → lead → helper → merge → reviewer → tester → Done, with skills and agent files', async () => {
    const b = await bootRedesign();
    open.push(b);
    const project = await createProject(b, 'shop');
    const root = project.rootPath;
    expectStatus(
      await b.put(
        `/api/projects/${project.id}/setup`,
        setupBody('SHOP', { model: 'claude-project-model' }),
      ),
      200,
    );
    await writeSkillsAndAgents(b, project);

    const stages = defaultStages();
    stages.plan = { model: null, skill: 'planning', agent: 'plan-style' };
    stages.orchestrate = { model: null, skill: null, agent: 'lead-style' };
    stages['code-review'] = { enabled: true, model: null, skill: null, agent: 'strict-reviewer' };
    stages['unit-tests'] = {
      enabled: true,
      model: 'claude-tester-stage-model',
      skill: 'unit-tests',
      agent: 'gone-agent',
    };
    await saveWorkflow(b, project.id, { plannerMode: 'separate', stages });

    // "Used by" on the Skills & Agents page comes from the saved workflow.
    const skills = expectStatus(await b.get(`/api/projects/${project.id}/skills`), 200) as {
      name: string;
      usedBy: string[];
      uncommitted: boolean;
    }[];
    expect(skills.map((s) => [s.name, s.usedBy, s.uncommitted])).toEqual([
      ['planning', ['plan'], false],
      ['unit-tests', ['unit-tests'], false],
    ]);
    // A skill a stage uses can't be deleted (ADR-0018).
    expect((await b.del(`/api/projects/${project.id}/skills/planning`)).status).toBe(409);

    const stream = listenToStream(b);
    const ticket = await createTicket(b, project.id, {
      title: 'Add a discount code field',
      description: 'Synthetic R-V ticket.',
      type: 'feature',
      priority: 'medium',
      labels: [],
    });
    expectStatus(await b.post(`/api/tickets/${ticket.id}/move`, { status: 'READY' }), 200);
    const started = TicketDetailDtoSchema.parse(
      expectStatus(await b.post(`/api/tickets/${ticket.id}/start`), 200),
    );
    const runId = started.currentRun?.id ?? '';
    expect(runId).not.toBe('');

    // ---- Plan: the separate, read-only planner with its skill and agent file.
    const planner = await agentOfKind(b, 'planner');
    const plugin = join(b.dataDir, 'runs', runId, 'skills-plugin');
    expect(planner.spec).toMatchObject({
      kind: 'planner',
      cwd: root,
      model: 'claude-plan-file-model',
      skillPlugin: { path: plugin, skills: ['acp-skills:planning'] },
      profile: { name: 'plan-style', tools: ['Read', 'Grep', 'Bash', 'Edit'] },
    });
    expect(planner.spec.prompt).toContain('acp-skills:planning');
    // The plugin holds the skill from the checkout, front matter cut to name and description.
    const copied = readFileSync(join(plugin, 'skills', 'planning', 'SKILL.md'), 'utf8');
    expect(copied).toContain(MARK.planSkill);
    expect(copied).toMatch(/^---\nname: planning\ndescription: /);

    const plannerSdk = b.sdkFor(planner.id);
    // The file's Bash and Edit are dropped for a read-only role; `Skill` comes with the plugin.
    expect(plannerSdk.tools).toEqual(['Read', 'Grep', 'Skill']);
    expect(plannerSdk.disallowedTools).toEqual(expect.arrayContaining(['Bash', 'Edit', 'Write']));
    expect(plannerSdk.allowedTools).toBeUndefined();
    expect(plannerSdk.settingSources).toEqual([]);
    expect(plannerSdk.plugins).toEqual([{ type: 'local', path: plugin }]);
    expect(plannerSdk.skills).toEqual(['acp-skills:planning']);
    expect(plannerSdk.model).toBe('claude-plan-file-model');
    expect(Object.keys(plannerSdk.mcpServers ?? {})).toEqual(['acp']);
    const plannerPrompt = appendedPrompt(plannerSdk);
    expect(plannerPrompt).toContain('=== Stage agent file .claude/agents/plan-style.md');
    expect(plannerPrompt).toContain(MARK.planFile);
    // The real gate: Bash is outside the planner's base set, and Glob, which the file does not
    // list, was narrowed away; an in-folder read runs without asking.
    await expect(gate(plannerSdk, 'Bash', { command: 'ls' })).resolves.toMatchObject({
      behavior: 'deny',
      message: READ_ONLY,
    });
    await expect(gate(plannerSdk, 'Glob', { pattern: '*.ts' })).resolves.toMatchObject({
      behavior: 'deny',
      message: NOT_IN_AGENT_FILE,
    });
    await expect(
      gate(plannerSdk, 'Read', { file_path: join(root, 'README.md') }),
    ).resolves.toMatchObject({ behavior: 'allow' });
    expect(await stageStates(b, runId)).toMatchObject({ plan: 'active', orchestrate: 'waiting' });

    planner.started();
    await planner.callLead('submit_plan', {
      summary: 'Add the field and validate the code',
      steps: [{ title: 'Build the field', role: 'Builder', detail: 'In checkout' }],
    });
    await waitForTicket(b, ticket.id, (d) => d.ticket.stage === 'PLAN_REVIEW', 'plan review');
    expect(await stageStates(b, runId)).toMatchObject({ plan: 'needs-you' });
    const plan = (await ticketDetail(b, ticket.id)).plans.at(-1);
    expectStatus(
      await b.post(`/api/tickets/${ticket.id}/plans/${plan?.id ?? ''}/decision`, {
        decision: 'approve',
      }),
      200,
    );

    // ---- Orchestrate: the lead gets the approved plan; its file narrows its read-only base set
    // (the file's Bash is not added, ADR-0019 §7) and keeps its control tools.
    const lead = await agentOfKind(b, 'lead');
    await waitFor(() => (planner.ended ? true : undefined), 'the planner to end');
    expect(lead.spec).toMatchObject({
      kind: 'lead',
      cwd: root,
      model: 'claude-project-model',
      profile: { name: 'lead-style', tools: ['Read', 'Grep', 'Bash'] },
    });
    expect(lead.spec.prompt).toContain('Add the field and validate the code');
    expect(lead.spec.skillPlugin).toBeUndefined();
    const leadSdk = b.sdkFor(lead.id);
    expect(leadSdk.tools).toEqual(['Read', 'Grep']);
    expect(leadSdk.disallowedTools).toBeUndefined();
    expect(leadSdk.allowedTools).toBeUndefined();
    expect(Object.keys(leadSdk.mcpServers ?? {})).toEqual(['acp']);
    // The lead is read-only (ADR-0013 §2): its edits and commands are denied, never asked.
    for (const [tool, input] of [
      ['Bash', { command: 'git status' }],
      ['Edit', { file_path: join(root, 'README.md'), old_string: 'a', new_string: 'b' }],
    ] as const) {
      await expect(gate(leadSdk, tool, input)).resolves.toMatchObject({
        behavior: 'deny',
        message: READ_ONLY,
      });
    }
    expect(leadSdk.plugins).toBeUndefined();
    expect(leadSdk.model).toBe('claude-project-model');
    expect(appendedPrompt(leadSdk)).toContain(MARK.leadFile);
    expect(appendedPrompt(leadSdk)).not.toContain(MARK.planFile);
    lead.started();
    await waitForRun(
      b,
      runId,
      (r) => r.agents.some((a) => a.kind === 'lead' && a.status === 'RUNNING'),
      'the lead running',
    );
    expect(await stageStates(b, runId)).toMatchObject({ plan: 'done', orchestrate: 'active' });

    // ---- Helpers: one helper, its change merged by the owner.
    await lead.callLead('start_agent', { role: 'Builder', task: 'Build the field' });
    const helper = await agentOfKind(b, 'worker');
    expect(helper.spec.cwd).not.toBe(root);
    expect(helper.spec.profile).toBeUndefined();
    helper.started();
    writeFileSync(join(helper.spec.cwd, 'discount.ts'), 'export const discount = 1;\n');
    helper.finish('success');
    await waitForRun(
      b,
      runId,
      (r) => r.agents.some((a) => a.id === helper.id && a.status === 'SUCCEEDED'),
      'the helper done',
    );
    await lead.callLead('request_review', {});
    await waitForRun(b, runId, (r) => r.status === 'REVIEW', 'the run in review');
    expectStatus(await mergeChange(b, runId, helper.id), 200);
    expect(existsSync(join(root, 'discount.ts'))).toBe(true);

    // ---- Final code review: read-only even though its agent file lists Bash.
    const reviewer = await agentOfKind(b, 'reviewer');
    await waitFor(() => (lead.ended ? true : undefined), 'the lead to stop');
    expect(reviewer.spec.cwd.startsWith(join(b.dataDir, 'review-checkouts', runId))).toBe(true);
    expect(readFileSync(join(reviewer.spec.cwd, 'discount.ts'), 'utf8')).toContain('discount');
    expect(reviewer.spec).toMatchObject({
      kind: 'reviewer',
      model: 'claude-review-file-model',
      profile: { name: 'strict-reviewer', tools: ['Read', 'Bash'] },
    });
    const reviewerSdk = b.sdkFor(reviewer.id);
    expect(reviewerSdk.tools).toEqual(['Read']);
    expect(reviewerSdk.disallowedTools).toEqual(expect.arrayContaining(['Bash', 'Edit', 'Write']));
    expect(reviewerSdk.model).toBe('claude-review-file-model');
    expect(appendedPrompt(reviewerSdk)).toContain(
      '=== Stage agent file .claude/agents/strict-reviewer.md',
    );
    for (const [tool, input] of [
      ['Bash', { command: 'git status' }],
      ['Write', { file_path: join(reviewer.spec.cwd, 'x.ts'), content: 'x' }],
      ['Grep', { pattern: 'x', path: reviewer.spec.cwd }],
    ] as const) {
      await expect(gate(reviewerSdk, tool, input)).resolves.toMatchObject({ behavior: 'deny' });
    }
    await expect(
      gate(reviewerSdk, 'Read', { file_path: join(reviewer.spec.cwd, 'discount.ts') }),
    ).resolves.toMatchObject({ behavior: 'allow' });
    // No approval was ever asked for: a read-only role's denials never reach the owner.
    expect((await runDetail(b, runId)).approvals).toEqual([]);
    reviewer.started();
    expect(await stageStates(b, runId)).toMatchObject({
      helpers: 'done',
      review: 'done',
      'code-review': 'active',
      'unit-tests': 'waiting',
    });
    await reviewer.callLead('post_review', { text: MARK.finding });
    await waitForTicket(
      b,
      ticket.id,
      (d) => d.comments.some((c) => c.author === 'reviewer' && c.body === MARK.finding),
      'the reviewer comment',
    );
    reviewer.finish('success');

    // ---- Unit tests: the stage model wins; the missing agent file does not block the stage.
    const tester = await agentOfKind(b, 'tester');
    expect(tester.spec).toMatchObject({
      kind: 'tester',
      model: 'claude-tester-stage-model',
      skillPlugin: { skills: ['acp-skills:unit-tests'] },
    });
    expect(tester.spec.profile).toBeUndefined();
    expect(tester.spec.cwd).not.toBe(root);
    const testerSdk = b.sdkFor(tester.id);
    // The tester's base set (ADR-0019 §7), with `Skill` for its plugin.
    expect(testerSdk.tools).toEqual(['Read', 'Grep', 'Glob', 'Edit', 'Write', 'Bash', 'Skill']);
    expect(testerSdk.allowedTools).toBeUndefined();
    expect(testerSdk.skills).toEqual(['acp-skills:unit-tests']);
    expect(testerSdk.model).toBe('claude-tester-stage-model');
    expect(appendedPrompt(testerSdk)).not.toContain('Stage agent file');
    expect(logLines(b.logs, 'project agent file unavailable')).toEqual([
      expect.objectContaining({ agentFile: 'gone-agent' }),
    ]);
    tester.started();
    writeFileSync(join(tester.spec.cwd, 'discount.test.ts'), 'export const tested = 1;\n');
    tester.finish('success');
    await waitFor(
      async () => ((await stageStates(b, runId))['unit-tests'] === 'needs-you' ? true : undefined),
      'the tester change in review',
    );
    expectStatus(await mergeChange(b, runId, tester.id), 200);

    const done = await waitForTicket(b, ticket.id, (d) => d.ticket.status === 'DONE', 'Done');
    expect(done.currentRun?.status ?? (await runDetail(b, runId)).status).toBe('COMPLETED');
    expect(existsSync(join(root, 'discount.test.ts'))).toBe(true);
    expect(await stageStates(b, runId)).toEqual({
      plan: 'done',
      orchestrate: 'done',
      helpers: 'done',
      review: 'done',
      'code-review': 'done',
      'unit-tests': 'done',
    });
    // The run-scoped plugin is gone once the run ends.
    await waitFor(() => (existsSync(plugin) ? undefined : true), 'the plugin removed');
    expect(b.fake.agents.map((a) => a.spec.kind)).toEqual([
      'planner',
      'lead',
      'worker',
      'reviewer',
      'tester',
    ]);

    // The page learns of each step from the stream (it refetches on any run notice).
    const frames = await stream.stop();
    expect(frames).toContain('"kind":"runs-changed"');
    expect(frames).toContain(`"runIds":["${runId}"]`);
    expect(frames).toContain('"kind":"tickets-changed"');

    // The owner's files reach agents only: never a log line or a stream frame.
    const logs = b.logs.join('\n');
    for (const mark of [MARK.planFile, MARK.leadFile, MARK.reviewFile, MARK.planSkill]) {
      expect(logs).not.toContain(mark);
      expect(frames).not.toContain(mark);
    }
    expect(logs).not.toContain(MARK.finding);
  }, 90_000);
});
