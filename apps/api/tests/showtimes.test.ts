import { beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import {
  showtimeMutationResponseSchema,
  showtimesListResponseSchema,
} from '@repo/shared';
import { createApp } from '../src/app.js';
import { loadEnv } from '../src/config/env.js';
import { queryRead, queryWrite } from '../src/db/pools.js';
import { getRedis } from '../src/redis/client.js';
import { createLogger } from '../src/middleware/logger.js';
import { signTestToken } from './helpers/jwt.js';
import { resetMockRedisStore } from './setup.js';

type MovieRow = {
  id: string;
  title: string;
  description: string | null;
  poster_url: string | null;
  runtime_minutes: number;
  is_active: boolean;
};

type ShowtimeRow = {
  id: string;
  movie_id: string;
  screen_id: number;
  start_time: Date;
  end_time: Date;
  price_cents: number;
  status: 'scheduled' | 'cancelled' | 'completed';
};

type SeatRow = {
  showtime_id: string;
  status: 'available' | 'held' | 'reserved';
};

const MOVIE_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const SHOWTIME_ID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const OTHER_SHOWTIME_ID = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const ADMIN_ID = '11111111-1111-1111-1111-111111111111';
const USER_ID = '22222222-2222-2222-2222-222222222222';

const adminToken = signTestToken({
  sub: ADMIN_ID,
  email: 'admin@arekta.local',
  role: 'admin',
});

const userToken = signTestToken({
  sub: USER_ID,
  email: 'user@arekta.local',
  role: 'user',
});

const env = loadEnv();
const logger = createLogger({ ...env, LOG_LEVEL: 'silent' });
const app = createApp({ ...env, IMGBB_API_KEY: 'test-imgbb-key' }, logger);

const movies = new Map<string, MovieRow>();
const showtimes = new Map<string, ShowtimeRow>();
const showtimeSeats = new Map<string, SeatRow[]>();
const confirmedReservations = new Set<string>();

function seedMovie(runtimeMinutes = 120): MovieRow {
  const movie: MovieRow = {
    id: MOVIE_ID,
    title: 'Test Movie',
    description: 'A test movie',
    poster_url: null,
    runtime_minutes: runtimeMinutes,
    is_active: true,
  };
  movies.set(movie.id, movie);
  return movie;
}

function rangesOverlap(
  aStart: Date,
  aEnd: Date,
  bStart: Date,
  bEnd: Date,
  gapMinutes = 15,
): boolean {
  const aEndWithGap = new Date(aEnd.getTime() + gapMinutes * 60 * 1000);
  const bEndWithGap = new Date(bEnd.getTime() + gapMinutes * 60 * 1000);
  return aStart < bEndWithGap && bStart < aEndWithGap;
}

function installDbMocks(): void {
  const handleRead = async (sql: string, params?: unknown[]) => {
    if (sql.includes('FROM movies') && sql.includes('WHERE id = $1')) {
      const id = params?.[0] as string;
      const movie = movies.get(id);
      if (!movie || (!sql.includes('includeInactive') && !movie.is_active)) {
        return { rows: movie && sql.includes('is_active = TRUE') === false ? [movie] : movie ? [movie] : [], rowCount: movie ? 1 : 0 };
      }
      return { rows: movie ? [movie] : [], rowCount: movie ? 1 : 0 };
    }

    if (sql.includes('SELECT id, title, description, poster_url, runtime_minutes, is_active')) {
      const id = params?.[0] as string;
      const movie = movies.get(id);
      if (!movie) {
        return { rows: [], rowCount: 0 };
      }
      if (sql.includes('is_active = TRUE') && !movie.is_active) {
        return { rows: [], rowCount: 0 };
      }
      return { rows: [movie], rowCount: 1 };
    }

    if (sql.includes('FROM showtimes s') && sql.includes('start_time::date')) {
      const movieId = params?.[0] as string;
      const date = params?.[1] as string;
      const rows = [...showtimes.values()]
        .filter(
          (s) =>
            s.movie_id === movieId &&
            s.status === 'scheduled' &&
            s.start_time.toISOString().slice(0, 10) === date,
        )
        .map((s) => ({
          ...s,
          available_seat_count: (showtimeSeats.get(s.id) ?? []).filter((seat) => seat.status === 'available')
            .length,
        }));
      return { rows, rowCount: rows.length };
    }

    if (sql.includes('FROM showtimes') && sql.includes('start_time > NOW()')) {
      const movieId = params?.[0] as string;
      const rows = [...showtimes.values()]
        .filter((s) => s.movie_id === movieId && s.status === 'scheduled' && s.start_time > new Date())
        .sort((a, b) => a.start_time.getTime() - b.start_time.getTime())
        .slice(0, 10);
      return { rows, rowCount: rows.length };
    }

    if (sql.includes('FROM showtimes') && sql.includes('WHERE id = $1')) {
      const id = params?.[0] as string;
      const row = showtimes.get(id);
      return { rows: row ? [row] : [], rowCount: row ? 1 : 0 };
    }

    if (sql.includes('FROM reservations') && sql.includes('confirmed')) {
      const showtimeId = params?.[0] as string;
      return {
        rows: [{ exists: confirmedReservations.has(showtimeId) }],
        rowCount: 1,
      };
    }

    if (sql.includes('FROM genres')) {
      return { rows: [], rowCount: 0 };
    }

    return { rows: [], rowCount: 0 };
  };

  vi.mocked(queryRead).mockImplementation(handleRead);
  vi.mocked(queryWrite).mockImplementation(async (sql: string, params?: unknown[]) => {
    if (sql.trimStart().startsWith('SELECT')) {
      return handleRead(sql, params);
    }

    if (sql.includes('INSERT INTO showtimes')) {
      const row: ShowtimeRow = {
        id: crypto.randomUUID(),
        movie_id: params?.[0] as string,
        screen_id: params?.[1] as number,
        start_time: params?.[2] as Date,
        end_time: params?.[3] as Date,
        price_cents: params?.[4] as number,
        status: 'scheduled',
      };

      for (const existing of showtimes.values()) {
        if (
          existing.screen_id === row.screen_id &&
          existing.status === 'scheduled' &&
          rangesOverlap(existing.start_time, existing.end_time, row.start_time, row.end_time)
        ) {
          const error = new Error('exclusion_violation') as Error & { code: string };
          error.code = '23P01';
          throw error;
        }
      }

      showtimes.set(row.id, row);
      showtimeSeats.set(
        row.id,
        Array.from({ length: 120 }, () => ({ showtime_id: row.id, status: 'available' as const })),
      );
      return { rows: [row], rowCount: 1 };
    }

    if (sql.includes('UPDATE showtimes') && sql.includes('SET status = \'cancelled\'')) {
      const id = params?.[0] as string;
      const row = showtimes.get(id);
      if (!row || row.status !== 'scheduled') {
        return { rows: [], rowCount: 0 };
      }
      row.status = 'cancelled';
      return { rows: [row], rowCount: 1 };
    }

    if (sql.includes('UPDATE showtimes') && sql.includes('status = \'completed\'')) {
      let updated = 0;
      for (const row of showtimes.values()) {
        if (row.status === 'scheduled' && row.end_time < new Date()) {
          row.status = 'completed';
          updated += 1;
        }
      }
      return { rows: [], rowCount: updated };
    }

    if (
      sql.includes('UPDATE showtimes') &&
      sql.includes(' SET ') &&
      !sql.includes("status = 'cancelled'") &&
      !sql.includes("status = 'completed'")
    ) {
      const id = params?.[params.length - 1] as string;
      const row = showtimes.get(id);
      if (!row || row.status !== 'scheduled') {
        return { rows: [], rowCount: 0 };
      }

      let valueIndex = 0;
      const nextStart = sql.includes('start_time =') ? (params?.[valueIndex++] as Date) : row.start_time;
      const nextEnd = sql.includes('end_time =') ? (params?.[valueIndex++] as Date) : row.end_time;
      const nextPrice = sql.includes('price_cents =')
        ? (params?.[valueIndex++] as number)
        : row.price_cents;

      for (const existing of showtimes.values()) {
        if (
          existing.id !== id &&
          existing.screen_id === row.screen_id &&
          existing.status === 'scheduled' &&
          rangesOverlap(existing.start_time, existing.end_time, nextStart, nextEnd)
        ) {
          const error = new Error('exclusion_violation') as Error & { code: string };
          error.code = '23P01';
          throw error;
        }
      }

      if (sql.includes('start_time =')) {
        row.start_time = nextStart;
      }
      if (sql.includes('end_time =')) {
        row.end_time = nextEnd;
      }
      if (sql.includes('price_cents =')) {
        row.price_cents = typeof nextPrice === 'number' ? nextPrice : row.price_cents;
      }

      return { rows: [row], rowCount: 1 };
    }

    return { rows: [], rowCount: 0 };
  });
}

describe('Showtimes API', () => {
  beforeEach(() => {
    movies.clear();
    showtimes.clear();
    showtimeSeats.clear();
    confirmedReservations.clear();
    resetMockRedisStore();
    installDbMocks();
    seedMovie();
  });

  it('POST /showtimes valid → 201 with end_time = start + runtime', async () => {
    const startTime = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

    const res = await request(app)
      .post('/showtimes')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ movieId: MOVIE_ID, startTime, priceCents: 1200 });

    expect(res.status).toBe(201);
    const parsed = showtimeMutationResponseSchema.parse(res.body);
    expect(parsed.showtime.movieId).toBe(MOVIE_ID);
    expect(parsed.showtime.priceCents).toBe(1200);

    const expectedEnd = new Date(new Date(startTime).getTime() + 120 * 60 * 1000).toISOString();
    expect(parsed.showtime.endTime).toBe(expectedEnd);
  });

  it('POST /showtimes creates 120 showtime_seats with status available', async () => {
    const startTime = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

    const res = await request(app)
      .post('/showtimes')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ movieId: MOVIE_ID, startTime, priceCents: 1200 });

    const showtimeId = res.body.showtime.id as string;
    const seats = showtimeSeats.get(showtimeId) ?? [];
    expect(seats).toHaveLength(120);
    expect(seats.every((seat) => seat.status === 'available')).toBe(true);
  });

  it('POST /showtimes overlapping same screen → 409', async () => {
    const startTime = new Date(Date.now() + 24 * 60 * 60 * 1000);
    showtimes.set(SHOWTIME_ID, {
      id: SHOWTIME_ID,
      movie_id: MOVIE_ID,
      screen_id: 1,
      start_time: startTime,
      end_time: new Date(startTime.getTime() + 120 * 60 * 1000),
      price_cents: 1200,
      status: 'scheduled',
    });

    const res = await request(app)
      .post('/showtimes')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        movieId: MOVIE_ID,
        startTime: startTime.toISOString(),
        priceCents: 1200,
      });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('SCHEDULE_CONFLICT');
  });

  it('POST /showtimes violates 15-min gap → 409', async () => {
    const firstStart = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const firstEnd = new Date(firstStart.getTime() + 120 * 60 * 1000);
    showtimes.set(SHOWTIME_ID, {
      id: SHOWTIME_ID,
      movie_id: MOVIE_ID,
      screen_id: 1,
      start_time: firstStart,
      end_time: firstEnd,
      price_cents: 1200,
      status: 'scheduled',
    });

    const tooSoonStart = new Date(firstEnd.getTime() + 10 * 60 * 1000);

    const res = await request(app)
      .post('/showtimes')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        movieId: MOVIE_ID,
        startTime: tooSoonStart.toISOString(),
        priceCents: 1200,
      });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('SCHEDULE_CONFLICT');
  });

  it('POST /showtimes > 90 days ahead → 400', async () => {
    const startTime = new Date(Date.now() + 91 * 24 * 60 * 60 * 1000).toISOString();

    const res = await request(app)
      .post('/showtimes')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ movieId: MOVIE_ID, startTime, priceCents: 1200 });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('POST /showtimes with past startTime → 400', async () => {
    const res = await request(app)
      .post('/showtimes')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        movieId: MOVIE_ID,
        startTime: '2025-06-13T18:00:00.000Z',
        priceCents: 1200,
      });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.message).toMatch(/future/i);
  });

  it('PUT /showtimes/:id rescheduling to past startTime → 400', async () => {
    showtimes.set(SHOWTIME_ID, {
      id: SHOWTIME_ID,
      movie_id: MOVIE_ID,
      screen_id: 1,
      start_time: new Date(Date.now() + 24 * 60 * 60 * 1000),
      end_time: new Date(Date.now() + 26 * 60 * 60 * 1000),
      price_cents: 1200,
      status: 'scheduled',
    });

    const res = await request(app)
      .put(`/showtimes/${SHOWTIME_ID}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ startTime: '2025-06-13T18:00:00.000Z' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.message).toMatch(/future/i);
  });

  it('GET /movies/:id includes future showtimes in upcomingShowtimes', async () => {
    const futureStart = new Date(Date.now() + 48 * 60 * 60 * 1000);
    showtimes.set(SHOWTIME_ID, {
      id: SHOWTIME_ID,
      movie_id: MOVIE_ID,
      screen_id: 1,
      start_time: futureStart,
      end_time: new Date(futureStart.getTime() + 120 * 60 * 1000),
      price_cents: 1200,
      status: 'scheduled',
    });

    const res = await request(app).get(`/movies/${MOVIE_ID}`);

    expect(res.status).toBe(200);
    expect(res.body.upcomingShowtimes).toHaveLength(1);
    expect(res.body.upcomingShowtimes[0]?.id).toBe(SHOWTIME_ID);
    expect(res.body.movie.id).toBe(MOVIE_ID);
  });

  it('POST /showtimes non-admin → 403', async () => {
    const startTime = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

    const res = await request(app)
      .post('/showtimes')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ movieId: MOVIE_ID, startTime, priceCents: 1200 });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('GET /movies/:id/showtimes?date= returns only that date showtimes', async () => {
    const date = '2025-06-13';
    showtimes.set(SHOWTIME_ID, {
      id: SHOWTIME_ID,
      movie_id: MOVIE_ID,
      screen_id: 1,
      start_time: new Date('2025-06-13T18:00:00.000Z'),
      end_time: new Date('2025-06-13T20:00:00.000Z'),
      price_cents: 1200,
      status: 'scheduled',
    });
    showtimes.set(OTHER_SHOWTIME_ID, {
      id: OTHER_SHOWTIME_ID,
      movie_id: MOVIE_ID,
      screen_id: 1,
      start_time: new Date('2025-06-14T18:00:00.000Z'),
      end_time: new Date('2025-06-14T20:00:00.000Z'),
      price_cents: 1200,
      status: 'scheduled',
    });
    showtimeSeats.set(
      SHOWTIME_ID,
      Array.from({ length: 120 }, () => ({ showtime_id: SHOWTIME_ID, status: 'available' as const })),
    );

    const res = await request(app).get(`/movies/${MOVIE_ID}/showtimes?date=${date}`);

    expect(res.status).toBe(200);
    const parsed = showtimesListResponseSchema.parse(res.body);
    expect(parsed.showtimes).toHaveLength(1);
    expect(parsed.showtimes[0]?.id).toBe(SHOWTIME_ID);
    expect(parsed.showtimes[0]?.availableSeatCount).toBe(120);
  });

  it('GET /movies/:id/showtimes missing date → 400', async () => {
    const res = await request(app).get(`/movies/${MOVIE_ID}/showtimes`);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('PUT /showtimes/:id update price → 200', async () => {
    showtimes.set(SHOWTIME_ID, {
      id: SHOWTIME_ID,
      movie_id: MOVIE_ID,
      screen_id: 1,
      start_time: new Date(Date.now() + 24 * 60 * 60 * 1000),
      end_time: new Date(Date.now() + 26 * 60 * 60 * 1000),
      price_cents: 1200,
      status: 'scheduled',
    });

    const res = await request(app)
      .put(`/showtimes/${SHOWTIME_ID}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ priceCents: 1500 });

    expect(res.status).toBe(200);
    expect(res.body.showtime.priceCents).toBe(1500);
  });

  it('PUT /showtimes/:id with confirmed reservation → 409', async () => {
    showtimes.set(SHOWTIME_ID, {
      id: SHOWTIME_ID,
      movie_id: MOVIE_ID,
      screen_id: 1,
      start_time: new Date(Date.now() + 24 * 60 * 60 * 1000),
      end_time: new Date(Date.now() + 26 * 60 * 60 * 1000),
      price_cents: 1200,
      status: 'scheduled',
    });
    confirmedReservations.add(SHOWTIME_ID);

    const res = await request(app)
      .put(`/showtimes/${SHOWTIME_ID}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ priceCents: 1500 });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('CONFLICT');
  });

  it('POST /showtimes/:id/cancel → status cancelled', async () => {
    showtimes.set(SHOWTIME_ID, {
      id: SHOWTIME_ID,
      movie_id: MOVIE_ID,
      screen_id: 1,
      start_time: new Date(Date.now() + 24 * 60 * 60 * 1000),
      end_time: new Date(Date.now() + 26 * 60 * 60 * 1000),
      price_cents: 1200,
      status: 'scheduled',
    });

    const res = await request(app)
      .post(`/showtimes/${SHOWTIME_ID}/cancel`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.showtime.status).toBe('cancelled');
    expect(showtimes.get(SHOWTIME_ID)?.status).toBe('cancelled');
  });

  it('cache: second GET within 60s hits Redis', async () => {
    const date = '2025-06-13';
    showtimes.set(SHOWTIME_ID, {
      id: SHOWTIME_ID,
      movie_id: MOVIE_ID,
      screen_id: 1,
      start_time: new Date('2025-06-13T18:00:00.000Z'),
      end_time: new Date('2025-06-13T20:00:00.000Z'),
      price_cents: 1200,
      status: 'scheduled',
    });
    showtimeSeats.set(
      SHOWTIME_ID,
      Array.from({ length: 120 }, () => ({ showtime_id: SHOWTIME_ID, status: 'available' as const })),
    );

    const redis = getRedis();

    await request(app).get(`/movies/${MOVIE_ID}/showtimes?date=${date}`);
    await request(app).get(`/movies/${MOVIE_ID}/showtimes?date=${date}`);

    expect(vi.mocked(redis.get)).toHaveBeenCalledTimes(2);
    expect(vi.mocked(redis.set)).toHaveBeenCalledTimes(1);

    const listQueries = vi
      .mocked(queryRead)
      .mock.calls.filter(([sql]) => typeof sql === 'string' && sql.includes('start_time::date'));
    expect(listQueries).toHaveLength(1);
  });
});
