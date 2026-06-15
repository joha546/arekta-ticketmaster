import { AppError } from '../errors/AppError.js';
import { createShowtimesService } from '../showtimes/service.js';
import * as moviesRepo from './repository.js';
import type { MovieRecord } from './repository.js';
import type { GenreRecord } from '../genres/repository.js';
import {
  PgMovieSearchRepository,
  type MovieSearchRepository,
  type MovieSearchParams,
} from './searchRepository.js';

export type CreateMovieInput = {
  title: string;
  description?: string;
  runtimeMinutes: number;
  genreIds: number[];
  posterUrl?: string;
};

export type UpdateMovieInput = Partial<CreateMovieInput>;

/**
 * Business logic for the movie catalog.
 * Orchestrates repository writes, genre validation, search, and delete guards.
 */
export function createMoviesService(searchRepo: MovieSearchRepository = new PgMovieSearchRepository()) {
  const showtimes = createShowtimesService();

  /**
   * Public browse endpoint — delegates filtering and pagination to the search repository.
   * Only active movies are returned (enforced in PgMovieSearchRepository).
   */
  async function listMovies(params: MovieSearchParams) {
    const { movies, total } = await searchRepo.search(params);
    return { movies, total, page: params.page, limit: params.limit };
  }

  /**
   * Public detail view — returns movie, genres, and upcoming showtimes.
   */
  async function getMovieById(id: string) {
    const movie = await moviesRepo.findById(id);
    if (!movie) {
      throw new AppError('Movie not found', 404, 'NOT_FOUND');
    }

    const genres = await moviesRepo.findGenresByMovieId(id);
    const upcomingShowtimes = await showtimes.getUpcomingForMovieDetail(id);
    return { movie, genres, upcomingShowtimes };
  }

  /**
   * Admin create — validates genre IDs exist before persisting the movie and associations.
   */
  async function createMovie(input: CreateMovieInput) {
    await assertValidGenreIds(input.genreIds);

    const uniqueGenreIds = [...new Set(input.genreIds)];
    const movie = await moviesRepo.create({
      title: input.title,
      description: input.description,
      posterUrl: input.posterUrl,
      runtimeMinutes: input.runtimeMinutes,
      genreIds: uniqueGenreIds,
    });

    const genres = await moviesRepo.findGenresByMovieId(movie.id);
    return { movie, genres };
  }

  /**
   * Admin partial update — only supplied fields are written; genre list is replaced when provided.
   */
  async function updateMovie(id: string, input: UpdateMovieInput) {
    const existing = await moviesRepo.findById(id);
    if (!existing) {
      throw new AppError('Movie not found', 404, 'NOT_FOUND');
    }

    if (input.genreIds !== undefined) {
      await assertValidGenreIds(input.genreIds);
    }

    const movie = await moviesRepo.update(id, {
      title: input.title,
      description: input.description,
      posterUrl: input.posterUrl,
      runtimeMinutes: input.runtimeMinutes,
      genreIds: input.genreIds ? [...new Set(input.genreIds)] : undefined,
    });

    if (!movie) {
      throw new AppError('Movie not found', 404, 'NOT_FOUND');
    }

    const genres = await moviesRepo.findGenresByMovieId(id);
    return { movie, genres };
  }

  /**
   * Admin soft delete — sets is_active = false.
   * Blocked when future scheduled showtimes exist to protect existing bookings.
   */
  async function deleteMovie(id: string): Promise<void> {
    const existing = await moviesRepo.findById(id);
    if (!existing) {
      throw new AppError('Movie not found', 404, 'NOT_FOUND');
    }

    const futureShowtimes = await moviesRepo.countFutureScheduledShowtimes(id);
    if (futureShowtimes > 0) {
      throw new AppError(
        'Cannot delete movie with future scheduled showtimes',
        409,
        'CONFLICT',
      );
    }

    const deleted = await moviesRepo.softDelete(id);
    if (!deleted) {
      throw new AppError('Movie not found', 404, 'NOT_FOUND');
    }
  }

  return { listMovies, getMovieById, createMovie, updateMovie, deleteMovie };
}

/** Ensures every genre ID references a seeded genre row; rejects unknown IDs with 400. */
async function assertValidGenreIds(genreIds: number[]): Promise<GenreRecord[]> {
  const uniqueIds = [...new Set(genreIds)];
  const found = await moviesRepo.findGenresByIds(uniqueIds);

  if (found.length !== uniqueIds.length) {
    throw new AppError('One or more genre IDs are invalid', 400, 'VALIDATION_ERROR');
  }

  return found;
}

export type { MovieRecord };
