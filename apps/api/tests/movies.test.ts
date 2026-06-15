import { beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import {
  movieDetailResponseSchema,
  movieMutationResponseSchema,
  moviesListResponseSchema,
  posterUploadResponseSchema,
} from '@repo/shared';
import { createApp } from '../src/app.js';
import { loadEnv } from '../src/config/env.js';
import { queryRead, queryWrite } from '../src/db/pools.js';
import { createLogger } from '../src/middleware/logger.js';
import { signTestToken } from './helpers/jwt.js';

/** Matches seed rows in 0003_seed.sql. */
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

type MovieRow = {
  id: string;
  title: string;
  description: string | null;
  poster_url: string | null;
  runtime_minutes: number;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
};

type ShowtimeRow = {
  id: string;
  movie_id: string;
  status: 'scheduled' | 'cancelled' | 'completed';
  start_time: Date;
};

const movies = new Map<string, MovieRow>();
const movieGenres = new Map<string, number[]>();
const showtimes = new Map<string, ShowtimeRow>();

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

function getGenresForMovie(movieId: string) {
  const ids = movieGenres.get(movieId) ?? [];
  return SEED_GENRES.filter((g) => ids.includes(g.id)).sort((a, b) => a.name.localeCompare(b.name));
}

function matchesSearch(movie: MovieRow, term: string): boolean {
  const haystack = `${movie.title} ${movie.description ?? ''}`.toLowerCase();
  return haystack.includes(term.toLowerCase());
}

function runMovieSearch(sql: string, params?: unknown[]): { rows: Record<string, unknown>[]; rowCount: number } {
  let idx = 0;
  const search = sql.includes('m.title %') ? (params?.[idx++] as string | undefined) : undefined;
  const genreSlug = sql.includes('g2.slug') ? (params?.[idx++] as string | undefined) : undefined;
  const date = sql.includes('start_time::date') ? (params?.[idx++] as string | undefined) : undefined;
  const limit = Number(params?.[idx++] ?? 20);
  const offset = Number(params?.[idx++] ?? 0);

  let rows = [...movies.values()].filter((m) => m.is_active);

  if (search) {
    rows = rows.filter((m) => matchesSearch(m, search));
  }

  if (genreSlug) {
    const genre = SEED_GENRES.find((g) => g.slug === genreSlug);
    rows = rows.filter((m) => genre && (movieGenres.get(m.id) ?? []).includes(genre.id));
  }

  if (date) {
    rows = rows.filter((m) =>
      [...showtimes.values()].some(
        (s) =>
          s.movie_id === m.id &&
          s.status === 'scheduled' &&
          s.start_time.toISOString().startsWith(date),
      ),
    );
  }

  rows.sort((a, b) => b.created_at.getTime() - a.created_at.getTime());

  const total = rows.length;
  const pageRows = rows.slice(offset, offset + limit);

  return {
    rows: pageRows.map((m) => {
      const genres = getGenresForMovie(m.id);
      return {
        id: m.id,
        title: m.title,
        description: m.description,
        poster_url: m.poster_url,
        runtime_minutes: m.runtime_minutes,
        total_count: String(total),
        genre_ids: genres.map((g) => g.id),
        genre_names: genres.map((g) => g.name),
        genre_slugs: genres.map((g) => g.slug),
      };
    }),
    rowCount: pageRows.length,
  };
}

function installMovieDbMocks(): void {
  const handleReadQuery = async (sql: string, params?: unknown[]) => {
    if (sql.includes('FROM genres WHERE id = ANY')) {
      const ids = params?.[0] as number[];
      const rows = SEED_GENRES.filter((g) => ids.includes(g.id));
      return { rows, rowCount: rows.length };
    }

    if (sql.includes('FROM genres g') && sql.includes('movie_genres mg')) {
      const movieId = params?.[0] as string;
      const rows = getGenresForMovie(movieId);
      return { rows, rowCount: rows.length };
    }

    if (sql.includes('FROM movies') && sql.includes('WHERE id = $1') && !sql.includes('is_active = TRUE')) {
      const id = params?.[0] as string;
      const movie = movies.get(id);
      return { rows: movie ? [movie] : [], rowCount: movie ? 1 : 0 };
    }

    if (sql.includes('FROM movies') && sql.includes('WHERE id = $1') && sql.includes('is_active = TRUE')) {
      const id = params?.[0] as string;
      const movie = movies.get(id);
      const row = movie?.is_active ? movie : undefined;
      return { rows: row ? [row] : [], rowCount: row ? 1 : 0 };
    }

    if (sql.includes('COUNT(*)') && sql.includes('FROM showtimes')) {
      const movieId = params?.[0] as string;
      const count = [...showtimes.values()].filter(
        (s) => s.movie_id === movieId && s.status === 'scheduled' && s.start_time > new Date(),
      ).length;
      return { rows: [{ count: String(count) }], rowCount: 1 };
    }

    if (sql.includes('FROM movies m') && sql.includes('COUNT(*) OVER()')) {
      return runMovieSearch(sql, params);
    }

    if (sql.includes('FROM genres')) {
      return { rows: SEED_GENRES, rowCount: SEED_GENRES.length };
    }

    return { rows: [], rowCount: 0 };
  };

  vi.mocked(queryRead).mockImplementation(handleReadQuery);

  vi.mocked(queryWrite).mockImplementation(async (sql: string, params?: unknown[]) => {
    if (sql.trimStart().startsWith('SELECT')) {
      return handleReadQuery(sql, params);
    }

    if (sql.includes('INSERT INTO movies')) {
      const movie: MovieRow = {
        id: crypto.randomUUID(),
        title: params?.[0] as string,
        description: (params?.[1] as string | null) ?? null,
        poster_url: (params?.[2] as string | null) ?? null,
        runtime_minutes: params?.[3] as number,
        is_active: true,
        created_at: new Date(),
        updated_at: new Date(),
      };
      movies.set(movie.id, movie);
      return { rows: [movie], rowCount: 1 };
    }

    if (sql.includes('UPDATE movies') && sql.includes('is_active = FALSE')) {
      const id = params?.[0] as string;
      const movie = movies.get(id);
      if (movie?.is_active) {
        movie.is_active = false;
        return { rows: [], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    }

    if (sql.includes('UPDATE movies') && sql.includes('SET')) {
      const id = params?.[params.length - 1] as string;
      const movie = movies.get(id);
      if (!movie || !movie.is_active) {
        return { rows: [], rowCount: 0 };
      }

      let paramOffset = 0;
      if (sql.includes('title =')) {
        movie.title = params?.[paramOffset++] as string;
      }
      if (sql.includes('description =')) {
        movie.description = params?.[paramOffset++] as string | null;
      }
      if (sql.includes('poster_url =')) {
        movie.poster_url = params?.[paramOffset++] as string | null;
      }
      if (sql.includes('runtime_minutes =')) {
        movie.runtime_minutes = params?.[paramOffset++] as number;
      }

      movie.updated_at = new Date();
      return { rows: [movie], rowCount: 1 };
    }

    if (sql.includes('DELETE FROM movie_genres')) {
      const movieId = params?.[0] as string;
      movieGenres.delete(movieId);
      return { rows: [], rowCount: 1 };
    }

    if (sql.includes('INSERT INTO movie_genres')) {
      const movieId = params?.[0] as string;
      const genreIds = (params?.slice(1) as number[]) ?? [];
      movieGenres.set(movieId, genreIds);
      return { rows: [], rowCount: genreIds.length };
    }

    return { rows: [], rowCount: 0 };
  });
}

describe('GET /movies', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    movies.clear();
    movieGenres.clear();
    showtimes.clear();
    installMovieDbMocks();
  });

  it('returns 200 with an empty list initially', async () => {
    const response = await request(app).get('/movies');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ movies: [], total: 0, page: 1, limit: 20 });
    expect(moviesListResponseSchema.safeParse(response.body).success).toBe(true);
  });
});

describe('POST /movies', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    movies.clear();
    movieGenres.clear();
    showtimes.clear();
    installMovieDbMocks();
  });

  it('returns 201 with genres embedded for admin', async () => {
    const response = await request(app)
      .post('/movies')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        title: 'The Matrix',
        description: 'There is no spoon',
        runtimeMinutes: 136,
        genreIds: [1, 7],
        posterUrl: 'https://i.ibb.co/example/matrix.jpg',
      });

    expect(response.status).toBe(201);
    expect(response.body.movie.title).toBe('The Matrix');
    expect(response.body.genres).toHaveLength(2);
    expect(response.body.genres.map((g: { slug: string }) => g.slug).sort()).toEqual(['action', 'sci-fi']);
    expect(movieMutationResponseSchema.safeParse(response.body).success).toBe(true);
  });

  it('returns 403 for a regular user', async () => {
    const response = await request(app)
      .post('/movies')
      .set('Authorization', `Bearer ${userToken}`)
      .send({
        title: 'Forbidden Movie',
        runtimeMinutes: 90,
        genreIds: [1],
      });

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('FORBIDDEN');
  });

  it('returns 400 for invalid genreIds', async () => {
    const response = await request(app)
      .post('/movies')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        title: 'Bad Genres',
        runtimeMinutes: 90,
        genreIds: [999],
      });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });
});

describe('GET /movies/:id', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    movies.clear();
    movieGenres.clear();
    showtimes.clear();
    installMovieDbMocks();
  });

  it('returns 200 with genres', async () => {
    const created = await request(app)
      .post('/movies')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        title: 'Inception',
        description: 'Dream within a dream',
        runtimeMinutes: 148,
        genreIds: [1, 8],
      });

    const movieId = created.body.movie.id as string;

    const response = await request(app).get(`/movies/${movieId}`);

    expect(response.status).toBe(200);
    expect(response.body.movie.title).toBe('Inception');
    expect(response.body.genres).toHaveLength(2);
    expect(response.body.upcomingShowtimes).toEqual([]);
    expect(movieDetailResponseSchema.safeParse(response.body).success).toBe(true);
  });
});

describe('GET /movies filters', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    movies.clear();
    movieGenres.clear();
    showtimes.clear();
    installMovieDbMocks();
  });

  it('filters by genre slug', async () => {
    await request(app)
      .post('/movies')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ title: 'Action Hero', runtimeMinutes: 100, genreIds: [1] });

    await request(app)
      .post('/movies')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ title: 'Laugh Track', runtimeMinutes: 95, genreIds: [2] });

    const response = await request(app).get('/movies?genre=action');

    expect(response.status).toBe(200);
    expect(response.body.total).toBe(1);
    expect(response.body.movies[0].title).toBe('Action Hero');
  });

  it('matches search term in title', async () => {
    await request(app)
      .post('/movies')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ title: 'The Matrix Reloaded', runtimeMinutes: 120, genreIds: [7] });

    await request(app)
      .post('/movies')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ title: 'Unrelated Comedy', runtimeMinutes: 90, genreIds: [2] });

    const response = await request(app).get('/movies?search=matrix');

    expect(response.status).toBe(200);
    expect(response.body.total).toBe(1);
    expect(response.body.movies[0].title).toContain('Matrix');
  });

  it('excludes inactive movies from the public list', async () => {
    const created = await request(app)
      .post('/movies')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ title: 'To Be Deleted', runtimeMinutes: 90, genreIds: [4] });

    const movieId = created.body.movie.id as string;
    const movie = movies.get(movieId)!;
    movie.is_active = false;

    const response = await request(app).get('/movies');

    expect(response.status).toBe(200);
    expect(response.body.total).toBe(0);
    expect(response.body.movies).toHaveLength(0);
  });
});

describe('PUT /movies/:id', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    movies.clear();
    movieGenres.clear();
    showtimes.clear();
    installMovieDbMocks();
  });

  it('updates title and genres', async () => {
    const created = await request(app)
      .post('/movies')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ title: 'Old Title', runtimeMinutes: 100, genreIds: [1] });

    const movieId = created.body.movie.id as string;

    const response = await request(app)
      .put(`/movies/${movieId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ title: 'New Title', genreIds: [2, 4] });

    expect(response.status).toBe(200);
    expect(response.body.movie.title).toBe('New Title');
    expect(response.body.genres.map((g: { slug: string }) => g.slug).sort()).toEqual(['comedy', 'drama']);
  });
});

describe('DELETE /movies/:id', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    movies.clear();
    movieGenres.clear();
    showtimes.clear();
    installMovieDbMocks();
  });

  it('returns 204 and excludes the movie from the public list', async () => {
    const created = await request(app)
      .post('/movies')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ title: 'Soft Delete Me', runtimeMinutes: 90, genreIds: [5] });

    const movieId = created.body.movie.id as string;

    const deleteResponse = await request(app)
      .delete(`/movies/${movieId}`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(deleteResponse.status).toBe(204);

    const listResponse = await request(app).get('/movies');
    expect(listResponse.body.total).toBe(0);

    const detailResponse = await request(app).get(`/movies/${movieId}`);
    expect(detailResponse.status).toBe(404);
  });

  it('returns 409 when future scheduled showtimes exist', async () => {
    const created = await request(app)
      .post('/movies')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ title: 'Has Showtimes', runtimeMinutes: 120, genreIds: [1] });

    const movieId = created.body.movie.id as string;
    showtimes.set(crypto.randomUUID(), {
      id: crypto.randomUUID(),
      movie_id: movieId,
      status: 'scheduled',
      start_time: new Date(Date.now() + 86_400_000),
    });

    const response = await request(app)
      .delete(`/movies/${movieId}`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('CONFLICT');
  });
});

describe('POST /admin/uploads/poster', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    movies.clear();
    movieGenres.clear();
    showtimes.clear();
    installMovieDbMocks();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          success: true,
          data: { url: 'https://i.ibb.co/test/poster.png', display_url: 'https://i.ibb.co/test/poster.png' },
        }),
      }),
    );
  });

  it('returns 200 with posterUrl for admin', async () => {
    const response = await request(app)
      .post('/admin/uploads/poster')
      .set('Authorization', `Bearer ${adminToken}`)
      .attach('image', Buffer.from('fake-image'), 'poster.png');

    expect(response.status).toBe(200);
    expect(response.body.posterUrl).toBe('https://i.ibb.co/test/poster.png');
    expect(posterUploadResponseSchema.safeParse(response.body).success).toBe(true);
  });

  it('returns 403 for non-admin', async () => {
    const response = await request(app)
      .post('/admin/uploads/poster')
      .set('Authorization', `Bearer ${userToken}`)
      .attach('image', Buffer.from('fake-image'), 'poster.png');

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('FORBIDDEN');
  });
});
