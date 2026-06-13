import pino from 'pino';
import { pinoHttp } from 'pino-http';
import type { Request, Response, RequestHandler } from 'express';
import type { Env } from '../config/env.js';
import { getTraceContext } from './traceContext.js';

export function createLogger(env: Env) {
  return pino({
    level: env.LOG_LEVEL,
    redact: {
      paths: ['req.headers.authorization', 'req.headers.cookie'],
      remove: true,
    },
  });
}

export function loggerMiddleware(logger: pino.Logger): RequestHandler {
  const middleware = pinoHttp({
    logger,
    customProps: (req: Request) => ({
      requestId: req.id,
      ...getTraceContext(),
    }),
    serializers: {
      req: (req: Request) => ({
        id: req.id,
        method: req.method,
        url: req.url,
      }),
      res: (res: Response) => ({
        statusCode: res.statusCode,
      }),
    },
  });

  return middleware;
}
