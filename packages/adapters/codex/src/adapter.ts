import os from 'node:os';
import { specKeepsInputOpen } from '@acp/core';
import type {
  ManagedAgentEvent,
  ManagedAgentHandle,
  ManagedAgentSpec,
  ManagedCallbacks,
  ManagedCapabilities,
  ManagedExecutionAdapter,
  ManagedFailureCode,
} from '@acp/core';
import { z } from 'zod';
import { answerServerRequest } from './approvals.js';
import type { ApprovalContext } from './approvals.js';
import { codexArgs, codexEnv } from './config.js';
import { mapNotification } from './events.js';
import type { Lifecycle } from './events.js';
import { checkGitLocation, defaultTmpRoots } from './git-location.js';
import { developerInstructionsFor } from './instructions.js';
import { dynamicToolsFor } from './lead-tools.js';
import { codexModes, tempDirOf } from './modes.js';
import { AsyncQueue } from './queue.js';
import { JsonRpcClient, spawnCodexAppServer } from './transport.js';
import type { CodexExit, CodexTransport, SpawnCodex } from './transport.js';

export interface ManagedCodexOptions {
  /** The Codex program; default `codex` on PATH. */
  bin?: string;
  /** Defaults to spawning the real app-server. Tests always inject a fake (ADR-0031 §3). */
  spawn?: SpawnCodex;
  /**
   * The source environment, filtered by `codexEnv` (no `ACP_*`, no `GIT_*`) before it reaches the
   * process. Default: `process.env`.
   */
  env?: Readonly<Record<string, string | undefined>>;
  /** The temp folders `checkGitLocation` counts as writable. Default: `defaultTmpRoots(env)`. */
  tmpRoots?: readonly string[];
  /** How long `checkAvailable` waits for the app-server. Default 20 s. */
  availabilityTimeoutMs?: number;
}

/**
 * What the Codex adapter honours (ADR-0031 owner decision 3). Skills and an agent file's `tools`
 * have no Codex mapping yet, so the server refuses or strips them (CX-4); everything else is
 * supported.
 */
export const CODEX_CAPABILITIES: ManagedCapabilities = Object.freeze({
  skills: false,
  profileTools: false,
  fullAuto: true,
  denyRead: true,
  leadTools: true,
  followUp: true,
});

export const NOT_INSTALLED = 'Codex is not installed: the codex program was not found.';
export const NOT_SIGNED_IN = 'Codex is not signed in; run codex login.';
export const NOT_ANSWERING = 'Codex could not start: its app-server did not answer.';

/**
 * P-D: the first words of a rework turn that could not resume the helper's saved thread and
 * started a new one in the same worktree (the Claude adapter's wording).
 */
export const REWORK_NEW_SESSION_NOTE =
  'Your earlier conversation for this task could not be continued, so this is a new session. ' +
  'Your earlier work is in this folder, saved on its branch: read the files you changed before ' +
  'you change anything.';

/** Thrown by `send` on a follow-up turn, which takes exactly one message (ADR-0020). */
export class ManagedFollowUpSendError extends Error {
  readonly code = 'managed_follow_up_one_message';
  constructor(agentRunId: string) {
    super(`Follow-up turn of ${agentRunId} takes one message`);
    this.name = 'ManagedFollowUpSendError';
  }
}

/** Thrown by `send` once the agent has finished or been aborted. */
export class ManagedAgentEndedError extends Error {
  readonly code = 'managed_agent_ended';
  constructor(agentRunId: string) {
    super(`Managed agent ${agentRunId} has ended`);
    this.name = 'ManagedAgentEndedError';
  }
}

const CLIENT_INFO = { name: 'agent-control-plane', title: 'Agent Control Plane', version: '0.4.0' };

/** The handshake: `initialize` (dynamic tools need `experimentalApi`), then `initialized`. */
async function initialize(client: JsonRpcClient): Promise<void> {
  await client.request('initialize', {
    clientInfo: CLIENT_INFO,
    capabilities: { experimentalApi: true, requestAttestation: false },
  });
  client.notify('initialized');
}

const ThreadResponseSchema = z.looseObject({
  thread: z.looseObject({ id: z.string().min(1) }),
  model: z.string().min(1).nullable().catch(null),
  /** The profile the thread runs under (CX-1b); checked against the one ACP selected. */
  activePermissionProfile: z.looseObject({ id: z.string() }).nullable().catch(null).optional(),
});
const TurnResponseSchema = z.looseObject({ turn: z.looseObject({ id: z.string().min(1) }) });
const AccountResponseSchema = z.looseObject({
  account: z
    .looseObject({ type: z.string().min(1) })
    .nullable()
    .catch(null),
});

function textInput(text: string): { type: 'text'; text: string; text_elements: [] }[] {
  return [{ type: 'text', text, text_elements: [] }];
}

export function createManagedCodex(options: ManagedCodexOptions = {}): ManagedExecutionAdapter {
  const spawn = options.spawn ?? spawnCodexAppServer;
  const sourceEnv = options.env ?? process.env;
  const env = codexEnv(sourceEnv);
  const tmpRoots = options.tmpRoots ?? defaultTmpRoots(sourceEnv);
  const timeoutMs = options.availabilityTimeoutMs ?? 20_000;
  const bin = options.bin ?? 'codex';
  return {
    provider: 'codex',
    capabilities: CODEX_CAPABILITIES,
    start(spec, callbacks) {
      return startAgent({ spawn, bin, env, tmpRoots }, spec, callbacks);
    },
    checkAvailable() {
      return checkAvailable(spawn, bin, env, timeoutMs);
    },
  };
}

/**
 * Whether Codex can start agents: the app-server starts, answers `initialize`, and `account/read`
 * names an account type (CX-1 result 1). Nothing else about the account is read, returned or
 * logged. The process is always closed afterwards.
 */
async function checkAvailable(
  spawn: SpawnCodex,
  bin: string,
  env: Readonly<Record<string, string>>,
  timeoutMs: number,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  let transport: CodexTransport;
  try {
    transport = spawn({ bin, cwd: os.homedir(), env });
  } catch {
    return { ok: false, reason: NOT_INSTALLED };
  }
  const client = new JsonRpcClient(transport, {
    onNotification: () => undefined,
    onRequest: () =>
      Promise.resolve({ error: { code: -32601, message: 'Not supported by the control plane.' } }),
  });
  let timer: NodeJS.Timeout | undefined;
  try {
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('timeout')), timeoutMs);
    });
    const read = (async () => {
      await initialize(client);
      return client.request('account/read', {});
    })();
    const parsed = AccountResponseSchema.safeParse(await Promise.race([read, timeout]));
    return parsed.success && parsed.data.account !== null
      ? { ok: true }
      : { ok: false, reason: NOT_SIGNED_IN };
  } catch {
    const exit = client.isClosed ? await client.closed : null;
    return { ok: false, reason: exit?.spawnError === 'not-found' ? NOT_INSTALLED : NOT_ANSWERING };
  } finally {
    clearTimeout(timer);
    transport.close();
  }
}

interface StartDeps {
  spawn: SpawnCodex;
  bin: string;
  env: Readonly<Record<string, string>>;
  tmpRoots: readonly string[];
}

/**
 * One agent on its own `codex app-server` process and thread. Events are buffered until read and
 * end with exactly one `finished`. A worker, tester, reviewer or follow-up ends when its turn ends
 * with no message on its way (as the Claude adapter decides with `specKeepsInputOpen`); the lead's
 * and the planner's input stays open until `abort()`.
 */
function startAgent(
  deps: StartDeps,
  spec: ManagedAgentSpec,
  callbacks: ManagedCallbacks,
): ManagedAgentHandle {
  const events = new AsyncQueue<ManagedAgentEvent>();
  const keepsOpen = specKeepsInputOpen(spec);
  const writes = (spec.kind === 'worker' || spec.kind === 'tester') && spec.followUp === undefined;
  const modes = codexModes(spec, deps.tmpRoots);
  const tempDir = tempDirOf(spec);

  let ended = false;
  let aborted = false;
  let interruptRequested = false;
  let transport: CodexTransport | null = null;
  let client: JsonRpcClient | null = null;
  let threadId: string | null = null;
  let activeTurnId: string | null = null;
  /** Messages on their way (`send`); a worker does not end while one is. */
  let inFlight = 0;
  /** A non-lead's turn ended while a message was on its way; how it ended. */
  let pendingEnd: 'success' | 'error' | 'cancelled' | null = null;
  let markReady: () => void = () => undefined;
  const ready = new Promise<void>((resolve) => {
    markReady = resolve;
  });

  const finish = (
    outcome: 'success' | 'error' | 'cancelled',
    failure?: ManagedFailureCode,
  ): void => {
    if (ended) return;
    ended = true;
    const end: ManagedAgentEvent = { type: 'finished', outcome, reportedCostUsd: null };
    if (failure !== undefined && outcome === 'error') end.failure = failure;
    events.push(end);
    events.close();
    markReady();
    // The process serves this one agent: it ends with it.
    transport?.close();
  };

  /** Ends after a failure, naming a missing Codex when the process never started. */
  const endFromFailure = async (): Promise<void> => {
    if (ended) return;
    const exit: CodexExit | null = client?.isClosed === true ? await client.closed : null;
    if (aborted) finish('cancelled');
    else if (exit !== null && exit.spawnError !== null) finish('error', 'provider-unavailable');
    else finish('error');
  };

  const emit = (event: ManagedAgentEvent): void => {
    if (!ended) events.push(event);
  };

  const handle: ManagedAgentHandle = {
    events,
    send: (text) => send(text),
    async interrupt() {
      const turnId = activeTurnId;
      if (ended || client === null || threadId === null || turnId === null) return;
      interruptRequested = true;
      try {
        await client.request('turn/interrupt', { threadId, turnId });
      } catch {
        // The turn had already ended.
      }
    },
    abort() {
      if (ended) return;
      aborted = true;
      // Ends stdin and kills the process (`finish` closes the transport).
      finish('cancelled');
    },
  };

  // F-1 (CX-1 result 8): a writing agent never starts where it could write its git data.
  if (writes) {
    const location = checkGitLocation(spec.cwd, tempDir === null ? [] : [tempDir], deps.tmpRoots);
    if (!location.safe) {
      finish('error', 'unsafe-git-location');
      return handle;
    }
  }

  // CX-1b: the agent's permission profile goes in as config. A path that cannot be written
  // safely ends the agent before any process starts: never a weaker profile (ADR-0022).
  let args: string[];
  try {
    args = codexArgs(modes.profile);
  } catch {
    finish('error', 'sandbox-unavailable');
    return handle;
  }

  // A protected agent's temp folder is its TMPDIR, the one temp place its profile lets it write.
  const env = tempDir === null ? { ...deps.env } : { ...deps.env, TMPDIR: tempDir };
  try {
    transport = deps.spawn({ bin: deps.bin, cwd: spec.cwd, env, args });
  } catch {
    finish('error', 'provider-unavailable');
    return handle;
  }

  const ctx: ApprovalContext = { spec, callbacks, emit, ended: () => ended };
  const rpc = new JsonRpcClient(transport, {
    onNotification: (method, params) => onNotification(method, params),
    onRequest: (method, params) => answerServerRequest(ctx, method, params),
  });
  client = rpc;
  void rpc.closed.then(() => endFromFailure());

  function onNotification(method: string, params: unknown): void {
    if (ended) return;
    const mapped = mapNotification(method, params, spec);
    for (const event of mapped.events) emit(event);
    onLifecycle(mapped.lifecycle);
  }

  function onLifecycle(lifecycle: Lifecycle): void {
    if (lifecycle === null) return;
    if (lifecycle.kind === 'turn-started') {
      activeTurnId = lifecycle.turnId;
      pendingEnd = null;
      return;
    }
    if (lifecycle.kind === 'error') {
      // The server will not retry; a non-lead's work is over. The lead's chat goes on.
      if (!keepsOpen) finish('error');
      return;
    }
    if (activeTurnId === null || activeTurnId === lifecycle.turnId) activeTurnId = null;
    const interrupted = interruptRequested;
    interruptRequested = false;
    if (keepsOpen) return;
    const outcome =
      lifecycle.status === 'completed'
        ? 'success'
        : lifecycle.status === 'interrupted' && interrupted
          ? 'cancelled'
          : 'error';
    if (inFlight > 0) pendingEnd = outcome;
    else finish(outcome);
  }

  async function startTurn(text: string): Promise<void> {
    if (client === null || threadId === null) throw new ManagedAgentEndedError(spec.agentRunId);
    const response = await client.request('turn/start', {
      threadId,
      input: textInput(text),
      ...(spec.effort !== undefined ? { effort: spec.effort } : {}),
    });
    const turn = TurnResponseSchema.safeParse(response);
    if (turn.success && activeTurnId === null) {
      activeTurnId = turn.data.turn.id;
      pendingEnd = null;
    }
  }

  function threadParams(): Record<string, unknown> {
    return {
      ...(spec.model !== null ? { model: spec.model } : {}),
      cwd: spec.cwd,
      approvalPolicy: modes.approvalPolicy,
      // CX-1b: the profile defined at spawn. No `sandbox`: a legacy sandbox overrides profiles.
      permissions: modes.profile.id,
      approvalsReviewer: 'user',
      developerInstructions: developerInstructionsFor(spec),
    };
  }

  function startThread(): Promise<unknown> {
    if (client === null) throw new ManagedAgentEndedError(spec.agentRunId);
    const tools = dynamicToolsFor(spec);
    return client.request('thread/start', {
      ...threadParams(),
      ephemeral: false,
      ...(tools.length > 0 ? { dynamicTools: tools } : {}),
    });
  }

  async function boot(): Promise<void> {
    try {
      await initialize(rpc);
      const resumeId = spec.followUp?.resumeSessionId ?? spec.rework?.resumeSessionId ?? null;
      let prompt = spec.prompt;
      let response: unknown;
      if (resumeId === null) {
        response = await startThread();
      } else {
        try {
          // Never forked: the thread keeps its id, so usage keeps flowing to the same session.
          response = await rpc.request('thread/resume', { threadId: resumeId, ...threadParams() });
        } catch (error) {
          // P-D: a rework whose thread is gone starts fresh in the same worktree; a follow-up
          // has nothing to answer from, so it fails.
          if (spec.followUp !== undefined || rpc.isClosed || ended) throw error;
          response = await startThread();
          prompt = `${REWORK_NEW_SESSION_NOTE}\n\n${spec.prompt}`;
        }
      }
      const thread = ThreadResponseSchema.safeParse(response);
      if (!thread.success) throw new Error('thread response');
      // ADR-0022 fail closed: a thread not running under ACP's profile never gets a turn.
      if (thread.data.activePermissionProfile?.id !== modes.profile.id) {
        finish('error', 'sandbox-unavailable');
        return;
      }
      threadId = thread.data.thread.id;
      emit({ type: 'started', providerSessionId: threadId, model: thread.data.model });
      await startTurn(prompt);
      markReady();
    } catch {
      await endFromFailure();
    }
  }

  async function send(text: string): Promise<void> {
    if (spec.followUp !== undefined) throw new ManagedFollowUpSendError(spec.agentRunId);
    if (ended) throw new ManagedAgentEndedError(spec.agentRunId);
    inFlight += 1;
    try {
      await ready;
      if (ended || client === null || threadId === null) {
        throw new ManagedAgentEndedError(spec.agentRunId);
      }
      const turnId = activeTurnId;
      if (turnId !== null) {
        try {
          await client.request('turn/steer', {
            threadId,
            input: textInput(text),
            expectedTurnId: turnId,
          });
          return;
        } catch {
          // The turn ended just before the steer arrived: start a new one below.
          if (ended || client.isClosed) throw new ManagedAgentEndedError(spec.agentRunId);
        }
      }
      await startTurn(text);
    } finally {
      inFlight -= 1;
      // A worker's turn ended while this message was on its way and no new turn started: it ends.
      if (!ended && inFlight === 0 && activeTurnId === null && pendingEnd !== null) {
        finish(pendingEnd);
      }
    }
  }

  void boot();
  return handle;
}
