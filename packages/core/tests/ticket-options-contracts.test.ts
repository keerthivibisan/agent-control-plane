// Contract tests for ticket-level run options (RL-H). Additive: every earlier shape still parses.
// Synthetic data only.
import { describe, expect, it } from 'vitest';
import {
  TicketRunOptionsSchema,
  TicketSchema,
  compactRunOptions,
  resolveRunOptions,
  ticketOptionsDiffer,
  type RunOptions,
} from '../src/index.js';
import {
  CreateTicketRequestSchema,
  StartTicketRequestSchema,
  TicketCardDtoSchema,
  TicketDtoSchema,
  UpdateTicketRequestSchema,
} from '../src/api/index.js';

const T = '2026-10-17T09:00:00.000Z';

const ticket = {
  id: 't1',
  projectId: 'p1',
  key: 'WEB-1',
  title: 'Dark mode',
  description: '',
  type: 'feature',
  priority: 'medium',
  labels: [],
  status: 'READY',
  currentRunId: null,
  createdAt: T,
  updatedAt: T,
} as const;

const project: RunOptions = { approvalMode: 'full-auto', reviewer: 'agent', maxReworkRounds: 2 };

describe('ticket run options (RL-H)', () => {
  it('are all optional: an empty object is "Project default" for every option', () => {
    expect(TicketRunOptionsSchema.parse({})).toEqual({});
    expect(
      TicketRunOptionsSchema.parse({
        approvalMode: 'manual',
        reviewer: 'lead',
        maxReworkRounds: 0,
      }),
    ).toEqual({ approvalMode: 'manual', reviewer: 'lead', maxReworkRounds: 0 });
  });

  it('refuse unknown modes, reviewers and rounds outside 0..5', () => {
    expect(TicketRunOptionsSchema.safeParse({ approvalMode: 'yolo' }).success).toBe(false);
    expect(TicketRunOptionsSchema.safeParse({ reviewer: 'owner' }).success).toBe(false);
    expect(TicketRunOptionsSchema.safeParse({ maxReworkRounds: 6 }).success).toBe(false);
    expect(TicketRunOptionsSchema.safeParse({ maxReworkRounds: -1 }).success).toBe(false);
    expect(TicketRunOptionsSchema.safeParse({ maxReworkRounds: 1.5 }).success).toBe(false);
    expect(TicketRunOptionsSchema.safeParse({ approvalMode: null }).success).toBe(false);
  });

  it('a ticket and its DTO from before RL-H still parse, without run options', () => {
    expect(TicketSchema.parse(ticket)).toEqual(ticket);
    expect(TicketSchema.parse(ticket).runOptions).toBeUndefined();
    expect(TicketDtoSchema.parse({ ...ticket, stage: 'READY' }).runOptions).toBeUndefined();
    const card = TicketCardDtoSchema.parse({
      ...ticket,
      stage: 'READY',
      activeHelpers: 0,
      budgetTokensUsed: null,
      needsYou: 0,
      latestEstimatedCost: null,
      lastActivityAt: null,
      lastRunOutcome: null,
    });
    expect(card.runOptions).toBeUndefined();
  });

  it('a ticket DTO carries its own options', () => {
    const dto = TicketDtoSchema.parse({
      ...ticket,
      stage: 'READY',
      runOptions: { approvalMode: 'manual' },
    });
    expect(dto.runOptions).toEqual({ approvalMode: 'manual' });
    expect(
      TicketDtoSchema.safeParse({ ...ticket, stage: 'READY', runOptions: { approvalMode: 'x' } })
        .success,
    ).toBe(false);
  });

  it('create: optional, and a request from before RL-H parses as before', () => {
    const old = CreateTicketRequestSchema.parse({ title: 'Old' });
    expect(old).toEqual({
      title: 'Old',
      description: '',
      type: 'feature',
      priority: 'medium',
      labels: [],
    });
    expect(
      CreateTicketRequestSchema.parse({ title: 'New', runOptions: { approvalMode: 'manual' } })
        .runOptions,
    ).toEqual({ approvalMode: 'manual' });
    expect(
      CreateTicketRequestSchema.safeParse({ title: 'x', runOptions: { maxReworkRounds: 9 } })
        .success,
    ).toBe(false);
  });

  it('update: a value sets an option, null puts it back to the project default', () => {
    expect(UpdateTicketRequestSchema.parse({ title: 'Renamed' })).toEqual({ title: 'Renamed' });
    expect(
      UpdateTicketRequestSchema.parse({
        runOptions: { approvalMode: null, reviewer: 'lead' },
      }).runOptions,
    ).toEqual({ approvalMode: null, reviewer: 'lead' });
    expect(UpdateTicketRequestSchema.parse({ runOptions: null }).runOptions).toBeNull();
    expect(
      UpdateTicketRequestSchema.safeParse({ runOptions: { maxReworkRounds: 6 } }).success,
    ).toBe(false);
    expect(
      UpdateTicketRequestSchema.safeParse({ runOptions: { approvalMode: 'yolo' } }).success,
    ).toBe(false);
  });

  it('the Start request is unchanged: an empty body still parses', () => {
    expect(StartTicketRequestSchema.parse({})).toEqual({});
  });
});

describe('resolveRunOptions: run override > ticket > project (RL-H)', () => {
  it('follows the project when the ticket has no options and the run no override', () => {
    expect(resolveRunOptions(project)).toEqual({
      options: project,
      source: { approvalMode: 'project', reviewer: 'project', maxReworkRounds: 'project' },
    });
    expect(resolveRunOptions(project, {}, {}).options).toEqual(project);
  });

  it("takes the ticket's option over the project's", () => {
    expect(resolveRunOptions(project, { approvalMode: 'manual', maxReworkRounds: 0 })).toEqual({
      options: { approvalMode: 'manual', reviewer: 'agent', maxReworkRounds: 0 },
      source: { approvalMode: 'ticket', reviewer: 'project', maxReworkRounds: 'ticket' },
    });
  });

  it("takes the one-run override over the ticket's option", () => {
    expect(
      resolveRunOptions(
        project,
        { approvalMode: 'manual', reviewer: 'lead' },
        { approvalMode: 'auto-edits' },
      ),
    ).toEqual({
      options: { approvalMode: 'auto-edits', reviewer: 'lead', maxReworkRounds: 2 },
      source: { approvalMode: 'run', reviewer: 'ticket', maxReworkRounds: 'project' },
    });
  });

  it('a project change reaches only the options left on the project default', () => {
    const own = { approvalMode: 'manual' } as const;
    const changed: RunOptions = { approvalMode: 'auto', reviewer: 'lead', maxReworkRounds: 4 };
    expect(resolveRunOptions(changed, own).options).toEqual({
      approvalMode: 'manual',
      reviewer: 'lead',
      maxReworkRounds: 4,
    });
  });
});

describe('ticketOptionsDiffer and compactRunOptions (RL-H)', () => {
  it('lists only the set options that differ from the project now', () => {
    expect(ticketOptionsDiffer(project, undefined)).toEqual([]);
    expect(ticketOptionsDiffer(project, {})).toEqual([]);
    expect(ticketOptionsDiffer(project, { approvalMode: 'full-auto' })).toEqual([]);
    expect(ticketOptionsDiffer(project, { approvalMode: 'manual', maxReworkRounds: 2 })).toEqual([
      'approvalMode',
    ]);
    expect(
      ticketOptionsDiffer(project, {
        approvalMode: 'manual',
        reviewer: 'lead',
        maxReworkRounds: 0,
      }),
    ).toEqual(['approvalMode', 'reviewer', 'maxReworkRounds']);
  });

  it('drops undefined fields', () => {
    expect(compactRunOptions(undefined)).toEqual({});
    expect(compactRunOptions({ approvalMode: undefined, maxReworkRounds: 0 })).toEqual({
      maxReworkRounds: 0,
    });
  });
});
