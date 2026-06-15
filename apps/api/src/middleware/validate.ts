import type { NextFunction, Request, Response } from 'express';
import type { ZodType } from 'zod';
import { AppError } from '../errors/AppError.js';

/** Parsed query params attached by validateQuery (req.query is read-only in Express 5). */
export type ValidatedRequest<T> = Request & { validatedQuery: T };

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

/**
 * Express middleware that parses and validates `req.query` with a Zod schema.
 * Coerced fields (page, limit) are stored on `req.validatedQuery` because
 * Express 5 treats `req.query` as read-only.
 */
export function validateQuery<T>(schema: ZodType<T>) {
  return (req: Request, _res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.query);
    if (!result.success) {
      const message = result.error.errors.map((e) => e.message).join('; ') || 'Validation failed';
      return next(new AppError(message, 400, 'VALIDATION_ERROR'));
    }
    (req as ValidatedRequest<T>).validatedQuery = result.data;
    next();
  };
}
