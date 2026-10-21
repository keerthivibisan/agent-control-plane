import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { defaultProjectWorkflow, workflowTemplate } from '@acp/core';
import { CSRF_HEADER, SkillDetailDtoSchema, SkillSummaryDtoSchema } from '@acp/core/api';
import { silentLogger } from '../../src/logger.js';
import { createFakeManagedAdapter } from '../control/fake-adapter.js';
import { boot, makeRepo, makeTempDir, registerProject } from '../verification/control/harness.js';

/*
 * The skills routes through `startServer` (bootstrap and app wiring): mounted with the board
 * under its CSRF token, and "used by" plus the delete guard follow the workflow saved through
 * R-G's workflow route. Live mode over an empty temp Claude dir; the fake managed adapter never
 * starts anything here.
 */

describe('skills through startServer', () => {
  it('writes a skill, reflects the saved workflow, and guards delete', async () => {
    const b = await boot({
      mode: 'live',
      dataDir: makeTempDir('acp-skills-server-'),
      claudeDir: makeTempDir('acp-skills-claude-'),
      adapter: createFakeManagedAdapter().adapter,
      logger: silentLogger,
    });
    try {
      const root = makeRepo();
      const project = await registerProject(b, 'web-app', root);
      const base = `/api/projects/${project.id}/skills`;
      const send = (method: string, path: string, body?: unknown, csrf = true) =>
        fetch(`${b.base}${path}`, {
          method,
          headers: { 'content-type': 'application/json', ...(csrf && { [CSRF_HEADER]: b.csrf }) },
          ...(body !== undefined && { body: JSON.stringify(body) }),
        });

      const created = await b.post(base, {
        name: 'code-review',
        description: 'Review a diff',
        instructions: '# Review\n',
      });
      expect(created.status).toBe(201);
      expect(SkillDetailDtoSchema.parse(created.body).path).toBe(
        '.claude/skills/code-review/SKILL.md',
      );
      expect(readFileSync(join(root, '.claude/skills/code-review/SKILL.md'), 'utf8')).toContain(
        'name: code-review',
      );
      expect((await send('DELETE', `${base}/code-review`, undefined, false)).status).toBe(403);

      const { stages, plannerMode } = defaultProjectWorkflow(project.id, new Date().toISOString());
      const saved = await send('PUT', `/api/projects/${project.id}/workflow`, {
        plannerMode,
        stages: { ...stages, plan: { model: null, skill: 'code-review' } },
      });
      expect(saved.status).toBe(200);

      const list = SkillSummaryDtoSchema.array().parse((await b.get(base)).body);
      expect(list.map((s) => [s.name, s.usedBy])).toEqual([['code-review', ['plan']]]);
      const refused = await send('DELETE', `${base}/code-review`);
      expect(refused.status).toBe(409);
      expect(((await refused.json()) as { error: { code: string } }).error.code).toBe(
        'skill_in_use',
      );

      // Agent definitions are mounted the same way, under the same CSRF token.
      const agents = `/api/projects/${project.id}/agents`;
      expect(
        (
          await send(
            'POST',
            agents,
            { name: 'x', description: 'd', tools: null, model: null, instructions: '' },
            false,
          )
        ).status,
      ).toBe(403);
      const agent = await b.post(agents, {
        name: 'reviewer',
        description: 'Reviews diffs',
        tools: ['Read'],
        model: null,
        instructions: 'Review.\n',
      });
      expect(agent.status).toBe(201);
      expect(readFileSync(join(root, '.claude/agents/reviewer.md'), 'utf8')).toContain(
        'tools: Read',
      );
      expect(((await b.get(agents)).body as { name: string }[]).map((a) => a.name)).toEqual([
        'reviewer',
      ]);

      // ADR-0023: once a graph is saved, "used by" and the guards follow its nodes.
      const graph = workflowTemplate('lead-only');
      const lead = graph.nodes.find((n) => n.type === 'lead');
      if (lead?.type !== 'lead') throw new Error('no lead');
      lead.skills = ['code-review'];
      lead.agent = 'reviewer';
      const put = await send('PUT', `/api/projects/${project.id}/workflow-graph`, { graph });
      expect(put.status).toBe(200);
      const afterGraph = SkillSummaryDtoSchema.array().parse((await b.get(base)).body);
      expect(afterGraph.map((s) => [s.name, s.usedBy, s.usedByNodes])).toEqual([
        ['code-review', ['orchestrate'], [{ nodeId: 'orchestrate', label: lead.label }]],
      ]);
      expect((await send('DELETE', `${agents}/reviewer`)).status).toBe(409);
    } finally {
      await b.server.close();
    }
  }, 60_000);
});
