import { describe, expect, it } from 'vitest';
import {
  AssistantMessageRequestSchema,
  AssistantProposalDtoSchema,
  AssistantStartRequestSchema,
  AssistantStreamEventSchema,
} from '../src/api/index.js';
import {
  ASSISTANT_TOOL_NAMES,
  emitsChatText,
  isReadOnlyRole,
  keepsInputOpen,
  LEAD_ROLE_TOOL_NAMES,
  LeadToolInputs,
  managedToolNames,
  MAX_SKILL_BYTES,
} from '../src/index.js';

/** ADR-0035: the project assistant's role, tools and API shapes. */

describe('the assistant role', () => {
  it('gets its four tools and the code map, never a ticket control tool', () => {
    expect(managedToolNames({ kind: 'assistant' })).toEqual([
      'ticket_status',
      'project_info',
      'propose_skill',
      'propose_agent',
      'code_map',
    ]);
    for (const name of [
      'start_agent',
      'message_agent',
      'stop_agent',
      'merge_change',
      'submit_plan',
    ]) {
      expect(ASSISTANT_TOOL_NAMES).not.toContain(name);
    }
    for (const name of ['ticket_status', 'project_info', 'propose_skill', 'propose_agent']) {
      expect(LEAD_ROLE_TOOL_NAMES).not.toContain(name);
      for (const kind of ['planner', 'reviewer', 'worker', 'tester'] as const) {
        expect(managedToolNames({ kind, canStartHelpers: true })).not.toContain(name);
      }
    }
  });

  it('only reads, keeps its input open and streams its text as chat', () => {
    expect(isReadOnlyRole('assistant')).toBe(true);
    expect(keepsInputOpen('assistant')).toBe(true);
    expect(emitsChatText('assistant')).toBe(true);
  });

  it('validates its tool inputs with the Skills & Agents limits', () => {
    const skill = LeadToolInputs.propose_skill;
    expect(skill.safeParse({ slug: 'run-tests', content: 'x' }).success).toBe(true);
    expect(skill.safeParse({ slug: '../x', content: 'x' }).success).toBe(false);
    expect(skill.safeParse({ slug: 'a', content: 'x'.repeat(MAX_SKILL_BYTES + 1) }).success).toBe(
      false,
    );
    expect(LeadToolInputs.ticket_status.safeParse({}).success).toBe(true);
    expect(LeadToolInputs.project_info.safeParse({}).success).toBe(true);
  });
});

describe('assistant API shapes', () => {
  it('defaults a start request to Claude, the default model, medium effort and Approve', () => {
    expect(AssistantStartRequestSchema.parse({})).toEqual({
      provider: 'claude-code',
      model: null,
      effort: 'medium',
      mode: 'approve',
    });
    expect(AssistantStartRequestSchema.safeParse({ effort: 'max' }).success).toBe(false);
  });

  it('caps a message at 8000 characters', () => {
    expect(AssistantMessageRequestSchema.safeParse({ text: 'x'.repeat(8000) }).success).toBe(true);
    expect(AssistantMessageRequestSchema.safeParse({ text: 'x'.repeat(8001) }).success).toBe(false);
    expect(AssistantMessageRequestSchema.safeParse({ text: '   ' }).success).toBe(false);
  });

  it('allows only the two proposal paths', () => {
    const base = {
      id: 'p1',
      kind: 'skill',
      slug: 'a',
      content: 'x',
      replace: false,
      state: 'pending',
      problem: null,
    };
    for (const path of ['.claude/skills/a/SKILL.md', '.claude/agents/a.md']) {
      expect(AssistantProposalDtoSchema.safeParse({ ...base, path }).success).toBe(true);
    }
    for (const path of ['.claude/settings.json', '.claude/skills/../x/SKILL.md', 'src/a.md']) {
      expect(AssistantProposalDtoSchema.safeParse({ ...base, path }).success).toBe(false);
    }
  });

  it('types every stream event', () => {
    expect(AssistantStreamEventSchema.safeParse({ type: 'text', full: 'Hi' }).success).toBe(true);
    expect(AssistantStreamEventSchema.safeParse({ type: 'status', session: null }).success).toBe(
      true,
    );
    expect(AssistantStreamEventSchema.safeParse({ type: 'text', delta: 'Hi' }).success).toBe(false);
  });
});
