import { trace } from '@opentelemetry/api';
import type { NextFunction, Request, Response } from 'express';

export function traceContext() {
  return (_req: Request, _res: Response, next: NextFunction) => {
    next();
  };
}

export function getTraceContext() {
  const span = trace.getActiveSpan();
  const ctx = span?.spanContext();

  return {
    trace_id: ctx?.traceId,
    span_id: ctx?.spanId,
  };
}
