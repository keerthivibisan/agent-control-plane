// ADR-0030: path patterns, change classification, the deterministic verification gate, evidence
// staleness and the policy contracts. Synthetic data only.
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_AUTOMATION,
  LeadToolInputs,
  ProjectAgentSetupSchema,
  ProjectAutomationSchema,
  RepoPathPatternSchema,
  automationOf,
  automationWarnings,
  classifyPaths,
  decideVerification,
  evidenceStaleReason,
  matchesPathPattern,
  policyFingerprint,
  type HarnessCheck,
  type ProjectAutomation,
  type VerificationPolicy,
} from '../src/index.js';
import {
  ConflictResolutionRecordSchema,
  UpdateProjectSetupRequestSchema,
  isActiveResolutionState,
} from '../src/api/index.js';

const check = (id: string, required: boolean): HarnessCheck => ({
  id,
  name: id,
  argv: ['pnpm', id],
  timeoutSec: 60,
  required,
});
const CHECKS = [check('lint', true), check('unit', true), check('smoke', false)];
const adaptive: VerificationPolicy = {
  mode: 'agent-adaptive',
  skipScopes: ['docs/**', 'README.md'],
  alwaysRunChecks: [],
  allowUnverifiedDelivery: false,
  onMissingChecks: 'escalate',
};
const required: VerificationPolicy = { ...adaptive, mode: 'required' };

describe('path patterns', () => {
  it('matches anchored and file-name patterns', () => {
    expect(matchesPathPattern('docs/guide/intro.md', 'docs/**')).toBe(true);
    expect(matchesPathPattern('docs/intro.md', 'docs/*.md')).toBe(true);
    expect(matchesPathPattern('docs/a/intro.md', 'docs/*.md')).toBe(false);
    expect(matchesPathPattern('src/docs/x.md', 'docs/**')).toBe(false);
    expect(matchesPathPattern('a/b/notes.md', '*.md')).toBe(true);
    expect(matchesPathPattern('README.md', 'README.md')).toBe(true);
  });

  it('rejects unsafe patterns', () => {
    for (const bad of ['/docs/**', '../x', 'docs/../src', 'docs//x', 'docs\\x', 'a/']) {
      expect(RepoPathPatternSchema.safeParse(bad).success).toBe(false);
      expect(matchesPathPattern('docs/x', bad)).toBe(false);
    }
  });
});

describe('classifyPaths (the entire combined change)', () => {
  it('is prose-only only when every path is prose inside a scope', () => {
    expect(classifyPaths(['docs/a.md', 'README.md'], adaptive.skipScopes).classification).toBe(
      'prose-only',
    );
  });

  it('MDX, scripts and dot-folders are never prose', () => {
    expect(classifyPaths(['docs/page.mdx'], ['docs/**']).classification).toBe('runtime');
    expect(classifyPaths(['docs/run.sh'], ['docs/**']).classification).toBe('runtime');
    expect(classifyPaths(['.github/README.md'], ['**']).classification).not.toBe('prose-only');
  });

  it('one runtime file among prose makes it runtime', () => {
    const c = classifyPaths(['docs/a.md', 'start.sh'], adaptive.skipScopes);
    expect(c.classification).toBe('runtime');
    expect(c.outsideScope).toEqual(['start.sh']);
  });

  it('configuration and dependency files are configuration', () => {
    expect(classifyPaths(['package.json'], ['**']).classification).toBe('configuration');
    expect(classifyPaths(['docs/a.md', 'pnpm-lock.yaml'], ['**']).classification).toBe(
      'configuration',
    );
  });

  it('prose outside every scope, or nothing at all, is uncertain', () => {
    expect(classifyPaths(['notes/a.md'], ['docs/**']).classification).toBe('uncertain');
    expect(classifyPaths([], ['docs/**']).classification).toBe('uncertain');
  });
});

describe('decideVerification (the policy gate)', () => {
  const prose = classifyPaths(['docs/a.md'], adaptive.skipScopes);
  const runtime = classifyPaths(['src/a.ts', 'docs/a.md'], adaptive.skipScopes);
  const skip = {
    classification: 'prose-only' as const,
    recommendation: 'skip-checks' as const,
    proposedCheckIds: [],
    reason: 'docs',
  };

  it('a policy-approved docs change skips checks, never passing them', () => {
    const d = decideVerification({
      policy: adaptive,
      paths: prose,
      assessment: skip,
      checks: CHECKS,
    });
    expect(d.route).toBe('skipped-by-policy');
    expect(d.checkIds).toEqual([]);
    expect(d.matchedRule).toBe('skip-scope:docs/**');
    expect(d.omitted.map((o) => o.id)).toEqual(['lint', 'unit', 'smoke']);
  });

  it('always-run checks still run on a docs change', () => {
    const d = decideVerification({
      policy: { ...adaptive, alwaysRunChecks: ['lint'] },
      paths: prose,
      assessment: skip,
      checks: CHECKS,
    });
    expect(d.route).toBe('run-checks');
    expect(d.checkIds).toEqual(['lint']);
    expect(d.mandatoryCheckIds).toEqual(['lint']);
  });

  it('an agent cannot skip checks for a runtime change, or remove a required one', () => {
    const d = decideVerification({
      policy: adaptive,
      paths: runtime,
      assessment: { ...skip, classification: 'prose-only' },
      checks: CHECKS,
    });
    expect(d.route).toBe('run-checks');
    expect(d.checkIds).toEqual(['lint', 'unit']);
    expect(d.reason).toMatch(/not prose-only/);
  });

  it('an agent may add checks (adaptive), never in required mode', () => {
    const add = {
      ...skip,
      recommendation: 'run-checks' as const,
      proposedCheckIds: ['smoke', 'nope'],
    };
    expect(
      decideVerification({ policy: adaptive, paths: runtime, assessment: add, checks: CHECKS })
        .checkIds,
    ).toEqual(['lint', 'unit', 'smoke']);
    expect(
      decideVerification({ policy: required, paths: runtime, assessment: add, checks: CHECKS })
        .checkIds,
    ).toEqual(['lint', 'unit']);
  });

  it('required mode never skips, even for prose', () => {
    const d = decideVerification({
      policy: required,
      paths: prose,
      assessment: skip,
      checks: CHECKS,
    });
    expect(d.route).toBe('run-checks');
  });

  it('a docs change asks for checks when the agent recommends them', () => {
    const d = decideVerification({
      policy: adaptive,
      paths: prose,
      assessment: { ...skip, recommendation: 'run-checks' },
      checks: CHECKS,
    });
    expect(d.route).toBe('run-checks');
  });

  it('no harness: unavailable (escalate) by default', () => {
    const d = decideVerification({
      policy: required,
      paths: runtime,
      assessment: null,
      checks: null,
    });
    expect(d.route).toBe('unavailable');
    expect(d.deliverAs).toBe('none');
    expect(d.reason).toMatch(/no harness file/);
  });

  it('no harness with draft-pr: only a draft may be delivered', () => {
    const d = decideVerification({
      policy: { ...required, onMissingChecks: 'draft-pr' },
      paths: runtime,
      assessment: null,
      checks: null,
    });
    expect(d.route).toBe('unavailable');
    expect(d.deliverAs).toBe('draft');
  });

  it('no harness with explicit unverified delivery: unverified, never passed', () => {
    const d = decideVerification({
      policy: { ...required, allowUnverifiedDelivery: true },
      paths: runtime,
      assessment: null,
      checks: null,
    });
    expect(d.route).toBe('unverified-by-policy');
    expect(d.reason).toMatch(/nothing was tested/);
  });

  it('a docs change without a harness still takes the approved skip path', () => {
    const d = decideVerification({
      policy: adaptive,
      paths: prose,
      assessment: null,
      checks: null,
    });
    expect(d.route).toBe('skipped-by-policy');
  });
});

describe('evidence binding', () => {
  const evidence = {
    candidateCommit: 'a'.repeat(40),
    targetCommit: 'b'.repeat(40),
    policyFingerprint: 'p',
  };
  it('is current only for the same candidate, target and policy', () => {
    expect(evidenceStaleReason(evidence, { ...evidence })).toBeNull();
    expect(evidenceStaleReason(evidence, { ...evidence, targetCommit: 'c'.repeat(40) })).toMatch(
      /target branch moved/,
    );
    expect(evidenceStaleReason(evidence, { ...evidence, candidateCommit: 'c'.repeat(40) })).toMatch(
      /candidate changed/,
    );
    expect(evidenceStaleReason(evidence, { ...evidence, policyFingerprint: 'q' })).toMatch(
      /policy/,
    );
    expect(evidenceStaleReason(evidence, { ...evidence, targetCommit: null })).toMatch(/no longer/);
  });

  it('the fingerprint changes with any policy field, not with key order', () => {
    const a = policyFingerprint(DEFAULT_AUTOMATION);
    const reordered = JSON.parse(JSON.stringify(DEFAULT_AUTOMATION)) as ProjectAutomation;
    expect(policyFingerprint(reordered)).toBe(a);
    const wider: ProjectAutomation = {
      ...DEFAULT_AUTOMATION,
      delivery: { mode: 'push-pr', allowedTargets: ['dev'] },
    };
    expect(policyFingerprint(wider)).not.toBe(a);
  });
});

describe('contracts', () => {
  it('defaults are conservative and old setups keep them', () => {
    expect(DEFAULT_AUTOMATION.conflictResolution.mode).toBe('manual');
    expect(DEFAULT_AUTOMATION.verification.allowUnverifiedDelivery).toBe(false);
    expect(DEFAULT_AUTOMATION.delivery.mode).toBe('manual');
    expect(ProjectAutomationSchema.safeParse(DEFAULT_AUTOMATION).success).toBe(true);
    expect(automationOf({})).toBe(DEFAULT_AUTOMATION);
    expect(ProjectAgentSetupSchema.shape.automation.safeParse(undefined).success).toBe(true);
    expect(UpdateProjectSetupRequestSchema.shape.automation.safeParse(null).success).toBe(true);
  });

  it('bounds attempts and warns about risky combinations', () => {
    const bad = {
      ...DEFAULT_AUTOMATION,
      conflictResolution: { mode: 'auto', maxAttempts: 9, helper: null },
    };
    expect(ProjectAutomationSchema.safeParse(bad).success).toBe(false);
    const risky: ProjectAutomation = {
      ...DEFAULT_AUTOMATION,
      verification: { ...DEFAULT_AUTOMATION.verification, allowUnverifiedDelivery: true },
      delivery: { mode: 'merge', allowedTargets: [] },
    };
    expect(automationWarnings(risky)).toHaveLength(2);
  });

  it('report_work takes an optional outcome and assessment', () => {
    const tool = LeadToolInputs.report_work;
    expect(tool.safeParse({ note: 'done' }).success).toBe(true);
    expect(tool.safeParse({ note: 'stuck', outcome: 'blocked' }).success).toBe(true);
    expect(tool.safeParse({ note: 'x', outcome: 'gave-up' }).success).toBe(false);
    expect(
      tool.safeParse({
        note: 'x',
        assessment: {
          classification: 'runtime',
          recommendation: 'run-checks',
          proposedCheckIds: ['unit'],
          reason: 'touches startup',
        },
      }).success,
    ).toBe(true);
  });

  it('active states hold the single operation slot', () => {
    expect(isActiveResolutionState('awaiting-owner')).toBe(true);
    expect(isActiveResolutionState('completed')).toBe(false);
    expect(ConflictResolutionRecordSchema.shape.state.options).toContain('interrupted');
  });
});
