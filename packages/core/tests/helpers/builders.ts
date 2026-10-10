import type { SessionKey, TokenCounts, UsageObservation } from '../../src/index.js';

/** Synthetic test data only: ids and timestamps below are invented. */

export function key(providerSessionId: string, providerAgentId: string | null = null): SessionKey {
  return { provider: 'claude-code', providerSessionId, providerAgentId };
}

export function tokens(
  output: number | null,
  rest: Partial<Omit<TokenCounts, 'output'>> = {},
): TokenCounts {
  return { input: 3, cacheCreation: 500, cacheRead: 20_000, ...rest, output };
}

export function at(second: number): string {
  return new Date(Date.UTC(2026, 9, 10, 8, 0, second)).toISOString();
}

export function obs(overrides: Partial<UsageObservation> & { eventId: number }): UsageObservation {
  return {
    messageId: 'msg_1',
    session: key('sess-a'),
    occurredAt: at(0),
    requestId: 'req_1',
    model: 'model-a',
    tokens: tokens(10),
    ...overrides,
  };
}
