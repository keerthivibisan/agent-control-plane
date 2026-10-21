// Contract tests for session names and run summaries (ADR-0024, v0.3.0 S-0). Additive: every
// earlier shape still parses. Synthetic data only.
import { describe, expect, it } from 'vitest';
import {
  MAX_SESSION_TITLE,
  TicketCommentAuthorSchema,
  TicketCommentSchema,
  type ManagedAgentSpec,
} from '../src/index.js';
import { SessionSummaryDtoSchema } from '../src/api/index.js';

const T = '2026-10-21T09:00:00.000Z';

describe('run summary comments', () => {
  it('accepts the app as a comment author, and the earlier authors still', () => {
    expect(TicketCommentAuthorSchema.options).toEqual(['owner', 'lead', 'reviewer', 'app']);
    const comment = {
      id: 'c1',
      ticketId: 't1',
      runId: 'r1',
      planId: null,
      author: 'app',
      body: 'Run summary',
      createdAt: T,
    };
    expect(TicketCommentSchema.parse(comment).author).toBe('app');
    expect(TicketCommentSchema.safeParse({ ...comment, author: 'system' }).success).toBe(false);
  });
});

describe('session titles', () => {
  it('lets a managed agent spec carry its title', () => {
    const spec: ManagedAgentSpec = {
      agentRunId: 'a1',
      kind: 'worker',
      cwd: '/work/web-app/.worktrees/a1',
      prompt: 'Do the step',
      model: null,
      title: 'WEB-12 · Frontend helper',
    };
    expect(spec.title?.length).toBeLessThanOrEqual(MAX_SESSION_TITLE);
    expect(MAX_SESSION_TITLE).toBe(120);
  });

  it('adds the managed run to a session summary, and older summaries still parse', () => {
    const shape = SessionSummaryDtoSchema.shape;
    expect(shape.managed.safeParse(undefined).success).toBe(true);
    const managed = {
      runId: 'r1',
      agentRunId: 'a1',
      ticketKey: 'WEB-12',
      kind: 'worker',
      label: 'Frontend helper',
    };
    expect(shape.managed.parse(managed)).toEqual(managed);
    expect(shape.managed.safeParse({ ...managed, ticketKey: null }).success).toBe(true);
    expect(shape.managed.safeParse({ ...managed, kind: 'owner' }).success).toBe(false);
  });
});
