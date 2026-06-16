import type { Env } from '../config/env.js';
import { createReservationsService } from './service.js';

const EXPIRY_INTERVAL_MS = 60 * 1000;

let intervalHandle: ReturnType<typeof setInterval> | null = null;

/**
 * Expires pending reservations on an interval (dev stub for pg_cron in production).
 */
export function startReservationExpiryJob(env: Env): void {
  if (intervalHandle) {
    return;
  }

  const reservations = createReservationsService(env);

  const run = () => {
    void reservations.expireStaleReservations().catch((error: unknown) => {
      console.error('Reservation expiry job failed', error);
    });
  };

  run();
  intervalHandle = setInterval(run, EXPIRY_INTERVAL_MS);
}

export function stopReservationExpiryJob(): void {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
}
