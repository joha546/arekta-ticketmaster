import type { NextFunction, Request, Response } from 'express';
import type { Env } from '../config/env.js';
import { findById } from '../auth/repository.js';
import { verifyAccessToken as verifyToken } from '../auth/jwt.js';
import { AppError } from '../errors/AppError.js';

import type { File } from 'multer';

/** Authenticated principal attached to the request by requireAuth / optionalAuth. */
export type AuthUser = {
  id: string;
  email: string;
  role: 'admin' | 'user';
};

export type AuthRequest = Request & {
  user?: AuthUser;
  file?: File;
};

export function verifyAccessToken(token: string, env: Env): AuthUser {
  return verifyToken(token, env);
}

function extractBearerToken(req: Request): string | null {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    return null;
  }
  return header.slice(7);
}

export function createAuthMiddleware(env: Env) {
  function requireAuth(req: AuthRequest, _res: Response, next: NextFunction) {
    const token = extractBearerToken(req);
    if (!token) {
      return next(new AppError('Authentication required', 401, 'UNAUTHORIZED'));
    }

    try {
      req.user = verifyAccessToken(token, env);
      next();
    } catch {
      next(new AppError('Invalid or expired token', 401, 'UNAUTHORIZED'));
    }
  }

  function optionalAuth(req: AuthRequest, _res: Response, next: NextFunction) {
    const token = extractBearerToken(req);
    if (!token) {
      return next();
    }

    try {
      req.user = verifyAccessToken(token, env);
    } catch {
      // optional auth — ignore invalid tokens
    }
    next();
  }

  function requireAdmin(req: AuthRequest, _res: Response, next: NextFunction) {
    if (!req.user) {
      return next(new AppError('Authentication required', 401, 'UNAUTHORIZED'));
    }
    if (req.user.role !== 'admin') {
      return next(new AppError('Admin access required', 403, 'FORBIDDEN'));
    }
    next();
  }

  async function requireVerifiedEmail(req: AuthRequest, _res: Response, next: NextFunction) {
    if (!req.user) {
      return next(new AppError('Authentication required', 401, 'UNAUTHORIZED'));
    }

    try {
      const user = await findById(req.user.id);
      if (!user) {
        return next(new AppError('Authentication required', 401, 'UNAUTHORIZED'));
      }
      if (!user.emailVerified) {
        return next(new AppError('Email verification required', 403, 'FORBIDDEN'));
      }
      next();
    } catch (error) {
      next(error);
    }
  }

  return { requireAuth, requireAdmin, optionalAuth, requireVerifiedEmail };
}
