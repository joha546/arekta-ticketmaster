import { AppError } from '../errors/AppError.js';
import * as moviesRepo from '../movies/repository.js';
import * as showtimesCache from './cache.js';
import * as showtimesRepo from './repository.js';
import type { ShowtimeListItem, ShowtimeRecord, UpcomingShowtimeRecord } from './repository.js';

const MAX_ADVANCE_MS = 90 * 24 * 60 * 60 * 1000;

export type CreateShowtimeInput = {
  movieId: string;
  startTime: string;
  priceCents: number;
};

export type UpdateShowtimeInput = {
  startTime?: string;
  priceCents?: number;
};

function toApiShowtime(showtime: ShowtimeRecord) {
  return {
    id: showtime.id,
    movieId: showtime.movieId,
    screenId: showtime.screenId,
    startTime: showtime.startTime.toISOString(),
    endTime: showtime.endTime.toISOString(),
    priceCents: showtime.priceCents,
    status: showtime.status,
  };
}

function toApiListItem(item: ShowtimeListItem) {
  return {
    id: item.id,
    startTime: item.startTime.toISOString(),
    endTime: item.endTime.toISOString(),
    priceCents: item.priceCents,
    status: item.status,
    availableSeatCount: item.availableSeatCount,
  };
}

function toApiUpcoming(item: UpcomingShowtimeRecord) {
  return {
    id: item.id,
    startTime: item.startTime.toISOString(),
    endTime: item.endTime.toISOString(),
    priceCents: item.priceCents,
    status: item.status,
  };
}

function assertWithinAdvanceWindow(startTime: Date): void {
  const maxStart = new Date(Date.now() + MAX_ADVANCE_MS);
  if (startTime.getTime() > maxStart.getTime()) {
    throw new AppError(
      'Showtime cannot be more than 90 days in advance',
      400,
      'VALIDATION_ERROR',
    );
  }
}

function assertNotInPast(startTime: Date): void {
  if (startTime.getTime() <= Date.now()) {
    throw new AppError('Showtime must be scheduled in the future', 400, 'VALIDATION_ERROR');
  }
}

function assertValidStartTime(startTime: Date): void {
  assertNotInPast(startTime);
  assertWithinAdvanceWindow(startTime);
}

function computeEndTime(startTime: Date, runtimeMinutes: number): Date {
  return new Date(startTime.getTime() + runtimeMinutes * 60 * 1000);
}

async function loadMovieForScheduling(movieId: string) {
  const movie = await moviesRepo.findById(movieId);
  if (!movie) {
    throw new AppError('Movie not found', 404, 'NOT_FOUND');
  }
  return movie;
}

function handleScheduleConflict(error: unknown): never {
  if (showtimesRepo.isScheduleConflictError(error)) {
    throw new AppError('Showtime conflicts with an existing schedule', 409, 'SCHEDULE_CONFLICT');
  }
  throw error;
}

/**
 * Business logic for showtime scheduling, listing, and lifecycle.
 */
export function createShowtimesService() {
  async function listShowtimesForMovie(movieId: string, date: string) {
    const movie = await moviesRepo.findById(movieId);
    if (!movie) {
      throw new AppError('Movie not found', 404, 'NOT_FOUND');
    }

    const cached = await showtimesCache.getCachedShowtimes(movieId, date);
    if (cached) {
      return { showtimes: cached.map(toApiListItem) };
    }

    const showtimes = await showtimesRepo.listByMovieAndDate(movieId, date);
    if (showtimes.length > 0) {
      await showtimesCache.setCachedShowtimes(movieId, date, showtimes);
    }
    return { showtimes: showtimes.map(toApiListItem) };
  }

  async function getUpcomingForMovieDetail(movieId: string) {
    const upcoming = await showtimesRepo.listUpcomingByMovieId(movieId);
    return upcoming.map(toApiUpcoming);
  }

  async function createShowtime(input: CreateShowtimeInput) {
    const movie = await loadMovieForScheduling(input.movieId);
    const startTime = new Date(input.startTime);
    assertValidStartTime(startTime);

    const endTime = computeEndTime(startTime, movie.runtimeMinutes);

    let showtime: ShowtimeRecord;
    try {
      showtime = await showtimesRepo.create({
        movieId: input.movieId,
        startTime,
        endTime,
        priceCents: input.priceCents,
      });
    } catch (error) {
      handleScheduleConflict(error);
    }

    await showtimesCache.invalidateShowtimesCache(
      input.movieId,
      showtimesCache.dateFromStartTime(startTime),
    );

    return { showtime: toApiShowtime(showtime) };
  }

  async function updateShowtime(id: string, input: UpdateShowtimeInput) {
    const existing = await showtimesRepo.findById(id);
    if (!existing) {
      throw new AppError('Showtime not found', 404, 'NOT_FOUND');
    }

    if (existing.status !== 'scheduled') {
      throw new AppError('Only scheduled showtimes can be updated', 409, 'CONFLICT');
    }

    if (await showtimesRepo.hasConfirmedReservations(id)) {
      throw new AppError(
        'Cannot update showtime with confirmed reservations',
        409,
        'CONFLICT',
      );
    }

    const previousDate = showtimesCache.dateFromStartTime(existing.startTime);
    let startTime = existing.startTime;
    let endTime = existing.endTime;

    if (input.startTime !== undefined) {
      startTime = new Date(input.startTime);
      assertValidStartTime(startTime);
      const movie = await loadMovieForScheduling(existing.movieId);
      endTime = computeEndTime(startTime, movie.runtimeMinutes);
    }

    let showtime: ShowtimeRecord | null;
    try {
      showtime = await showtimesRepo.update(id, {
        startTime: input.startTime !== undefined ? startTime : undefined,
        endTime: input.startTime !== undefined ? endTime : undefined,
        priceCents: input.priceCents,
      });
    } catch (error) {
      handleScheduleConflict(error);
    }

    if (!showtime) {
      throw new AppError('Showtime not found', 404, 'NOT_FOUND');
    }

    await showtimesCache.invalidateShowtimesCache(existing.movieId, previousDate);
    if (input.startTime !== undefined) {
      const nextDate = showtimesCache.dateFromStartTime(startTime);
      if (nextDate !== previousDate) {
        await showtimesCache.invalidateShowtimesCache(existing.movieId, nextDate);
      }
    }

    return { showtime: toApiShowtime(showtime) };
  }

  async function cancelShowtime(id: string) {
    const existing = await showtimesRepo.findById(id);
    if (!existing) {
      throw new AppError('Showtime not found', 404, 'NOT_FOUND');
    }

    if (existing.status !== 'scheduled') {
      throw new AppError('Only scheduled showtimes can be cancelled', 409, 'CONFLICT');
    }

    const showtime = await showtimesRepo.cancel(id);
    if (!showtime) {
      throw new AppError('Showtime not found', 404, 'NOT_FOUND');
    }

    await showtimesCache.invalidateShowtimesCache(
      existing.movieId,
      showtimesCache.dateFromStartTime(existing.startTime),
    );

    return { showtime: toApiShowtime(showtime) };
  }

  async function markCompletedShowtimes() {
    return showtimesRepo.markCompleted();
  }

  return {
    listShowtimesForMovie,
    getUpcomingForMovieDetail,
    createShowtime,
    updateShowtime,
    cancelShowtime,
    markCompletedShowtimes,
  };
}
