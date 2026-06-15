import { createShowtimesService } from './service.js';

const COMPLETION_INTERVAL_MS = 60 * 60 * 1000;

let intervalHandle: ReturnType<typeof setInterval> | null = null;

/**
 * Marks past showtimes as completed on an interval (dev stub for pg_cron in production).
 */
export function startShowtimeCompletionScheduler(): void {
  if (intervalHandle) {
    return;
  }

  const showtimes = createShowtimesService();

  const run = () => {
    void showtimes.markCompletedShowtimes().catch((error: unknown) => {
      console.error('Showtime completion job failed', error);
    });
  };

  run();
  intervalHandle = setInterval(run, COMPLETION_INTERVAL_MS);
}

export function stopShowtimeCompletionScheduler(): void {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
}
