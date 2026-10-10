import { realpathSync } from 'node:fs';
import path from 'node:path';
import { IsoTimestampSchema, NORMALIZED_EVENT_SCHEMA_VERSION } from '@acp/core';
import type { IsoTimestamp, NormalizedEvent } from '@acp/core';
import { z } from 'zod';
import {
  AGENT_ID_RE,
  classifyRelative,
  resolveAllowedTranscriptSync,
  SESSION_ID_RE,
} from './allowlist.js';
import { hookRecordKey } from './dedup.js';
import { isAbsolutePathString } from './paths.js';
import type { EventBase } from './records.js';

/**
 * Hooks the adapter understands (provider-adapters §6). Every other `hook_event_name` is ignored
 * and normalizes to `[]`.
 */
export const SUBSCRIBED_HOOKS = [
  'SessionStart',
  'SessionEnd',
  'SubagentStart',
  'SubagentStop',
  'Stop',
  'Notification',
  'CwdChanged',
] as const;
export type SubscribedHook = (typeof SUBSCRIBED_HOOKS)[number];

const SUBSCRIBED: ReadonlySet<string> = new Set(SUBSCRIBED_HOOKS);

/**
 * Hooks the settings snippet registers as `type: "http"`. `SessionStart` is left out: in the
 * 2026-10-11 capture (runtime 2.1.296) an http `SessionStart` hook was never delivered while a
 * `command` hook for it in the same run was (docs/research/p1-c6-hook-capture-2026-10-11.md).
 * `normalizeHook` still accepts a `SessionStart` body, e.g. one a user forwards from a command hook.
 */
export const SNIPPET_HOOKS = [
  'SessionEnd',
  'SubagentStart',
  'SubagentStop',
  'Stop',
  'Notification',
  'CwdChanged',
] as const satisfies readonly SubscribedHook[];

/** Thrown for a body that is not a usable hook payload. The message never quotes the payload. */
export class HookPayloadError extends Error {
  override readonly name = 'HookPayloadError';
}

/**
 * Short identifier-like values (hook `source`, `reason`, `notification_type`, `agent_type`,
 * `model`). Anything longer or with other characters is treated as unknown rather than stored, so
 * a hook can never smuggle free text into an event (ADR-0009).
 */
const identifier = z
  .string()
  .regex(/^[A-Za-z0-9_.:[\] -]{1,80}$/)
  .nullable()
  .catch(null);
const optString = z.string().min(1).nullable().catch(null);

/**
 * Common fields plus the per-event fields we read; names verified against runtime 2.1.296 except
 * `notification_type` and SessionStart `model` (not observed). Free-text fields
 * (`last_assistant_message`, `message`, `title`, `prompt`, tool input/output) are never read.
 */
const HookBodySchema = z.looseObject({
  session_id: z.string().regex(SESSION_ID_RE),
  hook_event_name: z.string().min(1).max(64),
  transcript_path: optString,
  cwd: optString,
  tool_use_id: z
    .string()
    .regex(/^[A-Za-z0-9_-]{1,128}$/)
    .nullable()
    .catch(null),
  source: identifier,
  model: identifier,
  reason: identifier,
  notification_type: identifier,
  agent_id: z.string().regex(AGENT_ID_RE).nullable().catch(null),
  agent_type: identifier,
  agent_transcript_path: optString,
  old_cwd: optString,
  new_cwd: optString,
});
type HookBody = z.infer<typeof HookBodySchema>;

export interface HookContext {
  claudeDir: string;
}

/**
 * Normalizes one hook delivery (provider-adapters §6). Throws {@link HookPayloadError} when the
 * body is not an object with a UUID `session_id` and a `hook_event_name`, or lacks a field the
 * event needs; returns `[]` for hook events that are not subscribed. Hooks carry lifecycle facts
 * only: never usage, and never message, prompt, or tool content.
 *
 * `source.path` is set only when the hook's transcript path passes the file allowlist and belongs
 * to the same session (SubagentStop prefers `agent_transcript_path`); otherwise it is null.
 */
export function normalizeHook(
  body: unknown,
  receivedAt: IsoTimestamp,
  context: HookContext,
): NormalizedEvent[] {
  if (!IsoTimestampSchema.safeParse(receivedAt).success) {
    throw new HookPayloadError('invalid receivedAt');
  }
  const parsed = HookBodySchema.safeParse(body);
  if (!parsed.success)
    throw new HookPayloadError('hook payload is missing session_id or event name');
  const hook = parsed.data;
  if (!SUBSCRIBED.has(hook.hook_event_name)) return [];
  const name = hook.hook_event_name as SubscribedHook;

  const key = hookRecordKey(hook.session_id, name, hook.tool_use_id, body);
  const agentId = name === 'SubagentStart' || name === 'SubagentStop' ? requireAgent(hook) : null;
  const base: EventBase = {
    schemaVersion: NORMALIZED_EVENT_SCHEMA_VERSION,
    provider: 'claude-code',
    sourceEventId: hook.tool_use_id,
    providerSessionId: hook.session_id,
    providerAgentId: agentId,
    occurredAt: null,
    observedAt: receivedAt,
    provenance: 'observed',
    source: {
      channel: 'hook',
      providerVersion: null,
      path: allowedPath(hook, name, context),
      byteOffset: null,
      hookEvent: name,
    },
  };

  switch (name) {
    case 'SessionStart':
      return [
        {
          ...base,
          dedupKey: key,
          eventType: 'session.started',
          payload: { startSource: hook.source, model: hook.model },
        },
      ];
    case 'SessionEnd':
      return [
        { ...base, dedupKey: key, eventType: 'session.ended', payload: { reason: hook.reason } },
      ];
    case 'Stop':
      return [{ ...base, dedupKey: key, eventType: 'session.turn_ended', payload: {} }];
    case 'Notification':
      return [
        {
          ...base,
          dedupKey: key,
          eventType: 'session.attention',
          payload: { notificationType: hook.notification_type },
        },
      ];
    case 'CwdChanged': {
      const to = [hook.new_cwd, hook.cwd].find((c) => c !== null && isAbsolutePathString(c));
      if (to === undefined || to === null) throw new HookPayloadError('CwdChanged has no new cwd');
      const from =
        hook.old_cwd !== null && isAbsolutePathString(hook.old_cwd) ? hook.old_cwd : null;
      return [{ ...base, dedupKey: key, eventType: 'session.cwd_changed', payload: { from, to } }];
    }
    case 'SubagentStart':
      return [
        {
          ...base,
          dedupKey: key,
          eventType: 'subagent.spawned',
          payload: {
            parentProviderSessionId: hook.session_id,
            agentId: requireAgent(hook),
            agentType: hook.agent_type,
            description: null,
            spawnToolUseId: null,
            spawnDepth: null,
            model: null,
          },
        },
      ];
    case 'SubagentStop':
      return [
        {
          ...base,
          dedupKey: key,
          eventType: 'subagent.stopped',
          payload: { agentId: requireAgent(hook), agentType: hook.agent_type },
        },
      ];
  }
}

function requireAgent(hook: HookBody): string {
  if (hook.agent_id === null) throw new HookPayloadError(`${hook.hook_event_name} has no agent_id`);
  return hook.agent_id;
}

/** The real transcript path when the hook's own path is allowlisted and matches its session. */
function allowedPath(hook: HookBody, name: SubscribedHook, context: HookContext): string | null {
  // A subagent path must name the hook's own agent; a session-level path must be the main file.
  const candidates: { file: string | null; agentId: string | null }[] =
    name === 'SubagentStop'
      ? [
          { file: hook.agent_transcript_path, agentId: hook.agent_id },
          { file: hook.transcript_path, agentId: null },
        ]
      : [{ file: hook.transcript_path, agentId: null }];
  for (const { file, agentId } of candidates) {
    if (file === null) continue;
    const real = resolveAllowedTranscriptSync(context.claudeDir, file);
    if (real === null) continue;
    const classified = classifyRelative(path.relative(realProjects(context.claudeDir), real));
    if (classified?.sessionId === hook.session_id && classified.agentId === agentId) return real;
  }
  return null;
}

function realProjects(claudeDir: string): string {
  return realpathSync(path.join(claudeDir, 'projects'));
}

export interface HookSnippetOptions {
  port: number;
  /** Name of the environment variable that holds the hook token in the user's shell. */
  tokenEnvVar: string;
}

export const HOOK_TOKEN_HEADER = 'X-ACP-Hook-Token';

/**
 * The settings snippet the user pastes into their own Claude Code settings (provider-adapters §6;
 * ADR-0005: the app prints it and never writes settings). Returns JSON text only. The token value
 * is never included: the header references the environment variable named by `tokenEnvVar`. The
 * shape was verified with runtime 2.1.296 (2026-10-11 capture): Claude Code POSTed JSON to the url
 * and expanded the `$VAR` header from `allowedEnvVars`. Only {@link SNIPPET_HOOKS} are registered.
 */
export function hookSettingsSnippet(options: HookSnippetOptions): string {
  const { port, tokenEnvVar } = options;
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new RangeError('port must be an integer between 1 and 65535');
  }
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(tokenEnvVar)) {
    throw new RangeError('tokenEnvVar must be a valid environment variable name');
  }
  const entry = [
    {
      hooks: [
        {
          type: 'http',
          url: `http://127.0.0.1:${port}/api/hooks/claude-code`,
          timeout: 2,
          headers: { [HOOK_TOKEN_HEADER]: `$${tokenEnvVar}` },
          allowedEnvVars: [tokenEnvVar],
        },
      ],
    },
  ];
  const hooks = Object.fromEntries(SNIPPET_HOOKS.map((event) => [event, entry]));
  return `${JSON.stringify({ hooks }, null, 2)}\n`;
}
