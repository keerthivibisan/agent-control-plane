import type { ManagedAgentHandle, ManagedAgentSpec, ManagedExecutionAdapter } from '@acp/core';
import {
  CsrfTokenDtoSchema,
  StreamNoticeDtoSchema,
  type StreamNoticeDto,
  type UpdateWorkflowRequest,
} from '@acp/core/api';
import { createManagedClaudeCode, type ManagedQueryFn } from '@acp/adapter-claude-code';
import { defaultProjectWorkflow } from '@acp/core';
import { startServer } from '../../../src/bootstrap.js';
import { loadConfig } from '../../../src/config.js';
import { createLogger } from '../../../src/logger.js';
import { createGitRunner } from '../../../src/workspace/index.js';
import { createFakeManagedAdapter } from '../../control/fake-adapter.js';
import { GIT_TEST_IDENTITY_ENV, tempDir } from '../../workspace/helpers.js';
import { expectStatus, waitFor, type Reply, type WorkspaceServer } from '../workspace/harness.js';

/*
 * R-V verification harness (redesign): P4-H's set-up (the real server composition through
 * `startServer` on 127.0.0.1 with an ephemeral port, live mode over an empty temp Claude dir, git
 * isolated from the owner's config, every log line and response body kept), with one addition:
 * each agent the server starts is ALSO handed to the real Claude Code managed adapter, whose SDK
 * `query` is a capturing stub. So a test sees the exact SDK options the real adapter would give
 * that agent (tools, disallowed tools, plugins, skills, resume, the system prompt) and can call
 * its real permission gate (`canUseTool`), while the scripted fake agent drives the run. Neither
 * the Agent SDK's `query` nor `claude` ever runs: the stub never spawns anything.
 */

export type SdkOptions = Parameters<ManagedQueryFn>[0]['options'];

/** What the real adapter would have passed to the SDK for one agent start. */
export interface SdkStart {
  agentRunId: string;
  kind: ManagedAgentSpec['kind'];
  followUp: boolean;
  options: SdkOptions;
}

/**
 * A `ManagedExecutionAdapter` that hands every start to the scripted fake (which the test drives)
 * and to the real adapter over a capturing `query` (whose handle is only kept to be aborted).
 */
function createTeeAdapter(): {
  adapter: ManagedExecutionAdapter;
  fake: ReturnType<typeof createFakeManagedAdapter>;
  sdk: SdkStart[];
  closeAll(): void;
} {
  const fake = createFakeManagedAdapter();
  const sdk: SdkStart[] = [];
  const shadows: ManagedAgentHandle[] = [];
  let current: ManagedAgentSpec | undefined;
  const query: ManagedQueryFn = ({ options }) => {
    const spec = current;
    if (spec !== undefined) {
      sdk.push({
        agentRunId: spec.agentRunId,
        kind: spec.kind,
        followUp: spec.followUp !== undefined,
        options,
      });
    }
    const signal = options.abortController?.signal;
    return {
      // Yields nothing; ends when the real adapter aborts (or never, which keeps nothing alive).
      // eslint-disable-next-line require-yield -- a stream with no SDK messages at all
      async *[Symbol.asyncIterator]() {
        await new Promise<void>((resolve) => {
          if (signal === undefined || signal.aborted) resolve();
          else signal.addEventListener('abort', () => resolve(), { once: true });
        });
      },
      interrupt: () => Promise.resolve(),
      close: () => undefined,
    };
  };
  // `env: {}`: nothing of this process's environment would reach an agent (it never starts).
  const real = createManagedClaudeCode({ query, env: {} });
  return {
    fake,
    sdk,
    adapter: {
      provider: 'claude-code',
      start(spec, callbacks) {
        const handle = fake.adapter.start(spec, callbacks);
        current = spec;
        try {
          shadows.push(real.start(spec, callbacks));
        } finally {
          current = undefined;
        }
        return handle;
      },
    },
    closeAll() {
      for (const h of shadows.splice(0)) h.abort();
    },
  };
}

export interface RedesignServer extends WorkspaceServer {
  /** One entry per agent start, in order (follow-up turns included). */
  sdk: SdkStart[];
  /** The SDK options of the latest start of this agent run (a follow-up turn reuses the lead's id). */
  sdkFor(agentRunId: string, followUp?: boolean): SdkOptions;
  del(path: string): Promise<Reply>;
}

export interface RedesignBootOptions {
  dataDir?: string;
  claudeDir?: string;
  logs?: string[];
}

export async function bootRedesign(options: RedesignBootOptions = {}): Promise<RedesignServer> {
  const dataDir = options.dataDir ?? tempDir('acp-rv-data-');
  const claudeDir = options.claudeDir ?? tempDir('acp-rv-claude-');
  const logs = options.logs ?? [];
  const config = loadConfig({
    ACP_MODE: 'live',
    ACP_DATA_DIR: dataDir,
    // Only for the config; the server listens on an ephemeral port (never 7420 or 5173).
    ACP_PORT: '7751',
    ACP_CLAUDE_DIR: claudeDir,
    ACP_POLL_INTERVAL_MS: '1000',
  });
  const tee = createTeeAdapter();
  const server = await startServer({
    config,
    port: 0,
    logger: createLogger((line) => logs.push(line)),
    managedAdapter: tee.adapter,
    // Skills and agent files are committed as the owner (ADR-0018): give the test repo an identity.
    git: createGitRunner({ env: GIT_TEST_IDENTITY_ENV }),
    // R-V verifies the redesign stages of runs started before ADR-0021 (legacy flow, kept by such
    // runs); the review loop is verified in tests/verification/review-loop.
    board: { legacyTicketRuns: true },
  });
  const base = `http://127.0.0.1:${server.port}`;
  const responses: string[] = [];
  let csrf = '';

  const request: WorkspaceServer['request'] = async (method, path, body, opts = {}) => {
    const headers: Record<string, string> = {};
    if (body !== undefined) headers['content-type'] = 'application/json';
    const token = opts.csrf === undefined ? csrf : opts.csrf;
    if (method !== 'GET' && token !== null) headers['X-ACP-CSRF'] = token;
    const res = await fetch(`${base}${path}`, {
      method,
      headers,
      ...(body !== undefined && { body: JSON.stringify(body) }),
    });
    const text = await res.text();
    responses.push(text);
    return { status: res.status, body: text === '' ? null : (JSON.parse(text) as unknown) };
  };

  csrf = CsrfTokenDtoSchema.parse((await request('GET', '/api/control/token')).body).token;
  let closed = false;
  return {
    server,
    base,
    dataDir,
    claudeDir,
    databasePath: config.databasePath,
    csrf,
    fake: tee.fake,
    logs,
    responses,
    sdk: tee.sdk,
    sdkFor(agentRunId, followUp = false) {
      const found = tee.sdk.filter((s) => s.agentRunId === agentRunId && s.followUp === followUp);
      const last = found.at(-1);
      if (last === undefined) throw new Error(`no SDK start for ${agentRunId}`);
      return last.options;
    },
    request,
    get: (path) => request('GET', path),
    post: (path, body = {}) => request('POST', path, body),
    put: (path, body) => request('PUT', path, body),
    del: (path) => request('DELETE', path),
    async close() {
      if (closed) return;
      closed = true;
      tee.closeAll();
      await server.close();
    },
  };
}

/** The default stage configuration, to change per test. */
export function defaultStages(): UpdateWorkflowRequest['stages'] {
  return defaultProjectWorkflow('x', '2026-10-16T09:00:00.000Z').stages;
}

export async function saveWorkflow(
  b: WorkspaceServer,
  projectId: string,
  workflow: UpdateWorkflowRequest,
): Promise<void> {
  expectStatus(await b.put(`/api/projects/${projectId}/workflow`, workflow), 200);
}

/** A synthetic agent file body for the Skills & Agents write route. */
export function agentFileBody(
  name: string,
  tools: string[] | null,
  model: string | null,
  instructions: string,
) {
  return { name, description: `Synthetic R-V agent ${name}.`, tools, model, instructions };
}

/** Text of the SDK system prompt's appended part ('' when nothing is appended). */
export function appendedPrompt(options: SdkOptions): string {
  const sp = options.systemPrompt;
  if (sp === undefined || typeof sp === 'string' || Array.isArray(sp)) return '';
  return 'append' in sp && typeof sp.append === 'string' ? sp.append : '';
}

/**
 * The owner's Merge on one agent's change. Right after a change enters review its checks are
 * still in flight, and the server answers `409 checks_running` (P4-H, documented): the owner
 * would click again, so this retries until the answer is something else.
 */
export async function mergeChange(
  b: WorkspaceServer,
  runId: string,
  agentRunId: string,
): Promise<Reply> {
  return waitFor(async () => {
    const res = await b.post(`/api/runs/${runId}/review`, { agentRunId, action: 'merge' });
    const code = (res.body as { error?: { code?: string } } | null)?.error?.code;
    return res.status === 409 && code === 'checks_running' ? undefined : res;
  }, 'the merge');
}

/**
 * Reads `GET /api/events/stream` as it arrives: `notices` grows with every parsed frame, so a
 * test can wait for the notice a step should publish (what the page's EventSource would get).
 */
export function openStream(b: WorkspaceServer): {
  notices: StreamNoticeDto[];
  raw: () => string;
  stop(): Promise<void>;
} {
  const controller = new AbortController();
  const notices: StreamNoticeDto[] = [];
  let text = '';
  const done = (async () => {
    try {
      const res = await fetch(`${b.base}/api/events/stream`, { signal: controller.signal });
      const reader = res.body?.getReader();
      const decoder = new TextDecoder();
      let pending = '';
      for (;;) {
        const chunk = await reader?.read();
        if (chunk === undefined || chunk.done) break;
        const piece = decoder.decode(chunk.value as Uint8Array, { stream: true });
        text += piece;
        pending += piece;
        let end = pending.indexOf('\n\n');
        while (end !== -1) {
          const frame = pending.slice(0, end);
          pending = pending.slice(end + 2);
          const data = frame.split('\n').find((l) => l.startsWith('data: '));
          if (data !== undefined)
            notices.push(StreamNoticeDtoSchema.parse(JSON.parse(data.slice(6))));
          end = pending.indexOf('\n\n');
        }
      }
    } catch {
      // Aborted by stop(), or the server closed the connection.
    }
  })();
  return {
    notices,
    raw: () => text,
    async stop() {
      controller.abort();
      await done;
    },
  };
}

/** Waits for a notice after index `from` naming this run (optionally of one kind). */
export function waitForNotice(
  stream: { notices: StreamNoticeDto[] },
  from: number,
  runId: string,
  kind?: StreamNoticeDto['kind'],
): Promise<StreamNoticeDto> {
  return waitFor(
    () =>
      stream.notices
        .slice(from)
        .find((n) => (n.runIds ?? []).includes(runId) && (kind === undefined || n.kind === kind)),
    `a ${kind ?? 'run'} notice for ${runId}`,
    5_000,
  );
}

/** Calls the real adapter's permission gate the way the SDK does for one tool use. */
export function gate(options: SdkOptions, toolName: string, input: Record<string, unknown>) {
  const canUseTool = options.canUseTool;
  if (canUseTool === undefined) throw new Error('no canUseTool');
  return canUseTool(toolName, input, {
    signal: new AbortController().signal,
    toolUseID: `tu-${toolName}`,
  } as Parameters<typeof canUseTool>[2]);
}
