import { Router, type Router as ExpressRouter } from 'express';
import type { Env } from '../config/env.js';
import { createUploadsRouter } from './uploads.routes.js';

/**
 * Mounts admin-only routes under `/admin/*`.
 * Phase 03: poster uploads. Later phases add reporting and operational tools.
 */
export function createAdminRouter(env: Env): ExpressRouter {
  const router = Router();

  router.use('/uploads', createUploadsRouter(env));

  return router;
}
