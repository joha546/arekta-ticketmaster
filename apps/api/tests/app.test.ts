import { beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { loadEnv } from '../src/config/env.js';
import { checkDatabaseHealth } from '../src/db/pools.js';
import { createLogger } from '../src/middleware/logger.js';

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
