import { createSeatsService } from './service.js';
import type { Env } from '../config/env.js';

const EXPIRY_INTERVAL_MS = 30 * 1000;

let intervalHandle: ReturnType<typeof setInterval> | null = null;

/**
 * Releases expired seat holds on an interval (dev stub for pg_cron in production).
 */
export function startHoldExpiryJob(env: Env): void {
  if (intervalHandle) {
    return;
  }

  const seats = createSeatsService(env);

  const run = () => {
    void seats.expireStaleHolds().catch((error: unknown) => {
      console.error('Hold expiry job failed', error);
    });
  };

  run();
  intervalHandle = setInterval(run, EXPIRY_INTERVAL_MS);
}

export function stopHoldExpiryJob(): void {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
}
