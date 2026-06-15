import { Router, type Router as ExpressRouter } from 'express';
import multer from 'multer';
import type { Env } from '../config/env.js';
import { AppError } from '../errors/AppError.js';
import { createAuthMiddleware, type AuthRequest } from '../middleware/auth.js';
import { uploadToImgbb } from './imgbb.js';

const POSTER_MAX_BYTES = 5 * 1024 * 1024;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: POSTER_MAX_BYTES },
  fileFilter: (_req, file, cb) => {
    if (!file.mimetype.startsWith('image/')) {
      cb(new AppError('File must be an image', 400, 'VALIDATION_ERROR'));
      return;
    }
    cb(null, true);
  },
});

/**
 * Admin file upload routes under `/admin/uploads/*`.
 * Accepts multipart poster images and returns a hosted imgbb URL for movie forms.
 */
export function createUploadsRouter(env: Env): ExpressRouter {
  const router = Router();
  const { requireAuth, requireAdmin } = createAuthMiddleware(env);

  /** POST /admin/uploads/poster — multipart field `image` → `{ posterUrl }`. */
  router.post(
    '/poster',
    requireAuth,
    requireAdmin,
    (req, res, next) => {
      upload.single('image')(req, res, (error: unknown) => {
        if (error instanceof multer.MulterError) {
          if (error.code === 'LIMIT_FILE_SIZE') {
            return next(new AppError('Image must be 5 MB or smaller', 400, 'VALIDATION_ERROR'));
          }
          return next(new AppError(error.message, 400, 'VALIDATION_ERROR'));
        }
        if (error instanceof Error) {
          return next(error);
        }
        if (error) {
          return next(new AppError('Upload failed', 400, 'VALIDATION_ERROR'));
        }
        next();
      });
    },
    async (req: AuthRequest, res, next) => {
      try {
        const file = req.file;
        if (!file) {
          throw new AppError('Image file is required', 400, 'VALIDATION_ERROR');
        }

        const posterUrl = await uploadToImgbb(env.IMGBB_API_KEY, file.buffer, file.originalname);
        res.json({ posterUrl });
      } catch (error) {
        next(error);
      }
    },
  );

  return router;
}
