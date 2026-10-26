// Contract test for the lead's handover note (ADR-0024 §3, v0.3.0 S-A, pre-approved in S-0).
// Additive: `request_review` without a summary still parses. Synthetic data only.
import { describe, expect, it } from 'vitest';
import { LeadToolInputs } from '../src/index.js';

describe('request_review.summary', () => {
  const schema = LeadToolInputs.request_review;

  it('is optional, so the earlier empty input still parses', () => {
    expect(schema.parse({})).toEqual({});
  });

  it('keeps a trimmed note of 1 to 1,500 characters', () => {
    expect(schema.parse({ summary: '  Added the toggle. Tests pass.  ' })).toEqual({
      summary: 'Added the toggle. Tests pass.',
    });
    expect(schema.safeParse({ summary: 'x'.repeat(1500) }).success).toBe(true);
    expect(schema.safeParse({ summary: 'x'.repeat(1501) }).success).toBe(false);
    expect(schema.safeParse({ summary: '   ' }).success).toBe(false);
    expect(schema.safeParse({ summary: 42 }).success).toBe(false);
  });
});
