import { randomUUID } from 'node:crypto';
import { stat } from 'node:fs/promises';
import {
  ASSISTANT_TOOL_NAMES,
  LeadToolInputs,
  type LeadToolName,
  type ManagedAgentEvent,
  type ManagedAgentHandle,
  type ManagedAgentSpec,
  type ManagedExecutionAdapter,
  type ManagedProviderId,
  type NormalizedEvent,
} from '@acp/core';
import {
  ASSISTANT_BUDGET_TOKENS,
  ASSISTANT_IDLE_MS,
  AssistantMessageRequestSchema,
  AssistantModeRequestSchema,
  AssistantStartRequestSchema,
  type AssistantEndReason,
  type AssistantMode,
  type AssistantProposalDto,
  type AssistantProposalKind,
  type AssistantSessionDto,
  type AssistantSessionStatus,
  type AssistantStreamEvent,
} from '@acp/core/api';
import { agentBudgetUsage, EMPTY_LEDGER, isOverBudget, recordUsage } from '@acp/orchestrator';
import type { UsageLedger } from '@acp/orchestrator';
import { codeMapToolReply, repoMapText, type RunCodeMapSource } from '../control/code-map.js';
import {
  managedSessionEvents,
  managedUsageEvent,
  SELF_RECORDED_USAGE,
} from '../control/managed-usage.js';
import { HttpError, notFound } from '../errors.js';
import { errorFields, type Logger } from '../logger.js';
import type { ProjectRef } from '../skills/index.js';
import {
  checkProposal,
  problemOf,
  writeProposal,
  type CheckedProposal,
  type ProposalWriters,
} from './proposals.js';
import { projectInfoAnswer, ticketStatusAnswer, type AssistantToolSources } from './tools.js';

/**
 * The project assistant (ADR-0035): one managed agent session per project, of the read-only
 * `assistant` role, started through the provider's adapter in the project's checkout. It is not
 * part of any ticket run and has no way to reach one: its tools are the four answered here plus
 * the code map.
 *
 * Everything lives in this process's memory and ends with the session: the session, its proposals
 * and the stream's short replay buffer. Nothing about the chat reaches the database or the logs
 * (ADR-0009): logs carry ids, codes and counts only. Usage is recorded as for any managed session
 * (Codex through the managed channel, Claude from its transcript like every Claude session).
 */

export type ProviderAvailability = { ok: true } | { ok: false; reason: string };

/** The latest ready map of a project, for the repository map and the `code_map` tool. */
export interface AssistantCodeMapSource extends RunCodeMapSource {
  summary(projectId: string): { manifest: { commit: string } | null };
}

export interface AssistantServiceDeps extends Omit<AssistantToolSources, 'skills' | 'agents'> {
  /** The ADR-0018 writers, also listed by `project_info`. */
  skills: ProposalWriters['skills'];
  agents: ProposalWriters['agents'];
  adapters: ReadonlyMap<ManagedProviderId, ManagedExecutionAdapter>;
  /** The provider's availability (the control service's cached check, CX-4). */
  checkProvider: (provider: ManagedProviderId) => Promise<ProviderAvailability>;
  projectOf: (projectId: string) => ProjectRef | undefined;
  /** Omitted (or the code map switched off): no repository map, and `code_map` refuses. */
  codeMap?: AssistantCodeMapSource;
  /** The deny-read list (CX-3b) for an adapter that enforces it. */
  denyRead: () => Promise<readonly string[]>;
  /** ADR-0032 §5: usage of a provider ACP does not observe from files (Codex). */
  ingestManaged?: (events: readonly NormalizedEvent[]) => void;
  now: () => Date;
  logger: Logger;
  newId?: () => string;
  /** Default `ASSISTANT_IDLE_MS`. */
  idleMs?: number;
  /** Default `ASSISTANT_BUDGET_TOKENS`. */
  budgetTokens?: number;
  /** The idle sweep's interval; null: no timer (tests call `sweep`). Default one minute. */
  sweepIntervalMs?: number | null;
}

export type AssistantListener = (event: AssistantStreamEvent, id: number) => void;

export interface AssistantService {
  start(projectId: string, body: unknown): Promise<AssistantSessionDto>;
  /** The project's current session; 404 when there is none. */
  current(projectId: string): AssistantSessionDto;
  send(projectId: string, body: unknown): Promise<AssistantSessionDto>;
  setMode(projectId: string, body: unknown): AssistantSessionDto;
  end(projectId: string): void;
  apply(projectId: string, proposalId: string): Promise<AssistantProposalDto>;
  discard(projectId: string, proposalId: string): AssistantProposalDto;
  /**
   * The stream: the snapshot (status and pending proposals) or, with `lastEventId` inside the
   * current session's buffer, the events after it; then live events until `unsubscribe`.
   */
  subscribe(
    projectId: string,
    listener: AssistantListener,
    lastEventId?: number,
  ): { replay: { event: AssistantStreamEvent; id: number }[]; unsubscribe: () => void };
  /** Ends idle sessions (the timer calls it; tests too). */
  sweep(): void;
  /** Ends every session (server stop). */
  close(): void;
}

/** The deny message for every permission request: the role only reads (ADR-0035 §6). */
export const ASSISTANT_READ_ONLY_MESSAGE =
  'The project assistant is read-only: it cannot change files or run commands.';
/** The session title (ADR-0024): app text only. */
export const ASSISTANT_SESSION_TITLE = 'Project assistant';
/** Events kept per project for a reconnect within the session. */
const REPLAY_LIMIT = 500;
const DEFAULT_SWEEP_MS = 60_000;

const END_MESSAGES: Readonly<Record<AssistantEndReason, string>> = {
  owner: 'The chat was ended.',
  replaced: 'A new chat was started.',
  idle: 'The chat ended after 30 minutes without activity.',
  budget: 'The chat reached its budget of 300k tokens. Start a new chat to go on.',
  finished: 'The assistant stopped.',
  failed: 'The assistant stopped with an error.',
  'server-stop': 'The app stopped.',
};

const FAILURE_MESSAGES: Readonly<Record<string, string>> = {
  'provider-unavailable': 'The provider could not start.',
  'unsafe-git-location': 'The project folder is in a place the provider cannot protect.',
  'sandbox-unavailable': 'The provider sandbox could not start.',
  'auto-mode-unavailable': 'The provider could not start.',
};

interface Proposal {
  dto: AssistantProposalDto;
  checked: CheckedProposal;
}

interface Session {
  id: string;
  project: ProjectRef;
  provider: ManagedProviderId;
  model: string | null;
  effort: AssistantSessionDto['effort'];
  mode: AssistantMode;
  status: AssistantSessionStatus;
  failure: string | null;
  startedAt: string;
  adapter: ManagedExecutionAdapter;
  handle: ManagedAgentHandle | null;
  /** Set once the session is ending, so the pump's `finished` changes nothing. */
  ending: boolean;
  ledger: UsageLedger;
  used: number;
  lastActivity: number;
  proposals: Map<string, Proposal>;
  /** The repository map's commit, for `code_map` (the latest ready map when the chat started). */
  mapCommit: string | null;
  providerSessionId: string | null;
}

interface Channel {
  listeners: Set<AssistantListener>;
  buffer: { event: AssistantStreamEvent; id: number }[];
  /** The session the buffer belongs to. */
  sessionId: string | null;
}

export function createAssistantService(deps: AssistantServiceDeps): AssistantService {
  const { logger } = deps;
  const newId = deps.newId ?? (() => randomUUID());
  const idleMs = deps.idleMs ?? ASSISTANT_IDLE_MS;
  const budgetLimit = deps.budgetTokens ?? ASSISTANT_BUDGET_TOKENS;
  const sessions = new Map<string, Session>();
  const channels = new Map<string, Channel>();
  let seq = 0;
  let closed = false;

  const sweepMs = deps.sweepIntervalMs === undefined ? DEFAULT_SWEEP_MS : deps.sweepIntervalMs;
  const timer = sweepMs === null ? undefined : setInterval(() => sweep(), sweepMs);
  timer?.unref?.();

  function channel(projectId: string): Channel {
    let c = channels.get(projectId);
    if (c === undefined) {
      c = { listeners: new Set(), buffer: [], sessionId: null };
      channels.set(projectId, c);
    }
    return c;
  }

  function emit(projectId: string, event: AssistantStreamEvent): void {
    const c = channel(projectId);
    const id = ++seq;
    c.buffer.push({ event, id });
    if (c.buffer.length > REPLAY_LIMIT) c.buffer.splice(0, c.buffer.length - REPLAY_LIMIT);
    for (const listener of c.listeners) {
      try {
        listener(event, id);
      } catch (error) {
        logger.log('warn', 'assistant listener failed', errorFields(error));
      }
    }
  }

  function dto(s: Session): AssistantSessionDto {
    return {
      id: s.id,
      projectId: s.project.id,
      provider: s.provider,
      model: s.model,
      effort: s.effort,
      mode: s.mode,
      status: s.status,
      failure: s.failure,
      budget: { used: s.used, limit: budgetLimit },
      startedAt: s.startedAt,
    };
  }

  function setStatus(s: Session, status: AssistantSessionStatus): void {
    if (s.status === status) return;
    s.status = status;
    emit(s.project.id, { type: 'status', session: dto(s) });
  }

  function projectOrThrow(projectId: string): ProjectRef {
    const project = deps.projectOf(projectId);
    if (project === undefined) throw notFound(`Project ${projectId} not found`);
    return project;
  }

  function sessionOrThrow(projectId: string): Session {
    const s = sessions.get(projectId);
    if (s === undefined) throw notFound('There is no assistant chat for this project');
    return s;
  }

  function parse<T>(
    schema: { safeParse(v: unknown): { success: true; data: T } | { success: false } },
    body: unknown,
  ): T {
    const parsed = schema.safeParse(body);
    if (!parsed.success) throw new HttpError(400, 'invalid_request', 'The request is not valid');
    return parsed.data;
  }

  /** Ends a session: aborts its agent, tells the stream, forgets everything about it. */
  function finish(s: Session, reason: AssistantEndReason, failure: string | null = null): void {
    if (s.ending) return;
    s.ending = true;
    if (sessions.get(s.project.id) === s) sessions.delete(s.project.id);
    try {
      s.handle?.abort();
    } catch (error) {
      logger.log('warn', 'assistant abort failed', errorFields(error));
    }
    s.failure = failure;
    setStatus(s, failure !== null ? 'failed' : 'ended');
    emit(s.project.id, { type: 'ended', reason, message: failure ?? END_MESSAGES[reason] });
    // The replay buffer holds the chat's text: it goes with the session.
    const c = channel(s.project.id);
    if (c.sessionId === s.id) {
      c.buffer.length = 0;
      c.sessionId = null;
    }
    s.proposals.clear();
    logger.log('info', 'assistant session ended', {
      projectId: s.project.id,
      sessionId: s.id,
      reason,
      budgetTokens: s.used,
    });
  }

  function touch(s: Session): void {
    s.lastActivity = deps.now().getTime();
  }

  // ---------------------------------------------------------------- tools

  async function proposeTool(
    s: Session,
    kind: AssistantProposalKind,
    input: { slug: string; content: string; replace?: boolean | undefined },
  ): Promise<string> {
    const replace = input.replace === true;
    let checked: CheckedProposal;
    try {
      checked = await checkProposal(deps, s.project, {
        kind,
        slug: input.slug,
        content: input.content,
        replace,
      });
    } catch (error) {
      throw new Error(problemOf(error), { cause: error });
    }
    const proposal: Proposal = {
      checked,
      dto: {
        id: newId(),
        kind,
        slug: checked.slug,
        path: checked.path,
        content: checked.content,
        replace: replace && checked.exists,
        state: 'pending',
        problem: null,
      },
    };
    if (s.mode === 'approve') {
      s.proposals.set(proposal.dto.id, proposal);
      emit(s.project.id, { type: 'proposal', proposal: { ...proposal.dto } });
      logger.log('info', 'assistant proposal shown', {
        projectId: s.project.id,
        sessionId: s.id,
        kind,
      });
      return `Proposal for ${checked.path} shown to the owner; wait for their decision.`;
    }
    // Auto (ADR-0035 §5): the owner's switch is the action; written at once through the writer.
    const ok = await write(s, proposal, 'written');
    s.proposals.set(proposal.dto.id, proposal);
    emit(s.project.id, { type: 'proposal', proposal: { ...proposal.dto } });
    return ok
      ? `Written ${checked.path} (Auto mode). It is not committed; the owner commits it.`
      : `Writing ${checked.path} failed: ${proposal.dto.problem ?? 'unknown problem'}`;
  }

  /** Writes through the ADR-0018 writer; sets the proposal's state. */
  async function write(
    s: Session,
    proposal: Proposal,
    success: 'applied' | 'written',
  ): Promise<boolean> {
    const { checked } = proposal;
    try {
      await writeProposal(deps, s.project, {
        kind: checked.kind,
        slug: checked.slug,
        request: checked.request,
        replace: proposal.dto.replace,
      });
      proposal.dto.state = success;
      proposal.dto.problem = null;
      logger.log('info', 'assistant proposal written', {
        projectId: s.project.id,
        sessionId: s.id,
        kind: checked.kind,
      });
      return true;
    } catch (error) {
      proposal.dto.state = 'failed';
      proposal.dto.problem = problemOf(error);
      logger.log('warn', 'assistant proposal not written', {
        projectId: s.project.id,
        sessionId: s.id,
        kind: checked.kind,
        ...errorFields(error),
      });
      return false;
    }
  }

  async function tool(s: Session, name: LeadToolName, raw: unknown): Promise<string> {
    if (!ASSISTANT_TOOL_NAMES.includes(name)) {
      throw new Error('The project assistant cannot use this tool.');
    }
    if (s.ending) throw new Error('This chat has ended.');
    touch(s);
    switch (name) {
      case 'ticket_status': {
        const input = parseTool(name, raw) as { ticketKey?: string };
        return ticketStatusAnswer(deps, s.project.id, input.ticketKey);
      }
      case 'project_info':
        parseTool(name, raw);
        return projectInfoAnswer(deps, s.project);
      case 'code_map': {
        const source = deps.codeMap;
        if (source === undefined) throw new Error('The code map is switched off.');
        return codeMapToolReply(source, s.project.id, s.mapCommit, raw);
      }
      case 'propose_skill':
      case 'propose_agent': {
        const input = parseTool(name, raw) as {
          slug: string;
          content: string;
          replace?: boolean;
        };
        return proposeTool(s, name === 'propose_skill' ? 'skill' : 'agent', input);
      }
      default:
        throw new Error('The project assistant cannot use this tool.');
    }
  }

  function parseTool(name: LeadToolName, raw: unknown): unknown {
    const parsed = LeadToolInputs[name].safeParse(raw);
    if (!parsed.success) {
      const issues = parsed.error.issues
        .slice(0, 3)
        .map((i) => `${i.path.length > 0 ? i.path.join('.') : 'input'}: ${i.message}`)
        .join('; ');
      throw new Error(`Invalid input for ${name}: ${issues}`);
    }
    return parsed.data;
  }

  // ---------------------------------------------------------------- the agent

  function onEvent(s: Session, event: ManagedAgentEvent, record: (e: ManagedAgentEvent) => void) {
    if (s.ending) return;
    touch(s);
    record(event);
    switch (event.type) {
      case 'started':
        s.providerSessionId = event.providerSessionId;
        if (event.model !== null) s.model = event.model;
        return;
      case 'activity':
        emit(s.project.id, { type: 'activity', summary: event.summary.slice(0, 300) });
        setStatus(s, 'working');
        return;
      case 'tool-use':
        return;
      case 'usage': {
        s.ledger = recordUsage(s.ledger, s.id, s.provider, event.messageId, event.tokens);
        s.used = agentBudgetUsage(s.ledger, s.id).used;
        if (isOverBudget(s.used, budgetLimit)) finish(s, 'budget');
        return;
      }
      case 'lead-text':
        if (event.text.trim() === '') return;
        emit(s.project.id, { type: 'text', full: event.text });
        setStatus(s, 'ready');
        return;
      case 'finished':
        if (event.outcome === 'error') {
          finish(s, 'failed', FAILURE_MESSAGES[event.failure ?? ''] ?? END_MESSAGES.failed);
        } else finish(s, 'finished');
        return;
    }
  }

  /** ADR-0032 §5: Codex's usage enters the database through the pipeline; Claude's from files. */
  function usageRecorder(s: Session): (event: ManagedAgentEvent) => void {
    const ingest = deps.ingestManaged;
    if (ingest === undefined || !SELF_RECORDED_USAGE.has(s.provider)) return () => undefined;
    return (event) => {
      if (event.type !== 'started' && event.type !== 'usage') return;
      const observedAt = deps.now().toISOString();
      const sessionId = event.type === 'started' ? event.providerSessionId : s.providerSessionId;
      if (sessionId === null) return;
      const events =
        event.type === 'started'
          ? managedSessionEvents({
              provider: s.provider,
              providerSessionId: sessionId,
              observedAt,
              cwd: s.project.rootPath,
              model: event.model ?? s.model,
            })
          : [
              managedUsageEvent({
                provider: s.provider,
                providerSessionId: sessionId,
                observedAt,
                messageId: event.messageId,
                model: s.model,
                tokens: event.tokens,
              }),
            ];
      try {
        ingest(events);
      } catch (error) {
        logger.log('error', 'assistant usage not recorded', {
          projectId: s.project.id,
          ...errorFields(error),
        });
      }
    };
  }

  async function pump(s: Session, handle: ManagedAgentHandle): Promise<void> {
    const record = usageRecorder(s);
    try {
      for await (const event of handle.events) onEvent(s, event, record);
    } catch (error) {
      logger.log('error', 'assistant pump failed', errorFields(error));
      finish(s, 'failed', END_MESSAGES.failed);
      return;
    }
    // The stream ended without `finished` (it should not): the chat cannot go on.
    if (!s.ending) finish(s, 'finished');
  }

  async function launch(s: Session, prompt: string): Promise<void> {
    const adapter = s.adapter;
    const spec: ManagedAgentSpec = {
      agentRunId: s.id,
      kind: 'assistant',
      cwd: s.project.rootPath,
      prompt,
      model: s.model,
      effort: s.effort,
      title: ASSISTANT_SESSION_TITLE,
      leadTools: (name, input) => tool(s, name, input),
    };
    const source = deps.codeMap;
    if (source !== undefined) {
      s.mapCommit = source.summary(s.project.id).manifest?.commit ?? null;
      const repoMap = repoMapText(source, s.project.id, s.mapCommit, {});
      if (repoMap !== undefined) spec.repoMap = repoMap;
    }
    if (adapter.capabilities.denyRead) spec.denyRead = [...(await deps.denyRead())];
    if (s.ending) return;
    const handle = adapter.start(spec, {
      requestPermission: () => {
        logger.log('info', 'assistant tool use denied', {
          projectId: s.project.id,
          sessionId: s.id,
        });
        return Promise.resolve({ allow: false, message: ASSISTANT_READ_ONLY_MESSAGE });
      },
    });
    s.handle = handle;
    void pump(s, handle);
  }

  // ---------------------------------------------------------------- API

  function sweep(): void {
    const now = deps.now().getTime();
    for (const s of [...sessions.values()]) {
      if (now - s.lastActivity >= idleMs) finish(s, 'idle');
    }
  }

  return {
    async start(projectId, body) {
      if (closed) throw new HttpError(503, 'shutting_down', 'The app is stopping');
      const project = projectOrThrow(projectId);
      const request = parse(AssistantStartRequestSchema, body);
      const adapter = deps.adapters.get(request.provider);
      if (adapter === undefined) {
        throw new HttpError(409, 'provider_unavailable', 'This provider is not set up here');
      }
      if (!adapter.capabilities.leadTools) {
        throw new HttpError(
          409,
          'provider_unavailable',
          "This provider cannot offer the assistant's tools",
        );
      }
      // A project whose folder was moved or deleted: the provider cannot start there, and the SDK's
      // own error for a missing folder is misleading ("binary failed to launch").
      if (!(await isFolder(project.rootPath))) {
        throw new HttpError(
          409,
          'project_folder_missing',
          "The project's folder was not found. It may have been moved or deleted.",
        );
      }
      const available = await deps.checkProvider(request.provider);
      if (!available.ok) {
        throw new HttpError(409, 'provider_unavailable', available.reason.slice(0, 300));
      }
      const previous = sessions.get(projectId);
      if (previous !== undefined) finish(previous, 'replaced');
      const s: Session = {
        id: newId(),
        project,
        provider: request.provider,
        // ADR-0035 §2: `sonnet` for Claude by default; Codex's own default otherwise.
        model: request.model ?? (request.provider === 'claude-code' ? 'sonnet' : null),
        effort: request.effort,
        mode: request.mode,
        status: 'ready',
        failure: null,
        startedAt: deps.now().toISOString(),
        adapter,
        handle: null,
        ending: false,
        ledger: EMPTY_LEDGER,
        used: 0,
        lastActivity: deps.now().getTime(),
        proposals: new Map(),
        mapCommit: null,
        providerSessionId: null,
      };
      sessions.set(projectId, s);
      const c = channel(projectId);
      c.buffer.length = 0;
      c.sessionId = s.id;
      emit(projectId, { type: 'status', session: dto(s) });
      logger.log('info', 'assistant session started', {
        projectId,
        sessionId: s.id,
        provider: s.provider,
        mode: s.mode,
      });
      return dto(s);
    },

    current(projectId) {
      return dto(sessionOrThrow(projectId));
    },

    async send(projectId, body) {
      const s = sessionOrThrow(projectId);
      const { text } = parse(AssistantMessageRequestSchema, body);
      touch(s);
      if (s.handle === null) {
        // The agent starts with the owner's first message, so an opened panel costs nothing.
        setStatus(s, 'starting');
        try {
          await launch(s, text);
        } catch (error) {
          logger.log('warn', 'assistant start failed', { projectId, ...errorFields(error) });
          finish(s, 'failed', 'The assistant could not start.');
          throw new HttpError(409, 'assistant_failed', 'The assistant could not start');
        }
      } else {
        try {
          await s.handle.send(text);
        } catch (error) {
          logger.log('warn', 'assistant message not delivered', {
            projectId,
            ...errorFields(error),
          });
          finish(s, 'failed', END_MESSAGES.failed);
          throw new HttpError(409, 'assistant_ended', 'The assistant chat has ended');
        }
      }
      if (!s.ending) setStatus(s, 'working');
      return dto(s);
    },

    setMode(projectId, body) {
      const s = sessionOrThrow(projectId);
      const { mode } = parse(AssistantModeRequestSchema, body);
      if (s.mode !== mode) {
        s.mode = mode;
        emit(projectId, { type: 'status', session: dto(s) });
      }
      return dto(s);
    },

    end(projectId) {
      finish(sessionOrThrow(projectId), 'owner');
    },

    async apply(projectId, proposalId) {
      const s = sessionOrThrow(projectId);
      const proposal = s.proposals.get(proposalId);
      if (proposal === undefined) throw notFound('No such proposal in this chat');
      if (proposal.dto.state !== 'pending') {
        throw new HttpError(409, 'proposal_decided', 'This proposal was already decided');
      }
      touch(s);
      // A decision in flight: a second click finds it decided.
      proposal.dto.state = 'applied';
      const ok = await write(s, proposal, 'applied');
      emit(projectId, { type: 'proposal', proposal: { ...proposal.dto } });
      void tell(
        s,
        ok
          ? `The owner applied ${proposal.dto.path}.`
          : `The owner applied ${proposal.dto.path}, but writing it failed: ${proposal.dto.problem ?? 'unknown problem'}`,
      );
      return { ...proposal.dto };
    },

    discard(projectId, proposalId) {
      const s = sessionOrThrow(projectId);
      const proposal = s.proposals.get(proposalId);
      if (proposal === undefined) throw notFound('No such proposal in this chat');
      if (proposal.dto.state !== 'pending') {
        throw new HttpError(409, 'proposal_decided', 'This proposal was already decided');
      }
      touch(s);
      proposal.dto.state = 'discarded';
      emit(projectId, { type: 'proposal', proposal: { ...proposal.dto } });
      void tell(s, `The owner discarded ${proposal.dto.path}.`);
      return { ...proposal.dto };
    },

    subscribe(projectId, listener, lastEventId) {
      const c = channel(projectId);
      const s = sessions.get(projectId);
      const first = c.buffer[0];
      const canReplay =
        s !== undefined &&
        c.sessionId === s.id &&
        lastEventId !== undefined &&
        first !== undefined &&
        lastEventId >= first.id - 1;
      let replay: { event: AssistantStreamEvent; id: number }[];
      if (canReplay) {
        replay = c.buffer.filter((e) => e.id > lastEventId);
      } else {
        // A fresh connection: the current state, never the chat's history.
        replay = [{ event: { type: 'status', session: s === undefined ? null : dto(s) }, id: seq }];
        for (const p of s?.proposals.values() ?? []) {
          if (p.dto.state === 'pending') {
            replay.push({ event: { type: 'proposal', proposal: { ...p.dto } }, id: seq });
          }
        }
      }
      c.listeners.add(listener);
      return { replay, unsubscribe: () => c.listeners.delete(listener) };
    },

    sweep,

    close() {
      closed = true;
      if (timer !== undefined) clearInterval(timer);
      for (const s of [...sessions.values()]) finish(s, 'server-stop');
    },
  };

  /** A short note to the assistant about the owner's decision; lost when the chat has ended. */
  async function tell(s: Session, text: string): Promise<void> {
    if (s.ending || s.handle === null) return;
    try {
      await s.handle.send(text);
      setStatus(s, 'working');
    } catch (error) {
      logger.log('warn', 'assistant note not delivered', {
        projectId: s.project.id,
        ...errorFields(error),
      });
    }
  }
}

async function isFolder(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}
