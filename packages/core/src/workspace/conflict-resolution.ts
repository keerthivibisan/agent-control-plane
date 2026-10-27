import { z } from 'zod';
import { GitBranchNameSchema } from './branching.js';
import { WorkflowNodeIdSchema } from './node-id.js';
import type { HarnessCheck } from './workspace.js';

/**
 * ADR-0030: policy-driven conflict resolution, adaptive verification and delegated delivery. Pure:
 * the server pins commits, reads the harness file and the changed paths, and passes them here. The
 * agent's assessment is advice; `decideVerification` is the deterministic gate that applies the
 * project's policy to it. Nothing here can grant a permission the policy does not hold.
 */

export const MAX_SKIP_SCOPES = 20;
export const MAX_ALWAYS_RUN_CHECKS = 20;
export const MAX_ALLOWED_TARGETS = 20;
export const MAX_RESOLUTION_ATTEMPTS = 3;
export const MAX_ASSESSMENT_REASON_CHARS = 1500;
export const MAX_PROPOSED_CHECKS = 20;

/** A harness check id (`HarnessCheckSchema.id`). */
export const CheckIdSchema = z
  .string()
  .regex(/^[a-z0-9][a-z0-9-]{0,39}$/, 'lowercase letters, digits and dashes');

const PATTERN_SEGMENT = /^(?:\*\*|[A-Za-z0-9._*-]{1,100})$/;

/**
 * A repository-relative path pattern for skip scopes: `/`-separated segments, each `**` (any
 * number of folders) or letters, digits, `.`, `_`, `-` and `*` (any characters inside one
 * segment). No leading `/`, no `..`, no empty segment, no backslash.
 */
export function isValidPathPattern(pattern: string): boolean {
  if (pattern.startsWith('/') || pattern.endsWith('/')) return false;
  const segments = pattern.split('/');
  return segments.every((s) => s !== '..' && s !== '.' && PATTERN_SEGMENT.test(s));
}

export const RepoPathPatternSchema = z.string().trim().min(1).max(200).refine(isValidPathPattern, {
  message: 'a repository-relative pattern such as docs/** or *.md (no leading /, no ..)',
});
export type RepoPathPattern = z.infer<typeof RepoPathPatternSchema>;

function segmentMatches(segment: string, pattern: string): boolean {
  const re = new RegExp(
    `^${pattern
      .split('*')
      .map((p) => p.replace(/[.+?^${}()|[\]\\-]/g, '\\$&'))
      .join('[^/]*')}$`,
  );
  return re.test(segment);
}

function matchFrom(path: readonly string[], i: number, pat: readonly string[], j: number): boolean {
  if (j === pat.length) return i === path.length;
  if (pat[j] === '**') {
    for (let k = i; k <= path.length; k++) if (matchFrom(path, k, pat, j + 1)) return true;
    return false;
  }
  const seg = path[i];
  const p = pat[j];
  if (seg === undefined || p === undefined) return false;
  return segmentMatches(seg, p) && matchFrom(path, i + 1, pat, j + 1);
}

/**
 * Whether a repository-relative file path matches a pattern. A pattern without `/` matches the
 * file name in any folder (`*.md`), like a `.gitignore` line; otherwise it is anchored at the
 * repository root (`docs/**`).
 */
export function matchesPathPattern(path: string, pattern: string): boolean {
  if (!isValidPathPattern(pattern)) return false;
  const parts = path.split('/');
  const pat = pattern.includes('/') ? pattern.split('/') : ['**', pattern];
  return matchFrom(parts, 0, pat, 0);
}

// ---------------------------------------------------------------- policies

/** How a ticket branch whose target moved is updated (ADR-0030 §1). */
export const ConflictResolutionPolicySchema = z.object({
  /** `manual`: only the owner's click starts it. `auto`: the app starts it when the target moved. */
  mode: z.enum(['manual', 'auto']),
  /** Resolver attempts per operation, counted across replacements (no-change and blocked too). */
  maxAttempts: z.number().int().min(1).max(MAX_RESOLUTION_ATTEMPTS),
  /** The helper block whose model, skills and agent file the resolver uses; null: the first one. */
  helper: WorkflowNodeIdSchema.nullable(),
});
export type ConflictResolutionPolicy = z.infer<typeof ConflictResolutionPolicySchema>;

/** What must be verified before a candidate is promoted or delivered (ADR-0030 §2). */
export const VerificationPolicySchema = z.object({
  /**
   * `required`: every harness check marked required runs on the candidate; nothing is skipped.
   * `agent-adaptive`: the assessment may add checks, and a change wholly inside `skipScopes` (prose
   * only) may skip them; required checks still run for every other change.
   */
  mode: z.enum(['required', 'agent-adaptive']),
  /** Where a prose-only change may skip checks (agent-adaptive only), e.g. `docs/**`, `*.md`. */
  skipScopes: z.array(RepoPathPatternSchema).max(MAX_SKIP_SCOPES),
  /** Checks that run on every candidate, even a prose-only one. Agents cannot waive them. */
  alwaysRunChecks: z.array(CheckIdSchema).max(MAX_ALWAYS_RUN_CHECKS),
  /** A change that needs checks may be delivered although none is configured (never "passed"). */
  allowUnverifiedDelivery: z.boolean(),
  /**
   * When checks are needed but none is configured and unverified delivery is not allowed:
   * `escalate` holds for the owner; `draft-pr` may deliver only as a draft pull request.
   */
  onMissingChecks: z.enum(['escalate', 'draft-pr']),
});
export type VerificationPolicy = z.infer<typeof VerificationPolicySchema>;

/** What the app may deliver without a click (ADR-0030 §3). Separate from resolution. */
export const DeliveryPolicySchema = z.object({
  /**
   * `manual`: the owner merges or opens the pull request. `push-pr`: the app pushes the ticket
   * branch and opens or updates its pull request. `merge`: as `push-pr` when a pull request is
   * open; otherwise the app merges into the target locally (fast-forward only).
   */
  mode: z.enum(['manual', 'push-pr', 'merge']),
  /** Targets the delegation covers. Empty: none, so nothing is delivered automatically. */
  allowedTargets: z.array(GitBranchNameSchema).max(MAX_ALLOWED_TARGETS),
});
export type DeliveryPolicy = z.infer<typeof DeliveryPolicySchema>;

export const ProjectAutomationSchema = z.object({
  conflictResolution: ConflictResolutionPolicySchema,
  verification: VerificationPolicySchema,
  delivery: DeliveryPolicySchema,
});
export type ProjectAutomation = z.infer<typeof ProjectAutomationSchema>;

/** Conservative: nothing automatic, required checks, escalate, owner delivery. */
export const DEFAULT_AUTOMATION: Readonly<ProjectAutomation> = Object.freeze({
  conflictResolution: { mode: 'manual', maxAttempts: 2, helper: null },
  verification: {
    mode: 'required',
    skipScopes: [],
    alwaysRunChecks: [],
    allowUnverifiedDelivery: false,
    onMissingChecks: 'escalate',
  },
  delivery: { mode: 'manual', allowedTargets: [] },
});

/** A project's effective automation: its own, else the defaults (never widened implicitly). */
export function automationOf(setup: {
  automation?: ProjectAutomation | undefined;
}): ProjectAutomation {
  return setup.automation ?? DEFAULT_AUTOMATION;
}

/** Plain warnings for the settings page; they never block saving. */
export function automationWarnings(a: ProjectAutomation): string[] {
  const out: string[] = [];
  if (a.verification.allowUnverifiedDelivery && a.delivery.mode !== 'manual') {
    out.push('Changes that need checks can be delivered without any automated verification.');
  }
  if (a.delivery.mode !== 'manual' && a.delivery.allowedTargets.length === 0) {
    out.push('Delivery is delegated but no target branch is allowed, so nothing is delivered.');
  }
  if (a.verification.mode === 'agent-adaptive' && a.verification.skipScopes.length === 0) {
    out.push('No skip scope is set, so every change still runs its checks.');
  }
  return out;
}

/**
 * A stable fingerprint of a policy: evidence (an assessment, a skip, a pass) is bound to it, so
 * changing the policy makes earlier evidence stale. Canonical JSON, then FNV-1a (64-bit, as two
 * 32-bit halves); not a security hash, only change detection.
 */
export function policyFingerprint(a: ProjectAutomation): string {
  const canonical = JSON.stringify(sortKeys(a));
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < canonical.length; i++) {
    const c = canonical.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ c, 0x811c9dc5) >>> 0;
  }
  return `${h1.toString(16).padStart(8, '0')}${h2.toString(16).padStart(8, '0')}`;
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((k) => [k, sortKeys((value as Record<string, unknown>)[k])]),
    );
  }
  return value;
}

// ---------------------------------------------------------------- classification

export const ChangeClassificationSchema = z.enum([
  'prose-only',
  'runtime',
  'configuration',
  'uncertain',
]);
export type ChangeClassification = z.infer<typeof ChangeClassificationSchema>;

/** Plain prose. MDX, notebooks and templates are not: they can execute or be generated. */
const PROSE_EXTENSIONS = ['.md', '.markdown', '.txt', '.rst', '.adoc'];

const CONFIG_NAMES = new Set([
  'package.json',
  'pnpm-lock.yaml',
  'package-lock.json',
  'yarn.lock',
  'pnpm-workspace.yaml',
  'tsconfig.json',
  'dockerfile',
  'makefile',
  'cargo.toml',
  'cargo.lock',
  'go.mod',
  'go.sum',
  'pom.xml',
  'build.gradle',
  'requirements.txt',
  'pyproject.toml',
  '.npmrc',
  '.nvmrc',
  '.gitattributes',
  '.gitignore',
]);
const CONFIG_EXTENSIONS = ['.json', '.yaml', '.yml', '.toml', '.ini', '.cfg', '.conf', '.env'];

function isConfiguration(path: string): boolean {
  const lower = path.toLowerCase();
  const name = lower.split('/').at(-1) ?? lower;
  if (CONFIG_NAMES.has(name)) return true;
  if (lower.startsWith('.github/') || lower.startsWith('.acp/') || lower.startsWith('.claude/')) {
    return true;
  }
  if (/\.config\.[a-z]+$/.test(name) || name.startsWith('.env')) return true;
  return CONFIG_EXTENSIONS.some((ext) => name.endsWith(ext));
}

function isProse(path: string): boolean {
  const lower = path.toLowerCase();
  // A dot-folder (`.github/`, `.acp/`) is tooling, whatever the file type.
  if (lower.split('/').some((s, i, all) => i < all.length - 1 && s.startsWith('.'))) return false;
  return PROSE_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

export interface PathClassification {
  classification: ChangeClassification;
  /** Paths that keep the change from being prose-only inside the approved scopes. */
  outsideScope: string[];
  /** The skip scopes at least one path matched (the rule a skip names). */
  matchedScopes: string[];
}

/**
 * The deterministic class of the entire combined change (ADR-0030 §4): every path the candidate
 * changes against the new target, every path the target update brought, and every conflicted
 * path. Prose-only needs each path to be plain prose (by extension, outside dot-folders) and
 * inside a skip scope; a name alone is never proof of behavioural safety, so the gate treats
 * prose-only as the one class that may skip, and only under the owner's scopes.
 */
export function classifyPaths(
  paths: readonly string[],
  skipScopes: readonly string[],
): PathClassification {
  const unique = [...new Set(paths)];
  const matchedScopes = skipScopes.filter((s) => unique.some((p) => matchesPathPattern(p, s)));
  const of = (classification: ChangeClassification, outsideScope: string[]) => ({
    classification,
    outsideScope,
    matchedScopes,
  });
  if (unique.length === 0) return of('uncertain', []);
  const outsideScope = unique.filter(
    (p) => !isProse(p) || !skipScopes.some((s) => matchesPathPattern(p, s)),
  );
  if (outsideScope.length === 0) return of('prose-only', outsideScope);
  if (unique.some((p) => !isProse(p) && !isConfiguration(p))) return of('runtime', outsideScope);
  if (unique.some(isConfiguration)) return of('configuration', outsideScope);
  // Prose outside every approved scope: checks still apply.
  return of('uncertain', outsideScope);
}

// ---------------------------------------------------------------- assessment and gate

/** The resolver's (or a reviewer's) recommendation, as its `report_work` carries it. */
export const VerificationAssessmentInputSchema = z.object({
  classification: ChangeClassificationSchema,
  recommendation: z.enum(['run-checks', 'skip-checks']),
  proposedCheckIds: z.array(CheckIdSchema).max(MAX_PROPOSED_CHECKS),
  reason: z.string().trim().min(1).max(MAX_ASSESSMENT_REASON_CHARS),
});
export type VerificationAssessmentInput = z.infer<typeof VerificationAssessmentInputSchema>;

const COMMIT = z.string().regex(/^[0-9a-f]{40}(?:[0-9a-f]{24})?$/);

/** An assessment bound to the commits it assessed: a new candidate or target makes it stale. */
export const VerificationAssessmentSchema = VerificationAssessmentInputSchema.extend({
  candidateCommit: COMMIT,
  targetCommit: COMMIT,
});
export type VerificationAssessment = z.infer<typeof VerificationAssessmentSchema>;

export const VerificationRouteSchema = z.enum([
  'run-checks',
  'skipped-by-policy',
  'unverified-by-policy',
  'unavailable',
]);
export type VerificationRoute = z.infer<typeof VerificationRouteSchema>;

export interface VerificationDecision {
  route: VerificationRoute;
  /** The checks that must run and pass on the candidate (mandatory ∪ agent-selected). */
  checkIds: string[];
  /** The checks no assessment can remove (`required` in required mode, `alwaysRunChecks`). */
  mandatoryCheckIds: string[];
  /** Configured checks that will not run, with why (owner-facing). */
  omitted: { id: string; reason: string }[];
  /** The deterministic class, which wins over the assessment's when they disagree. */
  classification: ChangeClassification;
  /** The policy rule that decided, e.g. `skip-scope:docs/**` or `required-checks`. */
  matchedRule: string;
  /** A plain explanation for the owner. */
  reason: string;
  /** Delivery limit from the route: `draft` only for `unavailable` under `draft-pr`. */
  deliverAs: 'normal' | 'draft' | 'none';
}

export interface DecideVerificationInput {
  policy: VerificationPolicy;
  paths: PathClassification;
  assessment: VerificationAssessmentInput | null;
  /** The harness file's checks; null when the project has no (valid) harness file. */
  checks: readonly HarnessCheck[] | null;
}

/**
 * The deterministic gate (ADR-0030 §4). The agent can only make it stricter: it may add checks,
 * and it may recommend a skip that the policy then allows or not. It never removes a mandatory
 * check, never turns a non-prose change into a skip, and never reports a missing check as passed.
 */
export function decideVerification(input: DecideVerificationInput): VerificationDecision {
  const { policy, paths, assessment } = input;
  const checks = input.checks ?? [];
  const known = new Set(checks.map((c) => c.id));
  const classification = paths.classification;
  const adaptive = policy.mode === 'agent-adaptive';
  const alwaysRun = policy.alwaysRunChecks.filter((id) => known.has(id));
  const required = checks.filter((c) => c.required).map((c) => c.id);
  const proseOnly = adaptive && classification === 'prose-only';
  const agentWantsChecks = assessment?.recommendation === 'run-checks';

  // Prose inside an approved scope: only the always-run checks (if any) apply.
  if (proseOnly && !agentWantsChecks) {
    const omitted = checks
      .filter((c) => !alwaysRun.includes(c.id))
      .map((c) => ({ id: c.id, reason: 'documentation-only change inside an approved scope' }));
    if (alwaysRun.length === 0) {
      return {
        route: 'skipped-by-policy',
        checkIds: [],
        mandatoryCheckIds: [],
        omitted,
        classification,
        matchedRule: `skip-scope:${paths.matchedScopes.join(',')}`,
        reason:
          'Prose-only changes inside the approved documentation scope; no executable, build or configuration file changed. Checks skipped by policy.',
        deliverAs: 'normal',
      };
    }
    return runChecks(alwaysRun, alwaysRun, omitted, classification, 'always-run-checks', input);
  }

  const proposed = adaptive
    ? (assessment?.proposedCheckIds ?? []).filter((id) => known.has(id))
    : [];
  const mandatory = unique([...required, ...alwaysRun]);
  const selected = unique([...mandatory, ...proposed]);
  const omitted = checks
    .filter((c) => !selected.includes(c.id))
    .map((c) => ({ id: c.id, reason: 'not required and not selected by the assessment' }));
  if (selected.length > 0) {
    return runChecks(
      selected,
      mandatory,
      omitted,
      classification,
      adaptive ? 'required-and-selected-checks' : 'required-checks',
      input,
    );
  }
  const why =
    input.checks === null
      ? 'The project has no harness file, so no automated check can run.'
      : 'No configured check applies to this change.';
  if (policy.allowUnverifiedDelivery) {
    return {
      route: 'unverified-by-policy',
      checkIds: [],
      mandatoryCheckIds: [],
      omitted,
      classification,
      matchedRule: 'allow-unverified-delivery',
      reason: `${why} The project allows delivery without automated verification; nothing was tested.`,
      deliverAs: 'normal',
    };
  }
  return {
    route: 'unavailable',
    checkIds: [],
    mandatoryCheckIds: [],
    omitted,
    classification,
    matchedRule: `on-missing-checks:${policy.onMissingChecks}`,
    reason:
      policy.onMissingChecks === 'draft-pr'
        ? `${why} Verification unavailable: delivery is limited to a draft pull request.`
        : `${why} Verification unavailable: waiting for the owner.`,
    deliverAs: policy.onMissingChecks === 'draft-pr' ? 'draft' : 'none',
  };
}

function runChecks(
  checkIds: string[],
  mandatoryCheckIds: string[],
  omitted: { id: string; reason: string }[],
  classification: ChangeClassification,
  matchedRule: string,
  input: DecideVerificationInput,
): VerificationDecision {
  const ignoredSkip =
    input.assessment?.recommendation === 'skip-checks' && classification !== 'prose-only'
      ? ' The assessment recommended skipping checks, but the change is not prose-only inside an approved scope.'
      : '';
  return {
    route: 'run-checks',
    checkIds,
    mandatoryCheckIds,
    omitted,
    classification,
    matchedRule,
    reason: `Checks selected for the candidate: ${checkIds.join(', ')}.${ignoredSkip}`,
    deliverAs: 'normal',
  };
}

function unique(ids: readonly string[]): string[] {
  return [...new Set(ids)];
}

/**
 * Evidence is bound to the candidate commit, the target commit and the policy fingerprint
 * (ADR-0030 §4.7): any change makes it stale. Null when it is current.
 */
export function evidenceStaleReason(
  evidence: { candidateCommit: string | null; targetCommit: string; policyFingerprint: string },
  now: { candidateCommit: string | null; targetCommit: string | null; policyFingerprint: string },
): string | null {
  if (now.targetCommit === null) return 'The target branch no longer exists.';
  if (now.targetCommit !== evidence.targetCommit) {
    return 'The target branch moved since this was assessed; earlier evidence is stale.';
  }
  if (evidence.candidateCommit !== null && now.candidateCommit !== evidence.candidateCommit) {
    return 'The candidate changed since this was assessed; earlier evidence is stale.';
  }
  if (now.policyFingerprint !== evidence.policyFingerprint) {
    return "The project's policy changed since this was decided; earlier evidence is stale.";
  }
  return null;
}

// ---------------------------------------------------------------- helper outcomes

/**
 * A helper's own account of its turn (`report_work.outcome`): the lead is told it with the note,
 * and `no-change` and `blocked` attempts count against the step's limit (ADR-0030 §5).
 */
export const HelperOutcomeKindSchema = z.enum(['completed', 'no-change', 'blocked']);
export type HelperOutcomeKind = z.infer<typeof HelperOutcomeKindSchema>;
