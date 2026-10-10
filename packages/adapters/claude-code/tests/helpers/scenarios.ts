import { cp, mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
  Checkpoint,
  CheckpointStore,
  IngestionBatch,
  NormalizedEvent,
  RegisteredRoot,
} from '@acp/core';
import { expect } from 'vitest';
import { makeTempDir } from './temp-claude-dir.js';

/** Synthetic fixture scenarios (test-fixtures/claude-code/README.md). */
export const FIXTURES_DIR = fileURLToPath(
  new URL('../../../../../test-fixtures/claude-code/', import.meta.url),
);

export const ROOTS: RegisteredRoot[] = [{ projectId: 'project', rootPath: '/home/user/project' }];
export const FIXED_NOW = (): Date => new Date('2026-10-10T12:00:00.000Z');

/** In-memory stand-in for the pipeline: commits each batch's checkpoint after consuming it. */
export class MemoryStore implements CheckpointStore {
  readonly map = new Map<string, Checkpoint>();
  get(sourcePath: string): Checkpoint | undefined {
    return this.map.get(sourcePath);
  }
}

export interface Pollable {
  poll(
    roots: readonly RegisteredRoot[],
    checkpoints: CheckpointStore,
  ): AsyncIterable<IngestionBatch>;
}

export async function drain(
  adapter: Pollable,
  store = new MemoryStore(),
  roots: readonly RegisteredRoot[] = ROOTS,
): Promise<{ batches: IngestionBatch[]; events: NormalizedEvent[]; store: MemoryStore }> {
  const batches: IngestionBatch[] = [];
  for await (const batch of adapter.poll(roots, store)) {
    batches.push(batch);
    store.map.set(batch.sourcePath, batch.nextCheckpoint);
  }
  return { batches, events: batches.flatMap((b) => b.events), store };
}

/** Copies a scenario into a temp dir so tests may modify it. Returns the realpath of the copy. */
export async function copyScenario(name: string, sub = ''): Promise<string> {
  const dir = await makeTempDir();
  await cp(path.join(FIXTURES_DIR, name, sub), dir, { recursive: true });
  return dir;
}

export async function scenarioRoot(name: string): Promise<string> {
  return realpath(path.join(FIXTURES_DIR, name));
}

/** Replaces the machine-specific scenario root in source paths with `<root>`. */
export function portable(events: NormalizedEvent[], root: string): NormalizedEvent[] {
  return events.map((e) => ({
    ...e,
    source: {
      ...e.source,
      path: e.source.path === null ? null : e.source.path.replace(root, '<root>'),
    },
  }));
}

/**
 * Compares events with `<scenario>/expected/<file>`. With `UPDATE_GOLDEN=1` the file is rewritten
 * instead; review the diff before committing.
 */
export async function expectGolden(
  scenario: string,
  events: NormalizedEvent[],
  file = 'events.json',
): Promise<void> {
  const target = path.join(FIXTURES_DIR, scenario, 'expected', file);
  if (process.env.UPDATE_GOLDEN === '1') {
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, `${JSON.stringify(events, null, 2)}\n`);
    return;
  }
  const expected = JSON.parse(await readFile(target, 'utf8')) as unknown;
  expect(events).toEqual(expected);
}
