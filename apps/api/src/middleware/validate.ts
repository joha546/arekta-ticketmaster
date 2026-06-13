import type { NextFunction, Request, Response } from 'express';
import type { ZodType } from 'zod';
import { AppError } from '../errors/AppError.js';

/**
 * Express middleware that parses and validates `req.body` with a Zod schema.
 * On failure, forwards a 400 VALIDATION_ERROR to the error handler.
 */
export function validateBody<T>(schema: ZodType<T>) {
  return (req: Request, _res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      const message = result.error.errors.map((e) => e.message).join('; ') || 'Validation failed';
      return next(new AppError(message, 400, 'VALIDATION_ERROR'));
    }
    req.body = result.data;
    next();
  };
}
