import { describe, expect, it } from 'vitest';
import {
  AgentRunSchema,
  DEFAULT_AGENT_BUDGET_TOKENS,
  LEAD_TOOL_NAMES,
  LeadToolInputs,
  MAX_CONCURRENT_CHILD_AGENTS,
  MAX_DELEGATION_DEPTH,
  budgetTokens,
} from '../src/index.js';
import {
  ApprovalDecisionRequestSchema,
  ChatRequestSchema,
  RunDetailDtoSchema,
  StreamNoticeDtoSchema,
} from '../src/api/index.js';

const T = '2026-10-11T08:00:00.000Z';

describe('budgetTokens (ADR-0014)', () => {
  it('counts output, uncached input and cache writes, but not cache reads', () => {
    expect(budgetTokens({ input: 10, output: 200, cacheCreation: 1000, cacheRead: 999_999 })).toBe(
      1210,
    );
  });
  it('treats a missing category as not contributing, and all-missing as unavailable (null)', () => {
    expect(budgetTokens({ input: null, output: 5, cacheCreation: null, cacheRead: 7 })).toBe(5);
    expect(
      budgetTokens({ input: null, output: null, cacheCreation: null, cacheRead: 7 }),
    ).toBeNull();
  });
});

describe('policy limits (ADR-0013)', () => {
  it('match the roadmap: at most 3 children, depth 1', () => {
    expect(MAX_CONCURRENT_CHILD_AGENTS).toBe(3);
    expect(MAX_DELEGATION_DEPTH).toBe(1);
    expect(DEFAULT_AGENT_BUDGET_TOKENS).toBeGreaterThan(0);
  });
});

describe('lead tools', () => {
  it('are exactly the fixed set and validate their inputs', () => {
    expect(LEAD_TOOL_NAMES.sort()).toEqual(
      [
        'agent_status',
        'list_agents',
        'message_agent',
        'post_review',
        'request_review',
        'start_agent',
        'stop_agent',
        'submit_plan',
      ].sort(),
    );
    expect(
      LeadToolInputs.start_agent.safeParse({ role: 'API builder', task: 'Build it' }).success,
    ).toBe(true);
    expect(LeadToolInputs.start_agent.safeParse({ role: '', task: 'x' }).success).toBe(false);
    expect(
      LeadToolInputs.message_agent.safeParse({ agentId: 'a', text: 'x'.repeat(4001) }).success,
    ).toBe(false);
  });

  it('post_review takes plain text up to the ticket comment limit (decision B)', () => {
    expect(LeadToolInputs.post_review.safeParse({ text: 'Looks fine.' }).success).toBe(true);
    expect(LeadToolInputs.post_review.safeParse({ text: '   ' }).success).toBe(false);
    expect(LeadToolInputs.post_review.safeParse({ text: 'x'.repeat(8001) }).success).toBe(false);
  });
});

describe('orchestration DTOs', () => {
  it('parse a run with a lead and a worker, approvals and chat', () => {
    const agent = (id: string, kind: 'lead' | 'worker') => ({
      id,
      runId: 'r1',
      parentAgentRunId: kind === 'lead' ? null : 'a-lead',
      kind,
      role: kind === 'lead' ? 'Lead' : 'Tester',
      task: kind === 'lead' ? null : 'Write tests',
      status: 'RUNNING',
      sessionId: null,
      budget: { used: 0, limit: DEFAULT_AGENT_BUDGET_TOKENS },
      latestActivity: null,
      review: null,
      branch: kind === 'lead' ? null : 'acp/r1/a-1',
      createdAt: T,
      endedAt: null,
    });
    const run = RunDetailDtoSchema.parse({
      id: 'r1',
      projectId: 'p1',
      ticketId: null,
      title: 'Add rate limiting',
      status: 'RUNNING',
      agentCount: 2,
      pendingApprovals: 1,
      createdAt: T,
      updatedAt: T,
      endedAt: null,
      budget: { maxTokensPerAgent: DEFAULT_AGENT_BUDGET_TOKENS, softCostUsdPerRun: null },
      agents: [agent('a-lead', 'lead'), agent('a-1', 'worker')],
      approvals: [
        {
          id: 'ap1',
          runId: 'r1',
          agentRunId: 'a-1',
          kind: 'tool-use',
          toolName: 'Edit',
          summary: 'Edit src/app.ts',
          status: 'pending',
          requestedAt: T,
          decidedAt: null,
        },
      ],
      messages: [
        { id: 'm1', runId: 'r1', role: 'owner', text: 'Spin up two agents', createdAt: T },
      ],
    });
    expect(run.agents).toHaveLength(2);
    expect(AgentRunSchema.safeParse({ ...run.agents[0], budgetTokensUsed: 0 }).success).toBe(true);
  });

  it('reject empty chat, unknown decisions, and accept the new stream notice kinds', () => {
    expect(ChatRequestSchema.safeParse({ text: '   ' }).success).toBe(false);
    expect(ApprovalDecisionRequestSchema.safeParse({ decision: 'maybe' }).success).toBe(false);
    expect(
      StreamNoticeDtoSchema.parse({
        kind: 'approval-requested',
        lastEventId: 0,
        sessionIds: [],
        projectIds: [],
        runIds: ['r1'],
      }).runIds,
    ).toEqual(['r1']);
  });
});
