import { queryRead, queryWrite } from '../db/pools.js';
import type { GenreRecord } from '../genres/repository.js';

/** Public movie shape returned by detail and mutation endpoints. */
export type MovieRecord = {
  id: string;
  title: string;
  description: string | null;
  posterUrl: string | null;
  runtimeMinutes: number;
};

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

type GenreRow = {
  id: number;
  name: string;
  slug: string;
};

function mapMovie(row: MovieRow): MovieRecord {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    posterUrl: row.poster_url,
    runtimeMinutes: row.runtime_minutes,
  };
}

function mapGenre(row: GenreRow): GenreRecord {
  return { id: row.id, name: row.name, slug: row.slug };
}

/**
 * Data access for `movies` and `movie_genres` tables.
 * Writes go to the primary; reads use read replicas via `queryRead`.
 */
export async function create(input: {
  title: string;
  description?: string;
  posterUrl?: string;
  runtimeMinutes: number;
  genreIds: number[];
}): Promise<MovieRecord> {
  const result = await queryWrite<MovieRow>(
    `INSERT INTO movies (title, description, poster_url, runtime_minutes)
     VALUES ($1, $2, $3, $4)
     RETURNING id, title, description, poster_url, runtime_minutes, is_active, created_at, updated_at`,
    [input.title, input.description ?? null, input.posterUrl ?? null, input.runtimeMinutes],
  );

  const movie = result.rows[0];
  if (!movie) {
    throw new Error('Failed to create movie');
  }

  await replaceGenres(movie.id, input.genreIds);
  return mapMovie(movie);
}

export async function update(
  id: string,
  input: {
    title?: string;
    description?: string | null;
    posterUrl?: string | null;
    runtimeMinutes?: number;
    genreIds?: number[];
  },
): Promise<MovieRecord | null> {
  const fields: string[] = [];
  const values: unknown[] = [];
  let paramIndex = 1;

  if (input.title !== undefined) {
    fields.push(`title = $${paramIndex++}`);
    values.push(input.title);
  }
  if (input.description !== undefined) {
    fields.push(`description = $${paramIndex++}`);
    values.push(input.description);
  }
  if (input.posterUrl !== undefined) {
    fields.push(`poster_url = $${paramIndex++}`);
    values.push(input.posterUrl);
  }
  if (input.runtimeMinutes !== undefined) {
    fields.push(`runtime_minutes = $${paramIndex++}`);
    values.push(input.runtimeMinutes);
  }

  if (fields.length === 0 && input.genreIds === undefined) {
    return findById(id);
  }

  values.push(id);

  const result =
    fields.length > 0
      ? await queryWrite<MovieRow>(
          `UPDATE movies SET ${fields.join(', ')}
           WHERE id = $${paramIndex} AND is_active = TRUE
           RETURNING id, title, description, poster_url, runtime_minutes, is_active, created_at, updated_at`,
          values,
        )
      : await queryRead<MovieRow>(
          `SELECT id, title, description, poster_url, runtime_minutes, is_active, created_at, updated_at
           FROM movies
           WHERE id = $1 AND is_active = TRUE`,
          [id],
        );

  const movie = result.rows[0];
  if (!movie) {
    return null;
  }

  if (input.genreIds !== undefined) {
    await replaceGenres(id, input.genreIds);
  }

  return mapMovie(movie);
}

/** Sets `is_active = false` — movie remains in DB for reporting and FK integrity. */
export async function softDelete(id: string): Promise<boolean> {
  const result = await queryWrite(
    `UPDATE movies SET is_active = FALSE WHERE id = $1 AND is_active = TRUE`,
    [id],
  );
  return (result.rowCount ?? 0) > 0;
}

export async function findById(id: string, options?: { includeInactive?: boolean }): Promise<MovieRecord | null> {
  const activeFilter = options?.includeInactive ? '' : 'AND is_active = TRUE';

  const result = await queryRead<MovieRow>(
    `SELECT id, title, description, poster_url, runtime_minutes, is_active, created_at, updated_at
     FROM movies
     WHERE id = $1 ${activeFilter}`,
    [id],
  );

  const row = result.rows[0];
  return row ? mapMovie(row) : null;
}

export async function findGenresByMovieId(movieId: string): Promise<GenreRecord[]> {
  const result = await queryRead<GenreRow>(
    `SELECT g.id, g.name, g.slug
     FROM genres g
     INNER JOIN movie_genres mg ON mg.genre_id = g.id
     WHERE mg.movie_id = $1
     ORDER BY g.name ASC`,
    [movieId],
  );
  return result.rows.map(mapGenre);
}

/** Returns genre rows whose ids exist in the database (for validating admin input). */
export async function findGenresByIds(ids: number[]): Promise<GenreRecord[]> {
  if (ids.length === 0) {
    return [];
  }

  const result = await queryRead<GenreRow>(
    `SELECT id, name, slug FROM genres WHERE id = ANY($1::smallint[])`,
    [ids],
  );
  return result.rows.map(mapGenre);
}

/**
 * Counts scheduled showtimes in the future for a movie.
 * Used by the service layer to block soft-delete when bookings would break.
 */
export async function countFutureScheduledShowtimes(movieId: string): Promise<number> {
  const result = await queryRead<{ count: string }>(
    `SELECT COUNT(*)::text AS count
     FROM showtimes
     WHERE movie_id = $1
       AND status = 'scheduled'
       AND start_time > NOW()`,
    [movieId],
  );
  return Number(result.rows[0]?.count ?? 0);
}

async function replaceGenres(movieId: string, genreIds: number[]): Promise<void> {
  await queryWrite(`DELETE FROM movie_genres WHERE movie_id = $1`, [movieId]);

  if (genreIds.length === 0) {
    return;
  }

  const values = genreIds.map((_, index) => `($1, $${index + 2})`).join(', ');
  await queryWrite(`INSERT INTO movie_genres (movie_id, genre_id) VALUES ${values}`, [movieId, ...genreIds]);
}
