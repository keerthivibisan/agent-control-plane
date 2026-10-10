import { createHash } from 'node:crypto';
import { open } from 'node:fs/promises';
import { NORMALIZED_EVENT_SCHEMA_VERSION } from '@acp/core';
import type { Checkpoint, CheckpointStore, IngestionBatch, NormalizedEvent } from '@acp/core';
import { z } from 'zod';
import { MAX_META_BYTES } from './allowlist.js';
import { metaRecordKey } from './dedup.js';
import { OPEN_FLAGS } from './discovery.js';
import type { SourceFile } from './discovery.js';
import { HEAD_HASH_BYTES } from './reader.js';
import { cleanFreeText } from './redact.js';

/** Subagent descriptions are redacted and capped like titles (security §2.3). */
export const DESCRIPTION_MAX_LENGTH = 200;

const optString = z.string().min(1).nullable().catch(null);

/**
 * Subagent metadata (provider-adapters §2, §5). Only these five fields are read; verified-local
 * on 2026-10-10 for `agentType`, `description`, `toolUseId`, `spawnDepth` and `model`. Unknown
 * fields (for example worktree info) are ignored.
 */
const MetaSchema = z.looseObject({
  agentType: optString,
  description: optString,
  toolUseId: optString,
  spawnDepth: z.number().int().positive().nullable().catch(null),
  model: optString,
});

export type MetaOutcome =
  | { kind: 'unchanged' }
  | { kind: 'invalid'; reason: 'not-json-object' | 'too-large' }
  | { kind: 'batch'; batch: IngestionBatch };

/**
 * Reads one subagent meta file in full (at most 1 MiB) and turns it into one `subagent.spawned`
 * event on the child's key `(sessionId, agentId)`. The parent is the session whose directory holds
 * the file; for `spawnDepth > 1` core finds the real parent from `spawnToolUseId`.
 *
 * The record key hashes the file bytes, so a rewritten meta file is a new fact and an identical
 * re-read is a duplicate. The checkpoint (identity, size, mtime) avoids re-reading unchanged files.
 */
export async function readMeta(
  src: SourceFile,
  checkpoints: CheckpointStore,
  observedAt: string,
): Promise<MetaOutcome> {
  const agentId = src.agentId;
  if (agentId === null) return { kind: 'invalid', reason: 'not-json-object' };
  const fh = await open(src.path, OPEN_FLAGS);
  try {
    const st = await fh.stat();
    if (st.size > MAX_META_BYTES) return { kind: 'invalid', reason: 'too-large' };
    const fileIdentity = `${st.dev}:${st.ino}`;
    const previous = checkpoints.get(src.path);
    if (
      previous !== undefined &&
      previous.fileIdentity === fileIdentity &&
      previous.sizeBytes === st.size &&
      previous.mtimeMs === st.mtimeMs &&
      previous.byteOffset === st.size
    ) {
      return { kind: 'unchanged' };
    }

    const bytes = Buffer.alloc(st.size);
    const { bytesRead } = st.size > 0 ? await fh.read(bytes, 0, st.size, 0) : { bytesRead: 0 };
    const content = bytes.subarray(0, bytesRead);
    const value = parseObject(content);
    if (value === null) return { kind: 'invalid', reason: 'not-json-object' };

    const meta = MetaSchema.parse(value); // every field has a fallback; this cannot throw
    const event: NormalizedEvent = {
      schemaVersion: NORMALIZED_EVENT_SCHEMA_VERSION,
      provider: 'claude-code',
      dedupKey: `${metaRecordKey(src.sessionId, agentId, content)}#spawned`,
      sourceEventId: null,
      providerSessionId: src.sessionId,
      providerAgentId: agentId,
      occurredAt: null,
      observedAt,
      provenance: 'observed',
      source: {
        channel: 'subagent-meta',
        providerVersion: null,
        path: src.path,
        byteOffset: 0,
        hookEvent: null,
      },
      eventType: 'subagent.spawned',
      payload: {
        parentProviderSessionId: src.sessionId,
        agentId,
        agentType: meta.agentType,
        description:
          meta.description === null
            ? null
            : cleanFreeText(meta.description, DESCRIPTION_MAX_LENGTH),
        spawnToolUseId: meta.toolUseId,
        spawnDepth: meta.spawnDepth,
        model: meta.model,
      },
    };
    const nextCheckpoint: Checkpoint = {
      sourcePath: src.path,
      fileIdentity,
      sizeBytes: st.size,
      mtimeMs: st.mtimeMs,
      byteOffset: content.length,
      headHash: createHash('sha256').update(content.subarray(0, HEAD_HASH_BYTES)).digest('hex'),
      parseErrors: 0,
    };
    return { kind: 'batch', batch: { sourcePath: src.path, events: [event], nextCheckpoint } };
  } finally {
    await fh.close();
  }
}

function parseObject(content: Buffer): object | null {
  try {
    const value: unknown = JSON.parse(content.toString('utf8'));
    return typeof value === 'object' && value !== null && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}
