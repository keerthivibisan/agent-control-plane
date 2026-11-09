import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  CSRF_HEADER,
  CodeMapSummaryDtoSchema,
  TicketDetailDtoSchema,
  TicketDtoSchema,
  type ProjectDto,
} from '@acp/core/api';
import { startServer } from '../../src/bootstrap.js';
import { loadConfig } from '../../src/config.js';
import { silentLogger } from '../../src/logger.js';
import { createGitRunner } from '../../src/workspace/index.js';
import { createFakeManagedAdapter, type FakeAgent } from '../control/fake-adapter.js';
import {
  GIT_ENV,
  makeRepo,
  makeTempDir,
  registerProject,
  waitFor,
} from '../verification/control/harness.js';

/*
 * CM-5's comparison switch, through `startServer` (bootstrap wiring) with the scripted fake adapter:
 * with ACP_CODE_MAP=off a ticket run builds no map, its agents get no repository map and no map
 * summaries in their starting points (notes and paths still pass), and `code_map`, still offered,
 * refuses. With the default (on) the same run gets the map. Synthetic repository files only.
 */

const FILES = {
  'README.md': 'hello\n',
  'src/app.ts': 'export function createApp() {}\n',
  'src/main.ts': "import { createApp } from './app.js';\ncreateApp();\n",
};

async function bootWith(codeMap: 'on' | 'off' | undefined) {
  const dataDir = makeTempDir('acp-cm-off-');
  const config = loadConfig(
    {
      ACP_MODE: 'live',
      ACP_DATA_DIR: dataDir,
      ACP_CLAUDE_DIR: join(dataDir, 'claude'),
      ACP_POLL_INTERVAL_MS: '1000',
      ...(codeMap !== undefined && { ACP_CODE_MAP: codeMap }),
    },
    { homeDir: join(dataDir, 'home') },
  );
  const fake = createFakeManagedAdapter();
  const server = await startServer({
    config,
    port: 0,
    logger: silentLogger,
    managedAdapter: fake.adapter,
    git: createGitRunner({ env: GIT_ENV }),
  });
  const base = `http://127.0.0.1:${server.port}`;
  const read = async (res: Response) => ({
    status: res.status,
    body: res.status === 204 ? null : await res.json(),
  });
  const get = async (path: string) => read(await fetch(`${base}${path}`));
  const { token } = (await get('/api/control/token')).body as { token: string };
  const post = async (path: string, body: unknown = {}) =>
    read(
      await fetch(`${base}${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', [CSRF_HEADER]: token },
        body: JSON.stringify(body),
      }),
    );
  return { server, fake, get, post, b: { server, base, csrf: token, get, post } };
}

type Booted = Awaited<ReturnType<typeof bootWith>>;

/** A ticket started; the plan (one step with files and notes) approved; the lead returned. */
async function approvedRun(s: Booted): Promise<{ project: ProjectDto; lead: FakeAgent }> {
  const project = await registerProject(s.b, 'app', makeRepo(FILES));
  const created = await s.post(`/api/projects/${project.id}/tickets`, { title: 'Add a toggle' });
  const ticket = TicketDtoSchema.parse(created.body);
  await s.post(`/api/tickets/${ticket.id}/move`, { status: 'READY' });
  expect((await s.post(`/api/tickets/${ticket.id}/start`, {})).status).toBe(200);
  // The lead launches after the run's map build settled (or at once without a map source).
  const lead = await waitFor(
    () => s.fake.agents.find((a) => a.spec.kind === 'lead'),
    'the lead',
    10_000,
  );
  lead.started();
  await lead.callLead('submit_plan', {
    summary: 'Toggle',
    steps: [
      {
        title: 'Build',
        role: 'Builder',
        detail: 'In the app',
        files: ['src/app.ts'],
        notes: 'createApp builds the app.',
      },
    ],
  });
  const plan = await waitFor(async () => {
    const d = TicketDetailDtoSchema.parse((await s.get(`/api/tickets/${ticket.id}`)).body);
    return d.plans.find((p) => p.status === 'proposed');
  }, 'the proposed plan');
  const decided = await s.post(`/api/tickets/${ticket.id}/plans/${plan.id}/decision`, {
    decision: 'approve',
  });
  expect(decided.status).toBe(200);
  return { project, lead };
}

async function helperOf(s: Booted, lead: FakeAgent): Promise<FakeAgent> {
  // The plan approval creates the ticket branch in the background; start_agent waits for it.
  await waitFor(
    () =>
      lead.callLead('start_agent', { role: 'Builder', task: 'Build the toggle' }).then(
        () => true,
        (error: unknown) => {
          if (error instanceof Error && error.message.includes('still being created')) {
            return undefined;
          }
          throw error;
        },
      ),
    'start_agent',
    10_000,
  );
  return waitFor(() => s.fake.workers()[0], 'the helper', 10_000);
}

describe('ACP_CODE_MAP (CM-5 comparison switch)', () => {
  it('off: no map is built or used, starting points keep notes and paths, code_map refuses', async () => {
    const s = await bootWith('off');
    try {
      const { project, lead } = await approvedRun(s);
      expect(lead.spec.repoMap).toBeUndefined();
      await expect(lead.callLead('code_map', { action: 'search', query: 'app' })).rejects.toThrow(
        'no code map for this commit yet',
      );
      const helper = await helperOf(s, lead);
      expect(helper.spec.repoMap).toBeUndefined();
      const prompt = helper.spec.prompt;
      expect(prompt).toContain('=== Starting points from the lead ===');
      expect(prompt).toContain('createApp builds the app.');
      expect(prompt).toContain(
        'Files (no code map for this commit, so no summaries):\n- src/app.ts',
      );
      expect(prompt).not.toContain('related');
      await expect(
        helper.callLead('code_map', { action: 'find_symbol', query: 'createApp' }),
      ).rejects.toThrow('no code map for this commit yet');
      // Nothing was built for the run: the project's map was never made.
      const summary = CodeMapSummaryDtoSchema.parse(
        (await s.get(`/api/projects/${project.id}/code-map`)).body,
      );
      expect(summary.status).toBe('none');
    } finally {
      await s.server.close();
    }
  }, 30_000);

  it('on (the default): the run builds the map and its agents use it', async () => {
    const s = await bootWith(undefined);
    try {
      const { project, lead } = await approvedRun(s);
      expect(lead.spec.repoMap).toContain('Repository map: commit');
      expect(
        await lead.callLead('code_map', { action: 'find_symbol', query: 'createApp' }),
      ).toContain('src/app.ts:1');
      const helper = await helperOf(s, lead);
      expect(helper.spec.repoMap).toBe(lead.spec.repoMap);
      expect(helper.spec.prompt).toContain('Files (code map of commit');
      const summary = CodeMapSummaryDtoSchema.parse(
        (await s.get(`/api/projects/${project.id}/code-map`)).body,
      );
      expect(summary.status).toBe('ready');
    } finally {
      await s.server.close();
    }
  }, 30_000);
});
