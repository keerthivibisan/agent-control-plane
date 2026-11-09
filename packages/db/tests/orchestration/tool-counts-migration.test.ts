// Synthetic data only (CM-2, migration 0015): tool-call counts on agent runs.
import { copyFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  createOrchestrationRepositories,
  createRepositories,
  DEFAULT_MIGRATIONS_DIR,
  loadMigrations,
  openDatabase,
} from '../../src/index.js';
import { tempDir, thrown } from '../helpers.js';

const COUNTS = { read: 1, search: 0, edit: 0, shell: 0, code_map: 2, other: 0 };

describe('migration 0015 (CM-2)', () => {
  it('ships as 0015_agent_tool_counts and upgrades a 0014 database in place', () => {
    expect(loadMigrations(DEFAULT_MIGRATIONS_DIR).find((m) => m.version === 15)).toMatchObject({
      name: 'agent_tool_counts',
    });
    const dir = join(tempDir(), 'upto-14');
    mkdirSync(dir);
    for (const m of loadMigrations(DEFAULT_MIGRATIONS_DIR).filter((m) => m.version <= 14)) {
      const name = `${String(m.version).padStart(4, '0')}_${m.name}.sql`;
      copyFileSync(join(DEFAULT_MIGRATIONS_DIR, name), join(dir, name));
    }
    const path = join(tempDir(), 'old.sqlite');
    const old = openDatabase(path, { migrationsDir: dir });
    const projectId = createRepositories(old).projects.insert({ name: 'p', rootPath: '/p' }).id;
    const orchOld = createOrchestrationRepositories(old);
    const run = orchOld.runs.insert({
      projectId,
      title: 'Synthetic run',
      budget: { maxTokensPerAgent: 1000, softCostUsdPerRun: null },
    });
    const lead = orchOld.agentRuns.insert({
      runId: run.id,
      kind: 'lead',
      parentAgentRunId: null,
      role: 'Lead',
      task: null,
    });
    // Before 0015: no counts, and storing them is refused rather than lost.
    expect(lead.toolCounts).toBeNull();
    expect(thrown(() => orchOld.agentRuns.setToolCounts(lead.id, COUNTS))).toMatchObject({
      code: 'invalid_input',
    });
    old.close();
    const migrated = openDatabase(path);
    try {
      const orch = createOrchestrationRepositories(migrated);
      expect(orch.agentRuns.getById(lead.id)?.toolCounts).toBeNull();
      expect(orch.agentRuns.setToolCounts(lead.id, COUNTS)?.toolCounts).toEqual(COUNTS);
    } finally {
      migrated.close();
    }
  });
});
