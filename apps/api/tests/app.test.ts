import { beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { apiErrorSchema, paginationSchema } from '@repo/shared';
import { createApp } from '../src/app.js';
import { loadEnv } from '../src/config/env.js';
import { checkDatabaseHealth } from '../src/db/pools.js';
import { createLogger } from '../src/middleware/logger.js';
import { signTestToken } from './helpers/jwt.js';

const env = loadEnv();
const logger = createLogger({ ...env, LOG_LEVEL: 'silent' });
const app = createApp(env, logger);

describe('Health routes', () => {
  it('GET /health returns 200 with ok status', async () => {
    const response = await request(app).get('/health');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'ok' });
  });

  it('GET /ready returns 200 when primary and replicas are healthy', async () => {
    vi.mocked(checkDatabaseHealth).mockResolvedValueOnce({
      primary: true,
      replicaCount: 2,
    });

    const response = await request(app).get('/ready');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      status: 'ready',
      checks: { primary: true, replicas: 2 },
    });
  });

  it('GET /ready returns 503 when database is unavailable', async () => {
    vi.mocked(checkDatabaseHealth).mockResolvedValueOnce({
      primary: false,
      replicaCount: 0,
    });

    const response = await request(app).get('/ready');

    expect(response.status).toBe(503);
    expect(response.body.status).toBe('not_ready');
  });
});

describe('Auth middleware (debug routes)', () => {
  it('GET /debug/protected without token returns 401 UNAUTHORIZED', async () => {
    const response = await request(app).get('/debug/protected');

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('UNAUTHORIZED');
  });

  it('GET /debug/protected with valid test JWT returns 200', async () => {
    const token = signTestToken({
      sub: 'user-123',
      email: 'user@example.com',
      role: 'user',
    });

    const response = await request(app)
      .get('/debug/protected')
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body.status).toBe('ok');
    expect(response.body.userId).toBe('user-123');
  });

  it('GET /debug/admin without admin role returns 403 FORBIDDEN', async () => {
    const token = signTestToken({
      sub: 'user-123',
      email: 'user@example.com',
      role: 'user',
    });

    const response = await request(app)
      .get('/debug/admin')
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('FORBIDDEN');
  });

  it('GET /debug/admin with admin role returns 200', async () => {
    const token = signTestToken({
      sub: 'admin-123',
      email: 'admin@arekta.local',
      role: 'admin',
    });

    const response = await request(app)
      .get('/debug/admin')
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body.role).toBe('admin');
  });
});

describe('Foundation scaffolding', () => {
  it('creates app without throwing when REDIS_URL is set', () => {
    expect(() => createApp({ ...env, REDIS_URL: 'redis://localhost:6379' }, logger)).not.toThrow();
  });

  it('exports paginationSchema and apiErrorSchema from @repo/shared', () => {
    expect(paginationSchema.parse({})).toEqual({ page: 1, limit: 20 });
    expect(paginationSchema.parse({ page: '2', limit: '50' })).toEqual({ page: 2, limit: 50 });

    const parsed = apiErrorSchema.parse({
      error: { code: 'NOT_FOUND', message: 'Missing' },
    });
    expect(parsed.error.code).toBe('NOT_FOUND');
  });
});

describe('Error handling', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 404 for unknown routes', async () => {
    const response = await request(app).get('/unknown-route');

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('NOT_FOUND');
    expect(response.body.error.requestId).toBeDefined();
  });

  it('returns 400 for AppError without leaking stack', async () => {
    const response = await request(app).get('/debug/app-error');

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('BAD_REQUEST');
    expect(response.body.error.message).toBe('Bad request example');
    expect(response.body.error.stack).toBeUndefined();
  });

  it('returns 500 for unhandled errors without leaking stack', async () => {
    const response = await request(app).get('/debug/error');

    expect(response.status).toBe(500);
    expect(response.body.error.code).toBe('INTERNAL_ERROR');
    expect(response.body.error.stack).toBeUndefined();
  });

  it('sets X-Request-Id on responses', async () => {
    const response = await request(app).get('/health');

    expect(response.headers['x-request-id']).toBeDefined();
  });
});
