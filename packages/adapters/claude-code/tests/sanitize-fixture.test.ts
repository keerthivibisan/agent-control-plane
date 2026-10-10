import { describe, expect, it } from 'vitest';
import { REDACTED, Sanitizer, UNPARSEABLE_LINE } from '../scripts/sanitize-fixture.js';

const SESSION = '9a8b7c6d-1234-4abc-9def-0123456789ab';
const UUID_A = 'aaaaaaaa-1111-4222-8333-444444444444';
const UUID_B = 'bbbbbbbb-1111-4222-8333-444444444444';
const ACCOUNT = 'cccccccc-9999-4999-8999-999999999999';

/** Every string that is content, an id, or a path. None may survive sanitization. */
const SECRETS = [
  SESSION,
  UUID_A,
  UUID_B,
  ACCOUNT,
  'msg_01SecretMessageId',
  'req_01SecretRequestId',
  'toolu_01SecretToolUse',
  'a1b2c3secretagent',
  'PROMPT-TEXT-MARKER',
  'THINKING-MARKER',
  'RESPONSE-MARKER',
  'TOOL-INPUT-MARKER',
  'TOOL-OUTPUT-MARKER',
  'TITLE-MARKER',
  'sk-ant-api03-SECRETKEY',
  '/Users/alice/secret-repo',
  'alice',
  'secret-repo',
  'feature/secret-branch',
  'mcp__corp-server__lookup',
  'file-with-secret-name.ts',
];

const lines = [
  {
    type: 'user',
    uuid: UUID_A,
    parentUuid: null,
    sessionId: SESSION,
    cwd: '/Users/alice/secret-repo',
    gitBranch: 'feature/secret-branch',
    version: '2.1.263',
    entrypoint: 'claude-desktop',
    timestamp: '2026-10-10T08:00:00.000Z',
    message: { role: 'user', content: 'PROMPT-TEXT-MARKER sk-ant-api03-SECRETKEY' },
  },
  {
    type: 'assistant',
    uuid: UUID_B,
    parentUuid: UUID_A,
    sessionId: SESSION,
    cwd: '/Users/alice/secret-repo/packages/a',
    requestId: 'req_01SecretRequestId',
    message: {
      id: 'msg_01SecretMessageId',
      model: 'claude-opus-4-5',
      content: [
        { type: 'thinking', thinking: 'THINKING-MARKER', signature: 'SIG' },
        { type: 'text', text: 'RESPONSE-MARKER' },
        {
          type: 'tool_use',
          id: 'toolu_01SecretToolUse',
          name: 'Agent',
          input: { prompt: 'TOOL-INPUT-MARKER', file_path: '/Users/alice/secret-repo/x.ts' },
        },
        { type: 'tool_use', id: 'toolu_01SecretToolUse', name: 'mcp__corp-server__lookup' },
      ],
      stop_reason: 'tool_use',
      usage: { input_tokens: 3, output_tokens: 120, cache_read_input_tokens: 9000 },
    },
  },
  {
    type: 'user',
    uuid: 'dddddddd-1111-4222-8333-444444444444',
    agentId: 'a1b2c3secretagent',
    message: {
      content: [
        {
          type: 'tool_result',
          tool_use_id: 'toolu_01SecretToolUse',
          content: 'TOOL-OUTPUT-MARKER',
          is_error: false,
        },
      ],
    },
    toolUseResult: { 'file-with-secret-name.ts': { lines: 3 } },
  },
  { type: 'custom-title', customTitle: 'TITLE-MARKER', sessionId: SESSION },
  { type: 'bridge-session', accountUuid: ACCOUNT, organizationUuid: ACCOUNT },
  {
    type: 'cost-state',
    modelUsage: { 'claude-opus-4-5': { inputTokens: 10, costUSD: 0.5 } },
    totalCostUSD: 0.5,
  },
];

const input = `${lines.map((l) => JSON.stringify(l)).join('\n')}\n{not json PROMPT-TEXT-MARKER\n`;

describe('fixture sanitizer (C1)', () => {
  it('leaves no input text, id, or path in the output', () => {
    const out = new Sanitizer().jsonl(input);
    for (const secret of SECRETS) expect(out).not.toContain(secret);
  });

  it('keeps structure: keys, record types, line order, numbers, enum values', () => {
    const out = new Sanitizer().jsonl(input).split('\n');
    expect(out).toHaveLength(input.split('\n').length);
    expect(out.at(-2)).toBe(UNPARSEABLE_LINE);
    expect(out.at(-1)).toBe('');

    const parsed = out.slice(0, lines.length).map((l) => JSON.parse(l) as Record<string, unknown>);
    expect(parsed.map((p) => p.type)).toEqual(lines.map((l) => l.type));
    const [user, assistant] = parsed;
    expect(Object.keys(user ?? {})).toEqual(Object.keys(lines[0] ?? {}));
    expect(user).toMatchObject({
      version: '2.1.263',
      entrypoint: 'claude-desktop',
      timestamp: '2026-10-10T08:00:00.000Z',
      cwd: '/home/user/project',
      gitBranch: 'branch-1',
      message: { role: 'user', content: REDACTED },
    });
    expect(assistant).toMatchObject({
      cwd: '/home/user/project/d1/d2',
      message: {
        model: 'claude-opus-4-5',
        stop_reason: 'tool_use',
        usage: { input_tokens: 3, output_tokens: 120, cache_read_input_tokens: 9000 },
        content: [
          { type: 'thinking', thinking: REDACTED },
          { type: 'text', text: REDACTED },
          { type: 'tool_use', name: 'Agent', input: { prompt: REDACTED } },
          { type: 'tool_use', name: 'mcp__redacted__tool' },
        ],
      },
    });
    expect(parsed[5]).toEqual({
      type: 'cost-state',
      modelUsage: { 'claude-opus-4-5': { inputTokens: 10, costUSD: 0.5 } },
      totalCostUSD: 0.5,
    });
    // Dynamic keys that are not identifiers (file names, paths) are replaced too.
    expect(Object.keys((parsed[2]?.toolUseResult as object | undefined) ?? {})).toEqual([
      expect.stringMatching(/^key-\d+$/),
    ]);
  });

  it('maps ids deterministically and consistently, preserving their format', () => {
    const a = new Sanitizer().jsonl(input);
    const b = new Sanitizer().jsonl(input);
    expect(a).toBe(b);

    const [user, assistant, result] = a
      .split('\n')
      .slice(0, 3)
      .map((l) => JSON.parse(l) as Record<string, unknown>);
    const fakeSession = user?.sessionId as string;
    expect(fakeSession).toMatch(/^[0-9a-f]{8}-0000-4000-8000-[0-9a-f]{12}$/);
    expect(assistant?.sessionId).toBe(fakeSession);
    expect(assistant?.parentUuid).toBe(user?.uuid);
    const message = assistant?.message as { id: string; content: Array<{ id?: string }> };
    expect(message.id).toMatch(/^msg_fake[0-9a-f]{6}$/);
    expect(assistant?.requestId).toMatch(/^req_fake[0-9a-f]{6}$/);
    const toolId = message.content[2]?.id;
    expect(toolId).toMatch(/^toolu_fake[0-9a-f]{6}$/);
    const resultBlock = (result?.message as { content: Array<{ tool_use_id: string }> }).content[0];
    expect(resultBlock?.tool_use_id).toBe(toolId);
    expect(result?.agentId).toMatch(/^afake[0-9a-f]{6}$/);
  });

  it('shares the id map across files and maps ids in file names', () => {
    const s = new Sanitizer();
    const transcript = s.jsonl(input);
    const fakeSession = (JSON.parse(transcript.split('\n')[0] ?? '{}') as { sessionId: string })
      .sessionId;
    expect(s.fileName(`${SESSION}.jsonl`)).toBe(`${fakeSession}.jsonl`);
    expect(s.fileName(SESSION)).toBe(fakeSession);
    const agentFile = s.fileName('agent-a1b2c3secretagent.meta.json');
    expect(agentFile).toMatch(/^agent-afake[0-9a-f]{6}\.meta\.json$/);
    expect(s.fileName('agent-a1b2c3secretagent.jsonl')).toBe(
      agentFile.replace('.meta.json', '.jsonl'),
    );

    const meta = s.json(
      JSON.stringify({
        agentType: 'Explore',
        description: 'TOOL-INPUT-MARKER',
        toolUseId: 'toolu_01SecretToolUse',
        spawnDepth: 1,
        worktreePath: '/Users/alice/secret-repo/.claude/worktrees/x',
      }),
    );
    const parsedMeta = JSON.parse(meta) as Record<string, unknown>;
    expect(parsedMeta).toEqual({
      agentType: 'Explore',
      description: REDACTED,
      toolUseId: (
        JSON.parse(transcript.split('\n')[1] ?? '{}') as {
          message: { content: Array<{ id?: string }> };
        }
      ).message.content[2]?.id,
      spawnDepth: 1,
      worktreePath: expect.stringMatching(/^\/home\/user\/project(\/d\d+){3}$/) as string,
    });
  });

  it('redacts unexpected values under kept keys', () => {
    const out = new Sanitizer().jsonl(
      JSON.stringify({ type: 'a type with spaces PROMPT-TEXT-MARKER', model: 'x'.repeat(200) }),
    );
    expect(JSON.parse(out)).toEqual({ type: REDACTED, model: REDACTED });
  });
});
