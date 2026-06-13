import { Router, type Router as ExpressRouter } from 'express';
import type pino from 'pino';
import type { Env } from '../config/env.js';
import { createAuthMiddleware, type AuthRequest } from '../middleware/auth.js';
import { validateBody } from '../middleware/validate.js';
import {
  googleAuthRequestSchema,
  loginRequestSchema,
  signupRequestSchema,
} from './schemas.js';
import {
  REFRESH_COOKIE_NAME,
  clearRefreshCookie,
  setRefreshCookie,
} from './refresh.js';
import { createAuthService } from './service.js';

/**
 * Mounts all `/auth/*` HTTP endpoints.
 * Routes are thin: validate input, delegate to AuthService, shape HTTP responses.
 */
export function createAuthRouter(env: Env, logger: pino.Logger): ExpressRouter {
  const router = Router();
  const auth = createAuthService(env, logger);
  const { requireAuth } = createAuthMiddleware(env);

  router.post('/signup', validateBody(signupRequestSchema), async (req, res, next) => {
    try {
      const result = await auth.signup(req.body);
      res.status(201).json(result);
    } catch (error) {
      next(error);
    }
  });

  router.post('/login', validateBody(loginRequestSchema), async (req, res, next) => {
    try {
      const tokens = await auth.login(req.body);
      setRefreshCookie(res, tokens.refreshToken, env);
      res.json({ accessToken: tokens.accessToken });
    } catch (error) {
      next(error);
    }
  });

  router.post('/refresh', async (req, res, next) => {
    try {
      const refreshToken = req.cookies?.[REFRESH_COOKIE_NAME] as string | undefined;
      if (!refreshToken) {
        return res.status(401).json({
          error: { code: 'INVALID_REFRESH', message: 'Refresh token required' },
        });
      }

      const tokens = await auth.refresh(refreshToken);
      setRefreshCookie(res, tokens.refreshToken, env);
      res.json({ accessToken: tokens.accessToken });
    } catch (error) {
      next(error);
    }
  });

  router.post('/logout', async (req, res, next) => {
    try {
      const refreshToken = req.cookies?.[REFRESH_COOKIE_NAME] as string | undefined;
      await auth.logout(refreshToken);
      clearRefreshCookie(res);
      res.status(204).send();
    } catch (error) {
      next(error);
    }
  });

  router.post('/google', validateBody(googleAuthRequestSchema), async (req, res, next) => {
    try {
      const tokens = await auth.googleLogin(req.body.idToken);
      setRefreshCookie(res, tokens.refreshToken, env);
      res.json({ accessToken: tokens.accessToken });
    } catch (error) {
      next(error);
    }
  });

  router.get('/verify-email', async (req, res, next) => {
    try {
      const token = typeof req.query.token === 'string' ? req.query.token : '';
      if (!token) {
        return res.status(400).json({
          error: { code: 'INVALID_TOKEN', message: 'Verification token required' },
        });
      }

      const result = await auth.verifyEmail(token);

      if (req.accepts('html')) {
        return res.redirect(`${env.APP_URL}/?verified=1`);
      }

      res.json(result);
    } catch (error) {
      next(error);
    }
  });

  router.post('/resend-verification', requireAuth, async (req: AuthRequest, res, next) => {
    try {
      const result = await auth.resendVerification(req.user!.id);
      res.json(result);
    } catch (error) {
      next(error);
    }
  });

  router.get('/me', requireAuth, async (req: AuthRequest, res, next) => {
    try {
      const result = await auth.getMe(req.user!.id);
      res.json(result);
    } catch (error) {
      next(error);
    }
  });

  return router;
}
