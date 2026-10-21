import type { SessionSummaryDto, UsageTotalsDto } from '@acp/core/api';
import { Badge } from '../../components/Pill';
import { TokenValue } from '../../components/TokenValue';
import { NOT_REPORTED, SESSION_NAME_COPY, tokenType } from '../../lib/copy';
import type { SessionName } from '../../lib/session-name';
import type { TokenCategory } from '../../lib/tokens';

/** A helper agent is a session Claude Code ran as a sub-agent (it has an agent id). */
export function isHelperAgent(s: Pick<SessionSummaryDto, 'providerAgentId'>): boolean {
  return s.providerAgentId !== null;
}

/**
 * The quiet "Started by Agent Control Plane" tag on a session the app started (ADR-0024). Its
 * title says what that means; there is no link here, since most places it sits are inside a link.
 */
export function StartedByApp() {
  return (
    <Badge testId="started-by-app" title={SESSION_NAME_COPY.startedByAppTip}>
      {SESSION_NAME_COPY.startedByApp}
    </Badge>
  );
}

/**
 * What goes under a session's name, when anything does: the marker for a session the app started,
 * or a helper agent's task. Empty for the other names.
 */
export function SessionNameExtra({
  naming,
  inline = false,
}: {
  naming: SessionName;
  /** In a row next to other text (the graph's id line), instead of a line of its own. */
  inline?: boolean;
}) {
  if (naming.managed !== null) {
    return (
      <span className={inline ? 'inline-flex min-w-0' : 'mt-0.5 flex'}>
        <StartedByApp />
      </span>
    );
  }
  if (naming.detail === null) return null;
  return (
    <span
      className={`${inline ? 'min-w-0' : 'mt-0.5 block max-w-80'} truncate text-caption text-dim`}
      title={naming.detail}
      data-testid="session-detail-text"
    >
      {naming.detail}
    </span>
  );
}

/**
 * Compact token line: "1.2K input tokens · 3.4K output tokens", with the cache types on a quieter
 * second line. Each type keeps its own unit and is never added to another; a missing type reads
 * "Not reported".
 */
export function TokenSummary({
  usage,
  withCache = true,
  compact = true,
}: {
  usage: UsageTotalsDto;
  withCache?: boolean;
  /** False for exact numbers ("1,240 input tokens"), where there is room for them. */
  compact?: boolean;
}) {
  const t = usage.tokens;
  return (
    <span className="inline-flex flex-col gap-0.5 text-left">
      <span>
        <Part value={t.input} type="input" compact={compact} />
        <span className="text-dim"> · </span>
        <Part value={t.output} type="output" compact={compact} />
      </span>
      {withCache ? (
        <span className="text-caption text-dim">
          <Part value={t.cacheCreation} type="cacheCreation" compact={compact} />
          {' · '}
          <Part value={t.cacheRead} type="cacheRead" compact={compact} />
        </span>
      ) : null}
    </span>
  );
}

/** One token type with its unit; a missing one names its type: "Cache write tokens: Not reported". */
function Part({
  value,
  type,
  compact,
}: {
  value: number | null;
  type: TokenCategory;
  compact: boolean;
}) {
  if (value === null) {
    return (
      <span className="whitespace-nowrap text-unavailable" data-state="unavailable">
        {tokenType(type).label}: {NOT_REPORTED}
      </span>
    );
  }
  return (
    <span className="whitespace-nowrap">
      <TokenValue value={value} type={type} compact={compact} />
    </span>
  );
}
