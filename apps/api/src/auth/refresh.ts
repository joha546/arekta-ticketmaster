import { createHash, randomBytes } from 'node:crypto';
import type { Response } from 'express';
import type { Env } from '../config/env.js';
import { AppError } from '../errors/AppError.js';
import { getRedis } from '../redis/client.js';

/** HttpOnly cookie name carrying the opaque refresh token. */
export const REFRESH_COOKIE_NAME = 'refreshToken';

type SessionRecord = {
  userId: string;
};

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function sessionKey(tokenHash: string): string {
  return `session:${tokenHash}`;
}

function refreshTtlSeconds(env: Env): number {
  return parseDurationToSeconds(env.JWT_REFRESH_TTL);
}

/**
 * Parses simple duration strings like `7d`, `15m`, `1h` into seconds.
 */
function parseDurationToSeconds(duration: string): number {
  const match = /^(\d+)([smhd])$/.exec(duration.trim());
  if (!match) {
    return 7 * 24 * 60 * 60;
  }

  const value = Number(match[1]);
  const unit = match[2];

  switch (unit) {
    case 's':
      return value;
    case 'm':
      return value * 60;
    case 'h':
      return value * 60 * 60;
    case 'd':
      return value * 24 * 60 * 60;
    default:
      return 7 * 24 * 60 * 60;
  }
}

/**
 * Creates a new refresh session in Redis and returns the opaque token value.
 */
export async function createSession(userId: string, env: Env): Promise<string> {
  const refreshToken = randomBytes(32).toString('hex');
  const tokenHash = hashToken(refreshToken);
  const ttl = refreshTtlSeconds(env);

  const redis = getRedis();
  const record: SessionRecord = { userId };
  await redis.set(sessionKey(tokenHash), JSON.stringify(record), 'EX', ttl);

  return refreshToken;
}

/**
 * Validates an existing refresh token, revokes it, and issues a new one (rotation).
 */
export async function rotateSession(
  refreshToken: string,
  env: Env,
): Promise<{ userId: string; newRefreshToken: string }> {
  const tokenHash = hashToken(refreshToken);
  const redis = getRedis();
  const key = sessionKey(tokenHash);
  const raw = await redis.get(key);

  if (!raw) {
    throw new AppError('Invalid or expired refresh token', 401, 'INVALID_REFRESH');
  }

  const record = JSON.parse(raw) as SessionRecord;
  await redis.del(key);

  const newRefreshToken = await createSession(record.userId, env);
  return { userId: record.userId, newRefreshToken };
}

/**
 * Revokes a refresh session. Safe to call when the token is already gone.
 */
export async function revokeSession(refreshToken: string): Promise<void> {
  const tokenHash = hashToken(refreshToken);
  await getRedis().del(sessionKey(tokenHash));
}

/**
 * Sets the refresh token as an HttpOnly cookie on the response.
 */
export function setRefreshCookie(res: Response, refreshToken: string, env: Env): void {
  const maxAgeMs = refreshTtlSeconds(env) * 1000;

  res.cookie(REFRESH_COOKIE_NAME, refreshToken, {
    httpOnly: true,
    secure: env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: maxAgeMs,
  });
}

/** Clears the refresh token cookie after logout. */
export function clearRefreshCookie(res: Response): void {
  res.clearCookie(REFRESH_COOKIE_NAME, { path: '/' });
}
