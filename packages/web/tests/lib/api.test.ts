import { describe, expect, it } from 'vitest';
import { ApiError, createApiClient, paths, schemas, withQuery } from '../../src/lib/api';
import { PROXY_ERROR_HEADER } from '../../src/lib/constants';
import { overview } from '../fixtures/dto';
import { fakeServer, jsonResponse } from '../helpers';

async function rejection(p: Promise<unknown>): Promise<ApiError> {
  try {
    await p;
  } catch (e) {
    if (e instanceof ApiError) return e;
    throw e;
  }
  throw new Error('expected the request to fail');
}

describe('api client', () => {
  it('returns parsed data for a valid response', async () => {
    const server = fakeServer({ '/api/overview': overview() });
    const data = await createApiClient(server.fetch).get(paths.overview(), schemas.overview);
    expect(data.projectCount).toBe(1);
  });

  it('rejects a malformed response with every contract issue listed', async () => {
    const { totals: _totals, ...broken } = overview();
    const server = fakeServer({ '/api/overview': { ...broken, projectCount: -1 } });
    const err = await rejection(
      createApiClient(server.fetch).get(paths.overview(), schemas.overview),
    );
    expect(err.kind).toBe('parse');
    expect(err.path).toBe('/api/overview');
    const issuePaths = err.issues.map((i) => i.path);
    expect(issuePaths).toContain('projectCount');
    expect(issuePaths).toContain('totals');
  });

  it('rejects a non-JSON success body', async () => {
    const server = fakeServer({ '/api/health': new Response('<html>', { status: 200 }) });
    const err = await rejection(createApiClient(server.fetch).get(paths.health(), schemas.health));
    expect(err.kind).toBe('parse');
  });

  it('never turns a missing token category into 0', async () => {
    const o = overview();
    const bad = { ...o, totals: { ...o.totals, tokens: { ...o.totals.tokens, input: undefined } } };
    const server = fakeServer({ '/api/overview': bad });
    const err = await rejection(
      createApiClient(server.fetch).get(paths.overview(), schemas.overview),
    );
    expect(err.issues.map((i) => i.path)).toContain('totals.tokens.input');
  });

  it('surfaces an ErrorDto as an http error with code and request id', async () => {
    const server = fakeServer({
      'POST /api/projects': jsonResponse(400, {
        error: { code: 'invalid_root', message: 'rootPath is not a directory', requestId: 'r-9' },
      }),
    });
    const err = await rejection(
      createApiClient(server.fetch).post(
        paths.projects(),
        { name: 'x', rootPath: '/x' },
        schemas.project,
      ),
    );
    expect(err).toMatchObject({
      kind: 'http',
      status: 400,
      code: 'invalid_root',
      requestId: 'r-9',
    });
    expect(err.message).toBe('rootPath is not a directory');
  });

  it('reports the server as unreachable on a network failure or a proxy 502', async () => {
    const refused = await rejection(
      createApiClient(() => Promise.reject(new TypeError('Failed to fetch'))).get(
        paths.health(),
        schemas.health,
      ),
    );
    expect(refused.kind).toBe('unreachable');
    const proxied = await rejection(
      createApiClient(() =>
        Promise.resolve(new Response('', { status: 502, headers: { [PROXY_ERROR_HEADER]: '1' } })),
      ).get(paths.health(), schemas.health),
    );
    expect(proxied.kind).toBe('unreachable');
  });

  it('builds stable query strings and drops empty params', () => {
    expect(withQuery('/api/sessions', { status: 'stale', q: '', projectId: 'p 1' })).toBe(
      '/api/sessions?projectId=p+1&status=stale',
    );
    expect(paths.sessionEvents('a/b', 'c1')).toBe('/api/sessions/a%2Fb/events?cursor=c1');
  });
});

describe('api client: DELETE (redesign R-D)', () => {
  it('resolves on 204 No Content and sends the method and headers', async () => {
    const server = fakeServer({ 'DELETE /api/x': new Response(null, { status: 204 }) });
    await createApiClient(server.fetch).delete('/api/x', undefined, { 'X-Test': '1' });
    expect(server.calls).toEqual([{ method: 'DELETE', path: '/api/x', body: undefined }]);
  });

  it('rejects an ErrorDto refusal as a typed http error', async () => {
    const server = fakeServer({
      'DELETE /api/x': jsonResponse(409, {
        error: { code: 'skill_in_use', message: 'used', requestId: 'r' },
      }),
    });
    const err = await rejection(createApiClient(server.fetch).delete('/api/x'));
    expect(err).toMatchObject({ kind: 'http', status: 409, code: 'skill_in_use' });
  });

  it('rejects a DELETE that answers with a body instead of 204', async () => {
    const server = fakeServer({ 'DELETE /api/x': { unexpected: true } });
    expect((await rejection(createApiClient(server.fetch).delete('/api/x'))).kind).toBe('parse');
  });
});
