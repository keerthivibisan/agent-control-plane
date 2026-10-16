import { describe, expect, it } from 'vitest';
import {
  AgentRoleKindSchema,
  ProjectWorkflowSchema,
  SkillNameSchema,
  WORKFLOW_STAGES,
  defaultProjectWorkflow,
  stagesUsingSkill,
  tokenHeadline,
} from '../src/index.js';
import {
  ProjectTokensDtoSchema,
  SkillWriteRequestSchema,
  UpdateWorkflowRequestSchema,
} from '../src/api/index.js';

const T = '2026-10-16T10:00:00.000Z';

describe('workflow contracts (ADR-0019)', () => {
  it('lists the fixed stages in order', () => {
    expect(WORKFLOW_STAGES).toEqual([
      'plan',
      'orchestrate',
      'helpers',
      'review',
      'code-review',
      'unit-tests',
    ]);
  });

  it('defaults to the Phase 4 flow: one lead, no reviewer or tester', () => {
    const wf = ProjectWorkflowSchema.parse(defaultProjectWorkflow('p1', T));
    expect(wf.plannerMode).toBe('lead');
    expect(wf.stages['code-review'].enabled).toBe(false);
    expect(wf.stages['unit-tests'].enabled).toBe(false);
    expect(wf.stages.review.requireChecks).toBe(true);
  });

  it('refuses turning required checks off and unknown skill names', () => {
    const { stages } = defaultProjectWorkflow('p1', T);
    expect(
      UpdateWorkflowRequestSchema.safeParse({
        plannerMode: 'lead',
        stages: { ...stages, review: { requireChecks: false } },
      }).success,
    ).toBe(false);
    expect(
      UpdateWorkflowRequestSchema.safeParse({
        plannerMode: 'separate',
        stages: { ...stages, helpers: { model: null, skill: 'Bad Name' } },
      }).success,
    ).toBe(false);
  });

  it('finds every stage a skill is mapped to', () => {
    const wf = defaultProjectWorkflow('p1', T);
    wf.stages.plan.skill = 'planning';
    wf.stages['code-review'] = { enabled: true, model: null, skill: 'review' };
    wf.stages['unit-tests'] = { enabled: false, model: null, skill: 'review' };
    expect(stagesUsingSkill(wf, 'review')).toEqual(['code-review', 'unit-tests']);
    expect(stagesUsingSkill(wf, 'planning')).toEqual(['plan']);
    expect(stagesUsingSkill(wf, 'none')).toEqual([]);
  });

  it('knows the new agent roles', () => {
    for (const role of ['lead', 'worker', 'planner', 'reviewer', 'tester']) {
      expect(AgentRoleKindSchema.safeParse(role).success).toBe(true);
    }
  });
});

describe('skill contracts (ADR-0018)', () => {
  it('accepts Claude Code skill names only', () => {
    for (const ok of ['code-review', 'unit-tests', 'a', 'x1']) {
      expect(SkillNameSchema.safeParse(ok).success).toBe(true);
    }
    for (const bad of ['', '-x', 'Code', 'a/b', '../etc', 'a b', 'x'.repeat(65)]) {
      expect(SkillNameSchema.safeParse(bad).success).toBe(false);
    }
  });

  it('caps the written file and needs a description', () => {
    const base = { name: 'review', description: 'Review a change', instructions: '# Review' };
    expect(SkillWriteRequestSchema.safeParse(base).success).toBe(true);
    expect(SkillWriteRequestSchema.safeParse({ ...base, description: ' ' }).success).toBe(false);
    expect(
      SkillWriteRequestSchema.safeParse({ ...base, instructions: 'x'.repeat(64 * 1024 + 1) })
        .success,
    ).toBe(false);
  });
});

describe('token headline (redesign §4.5)', () => {
  it('splits new work from cache reuse', () => {
    expect(tokenHeadline({ input: 10, output: 90, cacheCreation: 100, cacheRead: 800 })).toEqual({
      newWork: 100,
      totalProcessed: 1000,
      cacheReuseShare: 0.8,
    });
  });

  it('stays unavailable rather than inventing zeros', () => {
    expect(
      tokenHeadline({ input: null, output: null, cacheCreation: null, cacheRead: null }),
    ).toEqual({ newWork: null, totalProcessed: null, cacheReuseShare: null });
    expect(tokenHeadline({ input: 5, output: null, cacheCreation: null, cacheRead: null })).toEqual(
      {
        newWork: 5,
        totalProcessed: 5,
        cacheReuseShare: null,
      },
    );
  });

  it('parses a project tokens response with external sessions and new roles', () => {
    const usage = {
      tokens: { input: 1, output: 2, cacheCreation: 3, cacheRead: 4 },
      recordCount: 1,
      recordsWithUnavailable: { input: 0, output: 0, cacheCreation: 0, cacheRead: 0 },
      provenance: 'derived',
    };
    const headline = { ...tokenHeadline(usage.tokens), provenance: 'derived' };
    const row = { usage, headline };
    expect(
      ProjectTokensDtoSchema.safeParse({
        projectId: 'p1',
        range: { from: null, to: null },
        sessions: { total: 2, withUsage: 1 },
        runs: 1,
        ticketsWithRuns: 1,
        totals: usage,
        headline,
        byDay: [{ day: '2026-10-16', ...row }],
        bySession: [{ sessionId: 's1', title: null, latestEstimatedCost: null, ...row }],
        byTicket: [{ ticketId: 't1', key: 'WEB-1', title: 'Dark mode', ...row }],
        byRole: [
          { role: 'external', ...row },
          { role: 'reviewer', ...row },
        ],
        byModel: [{ model: 'model-a', ...row }],
      }).success,
    ).toBe(true);
  });
});
