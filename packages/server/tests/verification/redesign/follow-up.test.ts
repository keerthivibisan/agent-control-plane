import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ChatMessageDtoSchema, type ProjectDto } from '@acp/core/api';
import type { FakeAgent } from '../../control/fake-adapter.js';
import {
  approveLatestPlan,
  createProject,
  createTicket,
  expectError,
  expectStatus,
  runDetail,
  setupBody,
  startHelper,
  startTicket,
  submitPlan,
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
  openStream,
  saveWorkflow,
  waitForNotice,
  type RedesignServer,
} from './harness.js';

/*
 * R-V: the lead's chat after the lead ends (ADR-0020, docs/history/redesign/README.md §6b) end to
 * end over HTTP. A ticket run completes in lead mode, with an orchestrate-stage agent file that
 * lists `Read, Bash`; then the owner's chat message resumes the lead for one answers-only turn.
 *
 * Checked: the resume id is the lead's own linked session; the real adapter's SDK options for the
 * turn (`resume`, no fork, `Read` only, subagents and edits disallowed, no MCP server, no skills);
 * the real gate; the run's status and the lead's record never move; one turn at a time; the turn's
 * usage does not reach the lead's budget; chat text never reaches a log line; a restart mid-turn
 * relaunches nothing and the chat continues afterwards. And the question the ticket page depends
 * on (R-J web review): the run stream publishes a notice when the reply lands and when the turn
 * ends, so the page leaves "The lead is answering…" without a reload.
 */

const open: RedesignServer[] = [];
afterEach(async () => {
  for (const b of open.splice(0)) await b.close();
});

const QUESTION = 'RV-OWNER-QUESTION: where is the discount applied?';
const ANSWER = 'RV-LEAD-ANSWER: in discount.ts, at checkout.';
const LATER = 'RV-OWNER-QUESTION-2: and the tests?';

/** A ticket run in lead mode, worked to Done; returns the run, the lead and the project. */
async function completedTicketRun(
  b: RedesignServer,
): Promise<{ project: ProjectDto; runId: string; lead: FakeAgent }> {
  const project = await createProject(b, 'shop');
  expectStatus(await b.put(`/api/projects/${project.id}/setup`, setupBody('SHOP')), 200);
  const p = `/api/projects/${project.id}`;
  expectStatus(
    await b.post(
      `${p}/agents`,
      agentFileBody('lead-style', ['Read', 'Bash'], null, 'RV-LEAD-FILE-INSTRUCTIONS\n'),
    ),
    201,
  );
  expectStatus(await b.post(`${p}/agents/lead-style/commit`), 200);
  const stages = defaultStages();
  stages.orchestrate = { model: null, skill: null, agent: 'lead-style' };
  await saveWorkflow(b, project.id, { plannerMode: 'lead', stages });

  const ticket = await createTicket(b, project.id, {
    title: 'Add a discount code field',
    description: 'Synthetic R-V ticket.',
    type: 'feature',
    priority: 'medium',
    labels: [],
  });
  const { runId, lead } = await startTicket(b, ticket.id);
  await submitPlan(b, ticket.id, lead, 'Add the field');
  await approveLatestPlan(b, ticket.id);
  const helper = await startHelper(b, runId, lead, 'Builder', 'Build the field');
  writeFileSync(join(helper.spec.cwd, 'discount.ts'), 'export const discount = 1;\n');
  helper.finish('success');
  await waitForRun(
    b,
    runId,
    (r) => r.agents.some((a) => a.id === helper.id && a.status === 'SUCCEEDED'),
    'the helper done',
  );
  await lead.callLead('request_review', {});
  await waitForRun(b, runId, (r) => r.status === 'REVIEW', 'review');
  expectStatus(await mergeChange(b, runId, helper.id), 200);
  await waitForTicket(b, ticket.id, (d) => d.ticket.status === 'DONE', 'Done');
  await waitFor(() => (lead.ended ? true : undefined), 'the lead to end');
  return { project, runId, lead };
}

const followUps = (b: RedesignServer) => b.fake.agents.filter((a) => a.spec.followUp !== undefined);

/** What must not move during a follow-up turn: the run and the lead's own record. */
const shape = async (b: RedesignServer, runId: string) => {
  const run = await runDetail(b, runId);
  return {
    status: run.status,
    endedAt: run.endedAt,
    agents: run.agents.map((a) => [a.id, a.kind, a.status, a.endedAt, a.budget.used]),
  };
};

describe('R-V: the follow-up turn of an ended lead (HTTP, SSE, real adapter options)', () => {
  it('resumes the lead session answers-only, publishes the reply and the end, changes no status', async () => {
    const b = await bootRedesign();
    open.push(b);
    const { project, runId, lead } = await completedTicketRun(b);
    const before = await shape(b, runId);
    expect(before.status).toBe('COMPLETED');
    expect((await runDetail(b, runId)).followUp).toEqual({ state: 'available', reason: null });

    const stream = openStream(b);
    // The stream is open once the server has written its first line.
    await waitFor(() => (stream.raw().includes('retry:') ? true : undefined), 'the stream');
    const res = await b.post(`/api/runs/${runId}/chat`, { text: QUESTION });
    expect(ChatMessageDtoSchema.parse(expectStatus(res, 200))).toMatchObject({
      role: 'owner',
      text: QUESTION,
      followUp: true,
    });
    const turn = await waitFor(() => followUps(b)[0], 'the follow-up turn');
    await waitForNotice(stream, 0, runId, 'chat-message');

    // The turn resumes the lead's own linked session, in the project root, with the stage's file.
    expect(turn.spec).toMatchObject({
      agentRunId: lead.id,
      kind: 'lead',
      cwd: project.rootPath,
      followUp: { resumeSessionId: `sess-${lead.id}` },
      profile: { name: 'lead-style', tools: ['Read', 'Bash'] },
    });
    expect(turn.spec.leadTools).toBeUndefined();
    expect(turn.spec.skillPlugin).toBeUndefined();
    const sdk = b.sdkFor(lead.id, true);
    expect(sdk.resume).toBe(`sess-${lead.id}`);
    expect(sdk.forkSession).toBe(false);
    // Read/Grep/Glob, narrowed by the file's list to Read; Bash is not added back.
    expect(sdk.tools).toEqual(['Read']);
    expect(sdk.disallowedTools).toEqual(
      expect.arrayContaining(['Bash', 'Edit', 'Write', 'Agent', 'Task']),
    );
    expect(sdk.mcpServers).toEqual({});
    expect(sdk.plugins).toBeUndefined();
    expect(sdk.skills).toBeUndefined();
    expect(sdk.allowedTools).toBeUndefined();
    expect(appendedPrompt(sdk)).toContain('=== Stage agent file .claude/agents/lead-style.md');
    // The lead's first start had the same file; only the follow-up resumes.
    expect(b.sdkFor(lead.id).resume).toBeUndefined();
    for (const [tool, input] of [
      [
        'Edit',
        { file_path: join(project.rootPath, 'discount.ts'), old_string: 'a', new_string: 'b' },
      ],
      ['Bash', { command: 'git log' }],
      ['mcp__acp__start_agent', { role: 'x', task: 'y' }],
    ] as const) {
      await expect(gate(sdk, tool, input)).resolves.toMatchObject({ behavior: 'deny' });
    }
    await expect(
      gate(sdk, 'Read', { file_path: join(project.rootPath, 'discount.ts') }),
    ).resolves.toMatchObject({ behavior: 'allow' });

    expect((await runDetail(b, runId)).followUp).toEqual({ state: 'running', reason: null });
    // One turn at a time.
    expectError(
      await b.post(`/api/runs/${runId}/chat`, { text: 'And?' }),
      409,
      'follow_up_running',
    );

    // The reply lands: a chat-message notice for the run, and the reply is in the run's messages.
    turn.started(`sess-${lead.id}`);
    turn.usage('msg-rv-follow-up', { input: 12, output: 340, cacheCreation: 0, cacheRead: 9000 });
    let mark = stream.notices.length;
    turn.emit({ type: 'lead-text', text: ANSWER });
    await waitForNotice(stream, mark, runId, 'chat-message');
    let run = await runDetail(b, runId);
    expect(run.messages.at(-1)).toMatchObject({ role: 'lead', text: ANSWER, followUp: true });
    expect(run.followUp?.state).toBe('running');

    // The turn ends: a runs-changed notice, after which the run reads "available" again.
    mark = stream.notices.length;
    turn.finish('success', 0.04);
    await waitForNotice(stream, mark, runId, 'runs-changed');
    run = await runDetail(b, runId);
    expect(run.followUp).toEqual({ state: 'available', reason: null });
    // Nothing about the run or the lead moved; the turn's usage is not the lead's budget.
    expect(await shape(b, runId)).toEqual(before);
    expect(run.approvals).toEqual([]);

    // Chat text is stored only as chat (ADR-0015): never in a log line or a stream frame.
    await stream.stop();
    for (const text of [QUESTION, ANSWER]) {
      expect(b.logs.join('\n')).not.toContain(text);
      expect(stream.raw()).not.toContain(text);
    }
  }, 60_000);

  it('a restart mid-turn relaunches nothing; the chat continues afterwards with the same session', async () => {
    const logs: string[] = [];
    const first = await bootRedesign({ logs });
    open.push(first);
    const { runId, lead } = await completedTicketRun(first);
    expectStatus(await first.post(`/api/runs/${runId}/chat`, { text: QUESTION }), 200);
    await waitFor(() => followUps(first)[0], 'the follow-up turn');
    expect((await runDetail(first, runId)).followUp?.state).toBe('running');
    await first.close();

    const second = await bootRedesign({
      dataDir: first.dataDir,
      claudeDir: first.claudeDir,
      logs,
    });
    open.push(second);
    const run = await runDetail(second, runId);
    expect(run.status).toBe('COMPLETED');
    expect(run.followUp).toEqual({ state: 'available', reason: null });
    // Give a relaunch every chance to happen; none may.
    await new Promise((r) => setTimeout(r, 300));
    expect(second.fake.agents).toEqual([]);
    expect(second.sdk).toEqual([]);

    expectStatus(await second.post(`/api/runs/${runId}/chat`, { text: LATER }), 200);
    const turn = await waitFor(() => second.fake.agents[0], 'the follow-up after the restart');
    expect(turn.spec.followUp).toEqual({ resumeSessionId: `sess-${lead.id}` });
    expect(second.sdkFor(lead.id, true).resume).toBe(`sess-${lead.id}`);
    turn.finish('success');
    await waitForRun(second, runId, (r) => r.followUp?.state === 'available', 'available again');
    expect(logs.join('\n')).not.toContain(LATER);
  }, 60_000);
});
