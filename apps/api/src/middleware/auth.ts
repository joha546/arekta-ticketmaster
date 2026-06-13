import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import type { Env } from '../config/env.js';
import { resolvePemValue } from '../config/pem.js';
import { AppError } from '../errors/AppError.js';

export type AuthUser = {
  id: string;
  email: string;
  role: 'admin' | 'user';
};

export type AuthRequest = Request & {
  user?: AuthUser;
};

type JwtPayload = {
  sub: string;
  email: string;
  role: 'admin' | 'user';
};

function normalizePemKey(key: string): string {
  return resolvePemValue(key);
}

export function verifyAccessToken(token: string, env: Env): AuthUser {
  const publicKey = normalizePemKey(env.JWT_PUBLIC_KEY);
  const payload = jwt.verify(token, publicKey, { algorithms: ['RS256'] }) as JwtPayload;

  return {
    id: payload.sub,
    email: payload.email,
    role: payload.role,
  };
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

  return { requireAuth, requireAdmin, optionalAuth };
}
