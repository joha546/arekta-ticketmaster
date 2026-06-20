import { Router, type Router as ExpressRouter, type Request, type Response } from 'express';
import type { Env } from '../config/env.js';
import { createUploadsRouter } from './uploads.routes.js';
import { getAllUserService } from './service.js';
import { sendResponse } from '../sheared/sendResponse.js';
import catchAsync from '../sheared/catchAsync.js';
import { createAuthMiddleware } from '../middleware/auth.js';

/**
 * Mounts admin-only routes under `/admin/*`.
 * Phase 03: poster uploads. Later phases add reporting and operational tools.
 */
export function createAdminRouter(env: Env): ExpressRouter {
  const router = Router();

  router.use('/uploads', createUploadsRouter(env));


  router.get('/users',
    createAuthMiddleware(env).requireAuth,
    createAuthMiddleware(env).requireAdmin,
    
    catchAsync(async (req: Request, res: Response) => {
      const users = await getAllUserService();

      sendResponse(res, {
        httpStatusCode: 200,
        success: true,
        message: "Users fetched successfully",
        data: users,
      });

    })
  );

  return router;
}

