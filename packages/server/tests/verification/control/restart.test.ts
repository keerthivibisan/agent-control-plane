import { existsSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ErrorDtoSchema, ReviewDtoSchema, RunDetailDtoSchema } from '@acp/core/api';
import { silentLogger } from '../../../src/logger.js';
import { createFakeManagedAdapter } from '../../control/fake-adapter.js';
import {
  boot,
  makeRepo,
  makeTempDir,
  registerProject,
  showFile,
  waitFor,
  waitForRun,
} from './harness.js';

/*
 * P3-F: restart mid-run through the whole server composition (`startServer`), not just the run
 * service (P3-D's tests/control/restart.test.ts covers the service after a crash). The first server
 * shuts down cleanly while two workers work, one of them waiting on an approval; a second server on
 * the same data dir must mark the run NEEDS_REVIEW, relaunch nothing, keep both worktrees, and let
 * the owner review: merge one, discard the other, run COMPLETED. Live mode (demo mode rebuilds its
 * database on every start) with an empty temp Claude dir; the managed adapter is the scripted fake.
 */

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
const temp = (prefix: string) => {
  const d = makeTempDir(prefix);
  dirs.push(d);
  return d;
};

describe('P3-F restart mid-run (ADR-0013 §7)', () => {
  it('live run → NEEDS_REVIEW after a restart; nothing relaunched; review, merge and discard still work', async () => {
    const dataDir = temp('acp-p3f-data-');
    const claudeDir = temp('acp-p3f-claude-');
    const repo = makeRepo();
    dirs.push(repo);

    const fake1 = createFakeManagedAdapter();
    const first = await boot({
      mode: 'live',
      dataDir,
      claudeDir,
      adapter: fake1.adapter,
      logger: silentLogger,
    });
    let firstClosed = false;
    try {
      const project = await registerProject(first, 'app', repo);
      const created = await first.post('/api/runs', { projectId: project.id });
      expect(created.status).toBe(201);
      const runId = RunDetailDtoSchema.parse(created.body).id;
      expect(
        (await first.post(`/api/runs/${runId}/chat`, { text: 'Spin up two agents' })).status,
      ).toBe(200);
      const lead = await waitFor(
        () => fake1.agents.find((a) => a.spec.kind === 'lead'),
        'the lead',
      );
      lead.started();
      await waitForRun(first, runId, (r) => r.status === 'RUNNING', 'the lead running');
      await lead.callLead('start_agent', { role: 'Builder', task: 'Add a greeting' });
      await lead.callLead('start_agent', { role: 'Writer', task: 'Write notes' });
      await waitFor(() => (fake1.workers().length === 2 ? true : undefined), 'two workers');
      // Workers start once their worktree exists, in either order: match them by role.
      const byRole = async (role: string) => {
        const run = RunDetailDtoSchema.parse((await first.get(`/api/runs/${runId}`)).body);
        const agent = run.agents.find((a) => a.role === role);
        if (agent === undefined) throw new Error(`no ${role}`);
        return fake1.byId(agent.id);
      };
      const builder = await byRole('Builder');
      const writer = await byRole('Writer');
      builder.started();
      writer.started();
      await waitForRun(
        first,
        runId,
        (r) => r.agents.filter((a) => a.status === 'RUNNING').length === 3,
        'both workers running',
      );
      writeFileSync(join(builder.spec.cwd, 'greeting.txt'), 'hello from the builder\n');
      writeFileSync(join(writer.spec.cwd, 'notes.txt'), 'notes from the writer\n');
      void builder.ask('Edit', 'Edit greeting.txt');
      await waitForRun(
        first,
        runId,
        (r) => r.approvals.some((a) => a.status === 'pending'),
        'a pending approval',
      );

      await first.server.close();
      firstClosed = true;

      const fake2 = createFakeManagedAdapter();
      const second = await boot({
        mode: 'live',
        dataDir,
        claudeDir,
        adapter: fake2.adapter,
        logger: silentLogger,
      });
      try {
        let run = RunDetailDtoSchema.parse((await second.get(`/api/runs/${runId}`)).body);
        expect(run.status).toBe('NEEDS_REVIEW');
        expect(run.agents.map((a) => [a.kind, a.status])).toEqual([
          ['lead', 'NEEDS_REVIEW'],
          ['worker', 'NEEDS_REVIEW'],
          ['worker', 'NEEDS_REVIEW'],
        ]);
        expect(run.approvals.map((a) => a.status)).toEqual(['expired']);
        // Never relaunched: the new process started no agent at all.
        expect(fake2.agents).toEqual([]);
        expect(existsSync(builder.spec.cwd)).toBe(true);
        expect(existsSync(writer.spec.cwd)).toBe(true);

        const chat = await second.post(`/api/runs/${runId}/chat`, { text: 'hello?' });
        expect(chat.status).toBe(409);
        expect(ErrorDtoSchema.parse(chat.body).error.code).toBe('run_not_active');

        const review = ReviewDtoSchema.parse((await second.get(`/api/runs/${runId}/review`)).body);
        expect(review.agents.map((a) => [a.role, a.files.map((f) => f.path)])).toEqual([
          ['Builder', ['greeting.txt']],
          ['Writer', ['notes.txt']],
        ]);
        expect(review.agents[0]?.diff).toContain('+hello from the builder');

        const merged = await second.post(`/api/runs/${runId}/review`, {
          agentRunId: builder.id,
          action: 'merge',
        });
        expect(merged.status).toBe(200);
        const discarded = await second.post(`/api/runs/${runId}/review`, {
          agentRunId: writer.id,
          action: 'discard',
        });
        expect(discarded.status).toBe(200);
        run = RunDetailDtoSchema.parse((await second.get(`/api/runs/${runId}`)).body);
        expect(run.status).toBe('COMPLETED');
        expect(showFile(repo, 'main', 'greeting.txt')).toBe('hello from the builder\n');
        expect(showFile(repo, 'main', 'notes.txt')).toBeNull();
        expect(existsSync(builder.spec.cwd)).toBe(false);
        expect(existsSync(writer.spec.cwd)).toBe(false);
      } finally {
        await second.server.close();
      }
    } finally {
      if (!firstClosed) await first.server.close();
    }
  });
});
