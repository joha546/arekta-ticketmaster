import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { queryRead, queryWrite } from '../../src/db/pools.js';
import { createMoviesService } from '../../src/movies/service.js';
import { skipIntegration } from './setup.js';

const TEST_TITLE = `Integration Movie ${Date.now()}`;

/**
 * Integration spec — exercises movie CRUD and search against a real PostgreSQL database.
 * Requires migrated seed data; skipped when INTEGRATION_TEST=0.
 */
describe.skipIf(skipIntegration)('Movies integration', () => {
  const movies = createMoviesService();
  let movieId: string;

  beforeAll(async () => {
    const created = await movies.createMovie({
      title: TEST_TITLE,
      description: 'Created by integration test',
      runtimeMinutes: 111,
      genreIds: [1, 7],
    });
    movieId = created.movie.id;
  });

  afterAll(async () => {
    if (movieId) {
      await queryWrite(`DELETE FROM movie_genres WHERE movie_id = $1`, [movieId]);
      await queryWrite(`DELETE FROM movies WHERE id = $1`, [movieId]);
    }
  });

  it('finds the created movie in search results', async () => {
    const result = await movies.listMovies({
      search: TEST_TITLE.slice(0, 12),
      page: 1,
      limit: 20,
      sort: 'newest',
    });

    expect(result.total).toBeGreaterThanOrEqual(1);
    expect(result.movies.some((m) => m.id === movieId)).toBe(true);
  });

  it('filters by genre slug', async () => {
    const result = await movies.listMovies({
      genreSlug: 'action',
      page: 1,
      limit: 100,
      sort: 'title',
    });

    expect(result.movies.some((m) => m.id === movieId)).toBe(true);
    for (const movie of result.movies) {
      expect(movie.genres.some((g) => g.slug === 'action')).toBe(true);
    }
  });

  it('soft delete removes the movie from active browse', async () => {
    await movies.deleteMovie(movieId);

    const list = await movies.listMovies({ page: 1, limit: 100, sort: 'newest' });
    expect(list.movies.some((m) => m.id === movieId)).toBe(false);

    const row = await queryRead<{ is_active: boolean }>(
      `SELECT is_active FROM movies WHERE id = $1`,
      [movieId],
    );
    expect(row.rows[0]?.is_active).toBe(false);
  });
});
