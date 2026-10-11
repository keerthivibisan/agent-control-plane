/**
 * Synthetic, test-only control-panel responses (Phase 3 M1). Every builder parses its output with
 * the @acp/core/api schema, so a fixture that drifts from the contract fails loudly. The roles,
 * tasks, paths and diff are invented. Never import this from src/.
 */
import {
  AgentRunDtoSchema,
  ApprovalDtoSchema,
  ChatMessageDtoSchema,
  ReviewDtoSchema,
  RunDetailDtoSchema,
  RunSummaryDtoSchema,
  type AgentRunDto,
  type ApprovalDto,
  type ChatMessageDto,
  type ReviewDto,
  type RunDetailDto,
  type RunSummaryDto,
} from '@acp/core/api';

export const RUN_ID = 'run-1';
export const LEAD_ID = 'agent-lead';
export const BUILDER_ID = 'agent-builder';
export const TESTER_ID = 'agent-tester';
export const CSRF = 'csrf-token-0123456789abcdef0123456789abcdef';

const T0 = '2026-10-11T09:00:00.000Z';
const T1 = '2026-10-11T09:01:00.000Z';
const T2 = '2026-10-11T09:02:00.000Z';
const T3 = '2026-10-11T09:05:00.000Z';

export function agent(over: Partial<AgentRunDto> & { id: string }): AgentRunDto {
  return AgentRunDtoSchema.parse({
    runId: RUN_ID,
    parentAgentRunId: LEAD_ID,
    kind: 'worker',
    role: 'Helper',
    task: 'Do one thing.',
    status: 'RUNNING',
    sessionId: null,
    budget: { used: 0, limit: 500_000 },
    latestActivity: null,
    review: null,
    createdAt: T1,
    endedAt: null,
    ...over,
  });
}

export const lead = agent({
  id: LEAD_ID,
  parentAgentRunId: null,
  kind: 'lead',
  role: 'Lead',
  task: null,
  status: 'RUNNING',
  sessionId: 's-lead',
  budget: { used: 42_000, limit: 500_000 },
  latestActivity: 'Started a helper agent: Test writer',
  createdAt: T0,
});

export const builder = agent({
  id: BUILDER_ID,
  role: 'Settings page builder',
  task: 'Add a settings page with a dark-mode switch.',
  status: 'WAITING_APPROVAL',
  sessionId: 's-builder',
  budget: { used: 120_000, limit: 500_000 },
  latestActivity: 'Used tool: Edit',
  createdAt: T1,
});

export const tester = agent({
  id: TESTER_ID,
  role: 'Test writer',
  task: 'Write tests for the settings page.',
  status: 'SUCCEEDED',
  sessionId: null,
  budget: { used: 512_000, limit: 500_000 },
  latestActivity: 'Finished its turn',
  review: { state: 'pending', changedFiles: 2 },
  createdAt: T2,
  endedAt: T3,
});

export function approval(over: Partial<ApprovalDto> & { id: string }): ApprovalDto {
  return ApprovalDtoSchema.parse({
    runId: RUN_ID,
    agentRunId: BUILDER_ID,
    kind: 'tool-use',
    toolName: 'Edit',
    summary: 'Edit src/settings.tsx',
    status: 'pending',
    requestedAt: T3,
    decidedAt: null,
    ...over,
  });
}

export function message(over: Partial<ChatMessageDto> & { id: string }): ChatMessageDto {
  return ChatMessageDtoSchema.parse({
    runId: RUN_ID,
    role: 'owner',
    text: 'Hello',
    createdAt: T0,
    ...over,
  });
}

export function runDetail(over: Partial<RunDetailDto> = {}): RunDetailDto {
  return RunDetailDtoSchema.parse({
    id: RUN_ID,
    projectId: 'p-1',
    title: 'Settings page',
    status: 'RUNNING',
    agentCount: 3,
    pendingApprovals: 1,
    createdAt: T0,
    updatedAt: T3,
    endedAt: null,
    budget: { maxTokensPerAgent: 500_000, softCostUsdPerRun: null },
    agents: [tester, lead, builder],
    approvals: [
      approval({ id: 'ap-1' }),
      approval({
        id: 'ap-0',
        summary: 'Run npm test',
        status: 'approved',
        requestedAt: T1,
        decidedAt: T2,
      }),
    ],
    messages: [
      message({
        id: 'm-2',
        role: 'lead',
        text: 'Starting two helper agents.',
        createdAt: T1,
      }),
      message({ id: 'm-1', text: 'Spin up two agents: one builds it, one tests it.' }),
    ],
    ...over,
  });
}

export function runSummary(over: Partial<RunSummaryDto> & { id: string }): RunSummaryDto {
  return RunSummaryDtoSchema.parse({
    projectId: 'p-1',
    title: 'Settings page',
    status: 'RUNNING',
    agentCount: 3,
    pendingApprovals: 0,
    createdAt: T0,
    updatedAt: T3,
    endedAt: null,
    ...over,
  });
}

export const DIFF = [
  'diff --git a/tests/settings.test.ts b/tests/settings.test.ts',
  'new file mode 100644',
  'index 0000000..1111111',
  '--- /dev/null',
  '+++ b/tests/settings.test.ts',
  '@@ -0,0 +1,2 @@',
  "+import { test } from 'vitest';",
  "+test('renders', () => {});",
  'diff --git a/src/settings.tsx b/src/settings.tsx',
  'index 2222222..3333333 100644',
  '--- a/src/settings.tsx',
  '+++ b/src/settings.tsx',
  '@@ -1,3 +1,3 @@',
  ' export function Settings() {',
  "-  return 'old';",
  "+  return 'new';",
  ' }',
  '',
].join('\n');

export function review(over: Partial<ReviewDto> = {}): ReviewDto {
  return ReviewDtoSchema.parse({
    runId: RUN_ID,
    agents: [
      {
        agentRunId: TESTER_ID,
        role: 'Test writer',
        branch: `acp/${RUN_ID}/${TESTER_ID}`,
        baseBranch: 'main',
        state: 'pending',
        files: [
          { path: 'tests/settings.test.ts', status: 'added', additions: 2, deletions: 0 },
          { path: 'src/settings.tsx', status: 'modified', additions: 1, deletions: 1 },
        ],
        diff: DIFF,
        diffTruncated: true,
      },
    ],
    ...over,
  });
}
