import type { SessionKey } from './session.js';

/**
 * Canonical string form of a SessionKey, for map keys and deterministic tie-breaks
 * (docs/usage-accounting.md §5). JSON array encoding is used because provider ids are arbitrary
 * strings: any separator character could appear inside an id and make two keys collide.
 */
export function sessionKeyToString(key: SessionKey): string {
  return JSON.stringify([key.provider, key.providerSessionId, key.providerAgentId]);
}

export function sessionKeysEqual(a: SessionKey, b: SessionKey): boolean {
  return (
    a.provider === b.provider &&
    a.providerSessionId === b.providerSessionId &&
    a.providerAgentId === b.providerAgentId
  );
}
