import { createHash } from 'node:crypto';
import { cpSync, readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createClaudeCodeAdapter } from '@acp/adapter-claude-code';
import {
  FIXTURES,
  NOW,
  copyScenario,
  ingestUntilIdle,
  openLiveStack,
  runReference,
  snapshotState,
  tempDir,
} from './helpers.js';

/*
 * P1-F acceptance checks (implementation-plan "Phase 1 acceptance checklist") that the F1/F3 suites
 * do not already cover, over the live-mode stack and synthetic fixtures only.
 */

const SID = 'c0ffee00-0000-4000-8000-000000000001';

function edgeRows(stack: ReturnType<typeof openLiveStack>) {
  return stack.db.connection
    .prepare(
      `SELECT e.kind, e.evidence, p.provider_agent_id AS parentAgent, ch.provider_agent_id AS childAgent
       FROM session_edges e
       JOIN sessions p ON p.id = e.parent_session_id
       JOIN sessions ch ON ch.id = e.child_session_id`,
    )
    .all() as { kind: string; evidence: string; parentAgent: string; childAgent: string }[];
}

/** sha256 and mtime of every file under `dir`, keyed by relative path. */
function fingerprint(dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (d: string) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else {
        const hash = createHash('sha256').update(readFileSync(p)).digest('hex');
        out[relative(dir, p)] = `${hash}:${statSync(p).mtimeMs}`;
      }
    }
  };
  walk(dir);
  return out;
}

describe('relationships', () => {
  it('meta creates a subagent edge (scenario 03)', async () => {
    const stack = openLiveStack(join(tempDir(), 'acp.sqlite'));
    await ingestUntilIdle(stack, copyScenario('03-subagent-with-meta'));
    const edges = edgeRows(stack);
    expect(edges).toHaveLength(1);
    expect(edges[0]?.kind).toBe('subagent');
    expect(edges[0]?.parentAgent).toBe('');
    expect(edges[0]?.childAgent).toBe('afake0301');
    expect(JSON.parse(edges[0]?.evidence ?? '[]')).toContain('subagent-metadata');
  });

  it('missing meta creates no guessed edge; the subagent session still exists (scenario 04)', async () => {
    const stack = openLiveStack(join(tempDir(), 'acp.sqlite'));
    await ingestUntilIdle(stack, copyScenario('04-subagent-without-meta'));
    expect(edgeRows(stack)).toEqual([]);
    const sessions = stack.queries.listSessions({}, { limit: 50 }).items;
    expect(sessions.map((s) => s.providerAgentId).sort()).toEqual(['afake0401', null]);
  });
});

describe('hook and transcript channels do not double-count', () => {
  it('ingesting every hook fixture after the transcript changes no usage', async () => {
    const claudeDir = copyScenario('01-streaming-duplicates');
    const stack = openLiveStack(join(tempDir(), 'acp.sqlite'));
    await ingestUntilIdle(stack, claudeDir);
    const before = snapshotState(stack);

    const adapter = createClaudeCodeAdapter({ claudeDir, now: () => NOW });
    const hooksDir = join(FIXTURES, '13-hooks', 'hooks');
    let hookEvents = 0;
    for (const name of readdirSync(hooksDir).sort()) {
      const body: unknown = JSON.parse(readFileSync(join(hooksDir, name), 'utf8'));
      const events = adapter.normalizeHook(body, NOW.toISOString());
      expect(events.every((e) => e.eventType !== 'usage.reported')).toBe(true);
      hookEvents += stack.pipeline.ingestEvents(events).inserted;
    }
    expect(hookEvents).toBeGreaterThan(0);

    const after = snapshotState(stack);
    expect(after.counts.events).toBe(before.counts.events + hookEvents);
    expect(after.counts.observations).toBe(before.counts.observations);
    expect(after.counts.records).toBe(before.counts.records);
    expect(after.sessions).toEqual(before.sessions);
    expect(after.sessions).toEqual(runReference(claudeDir).sessions);
  });
});

describe('security', () => {
  it('credential, settings, history and set-aside files are never ingested (scenario 14)', async () => {
    const claudeDir = tempDir('acp-verify-claude-');
    cpSync(join(FIXTURES, '14-denied-files'), claudeDir, { recursive: true });
    const stack = openLiveStack(join(tempDir(), 'acp.sqlite'));
    await ingestUntilIdle(stack, claudeDir);

    const sessions = stack.queries.listSessions({}, { limit: 50 }).items;
    expect(sessions.map((s) => [s.providerSessionId, s.providerAgentId])).toEqual([[SID, null]]);
    const paths = (
      stack.db.connection.prepare('SELECT DISTINCT source_path FROM events').all() as {
        source_path: string | null;
      }[]
    ).map((r) => r.source_path);
    expect(paths).toEqual([
      join(realpathSync(claudeDir), 'projects', '-home-user-project', `${SID}.jsonl`),
    ]);
    const checkpointPaths = stack.repos.checkpoints
      .list()
      .map((c) => relative(realpathSync(claudeDir), c.sourcePath));
    expect(checkpointPaths).toEqual([join('projects', '-home-user-project', `${SID}.jsonl`)]);
  });

  it('ingestion never modifies any file in the Claude data root, settings included', async () => {
    const claudeDir = tempDir('acp-verify-claude-');
    cpSync(join(FIXTURES, '14-denied-files'), claudeDir, { recursive: true });
    cpSync(join(FIXTURES, '03-subagent-with-meta', 'projects'), join(claudeDir, 'projects'), {
      recursive: true,
    });
    const before = fingerprint(claudeDir);
    expect(Object.keys(before)).toContain('settings.json');
    const stack = openLiveStack(join(tempDir(), 'acp.sqlite'));
    await ingestUntilIdle(stack, claudeDir);
    stack.db.connection.prepare('DELETE FROM ingestion_checkpoints').run();
    await ingestUntilIdle(stack, claudeDir);
    expect(fingerprint(claudeDir)).toEqual(before);
  });
});
