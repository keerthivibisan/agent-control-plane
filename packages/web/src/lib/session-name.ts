import type { SessionSummaryDto } from '@acp/core/api';
import { helperAgentLabel, OVERVIEW_COPY, SESSION_NAME_COPY } from './copy';
import { idPrefix } from './format';

/**
 * Which rule named a session (ADR-0024 §2), in the order they apply:
 * - `managed`: Agent Control Plane started it; named after the ticket and the agent's label;
 * - `titled`: Claude Code gave it a title;
 * - `helper`: a helper agent, named after its type (its task as the detail);
 * - `fallback`: none of these; named after its branch and when it started.
 */
export type SessionNameKind = 'managed' | 'titled' | 'helper' | 'fallback';

export interface SessionName {
  kind: SessionNameKind;
  /** What to call the session. Never blank, never "Untitled". */
  name: string;
  /** A quieter second line: a helper agent's task (its description), when Claude Code gave one. */
  detail: string | null;
  /** The managed run when Agent Control Plane started the session, for its marker and link. */
  managed: NonNullable<SessionSummaryDto['managed']> | null;
}

/** The fields a session is named from. `managed` is absent from servers before 0.3.0. */
export type NameableSession = Pick<
  SessionSummaryDto,
  'title' | 'agentType' | 'providerAgentId' | 'description' | 'gitBranch' | 'firstSeenAt'
> & { managed?: SessionSummaryDto['managed'] };

const startFormat = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
});

/** When a session started, in local time and without seconds: "Oct 21, 9:00 AM". */
export function formatSessionStart(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : startFormat.format(d);
}

/** Blank or missing text is no text: a title of spaces must not hide the next rule. */
function text(value: string | null | undefined): string | null {
  const t = value?.trim() ?? '';
  return t.length > 0 ? t : null;
}

/**
 * What to call a session, everywhere the app lists or draws one. The rules apply in order, and the
 * first that has data wins (ADR-0024 §2):
 * 1. started by Agent Control Plane: `WEB-12 · Frontend helper`, or the label alone without a ticket;
 * 2. Claude Code's title;
 * 3. a helper agent (it has an agent type or an agent id): `Helper agent: Explore`; a helper's
 *    task (its description) is the detail, under a title too;
 * 4. otherwise its branch and start: `Session on main · Oct 21, 9:00 AM`, or `Session started …`.
 *
 * Pure: the start time's format is injected so tests don't depend on the time zone.
 */
export function nameSession(
  s: NameableSession,
  formatStart: (iso: string) => string = formatSessionStart,
): SessionName {
  const managed = s.managed ?? null;
  if (managed !== null) {
    const label = text(managed.label) ?? managed.kind;
    const key = text(managed.ticketKey);
    return { kind: 'managed', name: key ? `${key} · ${label}` : label, detail: null, managed };
  }
  const helper = s.providerAgentId !== null || text(s.agentType) !== null;
  // A helper agent's task stays its second line, also when Claude Code titled it.
  const detail = helper ? text(s.description) : null;
  const title = text(s.title);
  if (title !== null) return { kind: 'titled', name: title, detail, managed: null };
  if (helper) {
    return { kind: 'helper', name: helperAgentLabel(text(s.agentType)), detail, managed: null };
  }
  const branch = text(s.gitBranch);
  const started = formatStart(s.firstSeenAt);
  return {
    kind: 'fallback',
    name: branch ? SESSION_NAME_COPY.onBranch(branch, started) : SESSION_NAME_COPY.started(started),
    detail: null,
    managed: null,
  };
}

/** Just the name, for places that have room for one line (labels, options, tooltips). */
export function sessionName(s: NameableSession): string {
  return nameSession(s).name;
}

/**
 * For lists that know only a session's id and title (the Tokens page, the cost list): the title,
 * else the session's short id ("Session 1a2b3c4d"). Never "Untitled".
 */
export function sessionNameFromTitle(sessionId: string, title: string | null): string {
  return text(title) ?? OVERVIEW_COPY.sessionById(idPrefix(sessionId));
}
