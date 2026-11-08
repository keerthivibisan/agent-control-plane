// Synthetic temp repositories only (CM-1): the code map REST routes.
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import {
  CSRF_HEADER,
  CodeMapFileDtoSchema,
  CodeMapGraphDtoSchema,
  CodeMapSearchDtoSchema,
  CodeMapSummaryDtoSchema,
} from '@acp/core/api';
import { CSRF, setupCodeMap } from './setup.js';

const base = (projectId: string) => `/api/projects/${projectId}/code-map`;
const errorCode = (res: request.Response): unknown =>
  (res.body as { error?: { code?: unknown } }).error?.code;

async function refreshed(s: ReturnType<typeof setupCodeMap>) {
  const res = await request(s.app)
    .post(`${base(s.projectId)}/refresh`)
    .set(CSRF_HEADER, CSRF);
  await s.service.idle();
  return res;
}

describe('code map routes', () => {
  it('summary is none before a build, building on refresh, then ready', async () => {
    const s = setupCodeMap();
    const commit = s.commit({
      'src/a.ts': "import { b } from './b.js';\nexport const a = 1;\n",
      'src/b.ts': 'export function b() {}\n',
      'tests/a.test.ts': "import { a } from '../src/a.js';\n",
    });
    const none = await request(s.app).get(base(s.projectId));
    expect(none.status).toBe(200);
    expect(CodeMapSummaryDtoSchema.parse(none.body)).toMatchObject({
      status: 'none',
      manifest: null,
      topFolders: [],
    });

    const started = await request(s.app)
      .post(`${base(s.projectId)}/refresh`)
      .set(CSRF_HEADER, CSRF);
    expect(started.status).toBe(202);
    expect(CodeMapSummaryDtoSchema.parse(started.body).status).toBe('building');
    await s.service.idle();

    const ready = CodeMapSummaryDtoSchema.parse((await request(s.app).get(base(s.projectId))).body);
    expect(ready).toMatchObject({ status: 'ready', errorCode: null, manifest: { commit } });
    expect(ready.topFolders).toEqual([
      { path: 'src', fileCount: 2, symbolCount: 2 },
      { path: 'tests', fileCount: 1, symbolCount: 0 },
    ]);
    expect(ready.languages).toEqual([{ language: 'typescript', fileCount: 3 }]);

    const graph = await request(s.app).get(`${base(s.projectId)}/graph`);
    expect(graph.status).toBe(200);
    expect(CodeMapGraphDtoSchema.parse(graph.body)).toMatchObject({
      level: 'file',
      commit,
      totalEdges: 2,
      truncated: false,
    });
    const scoped = CodeMapGraphDtoSchema.parse(
      (
        await request(s.app)
          .get(`${base(s.projectId)}/graph`)
          .query({ folder: 'src', depth: '1' })
      ).body,
    );
    expect(scoped.nodes.map((n) => n.id)).toEqual(['src/a.ts', 'src/b.ts']);

    const file = await request(s.app)
      .get(`${base(s.projectId)}/file`)
      .query({ path: 'src/a.ts' });
    expect(file.status).toBe(200);
    expect(CodeMapFileDtoSchema.parse(file.body)).toMatchObject({
      commit,
      importedBy: ['tests/a.test.ts'],
      tests: ['tests/a.test.ts'],
    });

    const search = await request(s.app)
      .get(`${base(s.projectId)}/search`)
      .query({ q: 'b' });
    expect(search.status).toBe(200);
    expect(CodeMapSearchDtoSchema.parse(search.body).matches[0]).toMatchObject({
      kind: 'symbol',
      name: 'b',
      rank: 'exact',
    });
  });

  it('refresh needs the CSRF token', async () => {
    const s = setupCodeMap();
    s.commit({ 'a.ts': 'export const a = 1;\n' });
    const missing = await request(s.app).post(`${base(s.projectId)}/refresh`);
    expect(missing.status).toBe(403);
    expect(errorCode(missing)).toBe('csrf_missing');
    const wrong = await request(s.app)
      .post(`${base(s.projectId)}/refresh`)
      .set(CSRF_HEADER, 'f'.repeat(64));
    expect(errorCode(wrong)).toBe('csrf_invalid');
    expect(
      CodeMapSummaryDtoSchema.parse((await request(s.app).get(base(s.projectId))).body).status,
    ).toBe('none');
  });

  it('answers 404 for an unknown project or an unbuilt map, 409 for a repo with no commit', async () => {
    const s = setupCodeMap();
    const unknown = await request(s.app).get(base('nope'));
    expect(unknown.status).toBe(404);
    const unbuilt = await request(s.app).get(`${base(s.projectId)}/graph`);
    expect(unbuilt.status).toBe(404);
    expect(errorCode(unbuilt)).toBe('code_map_not_built');
    const empty = await request(s.app)
      .post(`${base(s.projectId)}/refresh`)
      .set(CSRF_HEADER, CSRF);
    expect(empty.status).toBe(409);
    expect(errorCode(empty)).toBe('no_commits');
  });

  it('refuses bad paths, queries and commits with 400', async () => {
    const s = setupCodeMap();
    s.commit({ 'a.ts': 'export const a = 1;\n' });
    await refreshed(s);
    for (const path of ['../etc/passwd', '/etc/passwd', 'a/../../b', 'C:/x', 'a\\b', '']) {
      const res = await request(s.app)
        .get(`${base(s.projectId)}/file`)
        .query({ path });
      expect(res.status, path).toBe(400);
      expect(errorCode(res)).toBe('invalid_query');
    }
    const twice = await request(s.app).get(`${base(s.projectId)}/file?path=a.ts&path=b.ts`);
    expect(twice.status).toBe(400);
    expect((await request(s.app).get(`${base(s.projectId)}/search`)).status).toBe(400);
    const long = await request(s.app)
      .get(`${base(s.projectId)}/search`)
      .query({ q: 'x'.repeat(201) });
    expect(long.status).toBe(400);
    const depth = await request(s.app)
      .get(`${base(s.projectId)}/graph`)
      .query({ depth: 'deep' });
    expect(depth.status).toBe(400);
    const commit = await request(s.app)
      .get(`${base(s.projectId)}/graph`)
      .query({ commit: 'HEAD' });
    expect(commit.status).toBe(400);
    const missingFile = await request(s.app)
      .get(`${base(s.projectId)}/file`)
      .query({ path: 'zz.ts' });
    expect(missingFile.status).toBe(404);
    expect(errorCode(missingFile)).toBe('code_map_file_not_found');
  });

  it('collapses the graph to folders over the node cap', async () => {
    const s = setupCodeMap();
    const files: Record<string, string> = {};
    for (let i = 0; i < 1510; i++) files[`docs/part${i % 3}/n${i}.txt`] = `${i}\n`;
    s.commit(files);
    await refreshed(s);
    const graph = CodeMapGraphDtoSchema.parse(
      (await request(s.app).get(`${base(s.projectId)}/graph`)).body,
    );
    expect(graph.level).toBe('folder');
    expect(graph.nodes.map((n) => [n.id, n.fileCount])).toEqual([
      ['docs/part0', 504],
      ['docs/part1', 503],
      ['docs/part2', 503],
    ]);
  }, 30_000);
});
