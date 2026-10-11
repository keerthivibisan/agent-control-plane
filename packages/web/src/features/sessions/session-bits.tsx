import type { SessionSummaryDto, UsageTotalsDto } from '@acp/core/api';
import { TokenValue } from '../../components/TokenValue';
import { helperAgentLabel, NOT_REPORTED, tokenType, UNTITLED_SESSION } from '../../lib/copy';
import type { TokenCategory } from '../../lib/tokens';

/** A helper agent is a session Claude Code ran as a sub-agent (it has an agent id). */
export function isHelperAgent(s: Pick<SessionSummaryDto, 'providerAgentId'>): boolean {
  return s.providerAgentId !== null;
}

/** "Fix login", "Helper agent: Explore" or "Untitled session". Never blank. */
export function sessionName(
  s: Pick<SessionSummaryDto, 'title' | 'agentType' | 'providerAgentId'>,
): string {
  if (isHelperAgent(s)) return helperAgentLabel(s.agentType);
  return s.title ?? UNTITLED_SESSION;
}

/**
 * Compact token line: "1.2K input tokens · 3.4K output tokens", with the cache types on a quieter
 * second line. Each type keeps its own unit and is never added to another; a missing type reads
 * "Not reported".
 */
export function TokenSummary({
  usage,
  withCache = true,
}: {
  usage: UsageTotalsDto;
  withCache?: boolean;
}) {
  const t = usage.tokens;
  return (
    <span className="inline-flex flex-col gap-0.5 text-left">
      <span className="whitespace-nowrap">
        <Part value={t.input} type="input" />
        <span className="text-dim"> · </span>
        <Part value={t.output} type="output" />
      </span>
      {withCache ? (
        <span className="text-caption whitespace-nowrap text-dim">
          <Part value={t.cacheCreation} type="cacheCreation" />
          {' · '}
          <Part value={t.cacheRead} type="cacheRead" />
        </span>
      ) : null}
    </span>
  );
}

/** One token type with its unit; a missing one names its type: "Cache write tokens: Not reported". */
function Part({ value, type }: { value: number | null; type: TokenCategory }) {
  if (value === null) {
    return (
      <span className="text-unavailable" data-state="unavailable">
        {tokenType(type).label}: {NOT_REPORTED}
      </span>
    );
  }
  return <TokenValue value={value} type={type} compact />;
}
