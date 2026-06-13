import type { NextFunction, Request, Response } from 'express';
import { getRedis } from '../redis/client.js';

/**
 * Stub rate limiter using Redis INCR. Full limits wired in Phase 01.
 */
export function rateLimitStub() {
  return async (req: Request, _res: Response, next: NextFunction) => {
    try {
      const redis = getRedis();
      const key = `rate_limit:${req.ip ?? 'unknown'}`;
      await redis.incr(key);
      next();
    } catch (error) {
      next(error);
    }
  };
}
