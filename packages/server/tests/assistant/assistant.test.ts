import { existsSync, mkdirSync, readFileSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { createCodeMapRepositories, createRepositories } from '@acp/db';
import type { AssistantProposalDto, AssistantStreamEvent } from '@acp/core/api';
import { afterEach, describe, expect, it } from 'vitest';
import { ASSISTANT_READ_ONLY_MESSAGE } from '../../src/assistant/index.js';
import { ANSWER_CUT_NOTE, capAnswer } from '../../src/assistant/tools.js';
import { createCodeMapService } from '../../src/codemap/index.js';
import { createGitRunner } from '../../src/workspace/index.js';
import { GIT_TEST_ENV, tempDir } from '../workspace/helpers.js';
import { setupAssistant } from './helpers.js';

/*
 * The project assistant's server side (ADR-0035, AS-1): sessions in memory, the role's tools, the
 * Approve and Auto writes through the ADR-0018 writer, and the chat stream. Synthetic data only;
 * the fake adapter stands in for claude and codex.
 */

const SKILL = (slug: string, body = 'Run the tests before you finish.') =>
  `---\nname: ${slug}\ndescription: Use when testing\n---\n\n# ${slug}\n\n${body}\n`;
const AGENT = (slug: string) =>
  `---\nname: ${slug}\ndescription: Reviews database code\ntools: Read, Grep\nmodel: sonnet\n---\n\nYou review SQL.\n`;

let current: Awaited<ReturnType<typeof setupAssistant>> | undefined;
afterEach(() => {
  current?.assistant.close();
  current = undefined;
});

async function setup(options: Parameters<typeof setupAssistant>[0] = {}) {
  current = await setupAssistant(options);
  return current;
}

/** Starts a chat and sends the first message, so the fake assistant agent exists. */
async function chatting(s: Awaited<ReturnType<typeof setup>>, body: object = {}) {
  expect((await s.post('/session', body)).status).toBe(201);
  expect((await s.post('/session/messages', { text: 'Hello' })).status).toBe(200);
  await s.flush();
  return s.agent();
}

function proposals(events: AssistantStreamEvent[]): AssistantProposalDto[] {
  return events.flatMap((e) => (e.type === 'proposal' ? [e.proposal] : []));
}

describe('assistant sessions (ADR-0035 §2, §4)', () => {
  it('starts a Claude chat with sonnet by default, and launches the agent on the first message', async () => {
    const s = await setup();
    const started = await s.post('/session', {});
    expect(started.status).toBe(201);
    expect(started.body).toMatchObject({
      projectId: s.project.id,
      provider: 'claude-code',
      model: 'sonnet',
      effort: 'medium',
      mode: 'approve',
      status: 'ready',
      failure: null,
      budget: { used: 0, limit: 300_000 },
    });
    expect(s.fake.agents.filter((a) => a.spec.kind === 'assistant')).toHaveLength(0);
    const sent = await s.post('/session/messages', { text: 'What is open?' });
    expect(sent.body.status).toBe('working');
    await s.flush();
    const agent = s.agent();
    expect(agent.spec).toMatchObject({
      kind: 'assistant',
      cwd: s.repo,
      prompt: 'What is open?',
      model: 'sonnet',
      effort: 'medium',
      title: 'Project assistant',
    });
    expect(agent.spec.leadTools).toBeTypeOf('function');
    // Claude does not enforce denyRead per agent; its gate keeps reads inside the folder.
    expect(agent.spec.denyRead).toBeUndefined();
    expect((await s.get('/session')).body.id).toBe(started.body.id);
  });

  it("starts a Codex chat with the provider's default model, its effort and the deny list", async () => {
    const s = await setup({ codex: {} });
    const started = await s.post('/session', { provider: 'codex', effort: 'high', mode: 'auto' });
    expect(started.body).toMatchObject({
      provider: 'codex',
      model: null,
      effort: 'high',
      mode: 'auto',
    });
    await s.post('/session/messages', { text: 'Hi' });
    await s.flush();
    const agent = s.codex?.assistant();
    expect(agent?.spec).toMatchObject({ kind: 'assistant', model: null, effort: 'high' });
    expect(agent?.spec.denyRead).toEqual([`${s.homeDir}/.ssh`, s.dataDir]);
  });

  it('refuses a provider that is unavailable, and validates the request', async () => {
    const s = await setup({
      codex: {
        checkAvailable: () => Promise.resolve({ ok: false, reason: 'codex is not signed in' }),
      },
    });
    const refused = await s.post('/session', { provider: 'codex' });
    expect(refused.status).toBe(409);
    expect(refused.body.error?.message).toBe('codex is not signed in');
    expect((await s.post('/session', { effort: 'max' })).status).toBe(400);
    expect((await s.get('/session')).status).toBe(404);
  });

  it('a new start replaces the old chat and aborts its agent', async () => {
    const s = await setup();
    const first = await chatting(s);
    const rec = s.record();
    const second = await s.post('/session', {});
    expect(first.aborted).toBe(true);
    expect(rec.events.find((e) => e.type === 'ended')).toEqual({
      type: 'ended',
      reason: 'replaced',
      message: 'A new chat was started.',
    });
    expect((await s.get('/session')).body.id).toBe(second.body.id);
  });

  it("delivers the owner's messages to the agent and changes the mode without a restart", async () => {
    const s = await setup();
    const agent = await chatting(s);
    await s.post('/session/messages', { text: 'And WEB-1?' });
    expect(agent.sent).toEqual(['And WEB-1?']);
    const mode = await s.post('/session/mode', { mode: 'auto' });
    expect(mode.body.mode).toBe('auto');
    expect(agent.aborted).toBe(false);
    expect(s.fake.agents.filter((a) => a.spec.kind === 'assistant')).toHaveLength(1);
    expect((await s.post('/session/messages', { text: '' })).status).toBe(400);
    expect((await s.post('/session/messages', { text: 'x'.repeat(8001) })).status).toBe(400);
  });

  it('denies every permission request without asking anyone', async () => {
    const s = await setup();
    const agent = await chatting(s);
    for (const tool of ['Bash', 'Edit', 'Write', 'Read']) {
      await expect(agent.ask(tool, `${tool} something`)).resolves.toEqual({
        allow: false,
        message: ASSISTANT_READ_ONLY_MESSAGE,
      });
    }
    // Nothing reached the owner's approval queue.
    expect(s.db.connection.prepare('SELECT COUNT(*) FROM approvals').pluck().get()).toBe(0);
  });

  it('streams text and activity, with the status, and ends on the owner request', async () => {
    const s = await setup();
    const agent = await chatting(s);
    const rec = s.record();
    agent.started('sess-a');
    agent.emit({ type: 'activity', summary: 'Checked the tickets' });
    agent.emit({ type: 'lead-text', text: 'One ticket is open.' });
    await s.flush();
    expect(rec.events).toEqual([
      { type: 'activity', summary: 'Checked the tickets' },
      { type: 'text', full: 'One ticket is open.' },
      { type: 'status', session: expect.objectContaining({ status: 'ready' }) as unknown },
    ]);
    expect((await s.post('/session/end')).status).toBe(204);
    expect(agent.aborted).toBe(true);
    expect(rec.events.at(-1)).toMatchObject({ type: 'ended', reason: 'owner' });
    expect((await s.get('/session')).status).toBe(404);
  });

  it('ends the chat at its 300k budget', async () => {
    const s = await setup();
    const agent = await chatting(s);
    const rec = s.record();
    agent.usage('m1', { input: 10, output: 150_000, cacheCreation: 0, cacheRead: 9_999_999 });
    // The same message again with more output is one message, never summed.
    agent.usage('m1', { input: 10, output: 160_000, cacheCreation: 0, cacheRead: 9_999_999 });
    await s.flush();
    expect((await s.get('/session')).body.budget?.used).toBe(160_010);
    agent.usage('m2', { input: 0, output: 140_000, cacheCreation: 0, cacheRead: 0 });
    await s.flush();
    expect(agent.aborted).toBe(true);
    expect(rec.events.at(-1)).toEqual({
      type: 'ended',
      reason: 'budget',
      message: 'The chat reached its budget of 300k tokens. Start a new chat to go on.',
    });
    expect((await s.get('/session')).status).toBe(404);
  });

  it('ends an idle chat after 30 minutes (injected clock)', async () => {
    const s = await setup();
    const agent = await chatting(s);
    const rec = s.record();
    const start = s.clock.now.getTime();
    s.clock.now = new Date(start + 29 * 60_000);
    s.assistant.sweep();
    expect(agent.aborted).toBe(false);
    s.clock.now = new Date(start + 30 * 60_000);
    s.assistant.sweep();
    expect(agent.aborted).toBe(true);
    expect(rec.events.at(-1)).toMatchObject({ type: 'ended', reason: 'idle' });
  });

  it('records Codex usage through the managed channel, and not Claude usage', async () => {
    const s = await setup({ codex: {} });
    await s.post('/session', { provider: 'codex' });
    await s.post('/session/messages', { text: 'Hi' });
    await s.flush();
    const codex = s.codex?.assistant();
    codex?.started('thread-as', 'gpt-5');
    codex?.usage('thread-as:turn-1:40', {
      input: 30,
      output: 10,
      cacheCreation: null,
      cacheRead: 0,
    });
    await s.flush();
    const repos = createRepositories(s.db);
    expect(repos.usage.getRecord('codex', 'thread-as:turn-1:40')).toBeDefined();
    await s.post('/session', {});
    await s.post('/session/messages', { text: 'Hi' });
    await s.flush();
    s.agent().started('sess-claude');
    s.agent().usage('msg-c', { input: 1, output: 1, cacheCreation: null, cacheRead: null });
    await s.flush();
    expect(repos.usage.getRecord('claude-code', 'msg-c')).toBeUndefined();
  });
});

describe('the assistant tools (ADR-0035 §3)', () => {
  it('ticket_status answers for every open ticket and for one ticket', async () => {
    const s = await setup();
    const { ticket } = await s.startTicket('Add dark mode');
    const other = await s.createTicket('Write the docs');
    const agent = await chatting(s);
    const all = await agent.callLead('ticket_status', {});
    expect(all).toContain('2 open tickets:');
    expect(all).toContain(`${ticket.key} · Add dark mode · stage PLANNING`);
    expect(all).toContain('Current run: PLANNING');
    expect(all).toMatch(/- .+ \(lead, claude-code\): RUNNING/);
    expect(all).toContain(`${other.key} · Write the docs · stage BACKLOG`);
    const one = await agent.callLead('ticket_status', { ticketKey: other.key.toLowerCase() });
    expect(one).toContain(`${other.key} · Write the docs`);
    expect(one).not.toContain(ticket.key);
    await expect(agent.callLead('ticket_status', { ticketKey: 'ZZ-99' })).rejects.toThrow(
      'There is no ticket ZZ-99 in this project.',
    );
  });

  it('caps every answer at 8 KiB with a note', async () => {
    const s = await setup();
    for (let i = 0; i < 60; i++) {
      await s.board.createTicket(s.project.id, { title: `Ticket ${i} ${'é'.repeat(150)}` });
    }
    const agent = await chatting(s);
    const all = await agent.callLead('ticket_status', {});
    expect(Buffer.byteLength(all)).toBeLessThanOrEqual(8 * 1024);
    expect(all.endsWith(ANSWER_CUT_NOTE)).toBe(true);
    expect(capAnswer('short')).toBe('short');
    const cut = capAnswer('😀'.repeat(5000));
    expect(Buffer.byteLength(cut)).toBeLessThanOrEqual(8192);
    expect(cut).not.toContain('�');
  });

  it('project_info lists settings, workflow, harness, skills and agents', async () => {
    const s = await setup();
    await s.skills.create(s.project, {
      name: 'unit-tests',
      description: 'Write unit tests',
      instructions: 'Use vitest.',
    });
    const agent = await chatting(s);
    const info = await agent.callLead('project_info', {});
    expect(info).toContain('Provider: claude-code');
    expect(info).toContain('Approval mode:');
    expect(info).toContain('Workflow nodes:');
    expect(info).toMatch(/\(lead\)/);
    expect(info).toContain('Harness checks');
    expect(info).toContain('- unit-tests: Write unit tests');
    expect(info).toContain('Agent definitions (.claude/agents): none');
    expect(info).not.toContain('Use vitest.');
  });

  it('code_map refuses without a ready map, and every ticket control tool is refused', async () => {
    const s = await setup();
    const agent = await chatting(s);
    await expect(agent.callLead('code_map', { action: 'search', query: 'x' })).rejects.toThrow(
      'The code map is switched off.',
    );
    for (const name of ['start_agent', 'message_agent', 'stop_agent', 'merge_change'] as const) {
      await expect(agent.callLead(name, {})).rejects.toThrow('cannot use this tool');
    }
  });

  it('code_map answers from the latest ready map, which also gives the repository map', async () => {
    const ref: { map?: ReturnType<typeof createCodeMapService> } = {};
    const s = await setup({
      files: { 'src/greet.ts': 'export function greetOwner(): string {\n  return "hi";\n}\n' },
      assistant: {
        codeMap: {
          summary: (id) => ref.map?.summary(id) ?? { manifest: null },
          mapAt: (id, commit) => ref.map?.mapAt(id, commit),
          ensureForCommit: (id, commit) =>
            ref.map?.ensureForCommit(id, commit) ?? Promise.reject(new Error('no map')),
        },
      },
    });
    ref.map = createCodeMapService({
      repo: createCodeMapRepositories(s.db).codeMap,
      projectOf: (projectId) => s.repos.projects.getById(projectId),
      git: createGitRunner({ env: GIT_TEST_ENV }),
      logger: { log() {} },
      now: () => s.clock.now,
    });
    await ref.map.refresh(s.project.id);
    await ref.map.idle();
    const agent = await chatting(s);
    expect(agent.spec.repoMap).toContain('=== Repository map: commit');
    const answer = await agent.callLead('code_map', { action: 'find_symbol', query: 'greetOwner' });
    expect(answer).toContain('src/greet.ts');
  });

  it('code_map refuses while no map is ready', async () => {
    const s = await setup({
      assistant: {
        codeMap: {
          summary: () => ({ manifest: null }),
          mapAt: () => undefined,
          ensureForCommit: () => Promise.reject(new Error('unused')),
        },
      },
    });
    const agent = await chatting(s);
    expect(agent.spec.repoMap).toBeUndefined();
    await expect(agent.callLead('code_map', { action: 'search', query: 'x' })).rejects.toThrow(
      'no code map for this commit yet',
    );
  });
});

describe('proposals (ADR-0035 §5, ADR-0018)', () => {
  it('Approve: a proposal waits for the owner; Apply writes exactly .claude/skills/<slug>/SKILL.md', async () => {
    const s = await setup();
    const agent = await chatting(s);
    const rec = s.record();
    const reply = await agent.callLead('propose_skill', {
      slug: 'run-tests',
      content: SKILL('run-tests'),
    });
    expect(reply).toBe(
      'Proposal for .claude/skills/run-tests/SKILL.md shown to the owner; wait for their decision.',
    );
    const file = join(s.repo, '.claude', 'skills', 'run-tests', 'SKILL.md');
    expect(existsSync(file)).toBe(false);
    const [pending] = proposals(rec.events);
    expect(pending).toMatchObject({
      kind: 'skill',
      slug: 'run-tests',
      path: '.claude/skills/run-tests/SKILL.md',
      replace: false,
      state: 'pending',
      problem: null,
    });
    expect(pending?.content).toContain('Run the tests before you finish.');
    const applied = await s.post(`/proposals/${pending?.id}/apply`);
    expect(applied.status).toBe(200);
    expect(applied.body.state).toBe('applied');
    expect(readFileSync(file, 'utf8')).toBe(pending?.content);
    expect(agent.sent).toContain('The owner applied .claude/skills/run-tests/SKILL.md.');
    expect((await s.post(`/proposals/${pending?.id}/apply`)).status).toBe(409);
  });

  it('Approve: Discard writes nothing and tells the assistant', async () => {
    const s = await setup();
    const agent = await chatting(s);
    const rec = s.record();
    await agent.callLead('propose_agent', { slug: 'sql-reviewer', content: AGENT('sql-reviewer') });
    const [pending] = proposals(rec.events);
    expect(pending?.path).toBe('.claude/agents/sql-reviewer.md');
    const discarded = await s.post(`/proposals/${pending?.id}/discard`);
    expect(discarded.body.state).toBe('discarded');
    expect(existsSync(join(s.repo, '.claude', 'agents', 'sql-reviewer.md'))).toBe(false);
    expect(agent.sent).toContain('The owner discarded .claude/agents/sql-reviewer.md.');
    expect((await s.post('/proposals/nope/discard')).status).toBe(404);
  });

  it('Auto: the proposal is written at once', async () => {
    const s = await setup();
    const agent = await chatting(s, { mode: 'auto' });
    const rec = s.record();
    const reply = await agent.callLead('propose_agent', {
      slug: 'sql-reviewer',
      content: AGENT('sql-reviewer'),
    });
    expect(reply).toContain('Written .claude/agents/sql-reviewer.md (Auto mode)');
    const file = join(s.repo, '.claude', 'agents', 'sql-reviewer.md');
    expect(readFileSync(file, 'utf8')).toContain('tools: Read, Grep');
    expect(proposals(rec.events)).toEqual([expect.objectContaining({ state: 'written' })]);
  });

  it('refuses to replace an existing file without replace, and shows a replacement with it', async () => {
    const s = await setup();
    await s.skills.create(s.project, {
      name: 'run-tests',
      description: 'Old',
      instructions: 'Old.',
    });
    const agent = await chatting(s);
    const rec = s.record();
    await expect(
      agent.callLead('propose_skill', { slug: 'run-tests', content: SKILL('run-tests') }),
    ).rejects.toThrow('propose it again with replace: true');
    expect(proposals(rec.events)).toEqual([]);
    await agent.callLead('propose_skill', {
      slug: 'run-tests',
      content: SKILL('run-tests', 'New body.'),
      replace: true,
    });
    const [pending] = proposals(rec.events);
    expect(pending?.replace).toBe(true);
    await s.post(`/proposals/${pending?.id}/apply`);
    const text = readFileSync(join(s.repo, '.claude/skills/run-tests/SKILL.md'), 'utf8');
    expect(text).toContain('New body.');
  });

  it('refuses invalid front matter, a name that is not the slug, extra keys and oversize files', async () => {
    const s = await setup();
    const agent = await chatting(s);
    const cases: [object, string][] = [
      [{ slug: 'a', content: '# no front matter\n' }, 'no front matter'],
      [{ slug: 'a', content: '---\nname: a\ndescription: x\n' }, 'not closed'],
      [{ slug: 'a', content: SKILL('b') }, 'must equal the slug'],
      [{ slug: 'a', content: '---\nname: a\n---\nbody\n' }, 'description'],
      [
        { slug: 'a', content: '---\nname: a\ndescription: x\nallowed-tools: Bash\n---\nbody\n' },
        'may only set name and description',
      ],
      [{ slug: 'a', content: SKILL('a', 'é'.repeat(33_000)) }, 'larger than 64 KiB'],
    ];
    for (const [input, message] of cases) {
      await expect(agent.callLead('propose_skill', input)).rejects.toThrow(message);
    }
    expect(existsSync(join(s.repo, '.claude'))).toBe(false);
  });

  it('refuses a slug outside the allowed shape, so nothing lands outside the two paths', async () => {
    const s = await setup();
    const agent = await chatting(s, { mode: 'auto' });
    for (const slug of ['../evil', 'a/b', 'Upper', '.hidden', '', 'x'.repeat(65)]) {
      await expect(
        agent.callLead('propose_skill', { slug, content: SKILL(slug) }),
      ).rejects.toThrow();
      await expect(
        agent.callLead('propose_agent', { slug, content: AGENT(slug) }),
      ).rejects.toThrow();
    }
    expect(existsSync(join(s.repo, '.claude'))).toBe(false);
    expect(existsSync(join(s.repo, '..', 'evil'))).toBe(false);
  });

  it('refuses a symlinked .claude/skills in both modes and writes nothing through it', async () => {
    const s = await setup();
    const outside = tempDir('acp-assistant-outside-');
    mkdirSync(join(s.repo, '.claude'));
    symlinkSync(outside, join(s.repo, '.claude', 'skills'));
    const agent = await chatting(s, { mode: 'auto' });
    await expect(
      agent.callLead('propose_skill', { slug: 'run-tests', content: SKILL('run-tests') }),
    ).rejects.toThrow('symbolic link');
    await s.post('/session/mode', { mode: 'approve' });
    await expect(
      agent.callLead('propose_skill', { slug: 'run-tests', content: SKILL('run-tests') }),
    ).rejects.toThrow('symbolic link');
    expect(existsSync(join(outside, 'run-tests'))).toBe(false);
  });

  it('an Apply whose target became unsafe fails with the reason and writes nothing', async () => {
    const s = await setup();
    const agent = await chatting(s);
    const rec = s.record();
    await agent.callLead('propose_skill', { slug: 'run-tests', content: SKILL('run-tests') });
    const [pending] = proposals(rec.events);
    const outside = tempDir('acp-assistant-outside-');
    mkdirSync(join(s.repo, '.claude'));
    symlinkSync(outside, join(s.repo, '.claude', 'skills'));
    const applied = await s.post(`/proposals/${pending?.id}/apply`);
    expect(applied.body).toMatchObject({ state: 'failed' });
    expect(applied.body.problem).toContain('symbolic link');
    expect(existsSync(join(outside, 'run-tests'))).toBe(false);
    expect(agent.sent.at(-1)).toContain('but writing it failed');
  });
});

describe('session only: nothing persisted (ADR-0035 §4, ADR-0009)', () => {
  it('stores no chat text, proposal or session in the database, and logs no text', async () => {
    const s = await setup();
    await s.board.getSetup(s.project.id);
    const tables = s.db.connection
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .pluck()
      .all() as string[];
    const counts = () =>
      Object.fromEntries(
        tables.map((t) => [
          t,
          s.db.connection.prepare(`SELECT COUNT(*) FROM "${t}"`).pluck().get(),
        ]),
      );
    const before = counts();
    await s.post('/session', {});
    await s.post('/session/messages', { text: 'OWNER-SECRET-TEXT' });
    await s.flush();
    const agent = s.agent();
    agent.emit({ type: 'lead-text', text: 'ASSISTANT-SECRET-REPLY' });
    await agent.callLead('propose_skill', {
      slug: 'run-tests',
      content: SKILL('run-tests', 'SKILL-SECRET-BODY'),
    });
    await agent.callLead('ticket_status', {});
    await s.post('/session/messages', { text: 'OWNER-SECRET-TWO' });
    await s.flush();
    await s.post('/session/end');
    expect(counts()).toEqual(before);
    const dump = tables
      .map((t) => JSON.stringify(s.db.connection.prepare(`SELECT * FROM "${t}"`).all()))
      .join('\n');
    const logText = JSON.stringify(s.logs);
    for (const secret of [
      'OWNER-SECRET-TEXT',
      'OWNER-SECRET-TWO',
      'ASSISTANT-SECRET-REPLY',
      'SKILL-SECRET-BODY',
    ]) {
      expect(dump).not.toContain(secret);
      expect(logText).not.toContain(secret);
    }
    expect(s.logs.some((l) => l.message === 'assistant session ended')).toBe(true);
  });
});

describe('the chat stream (SSE)', () => {
  it('a fresh connection gets the status and pending proposals, never the history', async () => {
    const s = await setup();
    const agent = await chatting(s);
    agent.emit({ type: 'lead-text', text: 'Earlier reply.' });
    await agent.callLead('propose_skill', { slug: 'a', content: SKILL('a') });
    await agent.callLead('propose_skill', { slug: 'b', content: SKILL('b') });
    await s.flush();
    const first = proposals(s.record().replay.map((r) => r.event));
    await s.post(`/proposals/${first[1]?.id}/discard`);
    const fresh = s.record();
    expect(fresh.replay.map((r) => r.event.type)).toEqual(['status', 'proposal']);
    expect(fresh.replay[0]?.event).toMatchObject({
      type: 'status',
      session: { status: 'working' },
    });
    expect(proposals(fresh.replay.map((r) => r.event))).toEqual([
      expect.objectContaining({ slug: 'a', state: 'pending' }),
    ]);
    expect(JSON.stringify(fresh.replay)).not.toContain('Earlier reply.');
  });

  it('a reconnect with Last-Event-ID gets what it missed, in order', async () => {
    const s = await setup();
    const agent = await chatting(s);
    const live = s.record();
    agent.emit({ type: 'activity', summary: 'Read README.md' });
    await s.flush();
    const lastSeen = live.ids.at(-1) ?? 0;
    live.unsubscribe();
    agent.emit({ type: 'lead-text', text: 'Missed reply.' });
    await s.flush();
    const back = s.record(lastSeen);
    expect(back.replay.map((r) => r.event)).toEqual([
      { type: 'text', full: 'Missed reply.' },
      { type: 'status', session: expect.objectContaining({ status: 'ready' }) as unknown },
    ]);
    // After the chat ends, its buffer goes too: a reconnect gets only the empty status.
    await s.post('/session/end');
    const after = s.record(lastSeen);
    expect(after.replay.map((r) => r.event)).toEqual([{ type: 'status', session: null }]);
  });

  it('serves unnamed data frames with ids over HTTP, after CSRF-checked POSTs', async () => {
    const s = await setup();
    expect((await s.get('/session')).status).toBe(404);
    const noCsrf = await (
      await import('supertest')
    )
      .default(s.app)
      .post(`${s.base}/session`)
      .send({});
    expect(noCsrf.status).toBe(403);
    await s.post('/session', {});
    const server = s.app.listen(0, '127.0.0.1');
    await new Promise((r) => server.once('listening', r));
    const address = server.address();
    const port = typeof address === 'object' && address !== null ? address.port : 0;
    const res = await fetch(`http://127.0.0.1:${port}${s.base}/stream`);
    const reader = res.body?.getReader();
    let text = '';
    while (!text.includes('"type":"status"')) {
      const chunk = await reader?.read();
      if (chunk === undefined || chunk.done === true) break;
      text += new TextDecoder().decode(chunk.value as Uint8Array);
    }
    await reader?.cancel();
    server.close();
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    expect(text).toMatch(/id: \d+\ndata: \{"type":"status","session":\{/);
    expect(text).not.toContain('event:');
  });
});
