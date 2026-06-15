import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { queryRead, queryWrite } from '../../src/db/pools.js';
import { createShowtimesService } from '../../src/showtimes/service.js';
import { createMoviesService } from '../../src/movies/service.js';
import { skipIntegration } from './setup.js';

const TEST_TITLE = `Integration Showtime Movie ${Date.now()}`;

/**
 * Integration spec — exercises showtime scheduling against a real PostgreSQL database.
 */
describe.skipIf(skipIntegration)('Showtimes integration', () => {
  const movies = createMoviesService();
  const showtimes = createShowtimesService();
  let movieId: string;
  let runtimeMinutes: number;
  const createdShowtimeIds: string[] = [];

  beforeAll(async () => {
    const created = await movies.createMovie({
      title: TEST_TITLE,
      description: 'Created by showtimes integration test',
      runtimeMinutes: 100,
      genreIds: [1, 7],
    });
    movieId = created.movie.id;
    runtimeMinutes = created.movie.runtimeMinutes;
  });

  afterAll(async () => {
    for (const showtimeId of createdShowtimeIds) {
      await queryWrite(`DELETE FROM showtime_seats WHERE showtime_id = $1`, [showtimeId]);
      await queryWrite(`DELETE FROM showtimes WHERE id = $1`, [showtimeId]);
    }

    if (movieId) {
      await queryWrite(`DELETE FROM movie_genres WHERE movie_id = $1`, [movieId]);
      await queryWrite(`DELETE FROM movies WHERE id = $1`, [movieId]);
    }
  });

  it('creates 120 showtime_seats via trigger on real DB', async () => {
    const startTime = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString();
    const created = await showtimes.createShowtime({
      movieId,
      startTime,
      priceCents: 1100,
    });

    createdShowtimeIds.push(created.showtime.id);

    const seatCount = await queryRead<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM showtime_seats WHERE showtime_id = $1`,
      [created.showtime.id],
    );

    expect(Number(seatCount.rows[0]?.count ?? 0)).toBe(120);

    const availableCount = await queryRead<{ count: string }>(
      `SELECT COUNT(*)::text AS count
       FROM showtime_seats
       WHERE showtime_id = $1 AND status = 'available'`,
      [created.showtime.id],
    );

    expect(Number(availableCount.rows[0]?.count ?? 0)).toBe(120);
  });

  it('concurrent overlapping INSERTs — one succeeds, one gets exclusion_violation', async () => {
    const startTime = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000);

    const insert = () =>
      queryWrite<{ id: string }>(
        `INSERT INTO showtimes (movie_id, screen_id, start_time, end_time, price_cents)
         VALUES ($1, 1, $2, $3, 1200)
         RETURNING id`,
        [movieId, startTime, new Date(startTime.getTime() + runtimeMinutes * 60 * 1000)],
      );

    const results = await Promise.allSettled([insert(), insert()]);

    const fulfilled = results.filter((result) => result.status === 'fulfilled');
    const rejected = results.filter((result) => result.status === 'rejected');

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);

    const successId = fulfilled[0]?.status === 'fulfilled' ? fulfilled[0].value.rows[0]?.id : null;
    if (successId) {
      createdShowtimeIds.push(successId);
    }

    const rejection = rejected[0];
    expect(rejection?.status).toBe('rejected');
    if (rejection?.status === 'rejected') {
      const error = rejection.reason as { code?: string };
      expect(error.code).toBe('23P01');
    }
  });
});
