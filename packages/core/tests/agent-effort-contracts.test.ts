// Contract tests for the reasoning effort per agent block (ADR-0028 §1, v0.3.1 P-0). Additive:
// graphs saved before it still parse. Synthetic data only.
import { describe, expect, it } from 'vitest';
import { AGENT_EFFORTS, WorkflowNodeSchema } from '../src/index.js';

const lead = {
  type: 'lead',
  id: 'orchestrate',
  label: 'Lead',
  model: null,
  skills: [],
  agent: null,
};

describe('agent effort', () => {
  it('offers low, medium and high', () => {
    expect(AGENT_EFFORTS).toEqual(['low', 'medium', 'high']);
  });

  it('keeps older agent blocks and reads a chosen effort', () => {
    expect(WorkflowNodeSchema.parse(lead)).not.toHaveProperty('effort');
    expect(WorkflowNodeSchema.parse({ ...lead, effort: 'high' })).toMatchObject({ effort: 'high' });
  });

  it('refuses levels the editor does not offer', () => {
    for (const effort of ['max', 'xhigh', 'HIGH', '']) {
      expect(WorkflowNodeSchema.safeParse({ ...lead, effort }).success, effort).toBe(false);
    }
  });
});
