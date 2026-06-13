import {
  loginRequestSchema,
  signupRequestSchema,
  googleAuthRequestSchema,
} from '@repo/shared';

/**
 * Re-export shared auth request schemas so route handlers import from one place.
 * Validation rules live in @repo/shared for reuse by the web app and API.
 */
export { loginRequestSchema, signupRequestSchema, googleAuthRequestSchema };
