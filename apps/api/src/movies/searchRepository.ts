import { queryRead } from '../db/pools.js';
import type { GenreRecord } from '../genres/repository.js';
import type { MovieRecord } from './repository.js';

export type MovieSearchParams = {
  search?: string;
  genreSlug?: string;
  date?: string;
  page: number;
  limit: number;
  sort: 'title' | 'newest';
};

export type MovieListItem = MovieRecord & {
  genres: GenreRecord[];
};

export type MovieSearchResult = {
  movies: MovieListItem[];
  total: number;
};

/**
 * Abstraction for movie catalog search.
 * Phase 1 uses PostgreSQL trigram search; Phase 2 can swap in Elasticsearch
 * without changing the service or route layers.
 */
export interface MovieSearchRepository {
  search(params: MovieSearchParams): Promise<MovieSearchResult>;
}

type MovieSearchRow = {
  id: string;
  title: string;
  description: string | null;
  poster_url: string | null;
  runtime_minutes: number;
  total_count: string;
  genre_ids: number[] | null;
  genre_names: string[] | null;
  genre_slugs: string[] | null;
};

function mapSearchRow(row: MovieSearchRow): MovieListItem {
  const genres: GenreRecord[] = [];
  const ids = row.genre_ids ?? [];
  const names = row.genre_names ?? [];
  const slugs = row.genre_slugs ?? [];

  for (let i = 0; i < ids.length; i += 1) {
    genres.push({
      id: ids[i]!,
      name: names[i] ?? '',
      slug: slugs[i] ?? '',
    });
  }

  return {
    id: row.id,
    title: row.title,
    description: row.description,
    posterUrl: row.poster_url,
    runtimeMinutes: row.runtime_minutes,
    genres,
  };
}

/**
 * PostgreSQL implementation of movie search.
 * Uses pg_trgm `%` operator for fuzzy title/description matching and joins
 * genres + showtimes for filter params.
 */
export class PgMovieSearchRepository implements MovieSearchRepository {
  async search(params: MovieSearchParams): Promise<MovieSearchResult> {
    const conditions = ['m.is_active = TRUE'];
    const values: unknown[] = [];
    let paramIndex = 1;

    if (params.search) {
      conditions.push(
        `(m.title % $${paramIndex} OR COALESCE(m.description, '') % $${paramIndex} OR m.title ILIKE '%' || $${paramIndex} || '%')`,
      );
      values.push(params.search);
      paramIndex += 1;
    }

    if (params.genreSlug) {
      conditions.push(`EXISTS (
        SELECT 1 FROM movie_genres mg2
        INNER JOIN genres g2 ON g2.id = mg2.genre_id
        WHERE mg2.movie_id = m.id AND g2.slug = $${paramIndex}
      )`);
      values.push(params.genreSlug);
      paramIndex += 1;
    }

    if (params.date) {
      conditions.push(`EXISTS (
        SELECT 1 FROM showtimes s
        WHERE s.movie_id = m.id
          AND s.status = 'scheduled'
          AND s.start_time::date = $${paramIndex}::date
      )`);
      values.push(params.date);
      paramIndex += 1;
    }

    const whereClause = conditions.join(' AND ');
    const orderClause =
      params.sort === 'title' ? 'm.title ASC' : 'm.created_at DESC';
    const offset = (params.page - 1) * params.limit;

    values.push(params.limit, offset);

    const result = await queryRead<MovieSearchRow>(
      `SELECT
         m.id,
         m.title,
         m.description,
         m.poster_url,
         m.runtime_minutes,
         COUNT(*) OVER()::text AS total_count,
         ARRAY_AGG(g.id ORDER BY g.name) FILTER (WHERE g.id IS NOT NULL) AS genre_ids,
         ARRAY_AGG(g.name ORDER BY g.name) FILTER (WHERE g.name IS NOT NULL) AS genre_names,
         ARRAY_AGG(g.slug ORDER BY g.name) FILTER (WHERE g.slug IS NOT NULL) AS genre_slugs
       FROM movies m
       LEFT JOIN movie_genres mg ON mg.movie_id = m.id
       LEFT JOIN genres g ON g.id = mg.genre_id
       WHERE ${whereClause}
       GROUP BY m.id, m.title, m.description, m.poster_url, m.runtime_minutes, m.created_at
       ORDER BY ${orderClause}
       LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
      values,
    );

    const total = result.rows.length > 0 ? Number(result.rows[0]!.total_count) : 0;

    return {
      movies: result.rows.map(mapSearchRow),
      total,
    };
  }
}
