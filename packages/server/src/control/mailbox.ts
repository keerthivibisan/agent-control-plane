import { createHash } from 'node:crypto';
import type { AgentMessageKind, AgentMessageState, ManagedAgentHandle } from '@acp/core';
import { MAX_OUTBOX_ENTRIES } from '@acp/core/api';
import type { AgentMessageMetaDto } from '@acp/core/api';
import { isLiveAgentStatus } from '@acp/orchestrator';
import type { EngineAgent, RunState } from '@acp/orchestrator';
import type { Logger } from '../logger.js';

/**
 * Lead/agent message delivery (ADR-0033 §1, §2, §7). Every `send-to-agent` effect comes here. A
 * message is delivered to the agent's live process, queued while the agent starts, held in order
 * while it cannot take input (waiting for the owner, or the ended lead between follow-up turns),
 * or dropped when it never can arrive. A drop is always counted (`message-dropped`) and logged;
 * nothing is dropped silently. Lead/agent messages (those with `message` metadata) also get an
 * outbox entry: ids, states, times, the text's length and its SHA-256, never the text itself
 * (ADR-0009). Everything here is in memory with the live run; nothing survives a restart
 * (ADR-0013 §7) and nothing goes in the database.
 */

/** ADR-0033 §2: most messages held for one agent; past it the oldest is dropped and counted. */
export const MAX_HELD_MESSAGES = 50;

type OutboxEntry = AgentMessageMetaDto;

interface Pending {
  text: string;
  entry: OutboxEntry | null;
}

/** One live run's mail: the outbox and the messages waiting for their agent. */
export interface RunMail {
  /** For agents whose process is being started; sent once it runs. */
  queued: Map<string, Pending[]>;
  /** For agents that cannot take input now, oldest first (ADR-0033 §2). */
  held: Map<string, Pending[]>;
  /** The latest `MAX_OUTBOX_ENTRIES` lead/agent messages, oldest first. Metadata only. */
  outbox: OutboxEntry[];
}

export function emptyMail(): RunMail {
  return { queued: new Map(), held: new Map(), outbox: [] };
}

/** The parts of the control service's live run the mailbox uses. */
export interface MailboxLive {
  state: RunState;
  handles: Map<string, Pick<ManagedAgentHandle, 'send'>>;
  starting: Set<string>;
  mail: RunMail;
}

/** What one send came to, for the sender's tool reply. */
export interface SendResult {
  /** The state the caller is told; `held` reads as queued to an agent. */
  state: AgentMessageState;
  /** Why it was dropped (plain words); null otherwise. */
  reason: string | null;
  entry: OutboxEntry | null;
  to: string;
}

export interface MailboxDeps {
  now: () => Date;
  newId: () => string;
  logger: Logger;
  countDiagnostic: (code: string) => void;
  track: (promise: Promise<unknown>) => void;
  /** The ended lead can still get a follow-up turn (ADR-0020), so messages for it are held. */
  followUpOpen: (live: MailboxLive) => boolean;
}

const STATE_OF: Readonly<Record<Disposition['kind'], AgentMessageState>> = {
  deliver: 'delivered',
  queue: 'queued',
  hold: 'held',
  drop: 'dropped',
};

type Disposition =
  | { kind: 'deliver'; handle: Pick<ManagedAgentHandle, 'send'> }
  | { kind: 'queue' }
  | { kind: 'hold' }
  | { kind: 'drop'; reason: string };

/** SHA-256 of the text's UTF-8 bytes, lowercase hex. */
export function textHash(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

/** Statuses in which an agent cannot take a message now but will later (ADR-0033 §2). */
function waitsForInput(agent: EngineAgent): boolean {
  return (
    agent.status === 'BLOCKED' || agent.status === 'WAITING_APPROVAL' || agent.status === 'QUEUED'
  );
}

export function createMailbox(deps: MailboxDeps) {
  const { logger } = deps;
  let capture: SendResult[] | null = null;

  /**
   * Where a message for `agentRunId` goes now. Lead/agent messages (`holds`) wait for an agent
   * that will take input later; plain input (owner chat, the resume after a raise) is sent or
   * queued as before, never held.
   */
  function dispositionOf(live: MailboxLive, agentRunId: string, holds: boolean): Disposition {
    const agent = live.state.agents.find((a) => a.id === agentRunId);
    if (agent === undefined) return { kind: 'drop', reason: 'that agent is not in this run' };
    if (live.starting.has(agentRunId)) return { kind: 'queue' };
    if (holds && waitsForInput(agent)) return { kind: 'hold' };
    if (agent.status === 'AWAITING_REVIEW') {
      return { kind: 'drop', reason: 'its turn ended and its change is under review' };
    }
    if (agent.awaitingHelpers === true) {
      return { kind: 'drop', reason: 'it finished its own work and only waits for its helpers' };
    }
    if (!isLiveAgentStatus(agent.status)) {
      if (holds && agent.kind === 'lead' && deps.followUpOpen(live)) return { kind: 'hold' };
      return { kind: 'drop', reason: 'it has ended' };
    }
    const handle = live.handles.get(agentRunId);
    if (handle !== undefined) return { kind: 'deliver', handle };
    if (agent.status === 'STARTING') return { kind: 'queue' };
    return { kind: 'drop', reason: 'it has no running process' };
  }

  function record(live: MailboxLive, entry: OutboxEntry): void {
    const outbox = live.mail.outbox;
    outbox.push(entry);
    if (outbox.length > MAX_OUTBOX_ENTRIES) outbox.splice(0, outbox.length - MAX_OUTBOX_ENTRIES);
  }

  function dropped(live: MailboxLive, agentRunId: string, item: Pending): void {
    if (item.entry !== null) {
      item.entry.state = 'dropped';
      item.entry.deliveredAt = null;
    }
    deps.countDiagnostic('message-dropped');
    logger.log('warn', 'agent message not delivered', {
      runId: live.state.run.id,
      agentRunId,
      code: item.entry?.kind ?? 'input',
    });
  }

  function deliver(
    live: MailboxLive,
    agentRunId: string,
    handle: Pick<ManagedAgentHandle, 'send'>,
    item: Pending,
  ): void {
    if (item.entry !== null) {
      item.entry.state = 'delivered';
      item.entry.deliveredAt = deps.now().toISOString();
    }
    deps.track(
      handle.send(item.text).catch(() => {
        // The process ended while the message was on its way: it never arrived.
        deps.countDiagnostic('message-send-failed');
        dropped(live, agentRunId, item);
      }),
    );
  }

  function hold(live: MailboxLive, agentRunId: string, item: Pending): void {
    const list = live.mail.held.get(agentRunId) ?? [];
    list.push(item);
    while (list.length > MAX_HELD_MESSAGES) {
      const oldest = list.shift();
      deps.countDiagnostic('held-message-dropped');
      if (oldest !== undefined) dropped(live, agentRunId, oldest);
    }
    live.mail.held.set(agentRunId, list);
    if (item.entry !== null) item.entry.state = 'held';
  }

  function queue(live: MailboxLive, agentRunId: string, item: Pending): void {
    const list = live.mail.queued.get(agentRunId) ?? [];
    list.push(item);
    live.mail.queued.set(agentRunId, list);
    if (item.entry !== null) item.entry.state = 'queued';
  }

  function route(live: MailboxLive, agentRunId: string, item: Pending, d: Disposition): void {
    switch (d.kind) {
      case 'deliver':
        deliver(live, agentRunId, d.handle, item);
        return;
      case 'queue':
        queue(live, agentRunId, item);
        return;
      case 'hold':
        hold(live, agentRunId, item);
        return;
      case 'drop':
        dropped(live, agentRunId, item);
        return;
    }
  }

  /** Sends the agent's held messages, in order, once it can take input (or drops them for good). */
  function flushAgent(live: MailboxLive, agentRunId: string): void {
    const list = live.mail.held.get(agentRunId);
    if (list === undefined || list.length === 0) return;
    const d = dispositionOf(live, agentRunId, true);
    if (d.kind === 'hold') return;
    live.mail.held.delete(agentRunId);
    for (const item of list) route(live, agentRunId, item, d);
  }

  return {
    /** One `send-to-agent`: delivered, queued, held or dropped (counted); never silently lost. */
    send(
      live: MailboxLive,
      agentRunId: string,
      text: string,
      message?: { from: string; kind: AgentMessageKind },
    ): SendResult {
      const entry: OutboxEntry | null =
        message === undefined
          ? null
          : {
              id: deps.newId(),
              from: message.from,
              to: agentRunId,
              kind: message.kind,
              state: 'queued',
              createdAt: deps.now().toISOString(),
              deliveredAt: null,
              length: text.length,
              sha256: textHash(text),
            };
      if (entry !== null) record(live, entry);
      // Older held messages go first, so the agent reads every message in order. Plain input (the
      // resume after a raise) comes before them: it says why the agent can read again.
      if (message !== undefined) flushAgent(live, agentRunId);
      const d = dispositionOf(live, agentRunId, message !== undefined);
      route(live, agentRunId, { text, entry }, d);
      const result: SendResult = {
        state: entry?.state ?? STATE_OF[d.kind],
        reason: d.kind === 'drop' ? d.reason : null,
        entry,
        to: agentRunId,
      };
      capture?.push(result);
      return result;
    },

    /** The agent's process runs: what was queued for it is sent now, in order. */
    started(live: MailboxLive, agentRunId: string): void {
      const list = live.mail.queued.get(agentRunId);
      live.mail.queued.delete(agentRunId);
      const handle = live.handles.get(agentRunId);
      for (const item of list ?? []) {
        if (handle === undefined) dropped(live, agentRunId, item);
        else deliver(live, agentRunId, handle, item);
      }
    },

    /** The agent's start failed, or it was stopped while starting: its queue never arrives. */
    discardQueued(live: MailboxLive, agentRunId: string): void {
      const list = live.mail.queued.get(agentRunId);
      live.mail.queued.delete(agentRunId);
      for (const item of list ?? []) dropped(live, agentRunId, item);
    },

    /** After every transition: held messages go to agents that can take input again. */
    flush(live: MailboxLive): void {
      for (const agentRunId of [...live.mail.held.keys()]) flushAgent(live, agentRunId);
    },

    /**
     * ADR-0033 §2: the ended lead's follow-up turn starts; what was held for it goes into that
     * turn's prompt. Returns the texts, oldest first, and marks them delivered.
     */
    takeHeld(live: MailboxLive, agentRunId: string): string[] {
      const list = live.mail.held.get(agentRunId) ?? [];
      live.mail.held.delete(agentRunId);
      const at = deps.now().toISOString();
      for (const item of list) {
        if (item.entry === null) continue;
        item.entry.state = 'delivered';
        item.entry.deliveredAt = at;
      }
      return list.map((i) => i.text);
    },

    /** Runs `fn` and returns the sends it made (the lead tool's own message, for its reply). */
    capture<T>(fn: () => T): [T, SendResult[]] {
      const outer = capture;
      const mine: SendResult[] = [];
      capture = mine;
      try {
        return [fn(), mine];
      } finally {
        capture = outer;
      }
    },

    /** The run's outbox for the run detail: copies, oldest first, metadata only. */
    outbox(live: MailboxLive): AgentMessageMetaDto[] {
      return live.mail.outbox.map((e) => ({ ...e }));
    },
  };
}

export type Mailbox = ReturnType<typeof createMailbox>;

/**
 * The sender's view of a send (ADR-0033 §1): delivered, queued or dropped, with why. A held
 * message reads as queued: it arrives when the recipient can take input.
 */
export function deliveryLine(result: SendResult): string {
  switch (result.state) {
    case 'delivered':
      return 'delivered (handed to its process now).';
    case 'queued':
      return 'queued (it is starting and gets it as soon as it runs).';
    case 'held':
      return 'queued (it cannot take input now: it waits for the owner or is between turns; it gets it in order when it can).';
    case 'dropped':
      return `dropped: ${result.reason ?? 'it cannot receive messages'}. It will never arrive.`;
  }
}
