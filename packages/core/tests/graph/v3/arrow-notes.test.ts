// arrowNoteReceiver: who reads each arrow's label and purpose (ADR-0037 §2, amended 2026-11-14).
// Synthetic data.
import { describe, expect, it } from 'vitest';
import {
  arrowNoteReceiver,
  isArrowNoteType,
  type WorkflowEdgeV3,
  type WorkflowNodeV3,
} from '../../../src/index.js';

const agent = (id: string): WorkflowNodeV3 => ({
  type: 'agent',
  id,
  label: id,
  model: null,
  skills: [],
  agent: null,
});
const lead: WorkflowNodeV3 = {
  type: 'lead',
  id: 'lead',
  label: 'Lead',
  model: null,
  skills: [],
  agent: null,
};
const gate = (type: 'ticket' | 'ticket-merge' | 'owner-merge' | 'done', id: string = type) =>
  ({ type, id, label: id }) as WorkflowNodeV3;

function receiver(type: WorkflowEdgeV3['type'], from: WorkflowNodeV3, to: WorkflowNodeV3) {
  return arrowNoteReceiver({ type, from: from.id, to: to.id }, from, to);
}

describe('arrowNoteReceiver', () => {
  it('names the agent each arrow type concerns', () => {
    expect(receiver('research', agent('r'), agent('p'))).toBe('p');
    expect(receiver('custom', agent('a'), agent('b'))).toBe('b');
    expect(receiver('implement', lead, agent('h'))).toBe('h');
    expect(receiver('plan', agent('p'), gate('ticket', 'plan-approval'))).toBe('p');
    expect(receiver('review', agent('h'), agent('rv'))).toBe('rv');
    expect(receiver('review', agent('h'), lead)).toBe('lead');
    expect(receiver('findings', agent('rv'), lead)).toBe('lead');
    expect(receiver('rework', agent('rv'), agent('h'))).toBe('h');
    expect(receiver('test', gate('ticket-merge'), agent('t'))).toBe('t');
    expect(receiver('flow', gate('ticket-merge'), agent('final'))).toBe('final');
    expect(receiver('flow', gate('ticket'), lead)).toBe('lead');
  });

  it('no agent for arrows between steps and for merge', () => {
    expect(receiver('flow', gate('owner-merge'), gate('done'))).toBeNull();
    expect(receiver('flow', agent('final'), gate('owner-merge'))).toBeNull();
    expect(receiver('merge', lead, gate('ticket-merge'))).toBeNull();
    expect(
      arrowNoteReceiver({ type: 'flow', from: 'x', to: 'y' }, undefined, undefined),
    ).toBeNull();
  });

  it('research and custom keep their own hand-off; the rest are program notes', () => {
    expect(isArrowNoteType('research')).toBe(false);
    expect(isArrowNoteType('custom')).toBe(false);
    expect(isArrowNoteType('merge')).toBe(false);
    for (const t of [
      'plan',
      'implement',
      'review',
      'findings',
      'rework',
      'test',
      'flow',
    ] as const) {
      expect(isArrowNoteType(t)).toBe(true);
    }
  });
});
