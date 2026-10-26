// Session names (ADR-0024 §2, v0.3.0 S-B): one pure function names a session everywhere. Synthetic
// data only.
import { describe, expect, it } from 'vitest';
import {
  formatSessionStart,
  nameSession,
  sessionName,
  sessionNameFromTitle,
} from '../../src/lib/session-name';
import { session, T0 } from '../fixtures/dto';

// A fixed start format, so the expectations don't depend on the time zone.
const at = (iso: string) => `@${iso}`;
const managed = {
  runId: 'r-1',
  agentRunId: 'a-1',
  ticketKey: 'WEB-12',
  kind: 'worker' as const,
  label: 'Frontend helper',
};

describe('nameSession', () => {
  it('names a session the app started after its ticket and label, and marks it', () => {
    const n = nameSession(session({ id: 's-1', title: 'Claude’s own title', managed }), at);
    expect(n).toEqual({ kind: 'managed', name: 'WEB-12 · Frontend helper', detail: null, managed });
  });

  it('uses the label alone for a run without a ticket', () => {
    const s = session({ id: 's-1', managed: { ...managed, ticketKey: null, label: 'Lead' } });
    expect(nameSession(s, at).name).toBe('Lead');
    expect(nameSession(s, at).managed?.runId).toBe('r-1');
  });

  it('wins over the helper rule too: an app-started helper keeps its app name', () => {
    const s = session({ id: 's-1', providerAgentId: 'ag-1', agentType: 'Explore', managed });
    expect(nameSession(s, at).kind).toBe('managed');
  });

  it('uses Claude Code’s title next', () => {
    const n = nameSession(session({ id: 's-1', title: 'Fix login' }), at);
    expect(n).toEqual({ kind: 'titled', name: 'Fix login', detail: null, managed: null });
  });

  it('ignores a blank title', () => {
    expect(nameSession(session({ id: 's-1', title: '   ' }), at).kind).toBe('fallback');
  });

  it('names a helper agent after its type, with its task as the detail', () => {
    const s = session({
      id: 's-2',
      providerAgentId: 'ag-2',
      agentType: 'Explore',
      description: 'Find the login handler',
    });
    expect(nameSession(s, at)).toEqual({
      kind: 'helper',
      name: 'Helper agent: Explore',
      detail: 'Find the login handler',
      managed: null,
    });
  });

  it('knows a helper by its agent type alone, and without a type says "Helper agent"', () => {
    expect(nameSession(session({ id: 's-2', agentType: 'Plan' }), at).name).toBe(
      'Helper agent: Plan',
    );
    const noType = nameSession(session({ id: 's-3', providerAgentId: 'ag-3' }), at);
    expect(noType).toMatchObject({ kind: 'helper', name: 'Helper agent', detail: null });
  });

  it('keeps a titled helper’s task as its detail', () => {
    const s = session({ id: 's-2', providerAgentId: 'ag-2', title: 'Explore', description: 'X' });
    expect(nameSession(s, at)).toMatchObject({ kind: 'titled', name: 'Explore', detail: 'X' });
  });

  it('falls back to the branch and the start time', () => {
    const n = nameSession(session({ id: 's-9', gitBranch: 'feature/login' }), at);
    expect(n).toEqual({
      kind: 'fallback',
      name: `Session on feature/login · @${T0}`,
      detail: null,
      managed: null,
    });
  });

  it('falls back to the start time alone without a branch', () => {
    expect(nameSession(session({ id: 's-9', gitBranch: null }), at).name).toBe(
      `Session started @${T0}`,
    );
    expect(nameSession(session({ id: 's-9', gitBranch: ' ' }), at).name).toBe(
      `Session started @${T0}`,
    );
  });

  it('never says "Untitled", whatever is missing', () => {
    const bare = session({ id: 's-0', title: null, gitBranch: null });
    expect(sessionName(bare)).not.toMatch(/untitled/i);
    expect(sessionName(bare)).toBe(`Session started ${formatSessionStart(T0)}`);
  });

  it('reads sessions from servers before 0.3.0 (no managed field)', () => {
    const { managed: _absent, ...old } = session({ id: 's-1', title: 'Fix login' });
    expect(sessionName(old)).toBe('Fix login');
  });
});

describe('formatSessionStart', () => {
  it('writes a local date and time without seconds, and keeps an unreadable value as is', () => {
    expect(formatSessionStart(T0)).toMatch(/^[A-Z][a-z]{2} \d{1,2}, \d{1,2}:\d{2}\s?[AP]M$/);
    expect(formatSessionStart('not a date')).toBe('not a date');
  });
});

describe('sessionNameFromTitle', () => {
  it('uses the title, else the short id', () => {
    expect(sessionNameFromTitle('1a2b3c4d-5e6f', 'Fix login')).toBe('Fix login');
    expect(sessionNameFromTitle('1a2b3c4d-5e6f', null)).toBe('Session 1a2b3c4d');
    expect(sessionNameFromTitle('1a2b3c4d-5e6f', ' ')).toBe('Session 1a2b3c4d');
  });
});
