import { beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { genresResponseSchema } from '@repo/shared';
import { createApp } from '../src/app.js';
import { loadEnv } from '../src/config/env.js';
import { queryRead } from '../src/db/pools.js';
import { createLogger } from '../src/middleware/logger.js';

/** Matches seed rows in 0003_seed.sql (8 genres). */
const SEED_GENRES = [
  { id: 1, name: 'Action', slug: 'action' },
  { id: 2, name: 'Comedy', slug: 'comedy' },
  { id: 3, name: 'Documentary', slug: 'documentary' },
  { id: 4, name: 'Drama', slug: 'drama' },
  { id: 5, name: 'Horror', slug: 'horror' },
  { id: 6, name: 'Romance', slug: 'romance' },
  { id: 7, name: 'Sci-Fi', slug: 'sci-fi' },
  { id: 8, name: 'Thriller', slug: 'thriller' },
];

const env = loadEnv();
const logger = createLogger({ ...env, LOG_LEVEL: 'silent' });
const app = createApp(env, logger);

function installGenreDbMock(): void {
  vi.mocked(queryRead).mockImplementation(async (sql: string) => {
    if (sql.includes('FROM genres')) {
      return { rows: SEED_GENRES, rowCount: SEED_GENRES.length };
    }
    return { rows: [], rowCount: 0 };
  });
}

describe('GET /genres', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    installGenreDbMock();
  });

  it('returns 200 with 8 seeded genres', async () => {
    const response = await request(app).get('/genres');

    expect(response.status).toBe(200);
    expect(response.body.genres).toHaveLength(8);
  });

  it('returns genres sorted alphabetically by name', async () => {
    const response = await request(app).get('/genres');

    const names = response.body.genres.map((g: { name: string }) => g.name);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
  });

  it('returns each genre with id, name, and slug', async () => {
    const response = await request(app).get('/genres');

    for (const genre of response.body.genres) {
      expect(genre).toEqual(
        expect.objectContaining({
          id: expect.any(Number),
          name: expect.any(String),
          slug: expect.any(String),
        }),
      );
    }

    expect(genresResponseSchema.safeParse(response.body).success).toBe(true);
  });
});

describe('Regression', () => {
  it('GET /health still returns 200', async () => {
    const response = await request(app).get('/health');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'ok' });
  });
});
