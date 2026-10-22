import { z } from 'zod';
import { IsoTimestampSchema } from '../domain/time.js';
import { WorkflowNodeIdSchema } from './node-id.js';
import { BranchStrategySchema, TicketBranchPrefsSchema } from './branching.js';
import { GitCommitSchema } from '../orchestration/orchestration.js';
import type { RunStatus } from '../orchestration/orchestration.js';
import {
  ChangeReviewerModeSchema,
  ReworkRoundsSchema,
  type ChangeReviewerMode,
} from './workflow.js';

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
  /**
   * The ticket's own run options (RL-H). Absent (or empty) means every option follows the
   * project. A getter because `TicketRunOptionsSchema` is declared with the approval modes below.
   */
  get runOptions() {
    return TicketRunOptionsSchema.optional();
  },
  /**
   * ADR-0025: the ticket's own branch name and target branch. Absent (or an absent field) follows
   * the project's branching strategy.
   */
  branch: TicketBranchPrefsSchema.optional(),
});
export type Ticket = z.infer<typeof TicketSchema>;

/**
 * Who wrote a ticket comment. `app` (ADR-0024): Agent Control Plane itself, for the run summary it
 * composes from data it already records (the plan, each change, checks, the ticket branch, tokens)
 * and for the line it adds after the owner's merge. Never conversation content.
 */
export const TicketCommentAuthorSchema = z.enum(['owner', 'lead', 'reviewer', 'app']);
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
  /**
   * The helper role that does this step, e.g. "Backend". Every step goes to a helper: the lead is
   * read-only and never does a step itself (ADR-0021; the engine refuses lead, planner and
   * orchestrator as roles).
   */
  role: z.string().trim().min(1).max(60),
  detail: z.string().max(2000),
  /**
   * ADR-0023 §7: the helper node the engine resolved for this step when the plan was submitted,
   * stored so the step keeps its node across a restart. Absent for plans before ADR-0023 and for
   * version 1 runs, where every step goes to the helper pool.
   */
  helper: WorkflowNodeIdSchema.optional(),
});
export type PlanStep = z.infer<typeof PlanStepSchema>;

export const TicketPlanStatusSchema = z.enum([
  'proposed',
  'approved',
  'changes-requested',
  'superseded',
]);
export type TicketPlanStatus = z.infer<typeof TicketPlanStatusSchema>;

/** Who decided a plan: the owner, or Full auto's automatic approval (ADR-0022). */
export const TicketPlanDeciderSchema = z.enum(['owner', 'auto']);
export type TicketPlanDecider = z.infer<typeof TicketPlanDeciderSchema>;

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
  /**
   * Who decided the plan (ADR-0022): `auto` when a Full auto run approved it automatically. Absent
   * means the owner decided it (or it is not decided yet), as for every plan before Full auto.
   */
  decidedBy: TicketPlanDeciderSchema.optional(),
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

// ---------------------------------------------------------------- approval modes (ADR-0021)

/**
 * How much a ticket run's helpers and tester may do without asking (ADR-0021 §1). The project
 * holds the default; a run snapshots it at start and may override it. The lead, planner and
 * reviewers are never covered: they always ask, and the lead never approves anything itself.
 * - `manual`: every edit, write and command asks, harness checks included;
 * - `auto-edits`: edits inside the agent's own worktree (never under `.git` or `.claude`) and
 *   commands that exactly match a harness check run without asking;
 * - `auto`: `auto-edits` plus the project's command allowlist (`ProjectApprovals.commands`);
 * - `full-auto` (ADR-0022): helpers and the tester run in Claude Code's own auto mode (a classifier
 *   model reviews risky actions) inside the operating-system sandbox, the plan is approved
 *   automatically, and nothing asks the owner during the run: an action that still reaches the
 *   gate is allowed only by the `auto-edits` rules and otherwise denied. The owner sees only the final
 *   ticket-branch merge. The lead, planner and reviewers are unchanged (read-only, never covered).
 */
export const ApprovalModeSchema = z.enum(['manual', 'auto-edits', 'auto', 'full-auto']);
export type ApprovalMode = z.infer<typeof ApprovalModeSchema>;
export const APPROVAL_MODES = ApprovalModeSchema.options;
/** The mode a newly created project starts with. Existing projects keep their mapped setting. */
export const DEFAULT_APPROVAL_MODE: ApprovalMode = 'auto-edits';

/** Why an action ran without asking (`ApprovalDto.allowRule`, `approvals.allow_rule`). */
export const AllowRuleSchema = z.enum([
  'edit-in-own-worktree',
  'run-harness-check',
  'command-allowlist',
]);
export type AllowRule = z.infer<typeof AllowRuleSchema>;

/** Most patterns one project's command allowlist holds. */
export const MAX_COMMAND_PATTERNS = 30;
/** Most tokens one command pattern holds. */
export const MAX_COMMAND_PATTERN_TOKENS = 8;

/**
 * Characters a command token may hold. Joining such tokens with single spaces gives a command line
 * that is exact and shell-inert (the same set the harness-check rule uses, ADR-0013 amendment):
 * no quotes, spaces, `$`, `;`, `|`, `&`, `<`, `>`, `*`, `?`, `~`, backslashes or brackets.
 */
export const COMMAND_TOKEN_PATTERN = /^[A-Za-z0-9._/:=@+%,-]{1,200}$/;
/** A bare command name resolved through PATH, as for harness checks (ADR-0017). */
export const BARE_COMMAND_PATTERN = /^[a-z0-9][a-z0-9._-]*$/;

/**
 * True when `token` may appear in an allowlisted command: only `COMMAND_TOKEN_PATTERN`
 * characters, not an absolute path (also not after `=`, `:`, `,` or `@`, as in `--out=/etc`), and
 * no `..` anywhere. The gate applies the same rule to the command an agent actually runs.
 */
export function isSafeCommandToken(token: string): boolean {
  if (!COMMAND_TOKEN_PATTERN.test(token) || token.includes('..')) return false;
  return token.split(/[=:,@]/).every((part) => !part.startsWith('/'));
}

/**
 * Commands that can never be allowlisted: they run other commands, change the shell, raise
 * privileges or reach the network (ADR-0021 §2). Compared with argv[0] exactly.
 */
export const FORBIDDEN_ALLOWLIST_COMMANDS: readonly string[] = Object.freeze([
  // shells
  'sh',
  'bash',
  'zsh',
  'dash',
  'ksh',
  'mksh',
  'fish',
  'csh',
  'tcsh',
  'ash',
  'busybox',
  'pwsh',
  // command runners and wrappers
  'env',
  'sudo',
  'su',
  'doas',
  'xargs',
  'eval',
  'exec',
  'command',
  'builtin',
  'nohup',
  'timeout',
  'nice',
  'time',
  'watch',
  'setsid',
  'stdbuf',
  'chroot',
  // shell state
  'cd',
  'export',
  'alias',
  'source',
  'set',
  'unset',
  // remote access and network
  'ssh',
  'scp',
  'sftp',
  'rsync',
  'curl',
  'wget',
  'nc',
  'ncat',
  'netcat',
  'socat',
  'telnet',
]);

/** The only `git` subcommands an allowlist pattern may name (owner default, ADR-0021 §2). */
export const GIT_READ_ONLY_SUBCOMMANDS: readonly string[] = Object.freeze([
  'status',
  'diff',
  'log',
  'show',
  'rev-parse',
  'ls-files',
  'blame',
  'grep',
]);

/**
 * `git` options that are never allowlisted, anywhere in the command: they change the repository,
 * config or working directory git acts on (`-c`, `-C`, `--git-dir`, `--work-tree`, `--exec-path`,
 * `--config-env`), run another program (`-O`/`--open-files-in-pager` of `git grep`,
 * `--ext-diff`), or write a file (`--output`).
 */
export function isForbiddenGitOption(token: string): boolean {
  if (token === '-c' || token === '-C' || token.startsWith('-O')) return true;
  return [
    '--git-dir',
    '--work-tree',
    '--exec-path',
    '--config-env',
    '--open-files-in-pager',
    '--ext-diff',
    '--output',
  ].some((option) => token === option || token.startsWith(`${option}=`));
}

export const CommandTokenSchema = z
  .string()
  .regex(COMMAND_TOKEN_PATTERN, 'letters, digits and . _ / : = @ + % , - only (up to 200)')
  .refine(isSafeCommandToken, 'must not be an absolute path or contain ..');

/**
 * One command allowlist entry (ADR-0021 §2): `exact` allows exactly these words; `prefix` allows
 * these words followed by any further safe tokens (for example `npm` or `mvn` with any arguments).
 */
export const CommandPatternSchema = z
  .object({
    argv: z.array(CommandTokenSchema).min(1).max(MAX_COMMAND_PATTERN_TOKENS),
    match: z.enum(['exact', 'prefix']),
  })
  .superRefine((pattern, ctx) => {
    const [command, sub] = pattern.argv;
    if (command === undefined) return;
    if (!BARE_COMMAND_PATTERN.test(command)) {
      ctx.addIssue({
        code: 'custom',
        path: ['argv', 0],
        message: 'the first word must be a plain command name such as npm, mvn or make',
      });
    } else if (FORBIDDEN_ALLOWLIST_COMMANDS.includes(command)) {
      ctx.addIssue({
        code: 'custom',
        path: ['argv', 0],
        message: `"${command}" runs other commands or reaches the network, so it cannot be allowed`,
      });
    }
    if (command !== 'git') return;
    if (sub === undefined || !GIT_READ_ONLY_SUBCOMMANDS.includes(sub)) {
      ctx.addIssue({
        code: 'custom',
        path: ['argv', 1],
        message: `git needs a read-only subcommand: ${GIT_READ_ONLY_SUBCOMMANDS.join(', ')}`,
      });
    }
    pattern.argv.forEach((token, i) => {
      if (isForbiddenGitOption(token)) {
        ctx.addIssue({
          code: 'custom',
          path: ['argv', i],
          message: `the git option ${token} cannot be allowed`,
        });
      }
    });
  });
export type CommandPattern = z.infer<typeof CommandPatternSchema>;

/** A project's approval settings (ADR-0021 §1–2), stored in `project_setup.setup`. */
export const ProjectApprovalsSchema = z.object({
  mode: ApprovalModeSchema,
  /** Used only in `auto` mode, but kept when the owner switches modes. */
  commands: z
    .array(CommandPatternSchema)
    .max(MAX_COMMAND_PATTERNS)
    .refine(
      (list) => new Set(list.map((p) => `${p.match} ${p.argv.join(' ')}`)).size === list.length,
      { message: 'each command is listed once' },
    ),
});
export type ProjectApprovals = z.infer<typeof ProjectApprovalsSchema>;

/**
 * The mode a project set up before ADR-0021 behaves as. A legacy setup is never widened: only a
 * project that already pre-approved both edits and harness checks is `auto-edits`; any other mix is
 * `manual`, which can only ask more often (coordinator decision 2026-10-17, ADR-0021 §1). No command
 * allowlist existed, so `commands` is empty.
 */
export function approvalsFromLegacy(allowlist: ProjectAllowlist): ProjectApprovals {
  const both = allowlist.editInOwnWorktree && allowlist.runHarnessChecks;
  return { mode: both ? 'auto-edits' : 'manual', commands: [] };
}

/** A project's effective approvals: its own, or the legacy allowlist's mapping when it has none. */
export function approvalsOf(
  setup: Pick<ProjectAgentSetup, 'allowlist' | 'approvals'>,
): ProjectApprovals {
  return setup.approvals ?? approvalsFromLegacy(setup.allowlist);
}

// ---------------------------------------------------------------- ticket run options (RL-H)

/**
 * A ticket's own run options (RL-H, owner decision 2026-10-17): the approval mode, who reviews
 * each change and the rework rounds. An absent field is "Project default": it follows the project,
 * so a later project change reaches it. Precedence when a run starts: the one-run override
 * (`StartTicketRequest`) > the ticket's options > the project's settings; the run snapshots the
 * result (`resolveRunOptions`), so nothing changes a run once it started. Stored as JSON in
 * `tickets.run_options` (migration 0007); the project's command allowlist is never per ticket.
 */
export const TicketRunOptionsSchema = z.object({
  approvalMode: ApprovalModeSchema.optional(),
  reviewer: ChangeReviewerModeSchema.optional(),
  maxReworkRounds: ReworkRoundsSchema.optional(),
});
export type TicketRunOptions = z.infer<typeof TicketRunOptionsSchema>;
export const RUN_OPTION_KEYS = ['approvalMode', 'reviewer', 'maxReworkRounds'] as const;
export type RunOptionKey = (typeof RUN_OPTION_KEYS)[number];

/** The options a run starts with, every one decided. */
export interface RunOptions {
  approvalMode: ApprovalMode;
  reviewer: ChangeReviewerMode;
  maxReworkRounds: number;
}

/** Where a run's option came from: the one-run override, the ticket, or the project. */
export type RunOptionSource = 'run' | 'ticket' | 'project';

/** Only the fields that are set (no `undefined` keys): `{}` means "all project default". */
export function compactRunOptions(options: TicketRunOptions | undefined): TicketRunOptions {
  return {
    ...(options?.approvalMode !== undefined && { approvalMode: options.approvalMode }),
    ...(options?.reviewer !== undefined && { reviewer: options.reviewer }),
    ...(options?.maxReworkRounds !== undefined && { maxReworkRounds: options.maxReworkRounds }),
  };
}

/**
 * The options a run of the ticket starts with, and where each came from: the one-run override,
 * else the ticket's own option, else the project's setting.
 */
export function resolveRunOptions(
  project: RunOptions,
  ticket?: TicketRunOptions,
  run?: TicketRunOptions,
): { options: RunOptions; source: Record<RunOptionKey, RunOptionSource> } {
  const pick = <K extends RunOptionKey>(key: K): [RunOptions[K], RunOptionSource] => {
    const fromRun = run?.[key];
    if (fromRun !== undefined) return [fromRun as RunOptions[K], 'run'];
    const fromTicket = ticket?.[key];
    if (fromTicket !== undefined) return [fromTicket as RunOptions[K], 'ticket'];
    return [project[key], 'project'];
  };
  const [approvalMode, modeFrom] = pick('approvalMode');
  const [reviewer, reviewerFrom] = pick('reviewer');
  const [maxReworkRounds, roundsFrom] = pick('maxReworkRounds');
  return {
    options: { approvalMode, reviewer, maxReworkRounds },
    source: { approvalMode: modeFrom, reviewer: reviewerFrom, maxReworkRounds: roundsFrom },
  };
}

/**
 * The ticket's options that differ from the project's settings now (the board's badge). An option
 * set to the project's current value does not count, but it still holds if the project changes.
 */
export function ticketOptionsDiffer(
  project: RunOptions,
  ticket: TicketRunOptions | undefined,
): RunOptionKey[] {
  return RUN_OPTION_KEYS.filter((k) => ticket?.[k] !== undefined && ticket[k] !== project[k]);
}

export const ProjectAgentSetupSchema = z.object({
  projectId: z.string().min(1),
  projectKey: ProjectKeySchema,
  /** Fixed on for now (owner decision D3). */
  planFirst: z.literal(true),
  maxConcurrentHelpers: z.number().int().min(1).max(HARD_MAX_HELPERS),
  maxDepth: z.number().int().min(1).max(HARD_MAX_DEPTH),
  defaultBudgetTokensPerAgent: z.number().int().positive(),
  model: z.string().min(1).max(100).nullable(),
  /**
   * The pre-ADR-0021 allowlist. Kept until RL-B and RL-D read and write `approvals` instead; read
   * a project's effective settings with `approvalsOf(setup)`.
   */
  allowlist: ProjectAllowlistSchema,
  /** Approval mode and command allowlist (ADR-0021). Absent on setups saved before it. */
  approvals: ProjectApprovalsSchema.optional(),
  contextFiles: z.array(RepoRelativePathSchema).max(MAX_CONTEXT_FILES),
  /**
   * ADR-0025: how tickets name, start and finish their branches. Absent: the behaviour before it
   * (`acp/<KEY>` from the project's current branch).
   */
  branching: BranchStrategySchema.optional(),
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
  /** The manifest's checks as declared, so the settings card can show each command and time limit. */
  checks: z.array(HarnessCheckSchema),
});
export type HarnessStatus = z.infer<typeof HarnessStatusSchema>;

/**
 * `interrupted` (WG-F3): the app stopped (shut down, for example to upgrade) while the check ran,
 * or before it started. It is not a result: a merge gate counts it as never run and starts the
 * checks again. `skipped` and `error` stay results that block, as before.
 */
export const CheckRunStatusSchema = z.enum([
  'passed',
  'failed',
  'timed-out',
  'error',
  'skipped',
  'interrupted',
]);
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
  /**
   * The commit the check ran on (ADR-0021: checks gate a merge only for the commit they ran on;
   * `check_runs.commit_sha`). Null or absent for check runs recorded before it.
   */
  commit: GitCommitSchema.nullable().optional(),
});
export type CheckRun = z.infer<typeof CheckRunSchema>;

/**
 * The notes v0.1.0 (and 0.2.0 before WG-F3) stored for a check the app's shutdown stopped, as
 * status `error` (the running check) or `skipped` (the ones after it). A stopped run's checks got
 * the same notes then; they now get their own ("the run was stopped"), so only rows from before
 * WG-F3 carry these. The runner appends a note to the output as a last line `[note]`.
 */
export const LEGACY_STOPPED_CHECK_NOTES = {
  error: 'Stopped before it finished: the checks were stopped.',
  skipped: 'Not run: the checks were stopped.',
} as const;

/**
 * Whether a stored check run has no result because the app stopped (WG-F3): status `interrupted`,
 * or a row from before it with the legacy shutdown note (`LEGACY_STOPPED_CHECK_NOTES`). The merge
 * gates treat such a check as not run on its commit, so the checks run again; a real failure,
 * error, time-out or skip still blocks.
 */
export function checkRunWasInterrupted(run: Pick<CheckRun, 'status' | 'outputTail'>): boolean {
  if (run.status === 'interrupted') return true;
  if (run.status !== 'error' && run.status !== 'skipped') return false;
  return run.outputTail.endsWith(`\n[${LEGACY_STOPPED_CHECK_NOTES[run.status]}]`);
}

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
