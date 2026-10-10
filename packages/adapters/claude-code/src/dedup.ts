import { createHash } from 'node:crypto';

/**
 * Record keys (docs/usage-accounting.md §3). Each event appends a suffix to its record key
 * (`#session`, `#assistant`, `#usage`, `#tool:{id}`, …). Keys never contain byte offsets or
 * ingestion times, so re-reading a moved, rewritten, or re-delivered record yields the same key.
 */
export function sha256Hex(data: string | Buffer): string {
  return createHash('sha256').update(data).digest('hex');
}

/** `cc:tx:{sessionId}:{agentId|main}:{uuid}`, or `…:h:{sha256(line bytes)}` without a uuid. */
export function transcriptRecordKey(
  sessionId: string,
  agentId: string | null,
  uuid: string | null,
  lineBytes: Buffer,
): string {
  const scope = `cc:tx:${sessionId}:${agentId ?? 'main'}`;
  return uuid !== null ? `${scope}:${uuid}` : `${scope}:h:${sha256Hex(lineBytes)}`;
}

/** `cc:meta:{sessionId}:{agentId}:h:{sha256(file bytes)}`: a changed meta file gets a new key. */
export function metaRecordKey(sessionId: string, agentId: string, fileBytes: Buffer): string {
  return `cc:meta:${sessionId}:${agentId}:h:${sha256Hex(fileBytes)}`;
}

/** `cc:hook:{session_id}:{hook_event_name}:{tool_use_id or sha256(canonical JSON payload)}`. */
export function hookRecordKey(
  sessionId: string,
  hookEventName: string,
  toolUseId: string | null,
  body: unknown,
): string {
  const discriminator = toolUseId ?? sha256Hex(canonicalJson(body));
  return `cc:hook:${sessionId}:${hookEventName}:${discriminator}`;
}

/** JSON with object keys sorted recursively, so equal payloads hash equally. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([k, v]) => [k, sortKeys(v)]),
    );
  }
  return value;
}
