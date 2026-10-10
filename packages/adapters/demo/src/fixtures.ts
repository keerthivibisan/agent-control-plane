import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { EVENT_TYPES } from '@acp/core';
import type { EventType } from '@acp/core';

/** Thrown when a demo fixture file does not match the documented shape (see fixtures/README.md). */
export class DemoFixtureError extends Error {
  override readonly name = 'DemoFixtureError';
}

/** One fixture record: an event type, its payload, and a time offset from the demo base time. */
export interface DemoRecord {
  id: string;
  /** Seconds after the demo base time. Non-decreasing within a source. */
  t: number;
  eventType: EventType;
  payload: unknown;
}

/** One fixture file: the demo stand-in for a transcript file. */
export interface DemoSource {
  /** Stable source name; `demo://<source>` is the checkpoint `sourcePath`. */
  source: string;
  providerSessionId: string;
  providerAgentId: string | null;
  /** Working directory used for registered-root matching, like a transcript's first `cwd`. */
  cwd: string;
  records: DemoRecord[];
  /** sha256 of the fixture file bytes; a changed fixture resets its checkpoint. */
  contentHash: string;
}

/** `fixtures/` next to `src/` and `dist/`, so the path works from source and from the build. */
export const DEFAULT_FIXTURES_DIR = fileURLToPath(new URL('../fixtures/', import.meta.url));

const eventTypes = new Set<string>(EVENT_TYPES);

export async function loadDemoSources(dir: string): Promise<DemoSource[]> {
  const names = (await readdir(dir)).filter((n) => n.endsWith('.json')).sort();
  const sources: DemoSource[] = [];
  for (const name of names) {
    const bytes = await readFile(path.join(dir, name));
    const contentHash = createHash('sha256').update(bytes).digest('hex');
    sources.push(parseSource(name, JSON.parse(bytes.toString('utf8')) as unknown, contentHash));
  }
  const seen = new Set<string>();
  for (const s of sources) {
    if (seen.has(s.source)) throw new DemoFixtureError(`duplicate demo source "${s.source}"`);
    seen.add(s.source);
  }
  return sources;
}

function parseSource(file: string, raw: unknown, contentHash: string): DemoSource {
  const fail = (msg: string): never => {
    throw new DemoFixtureError(`${file}: ${msg}`);
  };
  if (!isRecord(raw)) return fail('not an object');
  const { source, providerSessionId, providerAgentId, cwd, records } = raw;
  if (!isNonEmpty(source)) return fail('missing source');
  if (!isNonEmpty(providerSessionId)) return fail('missing providerSessionId');
  if (providerAgentId !== null && !isNonEmpty(providerAgentId)) {
    return fail('providerAgentId must be a string or null');
  }
  if (!isNonEmpty(cwd) || !cwd.startsWith('/')) return fail('cwd must be an absolute path');
  if (!Array.isArray(records)) return fail('records must be an array');

  const ids = new Set<string>();
  let lastT = -Infinity;
  const parsed = records.map((r: unknown, i): DemoRecord => {
    if (!isRecord(r)) return fail(`record ${i} is not an object`);
    const { id, t, eventType, payload } = r;
    if (!isNonEmpty(id) || ids.has(id)) return fail(`record ${i} needs a unique id`);
    ids.add(id);
    if (typeof t !== 'number' || !Number.isFinite(t) || t < lastT) {
      return fail(`record ${id}: t must be a non-decreasing number`);
    }
    lastT = t;
    if (!isEventType(eventType)) return fail(`record ${id}: unknown eventType`);
    return { id, t, eventType, payload };
  });
  return { source, providerSessionId, providerAgentId, cwd, records: parsed, contentHash };
}

function isEventType(v: unknown): v is EventType {
  return typeof v === 'string' && eventTypes.has(v);
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isNonEmpty(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0;
}
