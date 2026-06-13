import type { NextFunction, Request, Response } from 'express';
import type pino from 'pino';
import { AppError } from '../errors/AppError.js';
import { getErrorCounter } from '../instrumentation.js';
import { getTraceContext } from './traceContext.js';

export function notFoundHandler() {
  return (_req: Request, _res: Response, next: NextFunction) => {
    next(new AppError('Route not found', 404, 'NOT_FOUND'));
  };
}

export function errorHandler(logger: pino.Logger) {
  return (err: Error, req: Request, res: Response, _next: NextFunction) => {
    const isAppError = err instanceof AppError;
    const statusCode = isAppError ? err.statusCode : 500;
    const code = isAppError ? err.code : 'INTERNAL_ERROR';
    const message = isAppError ? err.message : 'Internal server error';

    logger.error(
      {
        err,
        requestId: req.id,
        ...getTraceContext(),
      },
      'Request failed',
    );

    getErrorCounter().add(1, { code, status_code: String(statusCode) });

    res.status(statusCode).json({
      error: {
        code,
        message,
        requestId: req.id,
      },
    });
  };
}
