import { describe, expect, it } from 'vitest';
import {
  emitsChatText,
  gitGuardMessage,
  isChangeReviewer,
  isFollowUp,
  isReadOnlyRole,
  keepsInputOpen,
  LEAD_ROLE_TOOL_NAMES,
  managedToolNames,
  specKeepsInputOpen,
} from '../src/index.js';

/*
 * CX-3: the role tool sets and role facts moved here from the Claude Code adapter so both managed
 * adapters share them. The Claude adapter's tests (`permissions.test.ts`, `review-loop.test.ts`)
 * still cover the full behaviour through its re-exports.
 */

describe('managedToolNames', () => {
  it('gives each role its set', () => {
    expect(managedToolNames({ kind: 'lead' })).toBe(LEAD_ROLE_TOOL_NAMES);
    expect(LEAD_ROLE_TOOL_NAMES).not.toContain('post_review');
    expect(LEAD_ROLE_TOOL_NAMES).not.toContain('submit_review');
    expect(LEAD_ROLE_TOOL_NAMES).not.toContain('report_work');
    expect(LEAD_ROLE_TOOL_NAMES).not.toContain('ask_lead');
    expect(LEAD_ROLE_TOOL_NAMES).toContain('get_review_findings');
    expect(LEAD_ROLE_TOOL_NAMES).toContain('code_map');
    expect(managedToolNames({ kind: 'planner' })).toEqual(['submit_plan', 'code_map']);
    expect(managedToolNames({ kind: 'reviewer' })).toEqual(['post_review', 'ask_lead', 'code_map']);
    expect(managedToolNames({ kind: 'reviewer', reviewScope: 'change' })).toEqual([
      'submit_review',
      'ask_lead',
      'code_map',
    ]);
    expect(managedToolNames({ kind: 'worker' })).toEqual(['report_work', 'ask_lead', 'code_map']);
    expect(managedToolNames({ kind: 'worker', canStartHelpers: true })).toEqual([
      'start_agent',
      'list_agents',
      'message_agent',
      'stop_agent',
      'agent_status',
      'report_work',
      'ask_lead',
      'code_map',
    ]);
    expect(managedToolNames({ kind: 'tester', canStartHelpers: true })).toEqual([
      'report_work',
      'ask_lead',
      'code_map',
    ]);
  });

  it('ADR-0034 §4: code_map for every role, follow-ups included', () => {
    const specs = [
      { kind: 'lead' },
      { kind: 'planner' },
      { kind: 'reviewer' },
      { kind: 'reviewer', reviewScope: 'change' },
      { kind: 'worker' },
      { kind: 'worker', canStartHelpers: true },
      { kind: 'tester' },
      { kind: 'lead', followUp: { resumeSessionId: 's' } },
    ] as const;
    for (const spec of specs) expect(managedToolNames(spec)).toContain('code_map');
  });

  it('ADR-0033: ask_lead for helpers, the tester and reviewers; get_review_findings for the lead', () => {
    const kinds = ['lead', 'planner', 'reviewer', 'worker', 'tester'] as const;
    const withTool = (tool: string) =>
      kinds.filter((kind) => managedToolNames({ kind }).includes(tool as 'ask_lead'));
    expect(withTool('ask_lead')).toEqual(['reviewer', 'worker', 'tester']);
    expect(withTool('get_review_findings')).toEqual(['lead']);
  });

  it('gives a follow-up only the read-only code_map (ADR-0034 §4)', () => {
    expect(managedToolNames({ kind: 'lead', followUp: { resumeSessionId: 's' } })).toEqual([
      'code_map',
    ]);
  });
});

describe('role facts', () => {
  it('reads roles as the adapters need them', () => {
    expect(isChangeReviewer({ kind: 'reviewer', reviewScope: 'change' })).toBe(true);
    expect(isChangeReviewer({ kind: 'reviewer' })).toBe(false);
    expect(
      ['lead', 'planner', 'reviewer', 'worker', 'tester'].filter((k) =>
        isReadOnlyRole(k as 'lead'),
      ),
    ).toEqual(['planner', 'reviewer']);
    expect(keepsInputOpen('lead') && keepsInputOpen('planner') && !keepsInputOpen('worker')).toBe(
      true,
    );
    expect(emitsChatText('planner') && !emitsChatText('tester')).toBe(true);
    expect(isFollowUp({ followUp: { resumeSessionId: 's' } })).toBe(true);
    expect(specKeepsInputOpen({ kind: 'lead', followUp: { resumeSessionId: 's' } })).toBe(false);
    expect(specKeepsInputOpen({ kind: 'lead' })).toBe(true);
  });

  it('the git guard message names only the refused subcommand', () => {
    expect(gitGuardMessage({ command: 'git push' })).toContain('(git push)');
  });
});
