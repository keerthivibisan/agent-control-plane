import { z } from 'zod';
import { IsoTimestampSchema } from '../domain/time.js';
import type { RunStatus } from '../orchestration/orchestration.js';

/**
 * Phase 4 Agent Workspace domain (docs/phase-4/README.md §6, ADR-0016, ADR-0017).
 * Tickets live on an internal per-project board; each run of a ticket is a Phase 3 orchestration
 * run, plan-first. The harness is declared in the repo itself (`.acp/harness.json`).
 */

/** Hard ceilings for the per-project agent tree (ADR-0013 amendment). */
export const HARD_MAX_HELPERS = 6;
export const HARD_MAX_DEPTH = 2;
/** Context files given to agents (ADR-0012 amendment). */
export const MAX_CONTEXT_FILES = 10;
export const MAX_CONTEXT_BYTES = 32 * 1024;
/** Harness check output kept per check run (ADR-0017). */
export const MAX_CHECK_OUTPUT_BYTES = 16 * 1024;
export const HARNESS_MANIFEST_PATH = '.acp/harness.json';

const slug = z.string().regex(/^[a-z0-9][a-z0-9-]{0,39}$/, 'lowercase letters, digits and dashes');

/** A repo-relative path: no absolute paths, no `..` segments, no backslashes. */
export const RepoRelativePathSchema = z
  .string()
  .min(1)
  .max(300)
  .refine(
    (p) =>
      !p.startsWith('/') &&
      !/^[A-Za-z]:/.test(p) &&
      !p.includes('\\') &&
      p.split('/').every((seg) => seg !== '..' && seg !== ''),
    'must be a path inside the repository',
  );

// ---------------------------------------------------------------- tickets

export const TicketTypeSchema = z.enum(['feature', 'bug', 'chore', 'harness']);
export type TicketType = z.infer<typeof TicketTypeSchema>;
export const TicketPrioritySchema = z.enum(['low', 'medium', 'high', 'urgent']);
export type TicketPriority = z.infer<typeof TicketPrioritySchema>;
/** Stored ticket status. `ACTIVE` = a run exists; the board column comes from `ticketStage()`. */
export const TicketStatusSchema = z.enum(['BACKLOG', 'READY', 'ACTIVE', 'DONE', 'CANCELLED']);
export type TicketStatus = z.infer<typeof TicketStatusSchema>;
/** Board column, derived (never stored) from the ticket and its current run (README §6.2). */
export const TicketStageSchema = z.enum([
  'BACKLOG',
  'READY',
  'PLANNING',
  'PLAN_REVIEW',
  'WORKING',
  'NEEDS_YOU',
  'IN_REVIEW',
  'DONE',
  'CANCELLED',
]);
export type TicketStage = z.infer<typeof TicketStageSchema>;
export const TICKET_STAGES = TicketStageSchema.options;

/** 2–6 uppercase letters, e.g. `WEB`; ticket keys are `<PROJECT_KEY>-<n>`. */
export const ProjectKeySchema = z.string().regex(/^[A-Z]{2,6}$/, '2 to 6 capital letters');
export const TicketKeySchema = z.string().regex(/^[A-Z]{2,6}-[1-9][0-9]*$/);
export const TicketLabelSchema = z.string().trim().min(1).max(30);

export const TicketSchema = z.object({
  id: z.string().min(1),
  projectId: z.string().min(1),
  key: TicketKeySchema,
  title: z.string().trim().min(1).max(200),
  /** Owner-written description; stored per ADR-0016. */
  description: z.string().max(20_000),
  type: TicketTypeSchema,
  priority: TicketPrioritySchema,
  labels: z.array(TicketLabelSchema).max(10),
  status: TicketStatusSchema,
  currentRunId: z.string().min(1).nullable(),
  createdAt: IsoTimestampSchema,
  updatedAt: IsoTimestampSchema,
});
export type Ticket = z.infer<typeof TicketSchema>;

export const TicketCommentAuthorSchema = z.enum(['owner', 'lead']);
export const TicketCommentSchema = z.object({
  id: z.string().min(1),
  ticketId: z.string().min(1),
  runId: z.string().min(1).nullable(),
  planId: z.string().min(1).nullable(),
  author: TicketCommentAuthorSchema,
  body: z.string().trim().min(1).max(8000),
  createdAt: IsoTimestampSchema,
});
export type TicketComment = z.infer<typeof TicketCommentSchema>;

export const PlanStepSchema = z.object({
  title: z.string().trim().min(1).max(120),
  /** Helper role that will do this step, e.g. "Backend"; "Lead" for steps the lead does itself. */
  role: z.string().trim().min(1).max(60),
  detail: z.string().max(2000),
});
export type PlanStep = z.infer<typeof PlanStepSchema>;

export const TicketPlanStatusSchema = z.enum([
  'proposed',
  'approved',
  'changes-requested',
  'superseded',
]);
export type TicketPlanStatus = z.infer<typeof TicketPlanStatusSchema>;

export const TicketPlanSchema = z.object({
  id: z.string().min(1),
  ticketId: z.string().min(1),
  runId: z.string().min(1),
  version: z.number().int().positive(),
  summary: z.string().trim().min(1).max(2000),
  steps: z.array(PlanStepSchema).min(1).max(12),
  /** Distinct helper roles in the steps (excluding "Lead"). */
  plannedHelpers: z.number().int().nonnegative(),
  status: TicketPlanStatusSchema,
  createdAt: IsoTimestampSchema,
  decidedAt: IsoTimestampSchema.nullable(),
});
export type TicketPlan = z.infer<typeof TicketPlanSchema>;

// ---------------------------------------------------------------- project setup

export const ProjectAllowlistSchema = z.object({
  /** Auto-approve Edit/Write/MultiEdit/NotebookEdit inside the agent's own worktree. */
  editInOwnWorktree: z.boolean(),
  /** Auto-approve a Bash call that exactly matches one of the manifest's check commands. */
  runHarnessChecks: z.boolean(),
});
export type ProjectAllowlist = z.infer<typeof ProjectAllowlistSchema>;

export const ProjectAgentSetupSchema = z.object({
  projectId: z.string().min(1),
  projectKey: ProjectKeySchema,
  /** Fixed on for now (owner decision D3). */
  planFirst: z.literal(true),
  maxConcurrentHelpers: z.number().int().min(1).max(HARD_MAX_HELPERS),
  maxDepth: z.number().int().min(1).max(HARD_MAX_DEPTH),
  defaultBudgetTokensPerAgent: z.number().int().positive(),
  model: z.string().min(1).max(100).nullable(),
  allowlist: ProjectAllowlistSchema,
  contextFiles: z.array(RepoRelativePathSchema).max(MAX_CONTEXT_FILES),
  updatedAt: IsoTimestampSchema,
});
export type ProjectAgentSetup = z.infer<typeof ProjectAgentSetupSchema>;

// ---------------------------------------------------------------- harness

/** argv[0] is a bare command name resolved through PATH; never a path, never a shell (ADR-0017). */
export const CheckArgvSchema = z
  .array(z.string().min(1).max(500))
  .min(1)
  .max(50)
  .refine((argv) => /^[a-z0-9][a-z0-9._-]*$/.test(argv[0] ?? ''), {
    message: 'the first word must be a plain command name such as pnpm, npm or make',
  });

export const HarnessCheckSchema = z.object({
  id: slug,
  name: z.string().trim().min(1).max(80),
  argv: CheckArgvSchema,
  cwd: RepoRelativePathSchema.optional(),
  timeoutSec: z.number().int().min(1).max(1800),
  required: z.boolean(),
});
export type HarnessCheck = z.infer<typeof HarnessCheckSchema>;

/** `.acp/harness.json` (version-controlled in the project; ADR-0017). */
export const HarnessManifestSchema = z
  .object({
    version: z.literal(1),
    description: z.string().max(2000).optional(),
    checks: z.array(HarnessCheckSchema).min(1).max(20),
    context: z.array(RepoRelativePathSchema).max(MAX_CONTEXT_FILES).optional(),
    notes: z.string().max(4000).optional(),
  })
  .refine((m) => new Set(m.checks.map((c) => c.id)).size === m.checks.length, {
    message: 'check ids must be unique',
  });
export type HarnessManifest = z.infer<typeof HarnessManifestSchema>;

export const HarnessStateSchema = z.enum(['none', 'invalid', 'partial', 'ready']);
export type HarnessState = z.infer<typeof HarnessStateSchema>;

export const HarnessStatusSchema = z.object({
  state: HarnessStateSchema,
  checkedAt: IsoTimestampSchema,
  /** Plain sentences, e.g. "Check 'test' needs a timeout." Empty when ready. */
  problems: z.array(z.string().min(1)),
  checks: z.array(z.object({ id: slug, name: z.string().min(1), required: z.boolean() })),
});
export type HarnessStatus = z.infer<typeof HarnessStatusSchema>;

export const CheckRunStatusSchema = z.enum(['passed', 'failed', 'timed-out', 'error', 'skipped']);
export type CheckRunStatus = z.infer<typeof CheckRunStatusSchema>;

export const CheckRunSchema = z.object({
  id: z.string().min(1),
  runId: z.string().min(1).nullable(),
  /** Null when the check ran on the project's main branch ("Run checks now"). */
  agentRunId: z.string().min(1).nullable(),
  projectId: z.string().min(1),
  checkId: slug,
  name: z.string().min(1),
  required: z.boolean(),
  status: CheckRunStatusSchema,
  exitCode: z.number().int().nullable(),
  durationMs: z.number().int().nonnegative(),
  /** Last ≤ 16 KiB of combined output, redacted (ADR-0017). */
  outputTail: z.string().max(MAX_CHECK_OUTPUT_BYTES),
  startedAt: IsoTimestampSchema,
});
export type CheckRun = z.infer<typeof CheckRunSchema>;

// ---------------------------------------------------------------- stage

export interface StageInput {
  ticket: Pick<Ticket, 'status'>;
  /** The ticket's current run, if any. */
  run: { status: RunStatus; pendingApprovals: number } | null;
}

/** Board column for a ticket (README §6.2). Pure; shared by the server and the web app. */
export function ticketStage({ ticket, run }: StageInput): TicketStage {
  if (ticket.status === 'CANCELLED') return 'CANCELLED';
  if (ticket.status === 'DONE') return 'DONE';
  if (ticket.status === 'BACKLOG' || ticket.status === 'READY') return ticket.status;
  // ACTIVE
  if (run === null) return 'READY';
  switch (run.status) {
    case 'QUEUED':
    case 'PLANNING':
      return 'PLANNING';
    case 'PLAN_REVIEW':
      return 'PLAN_REVIEW';
    case 'COMPLETED':
      return 'DONE';
    case 'FAILED':
    case 'CANCELLED':
    case 'CANCELLING':
      return 'READY';
    default:
      break;
  }
  if (run.pendingApprovals > 0) return 'NEEDS_YOU';
  if (run.status === 'REVIEW' || run.status === 'NEEDS_REVIEW') return 'IN_REVIEW';
  return 'WORKING';
}

/** Ready-written "Build the harness" ticket (README §6.4). */
export const HARNESS_TICKET_TEMPLATE = {
  title: 'Build the harness',
  type: 'harness',
  priority: 'high',
  labels: ['harness'],
  description: [
    'Give this project a harness: checks that let AI agents verify their own work.',
    '',
    '1. Look at the project and how it is built and tested today.',
    '2. Create or extend fast checks where sensible: unit tests, a lint step, a type or build step.',
    `3. Write \`${HARNESS_MANIFEST_PATH}\` (version 1) listing each check as a command array, e.g.`,
    '   `{ "id": "test", "name": "Unit tests", "argv": ["pnpm", "test"], "timeoutSec": 300, "required": true }`.',
    '   The first word must be a plain command name; no shell syntax (no pipes, &&, or redirects).',
    '4. Keep all checks together under 10 minutes. Mark the ones that must pass before merge as required.',
    '5. Optionally list files agents should read first under "context" (for example CLAUDE.md).',
    '',
    'In your plan, say which checks you will add and which will be required.',
  ].join('\n'),
} as const;
