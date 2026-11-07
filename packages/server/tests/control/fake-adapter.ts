import type {
  LeadToolName,
  ManagedAgentEvent,
  ManagedAgentHandle,
  ManagedAgentSpec,
  ManagedCallbacks,
  ManagedCapabilities,
  ManagedExecutionAdapter,
  ManagedProviderId,
  PermissionDecision,
  TokenCounts,
} from '@acp/core';

/**
 * A scripted `ManagedExecutionAdapter` for tests (and for the P3-F e2e server): nothing is
 * spawned, no SDK is loaded. Each `start` creates a `FakeAgent` the test drives by hand: emit
 * events, ask for permission, call lead tools, finish. It behaves like the real adapter where the
 * server depends on it: `start` returns at once, events are buffered for one reader and end with
 * exactly one `finished`, `send` after the end rejects, `abort` ends the stream as `cancelled`.
 */

class EventQueue implements AsyncIterable<ManagedAgentEvent> {
  private readonly items: ManagedAgentEvent[] = [];
  private waiting: ((r: IteratorResult<ManagedAgentEvent>) => void) | null = null;
  closed = false;

  push(event: ManagedAgentEvent): void {
    if (this.closed) return;
    if (this.waiting !== null) {
      const resolve = this.waiting;
      this.waiting = null;
      resolve({ value: event, done: false });
    } else this.items.push(event);
  }

  close(): void {
    this.closed = true;
    if (this.waiting !== null) {
      const resolve = this.waiting;
      this.waiting = null;
      resolve({ value: undefined, done: true });
    }
  }

  [Symbol.asyncIterator](): AsyncIterator<ManagedAgentEvent> {
    return {
      next: () => {
        const item = this.items.shift();
        if (item !== undefined) return Promise.resolve({ value: item, done: false });
        if (this.closed) return Promise.resolve({ value: undefined, done: true });
        return new Promise((resolve) => (this.waiting = resolve));
      },
    };
  }
}

export class FakeAgentEndedError extends Error {
  override readonly name = 'ManagedAgentEndedError';
}

export class FakeAgent {
  readonly sent: string[] = [];
  interrupts = 0;
  aborted = false;
  private readonly queue = new EventQueue();
  readonly handle: ManagedAgentHandle;

  constructor(
    readonly spec: ManagedAgentSpec,
    readonly callbacks: ManagedCallbacks,
  ) {
    this.handle = {
      events: this.queue,
      send: (text) => {
        if (this.queue.closed) return Promise.reject(new FakeAgentEndedError('ended'));
        this.sent.push(text);
        return Promise.resolve();
      },
      interrupt: () => {
        this.interrupts++;
        return Promise.resolve();
      },
      abort: () => {
        if (this.queue.closed) return;
        this.aborted = true;
        this.finish('cancelled');
      },
    };
  }

  get id(): string {
    return this.spec.agentRunId;
  }

  get ended(): boolean {
    return this.queue.closed;
  }

  emit(...events: ManagedAgentEvent[]): this {
    for (const e of events) this.queue.push(e);
    return this;
  }

  started(providerSessionId = `sess-${this.id}`, model: string | null = 'claude-test'): this {
    return this.emit({ type: 'started', providerSessionId, model });
  }

  usage(messageId: string, tokens: TokenCounts): this {
    return this.emit({ type: 'usage', messageId, tokens });
  }

  finish(outcome: 'success' | 'error' | 'cancelled' = 'success', cost: number | null = null): void {
    this.queue.push({ type: 'finished', outcome, reportedCostUsd: cost });
    this.queue.close();
  }

  /** What the SDK's `canUseTool` does for a non-read-only tool. */
  ask(toolName: string, summary: string, input?: unknown): Promise<PermissionDecision> {
    return this.callbacks.requestPermission({
      agentRunId: this.id,
      toolName,
      toolUseId: `tu-${toolName}`,
      summary,
      ...(input === undefined ? {} : { input }),
    });
  }

  /** What the lead's MCP server does for a tool call. */
  callLead(name: LeadToolName, input: unknown): Promise<string> {
    const tools = this.spec.leadTools;
    if (tools === undefined) return Promise.reject(new Error('no lead tools'));
    return tools(name, input);
  }
}

export interface FakeManagedAdapter {
  adapter: ManagedExecutionAdapter;
  agents: FakeAgent[];
  /**
   * The latest start of this agent run. A follow-up turn of an ended lead (ADR-0020) starts again
   * under the lead's own id, so the first match would be the ended agent, whose `send` rejects.
   */
  byId(id: string): FakeAgent;
  /** The first lead start (the run's own lead, not a later follow-up turn). */
  lead(): FakeAgent;
  workers(): FakeAgent[];
}

/** What Codex's adapter honours (`CODEX_CAPABILITIES` of `@acp/adapter-codex`, CX-3). */
export const FAKE_CODEX_CAPABILITIES: ManagedCapabilities = Object.freeze({
  skills: false,
  profileTools: false,
  fullAuto: true,
  leadTools: true,
  followUp: true,
});

export interface FakeAdapterOptions {
  /** Default `claude-code`; `codex` also defaults the capabilities to Codex's. */
  provider?: ManagedProviderId;
  capabilities?: ManagedCapabilities;
  /** Gives the adapter a `checkAvailable` (CX-4); absent, it has none (always available). */
  checkAvailable?: () => Promise<{ ok: true } | { ok: false; reason: string }>;
}

export function createFakeManagedAdapter(options: FakeAdapterOptions = {}): FakeManagedAdapter {
  const provider = options.provider ?? 'claude-code';
  const agents: FakeAgent[] = [];
  const byId = (id: string): FakeAgent => {
    const agent = agents.findLast((a) => a.id === id);
    if (agent === undefined) throw new Error(`no fake agent ${id}`);
    return agent;
  };
  return {
    agents,
    byId,
    lead: () => {
      const lead = agents.find((a) => a.spec.kind === 'lead');
      if (lead === undefined) throw new Error('the lead has not started');
      return lead;
    },
    workers: () => agents.filter((a) => a.spec.kind === 'worker'),
    adapter: {
      provider,
      capabilities:
        options.capabilities ??
        (provider === 'codex'
          ? FAKE_CODEX_CAPABILITIES
          : {
              skills: true,
              profileTools: true,
              fullAuto: true,
              leadTools: true,
              followUp: true,
            }),
      start(spec, callbacks) {
        const agent = new FakeAgent(spec, callbacks);
        agents.push(agent);
        return agent.handle;
      },
      ...(options.checkAvailable !== undefined && { checkAvailable: options.checkAvailable }),
    },
  };
}
