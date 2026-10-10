import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { generatedClaudeDir } from './generated.js';
import {
  copyScenario,
  ingestOnce,
  ingestUntilIdle,
  openLiveStack,
  runReference,
  SCENARIOS,
  snapshotState,
  tempDir,
} from './helpers.js';

/*
 * P1-F task F3 (usage-accounting §7 scenarios 7 and 8; acceptance "Re-ingestion leaves totals
 * unchanged", "A restart creates no duplicates", "Edges are stable across re-ingestion"). Every run
 * uses the real live-mode stack over copies of synthetic fixtures in temp directories.
 */

const SOURCES: { name: string; dir: () => string }[] = [
  ...SCENARIOS.map((s) => ({ name: s, dir: () => copyScenario(s) })),
  { name: 'generated (synthetic, mixed rules)', dir: generatedClaudeDir },
];

describe('F3: deleting every checkpoint and re-running changes nothing', () => {
  it.each(SOURCES)('$name', async ({ dir }) => {
    const claudeDir = dir();
    const stack = openLiveStack(join(tempDir(), 'acp.sqlite'));
    await ingestUntilIdle(stack, claudeDir);
    const before = snapshotState(stack);

    const deleted = stack.db.connection.prepare('DELETE FROM ingestion_checkpoints').run().changes;
    expect(stack.repos.checkpoints.list()).toEqual([]);
    const batches = await ingestUntilIdle(stack, claudeDir);

    expect(snapshotState(stack)).toEqual(before);
    expect(before.duplicateDedupKeys).toBe(0);
    // A file with checkpoints was really re-read, not skipped.
    if (deleted > 0) expect(batches).toBeGreaterThan(0);
  });

  it('the generated data root re-reads every file and still matches the reference', async () => {
    const claudeDir = generatedClaudeDir();
    const stack = openLiveStack(join(tempDir(), 'acp.sqlite'));
    await ingestUntilIdle(stack, claudeDir);
    stack.db.connection.prepare('DELETE FROM ingestion_checkpoints').run();
    expect(await ingestUntilIdle(stack, claudeDir)).toBeGreaterThan(0);
    expect(snapshotState(stack).sessions).toEqual(runReference(claudeDir).sessions);
  });
});

describe('F3: a restart mid-ingest creates no duplicates and reaches the same totals', () => {
  it.each(SOURCES)('$name', async ({ dir }) => {
    const claudeDir = dir();

    // Reference run: one uninterrupted ingest with default chunks into its own database.
    const oneShot = openLiveStack(join(tempDir(), 'acp.sqlite'));
    await ingestUntilIdle(oneShot, claudeDir);
    const expected = snapshotState(oneShot);
    oneShot.close();

    // Interrupted run: tiny chunks, stop after the first committed batch, close the database
    // (the process "dies"), reopen it with a fresh adapter, and continue until idle.
    const dbPath = join(tempDir(), 'acp.sqlite');
    const first = openLiveStack(dbPath);
    const firstBatches = await ingestOnce(first, claudeDir, { chunkBytes: 200, stopAfter: 1 });
    const partial = snapshotState(first);
    first.close();

    const second = openLiveStack(dbPath);
    await ingestUntilIdle(second, claudeDir, { chunkBytes: 200 });
    const after = snapshotState(second);

    expect(after).toEqual(expected);
    expect(after.duplicateDedupKeys).toBe(0);
    // Nothing committed before the restart was lost or duplicated.
    for (const key of partial.dedupKeys) expect(after.dedupKeys).toContain(key);
    if (firstBatches > 0) expect(partial.counts.events).toBeLessThanOrEqual(after.counts.events);
  });

  it('stopping after every single batch (one restart per batch) still converges', async () => {
    const claudeDir = generatedClaudeDir();
    const expectedStack = openLiveStack(join(tempDir(), 'acp.sqlite'));
    await ingestUntilIdle(expectedStack, claudeDir);
    const expected = snapshotState(expectedStack);

    const dbPath = join(tempDir(), 'acp.sqlite');
    let restarts = 0;
    for (; restarts < 500; restarts++) {
      const stack = openLiveStack(dbPath);
      const n = await ingestOnce(stack, claudeDir, { chunkBytes: 128, stopAfter: 1 });
      stack.close();
      if (n === 0) break;
    }
    // Small chunks give many batches, so this really restarted many times.
    expect(restarts).toBeGreaterThan(5);
    const final = openLiveStack(dbPath);
    expect(snapshotState(final)).toEqual(expected);
  });
});
