import { getRedis } from '../redis/client.js';
import type { ShowtimeListItem } from './repository.js';

const CACHE_TTL_SEC = 60;

export function cacheKey(movieId: string, date: string): string {
  return `showtimes:${movieId}:${date}`;
}

export async function getCachedShowtimes(
  movieId: string,
  date: string,
): Promise<ShowtimeListItem[] | null> {
  const raw = await getRedis().get(cacheKey(movieId, date));
  if (!raw) {
    return null;
  }

  const parsed = JSON.parse(raw) as Array<
    Omit<ShowtimeListItem, 'startTime' | 'endTime'> & {
      startTime: string;
      endTime: string;
    }
  >;

  return parsed.map((item) => ({
    ...item,
    startTime: new Date(item.startTime),
    endTime: new Date(item.endTime),
  }));
}

export async function setCachedShowtimes(
  movieId: string,
  date: string,
  showtimes: ShowtimeListItem[],
): Promise<void> {
  await getRedis().set(cacheKey(movieId, date), JSON.stringify(showtimes), 'EX', CACHE_TTL_SEC);
}

export async function invalidateShowtimesCache(movieId: string, date: string): Promise<void> {
  await getRedis().del(cacheKey(movieId, date));
}

export function dateFromStartTime(startTime: Date): string {
  return startTime.toISOString().slice(0, 10);
}
