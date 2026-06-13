import { getRedis } from '../redis/client.js';

const FAIL_KEY_PREFIX = 'login_fail:';
const LOCK_KEY_PREFIX = 'login_lock:';

/** Failed attempts allowed within the rolling window before lockout. */
const MAX_FAILURES = 5;

/** Rolling window for counting failed login attempts (seconds). */
const FAILURE_WINDOW_SEC = 60;

/** Duration of account lock after too many failures (seconds). */
const LOCK_DURATION_SEC = 15 * 60;

function failKey(email: string): string {
  return `${FAIL_KEY_PREFIX}${email.toLowerCase()}`;
}

function lockKey(email: string): string {
  return `${LOCK_KEY_PREFIX}${email.toLowerCase()}`;
}

/**
 * Returns true when the account is temporarily locked after repeated failures.
 */
export async function isLocked(email: string): Promise<boolean> {
  const redis = getRedis();
  const locked = await redis.get(lockKey(email));
  return locked !== null;
}

/**
 * Increments the failure counter and applies a 15-minute lock after 5 failures/min.
 */
export async function recordFailure(email: string): Promise<void> {
  const redis = getRedis();
  const key = failKey(email);
  const count = await redis.incr(key);

  if (count === 1) {
    await redis.expire(key, FAILURE_WINDOW_SEC);
  }

  if (count >= MAX_FAILURES) {
    await redis.set(lockKey(email), '1', 'EX', LOCK_DURATION_SEC);
    await redis.del(key);
  }
}

/** Clears failure and lock keys after a successful login. */
export async function clearOnSuccess(email: string): Promise<void> {
  const redis = getRedis();
  await redis.del(failKey(email), lockKey(email));
}
