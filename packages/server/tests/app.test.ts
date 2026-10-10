import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { ErrorDtoSchema, HealthDtoSchema } from '@acp/core/api';
import { createApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { silentLogger } from '../src/logger.js';

const app = createApp({
  config: loadConfig({ ACP_MODE: 'demo' }, { homeDir: '/home/tester' }),
  logger: silentLogger,
  version: '0.0.0',
});

describe('createApp', () => {
  it('serves /api/health matching HealthDto, with a request id', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(HealthDtoSchema.parse(res.body)).toMatchObject({ status: 'ok', mode: 'demo' });
    expect(res.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('returns an ErrorDto 404 carrying the same request id for unknown API routes', async () => {
    const res = await request(app).get('/api/nope');
    expect(res.status).toBe(404);
    const body = ErrorDtoSchema.parse(res.body);
    expect(body.error.code).toBe('not_found');
    expect(body.error.requestId).toBe(res.headers['x-request-id']);
  });
});
